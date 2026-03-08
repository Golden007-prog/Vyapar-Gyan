# WhatsApp Seller/Customer Routing Architecture

## Overview

The WhatsApp webhook now intelligently routes messages based on the sender's role in the platform. Registered sellers and admins receive a dedicated copilot experience, while customers continue through the shopping flow.

## Message Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Incoming WhatsApp Message                    │
│                        (via Twilio)                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Twilio Webhook Handler (webhook.ts)                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 1. Verify Twilio signature                               │   │
│  │ 2. Parse form-encoded payload                            │   │
│  │ 3. Extract phone number                                  │   │
│  │ 4. Query UserRepository.getUserByPhone()                 │   │
│  │    ├─ Query GSI1: ROLE#seller + filter by phone         │   │
│  │    └─ Query GSI1: ROLE#admin + filter by phone          │   │
│  │ 5. Publish to EventBridge with userRole/userId          │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                         EventBridge                              │
│  Event Detail: {                                                 │
│    payload: { /* WhatsApp message */ },                          │
│    userRole: "seller" | "admin" | undefined,                     │
│    userId: "seller-123" | undefined                              │
│  }                                                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SQS Queue (async)                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              WhatsApp Worker Lambda (worker.ts)                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Extract userRole from event                              │   │
│  └──────────────────────────┬───────────────────────────────┘   │
│                             │                                    │
│              ┌──────────────┴──────────────┐                     │
│              │                             │                     │
│              ▼                             ▼                     │
│  ┌─────────────────────┐      ┌─────────────────────┐           │
│  │ userRole = "seller" │      │ userRole = undefined│           │
│  │    or "admin"       │      │   (customer)        │           │
│  └──────────┬──────────┘      └──────────┬──────────┘           │
│             │                            │                       │
│             ▼                            ▼                       │
│  ┌─────────────────────┐      ┌─────────────────────┐           │
│  │ handleSellerMessage │      │ handleCustomerMessage│           │
│  └──────────┬──────────┘      └──────────┬──────────┘           │
└─────────────┼─────────────────────────────┼────────────────────┘
              │                             │
              ▼                             ▼
┌─────────────────────────┐      ┌─────────────────────┐
│   Seller Copilot Flow   │      │  Customer Shop Flow  │
│  (seller-copilot.ts)    │      │  (existing states)   │
│                         │      │                      │
│ • Get user details      │      │ • Resolve customer   │
│ • Parse command         │      │ • Resolve session    │
│ • Execute action        │      │ • Route to state     │
│ • Send response         │      │ • Update cart/order  │
└─────────────────────────┘      └─────────────────────┘
```

## Routing Decision Logic

```typescript
// In worker.ts processMessageChange()

if (userRole === 'seller' || userRole === 'admin') {
  // SELLER PATH
  await handleSellerMessage({
    message,
    phoneNumber,
    userId,
    userRole,
    requestId
  });
} else {
  // CUSTOMER PATH (default)
  await handleCustomerMessage({
    message,
    phoneNumber,
    profileName,
    contact,
    requestId
  });
}
```

## User Lookup Strategy

### Query Pattern (GSI1)

```typescript
// Query sellers by role, filter by phone
Query GSI1:
  GSI1PK = "ROLE#seller"
  FilterExpression: phoneNumber = "+919876543210"

// Query admins by role, filter by phone  
Query GSI1:
  GSI1PK = "ROLE#admin"
  FilterExpression: phoneNumber = "+919876543210"
```

### DynamoDB Item Structure

```typescript
{
  PK: "USER#seller-123",
  SK: "PROFILE",
  GSI1PK: "ROLE#seller",        // Enables role-based queries
  GSI1SK: "USER#seller-123",
  id: "seller-123",
  role: "seller",
  phoneNumber: "+919876543210",  // Used in FilterExpression
  email: "rajesh@guptastore.com",
  businessName: "Gupta General Store",
  status: "active",
  createdAt: "2024-01-15T10:00:00Z",
  updatedAt: "2024-01-15T10:00:00Z"
}
```

## Seller Copilot Features (Current)

### Welcome Message

When a seller sends any message, they receive:

```
Welcome back, Seller! 🎉

What would you like to update in your store today?

You can:
• Add or update products
• Check inventory levels
• View recent orders
• Update order status
• See your analytics

Just tell me what you need!
```

### Future Command Examples

```
Seller: "add new product"
→ Guide through product creation flow

Seller: "check low stock"
→ List products with quantity < 5

