# Payment Integration Design (Razorpay + AWS Serverless)

## Architecture

```
Order Confirmed (seller accepts)
    │
    ├─ 1. Lambda: CreatePaymentLink
    │      ├─ Generate idempotency_key: "pay_{order_id}_{attempt}"
    │      ├─ Call Razorpay API: POST /payment_links
    │      │      Body: { amount: order.total_amount * 100 (paise), currency: "INR",
    │      │              description: "Order #VG-20260228-0001",
    │      │              customer: { contact: phone },
    │      │              notify: { sms: false, email: false },  // We notify via WhatsApp
    │      │              callback_url: "https://api.vyapargyan.com/payments/callback",
    │      │              callback_method: "get" }
    │      ├─ Store in DynamoDB payments table:
    │      │      PK: PAYMENT#{payment_id}, SK: METADATA
    │      │      provider_order_id, payment_link_url, payment_link_id,
    │      │      idempotency_key, status='created', order_id
    │      └─ Return payment_link_url
    │
    ├─ 2. Send payment link to customer (WhatsApp message via SQS)
    │
    ├─ 3. Customer pays via UPI/Card/NetBanking
    │
    └─ 4. Razorpay Webhook → API Gateway → Lambda: ProcessPaymentWebhook
           ├─ Verify signature (X-Razorpay-Signature)
           ├─ Archive raw payload to S3 (audit trail)
           ├─ Process event (idempotent)
           ├─ Update DynamoDB: payment + order + inventory (TransactWriteItems)
           └─ Publish event to EventBridge for notifications
```

## Webhook Verification

```typescript
import crypto from 'crypto';

export function verifyRazorpayWebhook(
  payloadBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payloadBody)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}
```

## Event Handling

| Razorpay Event      | Action                                                                        |
| ------------------- | ----------------------------------------------------------------------------- |
| `payment_link.paid` | Update payment status→captured, update order status→confirmed, finalize stock |
| `payment.captured`  | Same as above (backup event)                                                  |
| `payment.failed`    | Update payment status→failed, notify customer to retry                        |
| `refund.processed`  | Update payment status→refunded, update order→refunded                         |

## Duplicate Event Protection

1. Extract `event_id` from Razorpay payload
2. Check DynamoDB for existing event: `PK: EVENT#{event_id}, SK: PROCESSED`
3. Use conditional write: `attribute_not_exists(PK)` to ensure idempotency
4. If condition fails, return 200 OK (already processed)
5. Store event metadata with TTL for automatic cleanup after 30 days

## Payment → Order Update Flow

