# Part E — WhatsApp Orchestration Design

## State Machine

The `whatsapp_sessions.session_state` column drives the conversation flow:

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

### Supabase (persistent, source of truth)

- `whatsapp_sessions` — full session record, state, customer_id, active_order_id, active_product_id
- `whatsapp_messages` — complete message history
- `customers` — customer profile, auto-created on first message
- `conversation_state` (JSONB) — cart items, selected category, shipping info draft

### Redis (hot cache, ephemeral)

- `wa:session:{phone}` → session_id + current state (TTL 30min, refreshed on activity)
- `wa:lock:{wa_message_id}` → idempotency lock (TTL 60s)
- `wa:rate:{phone}` → rate limit counter (TTL 1min)
- `wa:cart:{session_id}` → cart items in progress (TTL 2h)

## Webhook Processing Pipeline

```
Meta WebHook POST
    │
    ├─ 1. Signature Verification (X-Hub-Signature-256)
    │      └─ Reject → 401
    │
    ├─ 2. Parse webhook type
    │      ├─ Message → message pipeline
    │      └─ Status update → status pipeline
    │
    ├─ 3. Idempotency Check (Redis: wa:lock:{wa_message_id})
    │      └─ Duplicate → 200 OK, skip
    │
    ├─ 4. Rate Limit Check (Redis: wa:rate:{phone})
    │      └─ Exceeded → 200 OK, skip, log
    │
    ├─ 5. Session Resolution
    │      ├─ Redis cache hit → use cached session
    │      └─ Cache miss → DB lookup → create if new
    │
    ├─ 6. Message Handler Dispatch (by session_state)
    │      ├─ greeting_handler()
    │      ├─ browsing_handler()
    │      ├─ product_inquiry_handler()
    │      ├─ negotiation_handler() → PriceGuardian
    │      ├─ ordering_handler()
    │      ├─ payment_handler()
    │      ├─ tracking_handler()
    │      └─ support_handler()
    │
    ├─ 7. Response Generation
    │      ├─ Build response (text/interactive/template)
    │      └─ Send via WhatsApp Cloud API
    │
    ├─ 8. Persist
    │      ├─ Store inbound message
    │      ├─ Store outbound message
    │      ├─ Update session state
    │      └─ Update Redis cache
    │
    └─ 9. Return 200 OK (always, per Meta requirements)
```

## Customer Flows

### New Customer Onboarding

1. First message from unknown phone → auto-create `customers` record (phone_number, whatsapp_verified=true)
2. Create `whatsapp_sessions` (state=greeting)
3. Send welcome template: "Welcome to [Platform]! Browse products by sending 'shop' or 'hi'"
4. Transition to `browsing`

### Product Browsing

1. Show category list as interactive buttons
2. User selects category → show products as interactive list (name + price + image)
3. User selects product → transition to `product_inquiry`

### Order Intent → Creation

1. User says "I want to buy this" or selects "Order" button
2. Collect shipping info (name, address, pincode) — step by step via messages
3. Store in `conversation_state.shipping_draft` JSONB
4. Show order summary, ask for confirmation
5. On confirm: create order via Order Service, reserve stock
6. Transition to `payment`

## Duplicate Webhook Prevention

1. **Redis lock**: `SET wa:lock:{wa_message_id} 1 NX EX 60` — atomic, fails if already set
2. **DB unique**: `whatsapp_messages.wa_message_id` has UNIQUE constraint — final safety net
3. **Status updates**: Track `wa_status` progression (sent→delivered→read), ignore regressions

## Retry Strategy

- **Outbound failures**: Retry 3x with exponential backoff (1s, 5s, 30s)
- **Store error_code and error_message** on failure
- **Dead letter**: After 3 failures, log to audit, mark message as `failed`
- **Session recovery**: If session state is corrupted, reset to `greeting` with apology message

## Idempotency Strategy

- Every inbound webhook: check `wa_message_id` in Redis first, then DB
- Every outbound send: generate unique message reference
- Every state transition: use optimistic locking on `updated_at` column
- Cart operations: Redis SET operations are inherently idempotent
