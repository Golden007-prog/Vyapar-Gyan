# Part F — Order Lifecycle Design

## Order State Machine

```
WhatsApp inquiry / Web browse
    → product selection
    → stock validation (available_stock = stock_quantity - reserved_stock)
    → PENDING (draft order created, stock reserved)
    → seller notified (seller_notifications: type=new_order)
    → seller ACCEPT → CONFIRMED → payment link created
    → seller REJECT → CANCELLED → stock unreserved
    → payment link sent to customer (WhatsApp/web)
    → Razorpay webhook: payment.captured → CONFIRMED → stock finalized (reserved→sale)
    → Razorpay webhook: payment.failed → stay CONFIRMED, retry link
    → seller marks PROCESSING → notifications sent
    → seller marks SHIPPED → tracking sent
    → seller marks DELIVERED → order complete
```

### Status Transitions (Enforced)

| From         | To           | Actor           | Side Effects                                                 |
| ------------ | ------------ | --------------- | ------------------------------------------------------------ |
| —            | `pending`    | System          | Reserve stock, create inventory_log(reserved), notify seller |
| `pending`    | `confirmed`  | Seller (accept) | Create payment link, notify customer                         |
| `pending`    | `cancelled`  | Seller (reject) | Unreserve stock, inventory_log(unreserved), notify customer  |
| `pending`    | `cancelled`  | Customer        | Unreserve stock, inventory_log(unreserved), notify seller    |
| `confirmed`  | `processing` | Seller          | —                                                            |
| `confirmed`  | `cancelled`  | Admin           | Unreserve stock, refund if paid                              |
| `processing` | `shipped`    | Seller          | Notify customer with tracking                                |
| `shipped`    | `delivered`  | Seller          | Finalize stock (reserved→sale), inventory_log(sale)          |
| `delivered`  | `returned`   | Admin           | Reverse sale, inventory_log(return), initiate refund         |
| any          | `refunded`   | Admin           | Process refund via Razorpay, inventory_log(return)           |

## DB Transaction Boundaries

### Order Creation Transaction (CRITICAL)

```sql
BEGIN;
  -- 1. Validate stock for all items
  SELECT stock_quantity, reserved_stock FROM products WHERE id = ANY($product_ids) FOR UPDATE;
  -- ↑ FOR UPDATE locks rows to prevent concurrent overselling

  -- 2. Check available_stock >= requested quantity for each item
  -- ROLLBACK if any item insufficient

  -- 3. Reserve stock
  UPDATE products SET reserved_stock = reserved_stock + $qty WHERE id = $product_id;

  -- 4. Create inventory_logs (type=reserved)
  INSERT INTO inventory_logs (product_id, change_type, quantity_change, quantity_before, quantity_after, reference_type)
    VALUES ($product_id, 'reserved', $qty, $before, $after, 'order');

  -- 5. Create order
  INSERT INTO orders (...) VALUES (...);

  -- 6. Create order_items
  INSERT INTO order_items (...) VALUES (...);

  -- 7. Create seller notification
  INSERT INTO seller_notifications (seller_id, type, title, reference_id, reference_type)
    VALUES ($seller_id, 'new_order', 'New order #' || $order_number, $order_id, 'order');
COMMIT;
```

### Payment Confirmation Transaction

```sql
BEGIN;
  -- 1. Update payment status
  UPDATE payments SET status='captured', provider_payment_id=$pid, paid_at=NOW() WHERE id=$payment_id;

  -- 2. Update order status
  UPDATE orders SET status='confirmed', updated_at=NOW() WHERE id=$order_id;

  -- 3. Finalize stock (convert reserved to actual sale)
  -- For each order item:
  UPDATE products SET
    stock_quantity = stock_quantity - $qty,
    reserved_stock = reserved_stock - $qty
  WHERE id = $product_id;

  -- 4. Log inventory change (sale)
  INSERT INTO inventory_logs (product_id, change_type, quantity_change, ...)
    VALUES ($product_id, 'sale', -$qty, ...);

  -- 5. Notify seller
  INSERT INTO seller_notifications (seller_id, type, title, reference_id)
    VALUES ($seller_id, 'payment_received', 'Payment received for #' || $order_number, $order_id);

  -- 6. Audit log
  INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, new_values)
    VALUES (NULL, 'payment_captured', 'order', $order_id, $webhook_data);
COMMIT;
```

## Stock Concurrency Handling

- **`SELECT ... FOR UPDATE`** on products row during order creation prevents overselling
- **Optimistic locking** via `updated_at` check on order status updates
- **reserved_stock** separates "spoken for" from "available" — two concurrent orders see correct availability
- **Negative stock prevented**: CHECK constraint or application-level validation before UPDATE

## Idempotency Keys

- Order creation: `idempotency_key = f"order_{customer_id}_{hash(items)}_{timestamp_minute}"`
- Payment creation: `idempotency_key = f"payment_{order_id}_{attempt}"` — stored in payments.idempotency_key (UNIQUE)
- Webhook processing: Razorpay event_id stored, checked before processing

## Failure Recovery

- **Order creation fails mid-transaction**: ROLLBACK undoes all stock reservations
- **Payment webhook fails**: Razorpay retries (up to 24h). Our webhook is idempotent.
- **Seller never responds**: Cron job cancels orders pending > 48h, unreserves stock
- **Orphaned reservations**: Nightly job finds orders in `pending` > 72h, cancels and unreserves

## Audit Logging

Every state transition creates an `audit_logs` entry with:

- `actor_id`: UUID of user (or NULL for system/webhook)
- `actor_role`: admin/seller/customer/system/webhook
- `action`: order_created, order_accepted, payment_captured, stock_reserved, etc.
- `resource_type`: order, payment, product
- `resource_id`: the entity UUID
- `old_values` / `new_values`: JSONB diff of changed fields
