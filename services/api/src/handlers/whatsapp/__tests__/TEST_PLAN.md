# WhatsApp Session Orchestration Test Plan

## Unit Tests

### MessageRepository Tests

**File:** `message-repository.test.ts`

```typescript
describe('MessageRepository', () => {
  test('should create inbound message', async () => {
    // Test message creation with all required fields
    // Verify DynamoDB PutItem called with correct structure
    // Verify TTL is set correctly (30 days)
  });

  test('should create outbound message', async () => {
    // Test outbound message creation
    // Verify waStatus is set
  });

  test('should retrieve recent messages', async () => {
    // Test getRecentMessages with limit
    // Verify messages returned in reverse chronological order
  });

  test('should handle empty message history', async () => {
    // Test getRecentMessages when no messages exist
    // Verify returns empty array
  });
});
```

### CatalogRepository Tests

**File:** `catalog-repository.test.ts`

```typescript
describe('CatalogRepository', () => {
  test('should get all active categories', async () => {
    // Test getCategories
    // Verify only active categories returned
    // Verify sorted by displayOrder
  });

  test('should get category by ID', async () => {
    // Test getCategoryById with valid ID
    // Verify correct category returned
  });

  test('should return null for invalid category ID', async () => {
    // Test getCategoryById with non-existent ID
  });

  test('should get products by category', async () => {
    // Test getProductsByCategory
    // Verify only active products with stock > 0
    // Verify limit is respected
  });

  test('should search products by name', async () => {
    // Test searchProducts with query
    // Verify matching products returned
  });

  test('should handle search with no results', async () => {
    // Test searchProducts with non-matching query
    // Verify returns empty array
  });
});
```

### WhatsAppSender Tests

**File:** `whatsapp-sender.test.ts`

```typescript
describe('WhatsAppSender', () => {
  test('should build text message payload', () => {
    // Test buildPayload for text message
    // Verify correct WhatsApp API format
  });

  test('should build button message payload', () => {
    // Test buildPayload for interactive button message
    // Verify buttons array formatted correctly
  });

  test('should build list message payload', () => {
    // Test buildPayload for interactive list message
    // Verify sections and rows formatted correctly
  });

  test('should send message successfully', async () => {
    // Mock WhatsApp API success response
    // Verify message sent and persisted
    // Verify waMessageId returned
  });

  test('should retry on failure', async () => {
    // Mock API failure then success
    // Verify retry logic with exponential backoff
    // Verify eventual success
  });

  test('should fail after max retries', async () => {
    // Mock API failures for all attempts
    // Verify throws error after 3 attempts
    // Verify failed message persisted
  });
});
```

### State Handler Tests

**File:** `greeting-handler.test.ts`

```typescript
describe('greetingHandler', () => {
  test('should send welcome with button message for ≤3 categories', async () => {
    // Mock 3 categories
    // Verify button message sent
    // Verify state transitioned to browsing
  });

  test('should send welcome with list message for >3 categories', async () => {
    // Mock 5 categories
    // Verify list message sent
    // Verify state transitioned to browsing
  });

  test('should handle no categories available', async () => {
    // Mock empty categories
    // Verify "check back soon" message sent
  });

  test('should store inbound message', async () => {
    // Verify message persisted to DynamoDB
  });
});
```

**File:** `browsing-handler.test.ts`

