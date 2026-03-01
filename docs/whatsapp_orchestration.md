# WhatsApp Orchestration Design (AWS Serverless)

## State Machine

The `whatsapp_sessions` DynamoDB item's `session_state` attribute drives the conversation flow:

```
greeting → browsing → product_inquiry → negotiation → ordering → payment → tracking
                ↕            ↕                ↕            ↕
             support ←→ idle ←→ closed
```

### State Definitions

| State             | Description                                | Triggers Transition To                               |
| ----------------- | ------------------------------------------ | ---------------------------------------------------- |
| `greeting`        | New/returning user welcome                 | → `browsing` (auto after greeting)                   |
| `browsing`        | Showing categories/products                | → `product_inquiry` (user selects product)           |
| `product_inquiry` | Product details, Q&A                       | → `negotiation` or → `ordering`                      |
| `negotiation`     | AI price negotiation                       | → `ordering` (deal agreed) or → `idle` (walked away) |
| `ordering`        | Collecting shipping info, confirming order | → `payment` (order created)                          |
| `payment`         | Payment link sent, waiting                 | → `tracking` (payment confirmed)                     |
| `tracking`        | Order status updates                       | → `idle` or → `browsing`                             |
| `support`         | Dispute/help mode                          | → previous state or → `idle`                         |
| `idle`            | Inactive, waiting for user                 | → any active state on message                        |
| `closed`          | Session expired/ended                      | New session on next message                          |

## What State Lives Where

### DynamoDB (persistent, source of truth)

```
PK: SESSION#{session_id}
SK: METADATA
Attributes:
  - phone_number (string) [GSI: PhoneIndex for lookup]
  - customer_id (string)
  - session_state (string: greeting | browsing | product_inquiry | etc.)
  - active_order_id (string, optional)
  - active_product_id (string, optional)
  - conversation_state (object: cart items, selected category, shipping draft)
  - last_activity_at (string ISO timestamp)
  - created_at (string ISO timestamp)
  - expires_at (string ISO timestamp, TTL for auto-cleanup)

PK: SESSION#{session_id}
SK: MESSAGE#{timestamp}#{wa_message_id}
Attributes:
  - wa_message_id (string, unique from WhatsApp)
  - direction ('inbound' | 'outbound')
  - message_type ('text' | 'image' | 'interactive' | 'template')
  - content (object: varies by type)
  - wa_status ('sent' | 'delivered' | 'read' | 'failed')
  - error_code (string, optional)
  - error_message (string, optional)
  - created_at (string ISO timestamp)
```

### No Redis Required

Unlike the old architecture, we don't need Redis for hot caching:
- Session lookups use DynamoDB GSI on `phone_number` (fast, consistent)
- Idempotency handled via DynamoDB conditional writes
- Rate limiting handled via API Gateway throttling
- Cart state stored in `conversation_state` JSONB attribute

## Webhook Processing Pipeline

```
Meta Webhook POST → API Gateway → Lambda (fast-ack pattern)
    │
    ├─ 1. Signature Verification (X-Hub-Signature-256)
    │      └─ Reject → 401
    │
    ├─ 2. Fast ACK (return 200 OK immediately)
    │      └─ Archive raw payload to S3 (async)
    │
    ├─ 3. Publish to EventBridge
    │      └─ Event: WhatsAppMessageReceived
    │
    └─ EventBridge → SQS → Lambda (async processor)
           │
           ├─ 4. Parse webhook type
           │      ├─ Message → message pipeline
           │      └─ Status update → status pipeline
           │
           ├─ 5. Idempotency Check (DynamoDB conditional write)
           │      └─ Duplicate → skip
           │
           ├─ 6. Rate Limit Check (API Gateway handles this)
           │
           ├─ 7. Session Resolution
           │      ├─ Query PhoneIndex GSI → get session
           │      └─ Not found → create new session + customer
           │
           ├─ 8. Message Handler Dispatch (by session_state)
           │      ├─ greeting_handler()
           │      ├─ browsing_handler()
           │      ├─ product_inquiry_handler()
           │      ├─ negotiation_handler() → PriceGuardian
           │      ├─ ordering_handler()
           │      ├─ payment_handler()
           │      ├─ tracking_handler()
           │      └─ support_handler()
           │
           ├─ 9. Response Generation
           │      ├─ Build response (text/interactive/template)
           │      └─ Send via WhatsApp Cloud API
           │
           ├─ 10. Persist
           │      ├─ Store inbound message (DynamoDB)
           │      ├─ Store outbound message (DynamoDB)
           │      └─ Update session state (DynamoDB)
           │
           └─ 11. On failure → SQS DLQ for retry/manual review
```

