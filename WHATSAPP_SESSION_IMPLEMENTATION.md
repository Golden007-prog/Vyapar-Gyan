# WhatsApp Session Orchestration Implementation

## Overview

This document describes the implementation of the WhatsApp session orchestration and catalog response flow, enabling end-to-end customer interactions from inbound message to outbound reply.

## Architecture

```
Inbound WhatsApp Message
    ↓
Webhook Handler (webhook.ts)
    ↓ [EventBridge]
SQS Queue
    ↓
Worker Lambda (worker.ts)
    ↓
Session Resolution → State Router → State Handler
    ↓
Catalog Lookup → Response Generation
    ↓
WhatsApp Sender → Outbound Message
    ↓
Message Persistence
```

## Components Implemented

### 1. Repositories

#### MessageRepository (`repositories/message-repository.ts`)
- Stores inbound and outbound WhatsApp messages
- DynamoDB pattern: `PK: SESSION#{sessionId}, SK: MESSAGE#{timestamp}#{waMessageId}`
- Supports message history retrieval
- Automatic TTL (30 days retention)

**Key Methods:**
- `create(input)` - Store a message
- `getRecentMessages(sessionId, limit)` - Retrieve message history

#### CatalogRepository (`repositories/catalog-repository.ts`)
- Read-only access to product catalog
- Supports category browsing and product lookup
- Simple text-based product search

**Key Methods:**
- `getCategories()` - Get all active categories
- `getCategoryById(id)` - Get category details
- `getProductsByCategory(categoryId, limit)` - List products in category
- `getProductById(id)` - Get product details
- `searchProducts(query, limit)` - Search products by name

#### SessionRepository (Enhanced)
- Added `updateContext()` method for conversation state management
- Supports storing cart items, selected category, shipping drafts

### 2. Services

#### WhatsAppSender (`services/whatsapp-sender.ts`)
- Handles outbound message sending via Meta's WhatsApp Cloud API
- Supports multiple message types:
  - Text messages
  - Interactive button messages (up to 3 buttons)
  - Interactive list messages (for longer lists)
- Exponential backoff retry logic (3 attempts: 2s, 4s, 8s delays)
- Automatic message persistence after successful send

**Message Types:**
```typescript
// Text message
{
  type: 'text',
  text: 'Hello customer!'
}

// Button message (max 3 buttons)
{
  type: 'interactive',
  body: 'Choose an option:',
  buttons: [
    { id: 'btn_1', title: 'Option 1' },
    { id: 'btn_2', title: 'Option 2' }
  ]
}

// List message (for longer lists)
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

### 3. State Handlers

#### Greeting Handler (`states/greeting-handler.ts`)
- Handles initial customer contact
- Sends welcome message with category options
- Automatically transitions to `browsing` state
- Adapts message format based on category count:
  - ≤3 categories: Button message
  - >3 categories: List message

**Flow:**
1. Store inbound message
2. Fetch active categories
3. Send welcome message with categories
4. Transition to browsing state

#### Browsing Handler (`states/browsing-handler.ts`)
- Handles product catalog browsing and search
- Simple deterministic intent detection (no LLM)
- Supports multiple intents:
  - `browse_category` - Show products in category
  - `show_categories` - List all categories
  - `view_product` - Show product details
  - `search_products` - Search by product name
  - `help` - Show help message
  - `fallback` - Handle unrecognized input

**Intent Detection Logic:**
- Interactive button/list responses → Extract ID from button/list selection
- Text "categories", "menu", "browse" → Show categories
- Text "help", "support" → Show help
- Other text (>2 chars) → Treat as search query

**Supported Flows:**
```
Customer: "hi"
→ Greeting handler → Show categories

Customer: [Selects "Sarees" from list]
→ Browse category → Show products in Sarees

Customer: "show sarees"
→ Search products → Show matching products

Customer: [Selects product from list]
→ View product → Show product details

Customer: "categories"
→ Show categories → List all categories

Customer: "help"
→ Show help → Display help message

Customer: "xyz"
→ Fallback → "I didn't understand..."
```

#### Checkout Handler (`states/checkout-handler.ts`)
- Placeholder for future order creation flow
- Currently returns "coming soon" message
- Will handle: cart summary, address collection, payment link generation

#### Router (`states/router.ts`)
- Routes messages to appropriate state handler
- Maps multiple states to handlers:
  - `greeting` → greetingHandler
  - `browsing`, `product_inquiry`, `idle` → browsingHandler
  - `checkout`, `ordering`, `payment` → checkoutHandler
  - `support` → handleSupport (currently delegates to browsing)

## Session State Model

### States
- `greeting` - Initial welcome, show categories
- `browsing` - Catalog browsing, product search
- `product_inquiry` - Product details view (handled by browsing handler)
- `idle` - Inactive session (handled by browsing handler)
- `ordering` - Order creation (placeholder)
- `checkout` - Cart and payment (placeholder)
- `payment` - Payment processing (placeholder)
- `support` - Customer support (placeholder)

### State Transitions
```
greeting → browsing (automatic after welcome)
browsing ↔ product_inquiry (viewing products)
browsing → ordering (future: add to cart)
ordering → payment (future: confirm order)
payment → browsing (future: after payment)
any → support (future: help request)
```

## DynamoDB Schema

### Sessions
```
PK: SESSION#{customerId}
SK: WHATSAPP#{phoneNumber}

