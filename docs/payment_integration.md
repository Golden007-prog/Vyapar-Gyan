# Part I — Payment Integration Design (Razorpay)

## Architecture

```
Order Confirmed (seller accepts)
    │
    ├─ 1. PaymentService.create_payment_link(order)
    │      ├─ Generate idempotency_key: "pay_{order_id}_{attempt}"
    │      ├─ Call Razorpay API: POST /payment_links
    │      │      Body: { amount: order.total_amount * 100 (paise), currency: "INR",
    │      │              description: "Order #VG-20260228-0001",
    │      │              customer: { contact: phone },
    │      │              notify: { sms: false, email: false },  // We notify via WhatsApp
    │      │              callback_url: "https://api.vyapargyan.com/api/v1/payments/callback",
    │      │              callback_method: "get" }
    │      ├─ Store in payments table:
    │      │      provider_order_id, payment_link_url, payment_link_id,
    │      │      idempotency_key, status='created'
    │      └─ Return payment_link_url
    │
    ├─ 2. Send payment link to customer (WhatsApp message)
    │
    ├─ 3. Customer pays via UPI/Card/NetBanking
    │
    └─ 4. Razorpay Webhook → POST /api/v1/payments/webhook
           ├─ Verify signature
           ├─ Process event
           └─ Update order + stock
```

## Webhook Verification

```python
import hmac, hashlib

def verify_razorpay_webhook(payload_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        payload_body,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

## Event Handling

| Razorpay Event      | Action                                                                        |
| ------------------- | ----------------------------------------------------------------------------- |
| `payment_link.paid` | Update payment status→captured, update order status→confirmed, finalize stock |
| `payment.captured`  | Same as above (backup event)                                                  |
| `payment.failed`    | Update payment status→failed, notify customer to retry                        |
| `refund.processed`  | Update payment status→refunded, update order→refunded                         |

## Duplicate Event Protection

1. Extract `event_id` from Razorpay payload
2. Check `payments.raw_webhook_payload` for existing event_id
3. Check `payments.status` — if already `captured`, skip
4. Redis lock: `SET rzp:event:{event_id} 1 NX EX 3600`

## Payment → Order Update Flow

```python
async def handle_payment_captured(event: RazorpayEvent):
    payment_link_id = event.payload.payment_link.entity.id
    payment = await payment_repo.find_by_payment_link_id(payment_link_id)
    if not payment or payment.status == 'captured':
        return  # idempotent

    async with db.transaction():
        # 1. Update payment
        await payment_repo.update(payment.id, {
            "status": "captured",
            "provider_payment_id": event.payload.payment.entity.id,
            "signature_verified": True,
            "paid_at": datetime.utcnow(),
            "raw_webhook_payload": event.dict()
        })

        # 2. Update order
        order = await order_repo.get(payment.order_id)
        await order_repo.update(order.id, {"status": "confirmed"})

        # 3. Finalize stock (reserved → sold)
        for item in await order_repo.get_items(order.id):
            await product_repo.finalize_stock(item.product_id, item.quantity)
            await inventory_repo.log(item.product_id, "sale", -item.quantity, order.id)

        # 4. Notify
        await notification_service.send(order.seller_id, "payment_received", order)
        await whatsapp_service.send_order_confirmed(order)

        # 5. Audit
        await audit_service.log("payment_captured", "payment", payment.id)
```

## Security Checks

- **Signature verification** on every webhook (reject unsigned requests)
- **Amount validation**: verify payment amount matches order total_amount
- **Currency validation**: verify INR
- **`signature_verified` flag**: stored per payment for audit
- **`fraud_review_flag`**: auto-set if amount mismatch or unusual pattern
- **Rate limiting**: Max 10 webhook calls per order_id per minute
