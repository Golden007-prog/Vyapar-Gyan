# Razorpay Integration - Quick Reference

## Key Code Snippets

### 1. Creating Payment Link with Commission Splitting

```typescript
// services/api/src/adapters/razorpay-adapter.ts

const paymentLinkResponse = await razorpayAdapter.createPaymentLink({
  orderId: 'VG-20260305-1234',
  amount: 1000,                    // Total amount in INR
  customerPhone: '+919876543210',
  customerName: 'Customer Name',
  description: 'Order VG-20260305-1234',
  sellerAccountId: 'acc_SELLER123', // Seller's Razorpay linked account
  commissionAmount: 150,            // Platform commission (15%)
});

// Result: 
// - Customer pays ₹1000
// - Platform receives ₹1000
// - Razorpay automatically transfers ₹850 to seller
// - Platform retains ₹150 commission
```

### 2. Payment Link Payload Structure

```typescript
{
  amount: 100000,              // Amount in paise (₹1000)
  currency: 'INR',
  accept_partial: false,
  description: 'Order VG-20260305-1234',
  customer: {
    contact: '+919876543210',
    name: 'Customer Name',
  },
  notify: {
    sms: true,
    whatsapp: true,           // Razorpay sends payment link via WhatsApp
  },
  reminder_enable: true,
  callback_url: 'https://api.vyapargyan.com/api/webhooks/razorpay/callback',
  reference_id: 'order-uuid',
  notes: {
    order_id: 'VG-20260305-1234',
    commission_amount: '150',
    seller_amount: '850',
  },
  transfers: [                // Razorpay Route: Automatic transfer
    {
      account: 'acc_SELLER123',
      amount: 85000,          // Seller amount in paise (₹850)
      currency: 'INR',
      notes: {
        order_id: 'VG-20260305-1234',
        type: 'seller_payout',
      },
      on_hold: false,         // Transfer immediately on capture
    },
  ],
}
```

### 3. Webhook Signature Verification

```typescript
// services/api/src/handlers/payment/razorpay-webhook.ts

const signature = event.headers['x-razorpay-signature'];
const payload = event.body;

const expectedSignature = createHmac('sha256', webhookSecret)
  .update(payload)
  .digest('hex');

const isValid = expectedSignature === signature;

if (!isValid) {
  return {
    statusCode: 401,
    body: JSON.stringify({ error: 'Invalid signature' }),
  };
}
```

### 4. Processing Payment Captured Event

```typescript
// services/api/src/handlers/payment/razorpay-webhook.ts

async function handlePaymentCaptured(webhookData: any, requestId: string) {
  const payment = webhookData.payload.payment.entity;
  const orderId = payment.notes?.order_id;

  // Get order from DynamoDB
  const order = await getOrder(tableName, orderId);
  
  // Check idempotency
  if (order.status === 'PAID') {
    return; // Already processed
  }

  // Update order status
  await updateOrderStatus(tableName, orderId, 'PAID', {
    paymentId: payment.id,
    paymentMethod: payment.method,
    paymentCapturedAt: new Date().toISOString(),
  });

  // Notify customer
  await twilioAdapter.sendWhatsAppMessage(
    order.customerPhone,
    '✅ Payment Received! Your order is confirmed.'
  );

  // Notify seller
  await twilioAdapter.sendWhatsAppMessage(
    order.sellerPhone,
    '🔔 New Paid Order! Please pack and ship.'
  );
}
```

### 5. Checkout Handler Integration

```typescript
// services/api/src/handlers/whatsapp/states/checkout-handler.ts

// After order creation
const result = await orderService.createOrder({
  customerId: customer.id,
  customerPhone: customer.phoneNumber,
  cartItems: cart,
});

if (result.success && result.order) {
  const order = result.order;

  // Generate payment link
  const paymentLinkResponse = await razorpayAdapter.createPaymentLink({
    orderId: order.id,
    amount: order.totalAmount,
    customerPhone: customer.phoneNumber,
    sellerAccountId: 'acc_SELLER123',
    commissionAmount: order.commissionAmount,
  });

  // Send payment link to customer
  const message = `
✅ Order Created Successfully!

📦 Order ID: ${order.orderId}
💰 Total Amount: ₹${order.totalAmount}

💳 Please complete payment to confirm your order:
${paymentLinkResponse.short_url}

Thank you for shopping with VyaparGyan! 🎉
  `;

  await whatsappSender.sendMessage(customer.phoneNumber, {
    type: 'text',
    text: message,
  });
}
```

### 6. API Stack Configuration