Attributes:
- id: string (UUID)
- customerId: string
- phoneNumber: string
- channelType: 'whatsapp'
- state: string (greeting | browsing | ordering | etc.)
- context: object (cart, selected_category, shipping_draft)
- createdAt: string (ISO timestamp)
- updatedAt: string (ISO timestamp)
- lastActivityAt: string (ISO timestamp)
```

### Messages
```
PK: SESSION#{sessionId}
SK: MESSAGE#{timestamp}#{waMessageId}

Attributes:
- sessionId: string
- waMessageId: string (from WhatsApp)
- direction: 'inbound' | 'outbound'
- messageType: 'text' | 'image' | 'interactive' | etc.
- content: object (message payload)
- waStatus: 'sent' | 'delivered' | 'read' | 'failed'
- errorCode: string (optional)
- errorMessage: string (optional)
- createdAt: string (ISO timestamp)
- ttl: number (30 days)
```

### Customers
```
PK: CUSTOMER#{phoneNumber}
SK: PROFILE

Attributes:
- id: string (UUID)
- phoneNumber: string
- profileName: string
- whatsappId: string (optional)
- createdAt: string (ISO timestamp)
- updatedAt: string (ISO timestamp)
```

### Categories
```
PK: CATEGORY
SK: CATEGORY#{categoryId}

Attributes:
- id: string
- name: string
- description: string (optional)
- imageUrl: string (optional)
- displayOrder: number
- isActive: boolean
```

### Products
```
PK: PRODUCT#{productId}
SK: METADATA

Attributes:
- id: string
- sellerId: string
- categoryId: string (GSI: CategoryIndex)
- name: string
- description: string
- price: number
- stockQuantity: number
- imageUrls: string[]
- isActive: boolean
- createdAt: string (ISO timestamp)
```

## Example Flows

### New Customer First Message

```
1. Customer sends "hi" to WhatsApp number
2. Webhook handler receives POST, validates signature
3. Publishes to EventBridge → SQS → Worker Lambda
4. Worker checks idempotency (first time)
5. CustomerRepository.resolveOrCreate() → Creates new customer
6. SessionRepository.resolveOrCreate() → Creates new session (state: greeting)
7. Router routes to greetingHandler
8. greetingHandler:
   - Stores inbound message
   - Fetches categories from catalog
   - Sends welcome message with category list
   - Updates session state to 'browsing'
9. WhatsAppSender sends message via Meta API
10. Stores outbound message in DynamoDB
```

### Category Browsing

```
1. Customer selects "Sarees" from category list
2. Webhook → EventBridge → SQS → Worker
3. Worker resolves existing session (state: browsing)
4. Router routes to browsingHandler
5. browsingHandler:
   - Detects intent: browse_category (cat_sarees)
   - Fetches products in Sarees category
   - Sends product list as interactive message
6. Customer selects product from list
7. browsingHandler:
   - Detects intent: view_product (prod_123)
   - Fetches product details
   - Sends product details as text message
```

### Product Search

```
1. Customer types "silk saree"
2. Webhook → EventBridge → SQS → Worker
3. Worker resolves session (state: browsing)
4. browsingHandler:
   - Detects intent: search_products (query: "silk saree")
   - Calls catalogRepository.searchProducts()
   - Sends matching products as list
```

## Observability

### Structured Logging

All handlers log key events:
- Webhook received (requestId, method, path)
- Session resolved (sessionId, customerId, state)
- Message persisted (messageId, direction, type)
- Intent detected (sessionId, intent type)
- Outbound send attempted (sessionId, phoneNumber, messageType)
- Outbound send success/failure (waMessageId, error)
- State transitions (sessionId, oldState, newState)

### Log Examples

```json
{
  "level": "info",
  "message": "WhatsApp webhook request received",
  "requestId": "abc-123",
  "method": "POST",
  "path": "/whatsapp/webhook"
}

{
  "level": "info",
  "message": "Customer and session resolved",
  "customerId": "cust-456",
  "sessionId": "sess-789",
  "sessionState": "browsing"
}

{
  "level": "info",
  "message": "Intent detected",
  "sessionId": "sess-789",
  "intent": "browse_category"
}

