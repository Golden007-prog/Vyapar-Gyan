# DynamoDB Schema Reference

## Single-Table Design

All entities stored in one table with different PK/SK patterns for access patterns.

**Table Name**: `vyapargyan-{env}-main`

## Access Patterns

### Sessions

#### Get Session by Customer and Phone
```typescript
PK: SESSION#{customerId}
SK: WHATSAPP#{phoneNumber}
```

**Item Structure**:
```json
{
  "PK": "SESSION#cust-123",
  "SK": "WHATSAPP#919876543210",
  "id": "sess-456",
  "customerId": "cust-123",
  "phoneNumber": "919876543210",
  "channelType": "whatsapp",
  "state": "browsing",
  "context": {
    "cart": [],
    "selectedCategory": "cat-1",
    "shippingDraft": {}
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z",
  "lastActivityAt": "2024-01-15T10:35:00.000Z"
}
```

**GSI: PhoneIndex** (for lookup by phone number)
```
GSI PK: phoneNumber
GSI SK: channelType
```

### Messages

#### Get Messages for Session
```typescript
PK: SESSION#{sessionId}
SK: MESSAGE#{timestamp}#{waMessageId}
```

**Inbound Message**:
```json
{
  "PK": "SESSION#sess-456",
  "SK": "MESSAGE#1705315800000#wamid.abc123",
  "sessionId": "sess-456",
  "waMessageId": "wamid.abc123",
  "direction": "inbound",
  "messageType": "text",
  "content": {
    "id": "wamid.abc123",
    "from": "919876543210",
    "timestamp": "1705315800",
    "type": "text",
    "text": {
      "body": "show sarees"
    }
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "ttl": 1707907800
}
```

**Outbound Message**:
```json
{
  "PK": "SESSION#sess-456",
  "SK": "MESSAGE#1705315805000#wamid.xyz789",
  "sessionId": "sess-456",
  "waMessageId": "wamid.xyz789",
  "direction": "outbound",
  "messageType": "interactive",
  "content": {
    "type": "interactive",
    "body": "Found 5 products in Sarees:",
    "buttonText": "View Products",
    "sections": [...]
  },
  "waStatus": "sent",
  "createdAt": "2024-01-15T10:30:05.000Z",
  "ttl": 1707907805
}
```

**Query Pattern**:
```typescript
// Get recent messages (most recent first)
KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)'
ScanIndexForward: false
Limit: 20
```

### Customers

#### Get Customer by Phone Number
```typescript
PK: CUSTOMER#{phoneNumber}
SK: PROFILE
```