```typescript
// services/api/src/handlers/payments/webhook.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export async function handlePaymentCaptured(event: RazorpayEvent) {
  const paymentLinkId = event.payload.payment_link.entity.id;
  
  // 1. Lookup payment by payment_link_id (GSI query)
  const payment = await paymentAdapter.findByPaymentLinkId(paymentLinkId);
  if (!payment || payment.status === 'captured') {
    return; // idempotent
  }

  // 2. Lookup order
  const order = await orderAdapter.get(payment.orderId);
  
  // 3. Atomic update using TransactWriteItems
  const transactItems = [
    // Update payment
    {
      Update: {
        TableName: process.env.TABLE_NAME!,
        Key: { PK: `PAYMENT#${payment.id}`, SK: 'METADATA' },
        UpdateExpression: 'SET #status = :captured, provider_payment_id = :pid, paid_at = :now, raw_webhook = :raw',
        ConditionExpression: '#status <> :captured', // prevent duplicate processing
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':captured': 'captured',
          ':pid': event.payload.payment.entity.id,
          ':now': new Date().toISOString(),
          ':raw': event
        }
      }
    },
    // Update order
    {
      Update: {
        TableName: process.env.TABLE_NAME!,
        Key: { PK: `ORDER#${order.id}`, SK: 'METADATA' },
        UpdateExpression: 'SET #status = :confirmed, updated_at = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':confirmed': 'confirmed',
          ':now': new Date().toISOString()
        }
      }
    },
    // Finalize stock for each item
    ...order.items.map(item => ({
      Update: {
        TableName: process.env.TABLE_NAME!,
        Key: { PK: `PRODUCT#${item.productId}`, SK: 'METADATA' },
        UpdateExpression: 'SET stock_quantity = stock_quantity - :qty, reserved_stock = reserved_stock - :qty',
        ConditionExpression: 'reserved_stock >= :qty', // ensure stock still reserved
        ExpressionAttributeValues: { ':qty': item.quantity }
      }
    })),
    // Create inventory logs
    ...order.items.map(item => ({
      Put: {
        TableName: process.env.TABLE_NAME!,
        Item: {
          PK: `PRODUCT#${item.productId}`,
          SK: `INVLOG#${Date.now()}#${crypto.randomUUID()}`,
          change_type: 'sale',
          quantity_change: -item.quantity,
          reference_type: 'order',
          reference_id: order.id,
          created_at: new Date().toISOString()
        }
      }
    })),
    // Mark event as processed
    {
      Put: {
        TableName: process.env.TABLE_NAME!,
        Item: {
          PK: `EVENT#${event.id}`,
          SK: 'PROCESSED',
          processed_at: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
        },
        ConditionExpression: 'attribute_not_exists(PK)' // idempotency
      }
    }
  ];

  await dynamoClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

  // 4. Publish event to EventBridge for async notifications
  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      Source: 'vyapargyan.payments',
      DetailType: 'PaymentCaptured',
      Detail: JSON.stringify({ orderId: order.id, paymentId: payment.id, sellerId: order.sellerId })
    }]
  }));

  // 5. Archive raw webhook to S3
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.RAW_EVENTS_BUCKET!,
    Key: `webhooks/razorpay/${event.id}.json`,
    Body: JSON.stringify(event),
    ContentType: 'application/json'
  }));
}
```

## Security Checks

- **Signature verification** on every webhook (reject unsigned requests with 401)
- **Amount validation**: verify payment amount matches order total_amount
- **Currency validation**: verify INR
- **Idempotency**: DynamoDB conditional writes prevent duplicate processing
- **Fraud review flag**: auto-set if amount mismatch or unusual pattern detected
- **Rate limiting**: API Gateway throttling (max 100 webhook calls per second)
- **Secrets**: Razorpay API key and webhook secret stored in AWS Secrets Manager

## DynamoDB Schema

### Payments Table

```
PK: PAYMENT#{payment_id}
SK: METADATA
Attributes:
  - order_id (string)
  - payment_link_id (string) [GSI: PaymentLinkIndex]
  - payment_link_url (string)
  - provider_order_id (string)
  - provider_payment_id (string)
  - idempotency_key (string) [GSI: IdempotencyIndex]
  - status (string: created | captured | failed | refunded)
  - amount (number)
  - currency (string)
  - paid_at (string ISO timestamp)
  - raw_webhook (object)
  - fraud_review_flag (boolean)
  - created_at (string ISO timestamp)
  - updated_at (string ISO timestamp)
```

### Event Deduplication

```
PK: EVENT#{razorpay_event_id}
SK: PROCESSED
Attributes:
  - processed_at (string ISO timestamp)
  - ttl (number) - DynamoDB TTL for automatic cleanup
```

## Error Handling

- **Webhook processing failure**: Lambda retries automatically (up to 2 retries)
- **DynamoDB transaction failure**: Conditional check failures are logged, webhook returns 200 OK (idempotent)
- **Razorpay API failure**: Exponential backoff with max 3 retries
- **Dead letter queue**: Failed webhook events sent to SQS DLQ for manual review
- **CloudWatch alarms**: Alert on high error rates, DLQ depth, or payment processing latency

## Monitoring

- **CloudWatch Metrics**:
  - Payment link creation success/failure rate
  - Webhook processing latency
  - Transaction success rate
  - Fraud review flag count
- **CloudWatch Logs**: Structured JSON logs with request IDs for correlation
- **X-Ray Tracing**: End-to-end tracing from webhook receipt to order confirmation
- **Alarms**: Alert on error rate > 1%, latency > 5s, or DLQ depth > 10

## Idempotency Strategy

1. **Payment creation**: Check `IdempotencyIndex` GSI before creating payment
2. **Webhook processing**: Conditional write on `EVENT#{event_id}` ensures single processing
3. **Order updates**: Conditional expressions prevent invalid state transitions
4. **Stock updates**: Conditional expressions ensure reserved stock exists before finalizing

## Razorpay Configuration

Stored in AWS Secrets Manager:

```json
{
  "razorpay_key_id": "rzp_live_...",
  "razorpay_key_secret": "...",
  "razorpay_webhook_secret": "..."
}
```

Lambda retrieves secrets at cold start and caches for subsequent invocations.
