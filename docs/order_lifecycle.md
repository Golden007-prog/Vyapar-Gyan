# Order Lifecycle Design (AWS Serverless)

## Order State Machine

```
WhatsApp inquiry / Web browse
    → product selection
    → stock validation (available_stock = stock_quantity - reserved_stock)
    → PENDING (draft order created, stock reserved via DynamoDB TransactWrite)
    → seller notified (EventBridge → SQS → notification Lambda)
    → seller ACCEPT → CONFIRMED → payment link created
    → seller REJECT → CANCELLED → stock unreserved (TransactWrite)
    → payment link sent to customer (WhatsApp via SQS)
    → Razorpay webhook: payment.captured → CONFIRMED → stock finalized (TransactWrite)
    → Razorpay webhook: payment.failed → stay CONFIRMED, retry link
    → seller marks PROCESSING → notifications sent
    → seller marks SHIPPED → tracking sent
    → seller marks DELIVERED → order complete
```

### Status Transitions (Enforced)

| From         | To           | Actor           | Side Effects                                                 |
| ------------ | ------------ | --------------- | ------------------------------------------------------------ |
| —            | `pending`    | System          | Reserve stock (TransactWrite), create inventory_log(reserved), notify seller |
| `pending`    | `confirmed`  | Seller (accept) | Create payment link, notify customer via EventBridge         |
| `pending`    | `cancelled`  | Seller (reject) | Unreserve stock (TransactWrite), inventory_log(unreserved), notify customer  |
| `pending`    | `cancelled`  | Customer        | Unreserve stock (TransactWrite), inventory_log(unreserved), notify seller    |
| `confirmed`  | `processing` | Seller          | Publish event to EventBridge                                 |
| `confirmed`  | `cancelled`  | Admin           | Unreserve stock, refund if paid                              |
| `processing` | `shipped`    | Seller          | Notify customer with tracking via EventBridge                |
| `shipped`    | `delivered`  | Seller          | Finalize stock (reserved→sale), inventory_log(sale)          |
| `delivered`  | `returned`   | Admin           | Reverse sale, inventory_log(return), initiate refund         |
| any          | `refunded`   | Admin           | Process refund via Razorpay, inventory_log(return)           |

## DynamoDB Transaction Boundaries

### Order Creation Transaction (CRITICAL)