Seller: "show today's orders"
→ Display orders from last 24 hours

Seller: "update order #123 to shipped"
→ Update order status and notify customer

Seller: "my sales this month"
→ Display revenue, orders, top products
```

## Error Handling

### User Lookup Failure

```typescript
try {
  const user = await userRepo.getUserByPhone(phoneNumber);
  // ... use user
} catch (error) {
  // Log warning but don't fail webhook
  logger.warn('Failed to lookup user', { phoneNumber, error });
  // Treat as customer (default flow)
}
```

### Graceful Degradation

- If user lookup fails → treat as customer
- If seller handler fails → log error, send generic response
- If Twilio send fails → log error, retry via DLQ

## Performance Characteristics

### User Lookup Latency

- GSI1 query: ~10-20ms (seller role)
- GSI1 query: ~10-20ms (admin role)
- Total lookup: ~20-40ms (sequential queries)
- FilterExpression overhead: minimal (<5ms)

### Optimization Opportunities

1. **Parallel Queries**: Query seller and admin roles concurrently
2. **Caching**: Cache phone→userId mappings (TTL: 5 minutes)
3. **Dedicated GSI**: Add GSI2PK: PHONE#{phoneNumber} for O(1) lookup
4. **Bloom Filter**: Pre-filter known seller phones in Lambda memory

## Security Considerations

### Authentication

- Twilio signature validation prevents message spoofing
- Phone number is trusted source of identity
- User role verified from DynamoDB (not from message)

### Authorization

- Seller can only access their own data
- Admin can access all data
- Customer cannot access seller functions

### Audit Trail

- All seller commands logged to CloudWatch
- User ID and role included in all logs
- Request ID enables end-to-end tracing

## Monitoring Queries

### CloudWatch Insights

```sql
-- Seller message volume
fields @timestamp, userRole, userId
| filter userRole = "seller"
| stats count() by bin(5m)

-- User lookup failures
fields @timestamp, phoneNumber, error
| filter @message like /Failed to lookup user/
| stats count() by phoneNumber

-- Routing decisions
fields @timestamp, userRole
| stats count() by userRole
```

### Key Metrics

- `seller_messages_per_hour` - Seller message volume
- `customer_messages_per_hour` - Customer message volume
- `user_lookup_errors` - Failed phone lookups
- `seller_response_time_ms` - Copilot response latency

## Testing Scenarios

### Test Case 1: Registered Seller

```
Input: WhatsApp message from +919876543210 (seller-123)
Expected: Route to seller copilot, send welcome message
```

### Test Case 2: Registered Admin

```
Input: WhatsApp message from +919876543211 (admin-001)
Expected: Route to seller copilot, send admin welcome
```

### Test Case 3: Unknown Customer

```
Input: WhatsApp message from +919999999999 (not in DB)
Expected: Route to customer flow, create session
```

### Test Case 4: User Lookup Failure

```
Input: WhatsApp message, DynamoDB query fails
Expected: Log warning, route to customer flow (graceful degradation)
```

## Configuration

### Required Environment Variables

All existing variables are sufficient:
- `TABLE_NAME` - DynamoDB table name
- `TWILIO_AUTH_TOKEN` - For signature validation
- `EVENT_BUS_NAME` - EventBridge bus name

### IAM Permissions

Worker Lambda needs:
- `dynamodb:Query` on main table and GSI1
- `dynamodb:GetItem` on main table
- Existing permissions are sufficient

## Deployment Checklist

- [x] Create UserRepository with phone lookup
- [x] Update webhook handler to detect user role
- [x] Update worker to route based on role
- [x] Create seller copilot service
- [ ] Deploy to dev environment
- [ ] Test with real Twilio webhook
- [ ] Monitor CloudWatch logs
- [ ] Verify routing decisions
- [ ] Test seller and customer flows
- [ ] Deploy to staging
- [ ] Deploy to production

## Next Steps

1. **Command Parsing**: Implement intent detection for seller commands
2. **Bedrock Integration**: Connect seller copilot to Bedrock Agent
3. **Action Handlers**: Implement product, order, inventory handlers
4. **Multilingual Support**: Add Hindi and regional language support
5. **Voice Commands**: Integrate Gemini for voice transcription
6. **Proactive Alerts**: Send low stock and new order notifications

---

**Implementation Date**: 2026-03-07
**Status**: ✅ Complete (routing logic)
**Next Phase**: Command parsing and Bedrock integration