{
  "level": "info",
  "message": "WhatsApp message sent successfully",
  "sessionId": "sess-789",
  "waMessageId": "wamid.xyz",
  "phoneNumber": "919876543210"
}
```

## Testing

### Unit Tests Needed

1. **MessageRepository**
   - Test message creation
   - Test message retrieval
   - Test TTL calculation

2. **CatalogRepository**
   - Test category fetching
   - Test product lookup by category
   - Test product search

3. **WhatsAppSender**
   - Test payload building for each message type
   - Test retry logic
   - Test error handling

4. **State Handlers**
   - Test intent detection logic
   - Test category browsing flow
   - Test product search flow
   - Test fallback handling

### Integration Tests Needed

1. **End-to-End Flow**
   - Simulate webhook → worker → handler → sender
   - Verify message persistence
   - Verify state transitions

2. **Session Management**
   - Test new customer creation
   - Test existing customer lookup
   - Test session state updates

## Remaining Gaps Before Order Creation

### 1. Cart Management
- Add cart operations to session context
- Implement "add to cart" intent
- Store cart items in session.context.cart
- Show cart summary

### 2. Order Creation Service
- Create OrderRepository
- Implement order creation handler
- Generate order ID and store in DynamoDB
- Link order to customer and session

### 3. Address Collection
- Multi-step conversation for address
- Store in session.context.shipping_draft
- Validate pincode/address format

### 4. Payment Integration
- Generate Razorpay payment link
- Send payment link via WhatsApp
- Handle payment webhook
- Update order status on payment confirmation

### 5. Order Tracking
- Implement tracking state handler
- Show order status updates
- Handle seller updates

### 6. Additional States
- Implement negotiation handler (future)
- Implement support handler (dispute resolution)
- Implement tracking handler (order updates)

### 7. Enhanced Features
- Image message handling (product images)
- Voice message transcription (Gemini AI)
- Multilingual support (Gemini AI)
- Product recommendations

### 8. Error Handling
- Dead letter queue monitoring
- Retry failed messages
- Alert on high error rates

### 9. Session Cleanup
- Implement session expiry (24 hours)
- EventBridge scheduled rule for cleanup
- DynamoDB TTL for automatic deletion

### 10. Rate Limiting
- API Gateway throttling configuration
- Per-customer rate limits
- Abuse prevention

## Files Added/Changed

### New Files
- `services/api/src/repositories/message-repository.ts` - Message persistence
- `services/api/src/repositories/catalog-repository.ts` - Catalog data access
- `services/api/src/services/whatsapp-sender.ts` - Outbound message sending

### Modified Files
- `services/api/src/handlers/whatsapp/states/greeting-handler.ts` - Complete implementation
- `services/api/src/handlers/whatsapp/states/browsing-handler.ts` - Complete implementation
- `services/api/src/handlers/whatsapp/states/checkout-handler.ts` - Placeholder with message persistence
- `services/api/src/handlers/whatsapp/states/router.ts` - Enhanced routing logic
- `services/api/src/repositories/session-repository.ts` - Added updateContext() method

### Unchanged (Already Implemented)
- `services/api/src/handlers/whatsapp/webhook.ts` - Webhook verification and EventBridge publishing
- `services/api/src/handlers/whatsapp/worker.ts` - SQS processing and session resolution
- `services/api/src/repositories/customer-repository.ts` - Customer management
- `services/api/src/utils/idempotency.ts` - Duplicate message prevention

## Configuration Required

### Environment Variables
- `WHATSAPP_API_URL` - Meta WhatsApp Cloud API base URL
- `WHATSAPP_TOKEN` - WhatsApp API access token (from Secrets Manager)
- `WHATSAPP_PHONE_NUMBER_ID` - WhatsApp Business Phone Number ID
- `WHATSAPP_VERIFY_TOKEN` - Webhook verification token
- `WHATSAPP_APP_SECRET` - App secret for signature verification
- `TABLE_NAME` - DynamoDB table name
- `EVENT_BUS_NAME` - EventBridge event bus name

### DynamoDB Indexes Required
- `CategoryIndex` - GSI on categoryId for product lookups
- `ProductSearchIndex` - GSI on product name for search (optional, can use scan)

## Next Steps

1. **Deploy and Test**
   - Deploy Lambda functions
   - Configure WhatsApp webhook URL
   - Test with real WhatsApp messages

2. **Add Cart Management**
   - Implement "add to cart" intent
   - Store cart in session context
   - Show cart summary

3. **Implement Order Creation**
   - Create OrderRepository
   - Build order creation flow
   - Integrate with payment service

4. **Add Observability**
   - CloudWatch dashboards
   - Alarms for errors and latency
   - X-Ray tracing

5. **Performance Optimization**
   - Cache categories in memory
   - Optimize DynamoDB queries
   - Add connection pooling

## Summary

This implementation provides a complete end-to-end WhatsApp conversation flow from inbound message to outbound reply, with:

- ✅ Session management and state tracking
- ✅ Message persistence (inbound and outbound)
- ✅ Simple deterministic intent detection
- ✅ Catalog browsing (categories and products)
- ✅ Product search
- ✅ Outbound message sending with retry logic
- ✅ Structured logging for observability
- ✅ Idempotency handling
- ⏳ Cart management (pending)
- ⏳ Order creation (pending)
- ⏳ Payment integration (pending)

The architecture is ready for the next phase: cart management and order creation.
