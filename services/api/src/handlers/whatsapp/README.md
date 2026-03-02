# WhatsApp Handler Implementation

## Quick Reference

### Architecture Overview

```
WhatsApp → Webhook → EventBridge → SQS → Worker → State Handler → WhatsApp
```

### File Structure

```
handlers/whatsapp/
├── webhook.ts              # Webhook receiver (fast-ack)
├── worker.ts               # Async message processor
├── states/
│   ├── router.ts           # Route to state handlers
│   ├── greeting-handler.ts # Welcome and category list
│   ├── browsing-handler.ts # Catalog browsing and search
│   └── checkout-handler.ts # Order creation (placeholder)
└── __tests__/
    ├── webhook.test.ts     # Webhook tests
    ├── TEST_PLAN.md        # Complete test plan
    └── integration.md      # Integration test guide

repositories/
├── customer-repository.ts  # Customer management
├── session-repository.ts   # Session state management
├── message-repository.ts   # Message history
└── catalog-repository.ts   # Product catalog access

services/
└── whatsapp-sender.ts      # Outbound message sending
```

## State Machine

```
greeting → browsing → product_inquiry → ordering → payment
              ↕            ↕                ↕
           support ←→ idle ←→ closed
```

## Message Flow

### Inbound Message Processing

1. **Webhook Handler** (`webhook.ts`)
   - Verify signature
   - Return 200 OK immediately
   - Publish to EventBridge

2. **Worker Lambda** (`worker.ts`)
   - Receive from SQS
   - Check idempotency
   - Resolve customer and session
   - Route to state handler

3. **State Handler** (`states/*.ts`)
   - Store inbound message
   - Detect intent
   - Fetch catalog data
   - Generate response
   - Send via WhatsAppSender
   - Update session state

### Outbound Message Sending

1. **WhatsAppSender** (`services/whatsapp-sender.ts`)
   - Build WhatsApp API payload
   - Send with retry logic (3 attempts)
   - Persist message to DynamoDB
   - Return message ID

## Intent Detection

### Interactive Messages
- Button reply: Extract ID from `interactive.button_reply.id`
- List reply: Extract ID from `interactive.list_reply.id`
- ID patterns:
  - `cat_{categoryId}` → Browse category
  - `prod_{productId}` → View product

### Text Messages
- "categories", "menu", "browse" → Show categories
- "help", "support" → Show help
- Other text (>2 chars) → Search products

## Message Types

### Text Message
```typescript
{
  type: 'text',
  text: 'Hello customer!'
}
```

### Button Message (max 3 buttons)
```typescript
{
  type: 'interactive',
  body: 'Choose an option:',
  buttons: [
    { id: 'btn_1', title: 'Option 1' },
    { id: 'btn_2', title: 'Option 2' }
  ]
}
```

### List Message
```typescript
{
  type: 'interactive',
  body: 'Select from list:',
  buttonText: 'View Options',
  sections: [
    {
      title: 'Section 1',
      rows: [
        { id: 'item_1', title: 'Item 1', description: 'Details' }
      ]
    }
  ]
}
```

## DynamoDB Access Patterns

### Get Session by Customer
```typescript
PK: SESSION#{customerId}
SK: WHATSAPP#{phoneNumber}
```

### Get Customer by Phone
```typescript
PK: CUSTOMER#{phoneNumber}
SK: PROFILE
```

### Get Messages for Session
```typescript
PK: SESSION#{sessionId}
SK: MESSAGE#{timestamp}#{waMessageId}
```

### Get Categories
```typescript
PK: CATEGORY
SK: CATEGORY#{categoryId}
```

### Get Products by Category
```typescript
GSI: CategoryIndex
categoryId = {categoryId}
Filter: isActive = true AND stockQuantity > 0
```

## Common Operations

### Create New Session
```typescript
const session = await sessionRepository.resolveOrCreate({
  customerId: customer.id,
  phoneNumber: customer.phoneNumber,
  channelType: 'whatsapp',
});
```

### Update Session State
```typescript
await sessionRepository.updateState(
  session.id,
  session.customerId,
  session.phoneNumber,
  'browsing'
);
```

### Store Message
```typescript
await messageRepository.create({
  sessionId: session.id,
  waMessageId: message.id,
  direction: 'inbound',
  messageType: message.type,
  content: message,
});
```