```typescript
describe('browsingHandler', () => {
  describe('Intent Detection', () => {
    test('should detect browse_category from button reply', () => {
      // Test interactive button with cat_ prefix
    });

    test('should detect view_product from list reply', () => {
      // Test interactive list with prod_ prefix
    });

    test('should detect show_categories from text', () => {
      // Test "categories", "menu", "browse" text
    });

    test('should detect help from text', () => {
      // Test "help", "support" text
    });

    test('should detect search_products from text', () => {
      // Test arbitrary text as search query
    });

    test('should fallback for unrecognized input', () => {
      // Test short text or unknown input
    });
  });

  describe('Category Browsing', () => {
    test('should show products in category', async () => {
      // Mock category and products
      // Verify product list sent
    });

    test('should handle category with no products', async () => {
      // Mock empty product list
      // Verify "no products" message sent
    });

    test('should handle invalid category ID', async () => {
      // Mock category not found
      // Verify error message sent
    });
  });

  describe('Product Search', () => {
    test('should show search results', async () => {
      // Mock search results
      // Verify product list sent
    });

    test('should handle no search results', async () => {
      // Mock empty search results
      // Verify "no products found" message sent
    });
  });

  describe('Product View', () => {
    test('should show product details', async () => {
      // Mock product
      // Verify details message sent with price and stock
    });

    test('should handle invalid product ID', async () => {
      // Mock product not found
      // Verify error message sent
    });
  });
});
```

**File:** `router.test.ts`

```typescript
describe('routeMessage', () => {
  test('should route to greetingHandler for greeting state', async () => {
    // Mock session with state: greeting
    // Verify greetingHandler called
  });

  test('should route to browsingHandler for browsing state', async () => {
    // Mock session with state: browsing
    // Verify browsingHandler called
  });

  test('should route to browsingHandler for product_inquiry state', async () => {
    // Mock session with state: product_inquiry
    // Verify browsingHandler called
  });

  test('should route to checkoutHandler for checkout state', async () => {
    // Mock session with state: checkout
    // Verify checkoutHandler called
  });

  test('should default to greetingHandler for unknown state', async () => {
    // Mock session with unknown state
    // Verify greetingHandler called
  });

  test('should handle handler errors', async () => {
    // Mock handler throwing error
    // Verify error logged and re-thrown
  });
});
```

## Integration Tests

### End-to-End Flow Tests

**File:** `e2e-flow.test.ts`

```typescript
describe('WhatsApp E2E Flow', () => {
  test('should handle new customer first message', async () => {
    // 1. Simulate webhook POST with new customer message
    // 2. Verify customer created
    // 3. Verify session created with state: greeting
    // 4. Verify welcome message sent
    // 5. Verify state transitioned to browsing
    // 6. Verify messages persisted
  });

  test('should handle category browsing', async () => {
    // 1. Simulate existing session
    // 2. Send category selection message
    // 3. Verify products fetched
    // 4. Verify product list sent
  });

  test('should handle product search', async () => {
    // 1. Simulate existing session
    // 2. Send search query message
    // 3. Verify search executed
    // 4. Verify results sent
  });

  test('should handle product view', async () => {
    // 1. Simulate existing session
    // 2. Send product selection message
    // 3. Verify product details fetched
    // 4. Verify details sent
  });

  test('should handle duplicate messages', async () => {
    // 1. Send same message twice
    // 2. Verify idempotency check prevents duplicate processing
    // 3. Verify only one response sent
  });
});
```

### Session Management Tests

**File:** `session-management.test.ts`

```typescript
describe('Session Management', () => {
  test('should create new session for new customer', async () => {
    // Verify CustomerRepository.resolveOrCreate creates customer
    // Verify SessionRepository.resolveOrCreate creates session
  });

  test('should reuse existing session for returning customer', async () => {
    // Verify existing session retrieved
    // Verify lastActivityAt updated
  });

  test('should update session state', async () => {
    // Verify state transition persisted
    // Verify updatedAt and lastActivityAt updated
  });

  test('should update session context', async () => {
    // Verify context object persisted
    // Verify can store cart, selected_category, etc.
  });
});
```

## Manual Testing Scenarios

### Scenario 1: New Customer Onboarding

```
1. Send "hi" from new WhatsApp number
   Expected: Welcome message with category list

2. Select category from list
   Expected: Product list for selected category

3. Select product from list
   Expected: Product details with price and stock

4. Type "categories"
   Expected: Category list shown again
```

### Scenario 2: Product Search

```
1. Type "saree" (or any product name)
   Expected: Search results with matching products

2. Select product from results
   Expected: Product details shown

3. Type "xyz" (non-existent product)
   Expected: "No products found" message
```