## Fast-Ack Pattern

WhatsApp requires 200 OK within 5 seconds. We use a two-stage pattern:

### Stage 1: Webhook Receiver (Fast)

```typescript
// services/api/src/handlers/whatsapp/webhook.ts
export async function handler(event: APIGatewayProxyEventV2) {
  // 1. Verify signature
  const signature = event.headers['x-hub-signature-256'];
  const secret = await getSecret('whatsapp-app-secret');
  
  if (!verifyWhatsAppSignature(event.body!, signature!, secret)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }
  
  // 2. Archive raw payload to S3 (fire-and-forget)
  s3Client.send(new PutObjectCommand({
    Bucket: process.env.RAW_EVENTS_BUCKET!,
    Key: `whatsapp/${Date.now()}.json`,
    Body: event.body
  })).catch(err => logger.error('S3 archive failed', { err }));
  
  // 3. Publish to EventBridge for async processing
  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      Source: 'vyapargyan.whatsapp',
      DetailType: 'WhatsAppWebhookReceived',
      Detail: event.body!
    }]
  }));
  
  // 4. Return 200 OK immediately (< 1 second)
  return { statusCode: 200, body: 'OK' };
}
```

### Stage 2: Async Processor (Thorough)

```typescript
// services/api/src/handlers/whatsapp/process-message.ts
// Triggered by EventBridge → SQS → Lambda
export async function handler(event: SQSEvent) {
  for (const record of event.Records) {
    const webhook = JSON.parse(record.body);
    
    try {
      await processWhatsAppWebhook(webhook);
    } catch (error) {
      logger.error('Webhook processing failed', { error, webhook });
      throw error; // Will retry via SQS, then DLQ
    }
  }
}
```

## Customer Flows

### New Customer Onboarding

1. First message from unknown phone → query PhoneIndex GSI (not found)
2. Create customer in DynamoDB:
   ```
   PK: CUSTOMER#{customer_id}
   SK: METADATA
   Attributes:
     - phone_number (string)
     - whatsapp_verified (boolean: true)
     - created_at (string ISO timestamp)
   ```
3. Create session:
   ```
   PK: SESSION#{session_id}
   SK: METADATA
   Attributes:
     - phone_number (string)
     - customer_id (string)
     - session_state ('greeting')
     - expires_at (now + 24 hours)
   ```
4. Send welcome template via WhatsApp Cloud API
5. Transition to `browsing`

### Product Browsing

1. Show category list as interactive buttons (WhatsApp interactive message)
2. User selects category → query products by category (DynamoDB GSI)
3. Show products as interactive list (name + price + image URL)
4. User selects product → transition to `product_inquiry`

### Order Intent → Creation

1. User says "I want to buy this" or selects "Order" button
2. Collect shipping info step-by-step:
   - Name → store in `conversation_state.shipping_draft.name`
   - Address → store in `conversation_state.shipping_draft.address`
   - Pincode → store in `conversation_state.shipping_draft.pincode`
3. Show order summary, ask for confirmation
4. On confirm: invoke order creation Lambda (via internal API or direct call)
5. Order created → transition to `payment`

## Duplicate Webhook Prevention

### Idempotency via DynamoDB

```typescript
// Check if message already processed
const messageId = webhook.entry[0].changes[0].value.messages[0].id;

try {
  await dynamoClient.send(new PutCommand({
    TableName: process.env.TABLE_NAME!,
    Item: {
      PK: `IDEMPOTENCY#${messageId}`,
      SK: 'PROCESSED',
      processed_at: new Date().toISOString(),
      ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    },
    ConditionExpression: 'attribute_not_exists(PK)' // Fail if already exists
  }));
} catch (error) {
  if (error.name === 'ConditionalCheckFailedException') {
    logger.info('Duplicate message, skipping', { messageId });
    return; // Already processed
  }
  throw error;
}
```

### Status Update Tracking

```typescript
// Update message status (sent → delivered → read)
await dynamoClient.send(new UpdateCommand({
  TableName: process.env.TABLE_NAME!,
  Key: { PK: `SESSION#${sessionId}`, SK: `MESSAGE#${timestamp}#${waMessageId}` },
  UpdateExpression: 'SET wa_status = :status, updated_at = :now',
  ConditionExpression: 'attribute_exists(PK)', // Only update if message exists
  ExpressionAttributeValues: {
    ':status': newStatus,
    ':now': new Date().toISOString()
  }
}));
```

## Retry Strategy

### Outbound Message Failures

```typescript
// services/api/src/adapters/whatsapp-adapter.ts
import { retry } from '@utils/retry';