**Item Structure**:
```json
{
  "PK": "CUSTOMER#919876543210",
  "SK": "PROFILE",
  "id": "cust-123",
  "phoneNumber": "919876543210",
  "profileName": "Rajesh Kumar",
  "whatsappId": "919876543210",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

### Categories

#### Get All Categories
```typescript
PK: CATEGORY
SK: CATEGORY#{categoryId}
```

**Item Structure**:
```json
{
  "PK": "CATEGORY",
  "SK": "CATEGORY#cat-1",
  "id": "cat-1",
  "name": "Sarees",
  "description": "Traditional Indian sarees",
  "imageUrl": "https://...",
  "displayOrder": 1,
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**Query Pattern**:
```typescript
KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)'
FilterExpression: 'isActive = :active'
```

### Products

#### Get Product by ID
```typescript
PK: PRODUCT#{productId}
SK: METADATA
```

**Item Structure**:
```json
{
  "PK": "PRODUCT#prod-123",
  "SK": "METADATA",
  "id": "prod-123",
  "sellerId": "seller-456",
  "categoryId": "cat-1",
  "name": "Silk Saree Red",
  "description": "Beautiful red silk saree with golden border",
  "price": 2500,
  "originalPrice": 2500,
  "discountedPrice": null,
  "isDeadStock": false,
  "stockQuantity": 10,
  "stockAddedDate": "2024-01-10T00:00:00.000Z",
  "imageUrls": [
    "https://bucket.s3.amazonaws.com/products/prod-123-1.jpg",
    "https://bucket.s3.amazonaws.com/products/prod-123-2.jpg"
  ],
  "isActive": true,
  "createdAt": "2024-01-10T00:00:00.000Z",
  "updatedAt": "2024-01-10T00:00:00.000Z"
}
```

#### Get Products by Category
**GSI: CategoryIndex**
```
GSI PK: categoryId
GSI SK: createdAt (or name for sorting)
```

**Query Pattern**:
```typescript
IndexName: 'CategoryIndex'
KeyConditionExpression: 'categoryId = :categoryId'
FilterExpression: 'isActive = :active AND stockQuantity > :zero'
```

#### Get Products by Seller (Aging Inventory)
**GSI: SellerStockIndex**
```
GSI PK: sellerId
GSI SK: stockAddedDate
```

**Query Pattern**:
```typescript
IndexName: 'SellerStockIndex'
KeyConditionExpression: 'sellerId = :sellerId AND stockAddedDate < :cutoffDate'
FilterExpression: 'stockQuantity > :zero AND isActive = :active'
// Used by AI workers to identify dead stock
```

### Orders

#### Get Order by ID
```typescript
PK: ORDER#{orderId}
SK: METADATA
```

**Item Structure**:
```json
{
  "PK": "ORDER#order-789",
  "SK": "METADATA",
  "id": "order-789",
  "customerId": "cust-123",
  "sellerId": "seller-456",
  "status": "pending",
  "items": [
    {
      "productId": "prod-123",
      "name": "Silk Saree Red",
      "price": 2500,
      "quantity": 1
    }
  ],
  "subtotal": 2500,
  "commissionRate": 0.15,
  "commissionAmount": 375,
  "sellerAmount": 2125,
  "shippingAddress": {
    "name": "Rajesh Kumar",
    "phone": "919876543210",
    "addressLine1": "123 Main St",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001"
  },
  "paymentId": null,
  "createdAt": "2024-01-15T10:40:00.000Z",
  "updatedAt": "2024-01-15T10:40:00.000Z"
}
```

#### Get Orders by Seller
**GSI: SellerOrdersIndex**
```
GSI PK: sellerId
GSI SK: createdAt
```

**Query Pattern**:
```typescript
IndexName: 'SellerOrdersIndex'
KeyConditionExpression: 'sellerId = :sellerId'
ScanIndexForward: false // Most recent first
```

#### Get Orders by Customer
**GSI: CustomerOrdersIndex**
```
GSI PK: customerId
GSI SK: createdAt
```

### Seller Metrics

#### Get Seller Monthly Revenue
```typescript
PK: SELLER#{sellerId}
SK: METRICS#{year}-{month}
```

**Item Structure**:
```json
{
  "PK": "SELLER#seller-456",
  "SK": "METRICS#2024-01",
  "sellerId": "seller-456",
  "year": 2024,
  "month": 1,
  "totalRevenue": 125000,
  "totalOrders": 50,
  "totalCommission": 18750,
  "netRevenue": 106250,
  "productsSold": 75,
  "averageOrderValue": 2500,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-31T23:59:59.000Z"
}
```

**Query Pattern**:
```typescript
KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)'
// Get all metrics for a seller or filter by year
```

### Inventory Uploads (WhatsApp One-Step Upload)

#### Get Upload by ID
```typescript
PK: UPLOAD#{uploadId}
SK: METADATA
```

**Item Structure**:
```json
{
  "PK": "UPLOAD#a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "SK": "METADATA",
  "GSI1PK": "SELLER#seller-456",
  "GSI1SK": "TS#2024-01-15T10:30:00.000Z",
  "uploadId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sellerId": "seller-456",
  "phoneNumber": "+919876543210",
  "mediaType": "csv",
  "s3Key": "uploads/seller-456/csv/a1b2c3d4.csv",
  "status": "completed",
  "productCount": 15,
  "columnMapping": {
    "name": 0,
    "price": 2,
    "quantity": 1,
    "category": 3,
    "confidence": 0.92,
    "reasoning": "AI identified 4 of 5 columns"
  },
  "headers": ["Product Name", "Stock", "Price", "Category", "SKU"],
  "csvLines": ["Product Name,Stock,Price,...", "Toor Dal 1kg,10,160,..."],
  "products": [
    { "name": "Toor Dal 1kg", "price": 160, "quantity": 10, "category": "Groceries" }
  ],
  "errors": [],
  "warnings": ["Row 5: skipped — invalid price"],
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:05.000Z",
  "expiresAt": 1705402200
}
```

**GSI1 Query — Get Seller's Uploads (most recent first)**:
```typescript
IndexName: 'GSI1'
KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)'
ExpressionAttributeValues: { ':pk': 'SELLER#seller-456', ':prefix': 'TS#' }
ScanIndexForward: false
```

**TTL**: 24 hours (`expiresAt` attribute)

### Idempotency Records

#### Check Message Already Processed
```typescript
PK: IDEMPOTENCY#{waMessageId}
SK: PROCESSED
```

**Item Structure**:
```json
{
  "PK": "IDEMPOTENCY#wamid.abc123",
  "SK": "PROCESSED",
  "processedAt": "2024-01-15T10:30:00.000Z",
  "requestId": "req-789",
  "ttl": 1705402200
}
```

**Conditional Write**:
```typescript
ConditionExpression: 'attribute_not_exists(PK)'
// Fails if already exists → duplicate message
```

## GSI Definitions

### PhoneIndex
- **Purpose**: Lookup session by phone number
- **PK**: phoneNumber
- **SK**: channelType
- **Projection**: ALL

### CategoryIndex
- **Purpose**: List products by category
- **PK**: categoryId
- **SK**: createdAt (or name)
- **Projection**: ALL

### SellerStockIndex
- **Purpose**: Query aging inventory for AI dead-stock detection
- **PK**: sellerId
- **SK**: stockAddedDate
- **Projection**: ALL

### SellerOrdersIndex
- **Purpose**: List orders by seller
- **PK**: sellerId
- **SK**: createdAt
- **Projection**: ALL

### CustomerOrdersIndex
- **Purpose**: List orders by customer
- **PK**: customerId
- **SK**: createdAt
- **Projection**: ALL

### ProductSearchIndex (Optional)
- **Purpose**: Search products by name
- **PK**: nameLowercase (first few chars)
- **SK**: name
- **Projection**: ALL
- **Note**: Consider OpenSearch for production

## TTL Configuration

### Messages
- **Attribute**: `ttl`
- **Retention**: 30 days
- **Calculation**: `Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)`

### Idempotency Records
- **Attribute**: `ttl`
- **Retention**: 24 hours
- **Calculation**: `Math.floor(Date.now() / 1000) + (24 * 60 * 60)`

### Sessions (Future)
- **Attribute**: `expiresAt`
- **Retention**: 24 hours after last activity
- **Calculation**: `Math.floor(Date.now() / 1000) + (24 * 60 * 60)`

### Upload Records
- **Attribute**: `expiresAt`
- **Retention**: 24 hours
- **Calculation**: `Math.floor(Date.now() / 1000) + (24 * 60 * 60)`
- **Purpose**: Auto-cleanup of WhatsApp inventory upload data after review window

## Capacity Planning

### Read Patterns
- Session lookup: 1 read per message (strongly consistent)
- Customer lookup: 1 read per new session
- Category list: 1 read per greeting (cacheable)
- Product list: 1 read per category browse (GSI)
- Product details: 1 read per product view

### Write Patterns
- Session create/update: 1-2 writes per message
- Message create: 2 writes per message (inbound + outbound)
- Idempotency check: 1 write per message

### Estimated Load (1000 messages/day)
- Reads: ~3000/day (3 per message average)
- Writes: ~3000/day (3 per message average)
- Storage: ~10MB/day for messages (with 30-day TTL = 300MB total)

## Best Practices

### Partition Key Design
- Use high-cardinality keys (customerId, sessionId, phoneNumber)
- Avoid hot partitions (don't use single PK for all items)
- Distribute writes across partitions

### Sort Key Design
- Use composite keys for range queries (MESSAGE#{timestamp}#{id})
- Enable efficient filtering and sorting
- Support multiple access patterns

### Attribute Design
- Use consistent naming (camelCase)
- Store timestamps as ISO strings for readability
- Use numbers for TTL (Unix epoch seconds)
- Store complex objects as JSON (context, content)

### Query Optimization
- Use KeyConditionExpression for partition/sort key
- Use FilterExpression for additional filtering (post-query)
- Limit results to reduce costs
- Use GSIs for alternate access patterns

### Cost Optimization
- Enable TTL for automatic cleanup
- Use on-demand billing for variable workload
- Cache frequently accessed data (categories)
- Batch operations where possible

## Migration Notes

### From Supabase/PostgreSQL
- Sessions: Map `session_id` → `PK: SESSION#{customerId}, SK: WHATSAPP#{phone}`
- Messages: Map `message_id` → `SK: MESSAGE#{timestamp}#{waMessageId}`
- Customers: Map `customer_id` → `PK: CUSTOMER#{phone}, SK: PROFILE`
- Products: Map `product_id` → `PK: PRODUCT#{productId}, SK: METADATA`

### Data Migration Script
```typescript
// Pseudo-code for migration
for (const session of oldSessions) {
  await dynamoDB.putItem({
    PK: `SESSION#${session.customer_id}`,
    SK: `WHATSAPP#${session.phone_number}`,
    ...session
  });
}
```

## Monitoring

### CloudWatch Metrics
- `ConsumedReadCapacityUnits`
- `ConsumedWriteCapacityUnits`
- `UserErrors` (throttling)
- `SystemErrors`

### Alarms
- Read throttling > 10/minute
- Write throttling > 10/minute
- User errors > 100/hour
- System errors > 10/hour

## Backup Strategy

### Point-in-Time Recovery (PITR)
- Enable PITR for production
- 35-day retention
- Restore to any point in time

### On-Demand Backups
- Weekly full backups
- Retain for 90 days
- Store in separate AWS account (disaster recovery)

## Security

### Encryption
- Encryption at rest (AWS managed keys)
- Encryption in transit (TLS)

### Access Control
- IAM roles for Lambda functions
- Least privilege principle
- No direct table access from clients

### Audit
- CloudTrail for API calls
- DynamoDB Streams for change tracking
- Store audit logs in S3