### Scenario 3: Help and Fallback

```
1. Type "help"
   Expected: Help message with available commands

2. Type "asdfgh" (gibberish)
   Expected: Fallback message with guidance

3. Type "categories"
   Expected: Category list shown
```

### Scenario 4: Session Continuity

```
1. Send message, wait for response
2. Send another message immediately
   Expected: Session maintained, state preserved

3. Wait 30 minutes, send message
   Expected: Session still active (24 hour expiry)
```

## Load Testing

### Concurrent Messages

```
Test: 100 concurrent messages from different customers
Expected:
- All messages processed successfully
- No duplicate responses
- Average latency < 2 seconds
- No DynamoDB throttling
```

### Message Burst

```
Test: 10 messages from same customer in 1 second
Expected:
- All messages processed in order
- Idempotency prevents duplicates
- Session state consistent
```

## Error Scenarios

### WhatsApp API Failure

```
Test: Mock WhatsApp API returning 500 error
Expected:
- Retry logic executes (3 attempts)
- Failed message persisted with error details
- Error logged to CloudWatch
```

### DynamoDB Throttling

```
Test: Simulate DynamoDB throttling
Expected:
- AWS SDK retries automatically
- Eventually consistent success
- Latency increases but no failures
```

### Invalid Webhook Signature

```
Test: Send webhook with invalid signature
Expected:
- Request rejected with 200 OK (to prevent Meta retries)
- Error logged
- No processing occurs
```

### Malformed Webhook Payload

```
Test: Send webhook with invalid JSON
Expected:
- Request rejected with 200 OK
- Error logged
- No processing occurs
```

## Performance Benchmarks

### Target Metrics

- Webhook response time: < 500ms (fast-ack)
- Worker processing time: < 2 seconds
- Message send latency: < 1 second
- DynamoDB query latency: < 100ms
- End-to-end latency: < 3 seconds

### Monitoring

- CloudWatch Logs: All errors and warnings
- CloudWatch Metrics: Custom metrics for message counts, latency
- X-Ray Tracing: End-to-end request tracing
- DLQ Depth: Alert if > 10 messages

## Test Data Setup

### Categories

```json
[
  {
    "id": "cat-1",
    "name": "Sarees",
    "description": "Traditional Indian sarees",
    "displayOrder": 1,
    "isActive": true
  },
  {
    "id": "cat-2",
    "name": "Kurtas",
    "description": "Ethnic kurtas and kurtis",
    "displayOrder": 2,
    "isActive": true
  },
  {
    "id": "cat-3",
    "name": "Jewelry",
    "description": "Fashion jewelry and accessories",
    "displayOrder": 3,
    "isActive": true
  }
]
```

### Products

```json
[
  {
    "id": "prod-1",
    "categoryId": "cat-1",
    "name": "Silk Saree Red",
    "description": "Beautiful red silk saree with golden border",
    "price": 2500,
    "stockQuantity": 10,
    "isActive": true
  },
  {
    "id": "prod-2",
    "categoryId": "cat-1",
    "name": "Cotton Saree Blue",
    "description": "Comfortable blue cotton saree",
    "price": 1200,
    "stockQuantity": 5,
    "isActive": true
  }
]
```

## Test Execution Checklist

- [ ] Unit tests for all repositories
- [ ] Unit tests for WhatsAppSender
- [ ] Unit tests for state handlers
- [ ] Unit tests for router
- [ ] Integration tests for E2E flow
- [ ] Integration tests for session management
- [ ] Manual testing of all scenarios
- [ ] Load testing with concurrent messages
- [ ] Error scenario testing
- [ ] Performance benchmarking
- [ ] CloudWatch logs verification
- [ ] DynamoDB data verification
- [ ] WhatsApp message delivery verification

## CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Test WhatsApp Handlers

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '20'
      - run: pnpm install
      - run: pnpm --filter @vyapargyan/api test
      - run: pnpm --filter @vyapargyan/api test:integration
```
