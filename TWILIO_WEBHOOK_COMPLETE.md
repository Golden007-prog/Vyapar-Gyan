# Twilio Webhook Integration Complete

## Summary

Successfully completed the Twilio pivot by updating the webhook handler, database infrastructure, and API Gateway configuration to properly handle Twilio's webhook format.

## Changes Made

### 1. Webhook Handler Refactoring (`services/api/src/handlers/whatsapp/webhook.ts`)

**Key Updates:**
- **Signature Validation Order**: Now parses form data BEFORE signature validation (Twilio's `validateRequest` requires parsed params, not raw body)
- **Field Name Compatibility**: Updated to handle both `SmsMessageSid`/`MessageSid` and `SmsStatus`/`MessageStatus` field variations from Twilio
- **Phone Number Normalization**: Strips both `whatsapp:` prefix AND `+` prefix to ensure consistent phone number format (e.g., `919876543210`)
- **Proper Signature Validation**: Passes parsed params object to `validateRequest()` instead of raw body string

**Flow:**
1. Receive POST request from Twilio
2. Parse form-encoded body (`application/x-www-form-urlencoded`)
3. Reconstruct full URL with query parameters
4. Verify Twilio signature using auth token, URL, and parsed params
5. Transform Twilio payload to Meta WhatsApp format (maintains worker.ts compatibility)
6. Publish to EventBridge for async processing

**Twilio Payload Fields Handled:**
- `SmsMessageSid` or `MessageSid` - Unique message identifier
- `From` - Sender's WhatsApp number (format: `whatsapp:+1234567890`)
- `To` - Recipient's WhatsApp number
- `Body` - Message text content
- `NumMedia` - Number of media attachments
- `MediaUrl0`, `MediaContentType0` - First media attachment
- `ProfileName` - Sender's WhatsApp profile name
- `SmsStatus` or `MessageStatus` - Message delivery status

### 2. Database Infrastructure (`infra/cdk/lib/stacks/database-stack.ts`)

**Added 6 New Global Secondary Indexes:**

1. **PhoneIndex**
   - PK: `phoneNumber` (e.g., `919876543210`)
   - SK: `channelType` (e.g., `whatsapp`)
   - Purpose: Lookup WhatsApp session by phone number

2. **CategoryIndex**
   - PK: `categoryId` (e.g., `cat-1`)
   - SK: `createdAt` (ISO timestamp)
   - Purpose: List products by category, sorted by creation date

3. **SellerStockIndex** ⭐
   - PK: `sellerId` (e.g., `seller-456`)
   - SK: `stockAddedDate` (ISO timestamp)
   - Purpose: AI dead-stock detection by querying aging inventory
   - Used by: Bedrock orchestration workers to identify products for discount campaigns

4. **SellerOrdersIndex**
   - PK: `sellerId` (e.g., `seller-456`)
   - SK: `createdAt` (ISO timestamp)
   - Purpose: List orders by seller, sorted by creation date (most recent first)

5. **CustomerOrdersIndex**
   - PK: `customerId` (e.g., `cust-123`)
   - SK: `createdAt` (ISO timestamp)
   - Purpose: List orders by customer, sorted by creation date

6. **GSI1, GSI2, GSI3** (existing)
   - Maintained for role-based queries, email lookups, and payment lookups

**Configuration:**
- All GSIs use `ProjectionType.ALL` for complete data access
- Billing mode respects environment config (on-demand for dev, provisioned optional for prod)
- Read/write capacity configured only when using provisioned billing

### 3. API Gateway Configuration (`infra/cdk/lib/stacks/api-stack.ts`)

**Key Update:**
- Added `payloadFormatVersion: '2.0'` to Lambda integration
- Ensures API Gateway passes raw request body and headers properly
- Critical for Twilio signature validation (requires exact body match)

**Webhook Route:**
- Path: `/api/v1/whatsapp/webhook`
- Methods: `GET` (verification), `POST` (messages)
- Integration: Lambda proxy with payload format v2.0

## Testing Checklist

### Webhook Handler
- [ ] Twilio signature validation works with real webhooks
- [ ] Form-encoded body parsing handles special characters
- [ ] Phone number normalization strips both `whatsapp:` and `+` prefixes
- [ ] Handles both `SmsMessageSid` and `MessageSid` field names
- [ ] Media messages (image, video, audio, document) transform correctly
- [ ] EventBridge publishing succeeds
- [ ] Worker.ts processes transformed events without changes

### Database
- [ ] Deploy CDK stack successfully
- [ ] All 6 GSIs created in DynamoDB
- [ ] PhoneIndex enables session lookup by phone
- [ ] CategoryIndex enables product browsing by category
- [ ] SellerStockIndex enables AI dead-stock queries
- [ ] SellerOrdersIndex enables seller order history
- [ ] CustomerOrdersIndex enables customer order history

### API Gateway
- [ ] Webhook URL accessible: `https://{api-id}.execute-api.{region}.amazonaws.com/api/v1/whatsapp/webhook`
- [ ] POST requests pass raw body to Lambda
- [ ] Headers (especially `X-Twilio-Signature`) passed correctly
- [ ] CORS configured for web app origins

## Configuration Requirements

### Secrets Manager
```bash
# Twilio credentials (required for signature validation)
aws secretsmanager create-secret \
  --name /dev/twilio/account-sid \
  --secret-string "AC..." \
  --profile kiro-mcp

aws secretsmanager create-secret \
  --name /dev/twilio/auth-token \
  --secret-string "your-auth-token" \
  --profile kiro-mcp
```

### SSM Parameter Store
```bash
# Twilio phone number
aws ssm put-parameter \
  --name /dev/twilio/phone-number \
  --value "whatsapp:+14155238886" \
  --type String \
  --profile kiro-mcp
```

### Lambda Environment Variables
Already configured in `api-stack.ts`:
- `ENVIRONMENT` - Environment name (dev/staging/prod)
- `TABLE_NAME` - DynamoDB table name
- `EVENT_BUS_NAME` - EventBridge bus name
- `USER_POOL_ID` - Cognito User Pool ID
- `LOG_LEVEL` - Logging level (info)

## Deployment Steps

1. **Build API Service**
   ```bash
   cd services/api
   pnpm install
   pnpm build
   ```

2. **Deploy Infrastructure**
   ```bash
   cd infra/cdk
   pnpm install
   pnpm cdk deploy --all --context env=dev
   ```

3. **Configure Twilio Webhook**
   - Copy webhook URL from CDK output: `WhatsAppWebhookUrl`
   - Go to Twilio Console → Messaging → Settings → WhatsApp Sandbox
   - Set "When a message comes in" to webhook URL
   - Method: HTTP POST

4. **Test Integration**
   - Send WhatsApp message to Twilio sandbox number
   - Check CloudWatch Logs for webhook processing
   - Verify EventBridge event published
   - Confirm worker.ts processes message

## Architecture Flow

```
Customer WhatsApp Message
    ↓
Twilio API (receives message)
    ↓
POST /api/v1/whatsapp/webhook (form-encoded)
    ↓
API Gateway (passes raw body + headers)
    ↓
Lambda: webhook.ts
    ├─ Parse form data
    ├─ Verify Twilio signature
    ├─ Transform to Meta WhatsApp format
    └─ Publish to EventBridge
        ↓
EventBridge Rule
    ↓
Lambda: worker.ts (unchanged!)
    ├─ Load/create session
    ├─ Route to state handler
    ├─ Generate response
    └─ Send via Twilio adapter
```

## Backward Compatibility

✅ **Worker.ts requires NO changes** - The webhook transformation maintains the exact Meta WhatsApp Cloud API format that worker.ts expects.

✅ **Existing GSIs preserved** - GSI1, GSI2, GSI3 remain unchanged for existing access patterns.

✅ **Event format unchanged** - EventBridge events maintain the same structure with `source: 'twilio'` metadata.

## Next Steps

1. Deploy to dev environment
2. Test with Twilio sandbox
3. Monitor CloudWatch Logs for any issues
4. Update MCP servers to query new GSIs
5. Implement AI workers using SellerStockIndex
6. Deploy to staging/prod after validation

## Related Documentation

- `docs/whatsapp_orchestration.md` - WhatsApp flow documentation
- `services/api/DYNAMODB_SCHEMA.md` - Complete schema reference
- `TWILIO_MIGRATION_COMPLETE.md` - Previous Twilio adapter migration
- `services/api/src/handlers/whatsapp/README.md` - Handler documentation