### Send WhatsApp Message
```typescript
const waMessageId = await whatsappSender.sendMessage(
  customer.phoneNumber,
  {
    type: 'text',
    text: 'Hello!',
  },
  session.id
);
```

### Get Categories
```typescript
const categories = await catalogRepository.getCategories();
```

### Get Products by Category
```typescript
const products = await catalogRepository.getProductsByCategory(
  categoryId,
  limit
);
```

### Search Products
```typescript
const products = await catalogRepository.searchProducts(
  query,
  limit
);
```

## Error Handling

### Webhook Errors
- Always return 200 OK to prevent Meta retries
- Log errors to CloudWatch
- Invalid signature → Log and return 200

### Worker Errors
- Throw error to move message to DLQ
- DLQ depth alarm triggers on > 10 messages
- Manual review and reprocessing from DLQ

### Send Errors
- Retry 3 times with exponential backoff (2s, 4s, 8s)
- Persist failed message with error details
- Log error to CloudWatch

## Logging

### Key Events to Log
- Webhook received (requestId, method, path)
- Session resolved (sessionId, customerId, state)
- Message persisted (messageId, direction, type)
- Intent detected (sessionId, intent)
- Outbound send attempted (sessionId, phoneNumber)
- Outbound send success/failure (waMessageId, error)
- State transitions (sessionId, oldState, newState)

### Log Format
```typescript
logger.info('Event description', {
  sessionId: 'sess-123',
  customerId: 'cust-456',
  additionalContext: 'value',
});
```

## Configuration

### Required Environment Variables
- `ENVIRONMENT` - dev | staging | prod
- `AWS_REGION` - AWS region
- `TABLE_NAME` - DynamoDB table name
- `EVENT_BUS_NAME` - EventBridge event bus name
- `WHATSAPP_API_URL` - WhatsApp Cloud API URL
- `WHATSAPP_TOKEN` - Access token (from Secrets Manager)
- `WHATSAPP_PHONE_NUMBER_ID` - Phone number ID
- `WHATSAPP_VERIFY_TOKEN` - Webhook verification token
- `WHATSAPP_APP_SECRET` - App secret for signature verification

### Secrets Manager Paths
- `/{env}/whatsapp/token` - WhatsApp access token
- `/{env}/whatsapp/verify-token` - Webhook verification token
- `/{env}/whatsapp/app-secret` - App secret

### SSM Parameter Paths
- `/{env}/whatsapp/phone-number-id` - Phone number ID

## Testing

### Run Unit Tests
```bash
pnpm --filter @vyapargyan/api test
```

### Run Integration Tests
```bash
pnpm --filter @vyapargyan/api test:integration
```

### Manual Testing
1. Configure WhatsApp webhook URL in Meta dashboard
2. Send test message from WhatsApp
3. Check CloudWatch logs for processing
4. Verify response received in WhatsApp

## Deployment

### Build
```bash
cd services/api
pnpm build
```

### Deploy with CDK
```bash
cd infra/cdk
pnpm cdk deploy --all --context env=dev
```

### Verify Deployment
1. Check Lambda functions deployed
2. Verify EventBridge rule created
3. Verify SQS queue created
4. Test webhook endpoint

## Troubleshooting

### No Response from WhatsApp
- Check CloudWatch logs for errors
- Verify webhook signature validation
- Check EventBridge event published
- Verify SQS queue receiving messages
- Check worker Lambda invoked

### Duplicate Messages
- Check idempotency service logs
- Verify message ID unique
- Check DynamoDB conditional write

### Send Failures
- Check WhatsApp API credentials
- Verify phone number ID correct
- Check API rate limits
- Review retry logs

### Session Not Found
- Check customer repository logs
- Verify phone number format
- Check DynamoDB query syntax

## Next Steps

1. **Add Cart Management**
   - Implement "add to cart" intent
   - Store cart in session.context
   - Show cart summary

2. **Implement Order Creation**
   - Create OrderRepository
   - Build order creation flow
   - Integrate with payment service

3. **Add Payment Integration**
   - Generate Razorpay payment link
   - Handle payment webhook
   - Update order status

4. **Enhance Observability**
   - CloudWatch dashboards
   - Custom metrics
   - X-Ray tracing

## Resources

- [WhatsApp Cloud API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Meta Webhook Documentation](https://developers.facebook.com/docs/graph-api/webhooks)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