```typescript
// services/api/src/handlers/orders/create-order.ts
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

export async function createOrder(request: CreateOrderRequest) {
  const orderId = crypto.randomUUID();
  const orderNumber = generateOrderNumber(); // VG-YYYYMMDD-NNNN
  
  // 1. Validate stock for all items (parallel queries)
  const products = await Promise.all(
    request.items.map(item => productAdapter.get(item.productId))
  );
  
  // 2. Check available stock
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    const requestedQty = request.items[i].quantity;
    const availableStock = product.stock_quantity - product.reserved_stock;
    
    if (availableStock < requestedQty) {
      throw new InsufficientStockError(product.name, availableStock);
    }
  }
  
  // 3. Atomic transaction: reserve stock + create order + create items + log inventory
  const transactItems = [
    // Create order
    {
      Put: {
        TableName: process.env.TABLE_NAME!,
        Item: {
          PK: `ORDER#${orderId}`,
          SK: 'METADATA',
          order_number: orderNumber,
          seller_id: request.sellerId,
          customer_id: request.customerId,
          status: 'pending',
          subtotal: calculateSubtotal(request.items, products),
          tax: calculateTax(request.items, products),
          shipping: calculateShipping(request),
          total_amount: calculateTotal(request.items, products),
          shipping_name: request.shippingName,
          shipping_phone: request.shippingPhone,
          shipping_address: request.shippingAddress,
          source: request.source, // 'whatsapp' | 'web'
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        ConditionExpression: 'attribute_not_exists(PK)' // prevent duplicate
      }
    },
    // Create order items
    ...request.items.map((item, index) => ({
      Put: {
        TableName: process.env.TABLE_NAME!,
        Item: {
          PK: `ORDER#${orderId}`,
          SK: `ITEM#${index}`,
          product_id: item.productId,
          product_name: products[index].name, // denormalized for history
          quantity: item.quantity,
          unit_price: products[index].base_ask_price,
          subtotal: item.quantity * products[index].base_ask_price
        }
      }
    })),
    // Reserve stock for each product
    ...request.items.map((item, index) => ({
      Update: {
        TableName: process.env.TABLE_NAME!,
        Key: { PK: `PRODUCT#${item.productId}`, SK: 'METADATA' },
        UpdateExpression: 'SET reserved_stock = reserved_stock + :qty, updated_at = :now',
        ConditionExpression: 'stock_quantity - reserved_stock >= :qty', // ensure stock available
        ExpressionAttributeValues: {
          ':qty': item.quantity,
          ':now': new Date().toISOString()
        }
      }
    })),
    // Create inventory logs
    ...request.items.map((item, index) => ({
      Put: {
        TableName: process.env.TABLE_NAME!,
        Item: {
          PK: `PRODUCT#${item.productId}`,
          SK: `INVLOG#${Date.now()}#${crypto.randomUUID()}`,
          change_type: 'reserved',
          quantity_change: item.quantity,
          quantity_before: products[index].stock_quantity,
          quantity_after: products[index].stock_quantity, // stock_quantity unchanged, reserved_stock increased
          reference_type: 'order',
          reference_id: orderId,
          created_at: new Date().toISOString()
        }
      }
    }))
  ];
  
  // Execute atomic transaction
  await dynamoClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
  
  // 4. Publish event for async notification
  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      Source: 'vyapargyan.orders',
      DetailType: 'OrderCreated',
      Detail: JSON.stringify({ orderId, sellerId: request.sellerId, orderNumber })
    }]
  }));
  
  return { orderId, orderNumber };
}
```

### Payment Confirmation Transaction

```typescript
// services/api/src/handlers/payments/webhook.ts
export async function finalizeOrderPayment(orderId: string, paymentId: string) {
  const order = await orderAdapter.get(orderId);
  
  const transactItems = [
    // Update payment status
    {
      Update: {
        TableName: process.env.TABLE_NAME!,
        Key: { PK: `PAYMENT#${paymentId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #status = :captured, paid_at = :now',
        ConditionExpression: '#status <> :captured', // idempotent
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':captured': 'captured',
          ':now': new Date().toISOString()
        }
      }
    },
    // Update order status
    {
      Update: {
        TableName: process.env.TABLE_NAME!,
        Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #status = :confirmed, updated_at = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':confirmed': 'confirmed',
          ':now': new Date().toISOString()
        }
      }
    },
    // Finalize stock: convert reserved to actual sale
    ...order.items.map(item => ({
      Update: {
        TableName: process.env.TABLE_NAME!,
        Key: { PK: `PRODUCT#${item.productId}`, SK: 'METADATA' },
        UpdateExpression: 'SET stock_quantity = stock_quantity - :qty, reserved_stock = reserved_stock - :qty, updated_at = :now',
        ConditionExpression: 'reserved_stock >= :qty', // ensure stock still reserved
        ExpressionAttributeValues: {
          ':qty': item.quantity,
          ':now': new Date().toISOString()
        }
      }
    })),
    // Create inventory logs for sale
    ...order.items.map(item => ({
      Put: {
        TableName: process.env.TABLE_NAME!,
        Item: {
          PK: `PRODUCT#${item.productId}`,
          SK: `INVLOG#${Date.now()}#${crypto.randomUUID()}`,
          change_type: 'sale',
          quantity_change: -item.quantity,
          reference_type: 'order',
          reference_id: orderId,
          created_at: new Date().toISOString()
        }
      }
    }))
  ];
  
  await dynamoClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
  
  // Publish event for notifications
  await eventBridgeClient.send(new PutEventsCommand({
    Entries: [{
      Source: 'vyapargyan.payments',
      DetailType: 'PaymentCaptured',
      Detail: JSON.stringify({ orderId, paymentId, sellerId: order.sellerId })
    }]
  }));
}
```

### Stock Unreservation (Cancel/Reject)

```typescript
export async function unreserveOrderStock(orderId: string) {
  const order = await orderAdapter.get(orderId);
  
  const transactItems = [
    // Update order status
    {
      Update: {
        TableName: process.env.TABLE_NAME!,
        Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #status = :cancelled, updated_at = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':cancelled': 'cancelled',
          ':now': new Date().toISOString()
        }
      }
    },
    // Unreserve stock
    ...order.items.map(item => ({
      Update: {
        TableName: process.env.TABLE_NAME!,
        Key: { PK: `PRODUCT#${item.productId}`, SK: 'METADATA' },
        UpdateExpression: 'SET reserved_stock = reserved_stock - :qty, updated_at = :now',
        ConditionExpression: 'reserved_stock >= :qty',
        ExpressionAttributeValues: {
          ':qty': item.quantity,
          ':now': new Date().toISOString()
        }
      }
    })),
    // Log unreservation
    ...order.items.map(item => ({
      Put: {
        TableName: process.env.TABLE_NAME!,
        Item: {
          PK: `PRODUCT#${item.productId}`,
          SK: `INVLOG#${Date.now()}#${crypto.randomUUID()}`,
          change_type: 'unreserved',
          quantity_change: -item.quantity,
          reference_type: 'order',
          reference_id: orderId,
          created_at: new Date().toISOString()
        }
      }
    }))
  ];
  
  await dynamoClient.send(new TransactWriteCommand({ TransactItems: transactItems }));
}
```

## Stock Concurrency Handling

- **Conditional expressions** on DynamoDB updates prevent overselling
- **`stock_quantity - reserved_stock >= :qty`** ensures available stock before reservation
- **`reserved_stock >= :qty`** ensures stock still reserved before finalizing
- **Atomic transactions** via TransactWriteItems ensure all-or-nothing updates
- **Optimistic locking** via conditional expressions on status transitions
- **No negative stock**: Conditional expressions fail transaction if stock insufficient

## Idempotency Keys

- **Order creation**: `idempotency_key = hash(customer_id + items + timestamp_minute)` stored in DynamoDB with conditional write
- **Payment creation**: `idempotency_key = "payment_{order_id}_{attempt}"` with GSI for lookup
- **Webhook processing**: Razorpay `event_id` stored with conditional write to prevent duplicate processing

## Failure Recovery

- **Order creation fails mid-transaction**: DynamoDB TransactWrite rolls back all changes atomically
- **Payment webhook fails**: Razorpay retries (up to 24h). Lambda is idempotent via conditional writes.
- **Seller never responds**: EventBridge scheduled rule triggers Lambda daily to cancel orders pending > 48h
- **Orphaned reservations**: Nightly Lambda job finds orders in `pending` > 72h, cancels and unreserves stock
- **Dead letter queue**: Failed async operations sent to SQS DLQ for manual review

## Audit Logging

Every state transition creates an audit log entry in DynamoDB:

```typescript
// DynamoDB Schema
PK: AUDIT#{timestamp}#{uuid}
SK: ORDER#{order_id}
Attributes:
  - actor_id: string (user ID or 'system' or 'webhook')
  - actor_role: 'admin' | 'seller' | 'customer' | 'system' | 'webhook'
  - action: 'order_created' | 'order_accepted' | 'payment_captured' | 'stock_reserved' | etc.
  - resource_type: 'order' | 'payment' | 'product'
  - resource_id: string
  - old_values: object (JSONB-like)
  - new_values: object (JSONB-like)
  - created_at: string ISO timestamp
  - ttl: number (optional, for automatic cleanup)