```typescript
// infra/cdk/lib/stacks/api-stack.ts

// Create Razorpay webhook Lambda
this.razorpayWebhookFunction = new Function(this, 'RazorpayWebhookFunction', {
  functionName: `${config.resourcePrefix}-razorpay-webhook`,
  runtime: Runtime.NODEJS_20_X,
  handler: 'handlers/payment/razorpay-webhook.handler',
  code: Code.fromAsset('../../services/api/dist'),
  timeout: Duration.seconds(30),
  environment: {
    TABLE_NAME: table.tableName,
    RAZORPAY_WEBHOOK_SECRET: 'whsec_xxxxx',
  },
});

// Add webhook route (no auth required)
this.httpApi.addRoutes({
  path: '/api/webhooks/razorpay',
  methods: [HttpMethod.POST],
  integration: razorpayWebhookIntegration,
});
```

## Environment Variables

```bash
# Razorpay API Credentials
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxx

# Webhook Secret (from Razorpay Dashboard)
RAZORPAY_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx

# Seller Account (placeholder for MVP)
RAZORPAY_SELLER_ACCOUNT_ID=acc_xxxxxxxxxxxxx

# API Base URL (for callbacks)
API_BASE_URL=https://api.vyapargyan.com
```

## Webhook Events

### payment.captured
```json
{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_xxxxxxxxxxxxx",
        "amount": 100000,
        "currency": "INR",
        "status": "captured",
        "method": "upi",
        "notes": {
          "order_id": "VG-20260305-1234"
        }
      }
    }
  }
}
```

### payment.failed
```json
{
  "event": "payment.failed",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_xxxxxxxxxxxxx",
        "amount": 100000,
        "status": "failed",
        "error_code": "BAD_REQUEST_ERROR",
        "error_description": "Payment failed due to insufficient funds",
        "notes": {
          "order_id": "VG-20260305-1234"
        }
      }
    }
  }
}
```

## Testing with Razorpay Test Mode

### Test Cards
```
Success: 4111 1111 1111 1111
Failure: 4000 0000 0000 0002
CVV: Any 3 digits
Expiry: Any future date
```

### Test UPI
```
Success: success@razorpay
Failure: failure@razorpay
```

### Test Webhook
```bash
curl -X POST https://api.vyapargyan.com/api/webhooks/razorpay \
  -H "Content-Type: application/json" \
  -H "X-Razorpay-Signature: <signature>" \
  -d '{
    "event": "payment.captured",
    "payload": {
      "payment": {
        "entity": {
          "id": "pay_test123",
          "amount": 100000,
          "status": "captured",
          "notes": {
            "order_id": "test-order-id"
          }
        }
      }
    }
  }'
```

## Commission Calculation

```typescript
// Default commission rate: 15%
const commissionRate = 0.15;

// Example order
const subtotal = 1000;
const commissionAmount = Math.round(subtotal * commissionRate); // ₹150
const sellerAmount = subtotal - commissionAmount;                // ₹850

// Payment link transfers
transfers: [{
  account: sellerAccountId,
  amount: sellerAmount * 100, // 85000 paise
}]

// Result:
// - Customer pays: ₹1000
// - Seller receives: ₹850 (automatically transferred)
// - Platform retains: ₹150 (commission)
```

## Order Status Flow

```
PENDING_PAYMENT  →  PAID  →  PROCESSING  →  SHIPPED  →  DELIVERED
       ↓
PAYMENT_FAILED (customer can retry)
```

## Monitoring & Alerts

### CloudWatch Metrics
- Payment link generation success rate
- Webhook processing latency
- Payment failure rate
- Commission revenue

### CloudWatch Alarms
- High payment failure rate (> 10%)
- Webhook signature verification failures
- Order status update failures
- Seller notification failures

### CloudWatch Logs Insights Queries

**Payment Success Rate**:
```
fields @timestamp, orderId, status
| filter eventType = "payment.captured"
| stats count() by status
```

**Failed Payments**:
```
fields @timestamp, orderId, errorCode, errorDescription
| filter eventType = "payment.failed"
| sort @timestamp desc
```

**Webhook Processing Time**:
```
fields @timestamp, @duration
| filter @message like /Processing Razorpay webhook/
| stats avg(@duration), max(@duration), min(@duration)
```

## Troubleshooting

### Payment Link Not Generated
1. Check Razorpay credentials in environment
2. Verify seller account ID is valid
3. Check CloudWatch logs: `/aws/lambda/vyapargyan-dev-whatsapp-webhook`

### Webhook Not Received
1. Verify webhook URL in Razorpay dashboard
2. Check API Gateway access logs
3. Test webhook signature locally

### Order Status Not Updated
1. Check webhook signature verification
2. Verify order ID in payment notes
3. Check DynamoDB permissions for Lambda

### Seller Not Receiving Payout
1. Verify seller account is linked in Razorpay
2. Check Route transfer status in dashboard
3. Verify commission calculation

---

**Quick Links**:
- [Razorpay Payment Links API](https://razorpay.com/docs/api/payment-links/)
- [Razorpay Route Documentation](https://razorpay.com/docs/route/)
- [Webhook Signature Verification](https://razorpay.com/docs/webhooks/validate-test/)