export async function sendMessage(phone: string, content: any) {
  return retry(
    async () => {
      const response = await whatsappApi.post('/messages', {
        messaging_product: 'whatsapp',
        to: phone,
        ...content
      });
      return response.data;
    },
    {
      maxAttempts: 3,
      delayMs: [1000, 5000, 30000], // 1s, 5s, 30s
      onRetry: (attempt, error) => {
        logger.warn('WhatsApp send retry', { attempt, error, phone });
      }
    }
  );
}
```

### Failed Messages → DLQ

- SQS processes webhook events with 2 retries
- After 3 total attempts, message sent to Dead Letter Queue
- CloudWatch alarm triggers on DLQ depth > 10
- Manual review and reprocessing from DLQ

## Session Cleanup

### EventBridge Scheduled Rule

```typescript
// Runs daily at 2 AM UTC
// services/api/src/handlers/whatsapp/cleanup-sessions.ts
export async function handler() {
  const now = Date.now();
  const expiredThreshold = now - (24 * 60 * 60 * 1000); // 24 hours ago
  
  // Query sessions with last_activity_at < threshold
  // Use GSI: LastActivityIndex
  const expiredSessions = await sessionAdapter.queryExpired(expiredThreshold);
  
  for (const session of expiredSessions) {
    await sessionAdapter.update(session.id, {
      session_state: 'closed',
      expires_at: new Date().toISOString()
    });
    
    logger.info('Session expired', { sessionId: session.id, phone: session.phone_number });
  }
  
  return { expired: expiredSessions.length };
}
```

### DynamoDB TTL

Sessions have `expires_at` attribute with TTL enabled:
- Automatically deleted by DynamoDB after expiration
- No manual cleanup needed for old data
- Messages also have TTL (30 days retention)

## Idempotency Strategy

1. **Inbound webhook**: Check `IDEMPOTENCY#{wa_message_id}` with conditional write
2. **Outbound send**: Generate unique message reference, store before sending
3. **State transition**: Use conditional expressions on `session_state` to prevent invalid transitions
4. **Cart operations**: Atomic updates to `conversation_state` JSONB attribute

## DynamoDB Schema

### Sessions

```
PK: SESSION#{session_id}
SK: METADATA
GSI: PhoneIndex (phone_number → session_id)
GSI: LastActivityIndex (last_activity_at → session_id)
Attributes:
  - phone_number (string)
  - customer_id (string)
  - session_state (string)
  - active_order_id (string, optional)
  - active_product_id (string, optional)
  - conversation_state (object: cart, shipping_draft, selected_category)
  - last_activity_at (string ISO timestamp)
  - created_at (string ISO timestamp)
  - expires_at (number, TTL)
```

### Messages

```
PK: SESSION#{session_id}
SK: MESSAGE#{timestamp}#{wa_message_id}
Attributes:
  - wa_message_id (string, unique from WhatsApp)
  - direction ('inbound' | 'outbound')
  - message_type ('text' | 'image' | 'interactive' | 'template')
  - content (object)
  - wa_status ('sent' | 'delivered' | 'read' | 'failed')
  - error_code (string, optional)
  - error_message (string, optional)
  - created_at (string ISO timestamp)
  - ttl (number, 30 days)
```

### Idempotency Records

```
PK: IDEMPOTENCY#{wa_message_id}
SK: PROCESSED
Attributes:
  - processed_at (string ISO timestamp)
  - ttl (number, 24 hours)
```

## Monitoring

- **CloudWatch Metrics**: Message processing latency, success rate, DLQ depth
- **CloudWatch Alarms**: Alert on high error rate, DLQ depth > 10, processing latency > 10s
- **X-Ray Tracing**: End-to-end tracing from webhook receipt to response sent
- **Structured Logs**: All state transitions, message sends, errors logged with session context

## Key Differences from Supabase + Redis

| Aspect                | Supabase + Redis (Old)              | DynamoDB (New)                      |
| --------------------- | ----------------------------------- | ----------------------------------- |
| Session Storage       | PostgreSQL + Redis cache            | DynamoDB (single source of truth)   |
| Session Lookup        | Redis cache → PostgreSQL fallback   | DynamoDB GSI (PhoneIndex)           |
| Idempotency           | Redis SET NX + PostgreSQL UNIQUE    | DynamoDB conditional writes         |
| Rate Limiting         | Redis counters                      | API Gateway throttling              |
| Cart State            | Redis hash                          | DynamoDB JSONB attribute            |
| Message History       | PostgreSQL                          | DynamoDB (same table, different SK) |
| Session Cleanup       | Cron job + Redis expiry             | EventBridge + DynamoDB TTL          |
| Webhook Processing    | Synchronous in FastAPI              | Async via EventBridge + SQS         |