```

Audit logs are queryable via GSI on `resource_type` and `resource_id`.

## DynamoDB Schema

### Orders Table

```
PK: ORDER#{order_id}
SK: METADATA
Attributes:
  - order_number (string, unique)
  - seller_id (string) [GSI: SellerOrdersIndex]
  - customer_id (string) [GSI: CustomerOrdersIndex]
  - status (string) [GSI: StatusIndex]
  - subtotal, tax, shipping, total_amount (number)
  - shipping_name, shipping_phone, shipping_address (string)
  - source ('whatsapp' | 'web' | 'manual')
  - created_at, updated_at (string ISO timestamp)

PK: ORDER#{order_id}
SK: ITEM#{index}
Attributes:
  - product_id (string)
  - product_name (string, denormalized)
  - quantity (number)
  - unit_price (number)
  - subtotal (number)
```

### Products Table (Stock Management)

```
PK: PRODUCT#{product_id}
SK: METADATA
Attributes:
  - stock_quantity (number) - total physical stock
  - reserved_stock (number) - stock reserved for pending orders
  - available_stock (computed: stock_quantity - reserved_stock)
  - updated_at (string ISO timestamp)
```

### Inventory Logs

```
PK: PRODUCT#{product_id}
SK: INVLOG#{timestamp}#{uuid}
Attributes:
  - change_type ('reserved' | 'unreserved' | 'sale' | 'restock' | 'adjustment' | 'return')
  - quantity_change (number, positive or negative)
  - quantity_before (number)
  - quantity_after (number)
  - reference_type ('order' | 'manual' | 'return')
  - reference_id (string)
  - created_at (string ISO timestamp)
```

## Monitoring

- **CloudWatch Metrics**: Order creation success rate, stock reservation failures, transaction rollbacks
- **CloudWatch Alarms**: Alert on high order creation failure rate, stock inconsistencies
- **X-Ray Tracing**: End-to-end tracing from order creation to payment confirmation
- **DynamoDB Metrics**: Monitor consumed capacity, throttled requests, transaction conflicts

## Key Differences from SQL

| Aspect                | SQL (Old)                          | DynamoDB (New)                      |
| --------------------- | ---------------------------------- | ----------------------------------- |
| Transactions          | BEGIN/COMMIT with row locks        | TransactWriteItems (atomic)         |
| Stock Locking         | SELECT ... FOR UPDATE              | Conditional expressions             |
| Rollback              | ROLLBACK on error                  | Automatic on transaction failure    |
| Inventory Logs        | INSERT in same transaction         | Put items in TransactWrite          |
| Concurrency           | Row-level locks                    | Optimistic locking with conditions  |
| Idempotency           | UNIQUE constraints                 | Conditional writes                  |
