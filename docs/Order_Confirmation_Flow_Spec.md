I need to build the **Order Confirmation Flow** — the core transactional loop that makes VyaparGyan a real marketplace. Right now customers can browse and chat, but there's no seller-in-the-loop order acceptance. Here's what I need:

## The Flow

### Flow A: Customer orders via WhatsApp
```
Customer (WhatsApp) → "I want 2 packets of Amul Butter"
    ↓
AI Bot extracts intent → shows product card with price → Customer confirms "yes"
    ↓
Order created in DynamoDB (status: PENDING_SELLER_APPROVAL)
    ↓
🔔 Seller gets real-time notification in Web Inbox:
   "New Order #VG-1234 from Enigma
    📦 2x Amul Butter 500g — ₹560
    [✅ Accept]  [❌ Reject]  [💬 Message Customer]"
    ↓
Seller taps ✅ Accept
    ↓
Customer gets WhatsApp confirmation:
   "✅ Order Confirmed! #VG-1234
    📦 2x Amul Butter 500g — ₹560
    🏪 Dragon Store is preparing your order
    💳 Pay here: {razorpay_payment_link}"
    ↓
Customer pays via UPI link → Order status: CONFIRMED → PREPARING → READY → DELIVERED
```

### Flow B: Customer orders via Web App
```
Customer (Web Chat or Catalog) → adds items to cart → clicks Checkout
    ↓
Order created in DynamoDB (status: PENDING_SELLER_APPROVAL)
    ↓
🔔 Seller gets real-time notification in Web Inbox (same as Flow A)
    ↓
Seller taps ✅ Accept
    ↓
Customer gets notification in Web Chat:
   "✅ Order Confirmed! #VG-1234
    📦 2x Amul Butter 500g — ₹560
    🏪 Dragon Store is preparing your order"
   + Push notification if PWA installed
    ↓
If customer also has WhatsApp registered → also gets WhatsApp confirmation
```

### Flow C: Seller Rejects
```
Seller taps ❌ Reject (with optional reason: "Out of stock", "Store closed", "Custom reason")
    ↓
Customer gets notification on their original channel:
   "❌ Sorry, Dragon Store couldn't accept your order.
    Reason: Out of stock
    Would you like to search other stores?"
```

### Flow D: Seller Messages Customer (before accepting/rejecting)
```
Seller taps 💬 Message Customer → types "We only have 1 packet left, want just 1?"
    ↓
Customer gets message on their channel → replies "yes, 1 is fine"
    ↓
Seller updates order quantity → taps ✅ Accept
    ↓
Normal confirmation flow continues
```

## Architecture

```
Customer (WhatsApp/Web)
    ↓ order.created
DynamoDB: ORDER#{orderId} status=PENDING_SELLER_APPROVAL
    ↓ EventBridge: order.created
Fan-out Lambda → Push to Seller's WebSocket (Inbox notification)
    ↓
Seller Inbox: Order card with Accept/Reject/Message actions
    ↓ seller action
API Gateway → Order Handler Lambda
    ├─ Accept: status=CONFIRMED → EventBridge: order.confirmed
    │   ↓ Fan-out Lambda
    │   ├─ WebSocket → Customer Web Chat (order status card)
    │   ├─ Twilio → Customer WhatsApp (confirmation message)
    │   └─ Razorpay → Generate payment link (if not prepaid)
    │
    ├─ Reject: status=REJECTED → EventBridge: order.rejected
    │   ↓ Fan-out Lambda
    │   ├─ WebSocket → Customer Web Chat (rejection message)
    │   └─ Twilio → Customer WhatsApp (rejection message)
    │
    └─ Message: route through existing chat (human handoff activates)
```

## What to Build

### 1. Order State Machine Extension

Current states: `PENDING → CONFIRMED → PREPARING → READY → DELIVERED → COMPLETED`

New states:
```
PENDING_SELLER_APPROVAL → CONFIRMED (seller accepts)
PENDING_SELLER_APPROVAL → REJECTED (seller rejects)
PENDING_SELLER_APPROVAL → EXPIRED (seller doesn't respond in 30 min)
CONFIRMED → PREPARING → READY_FOR_PICKUP/OUT_FOR_DELIVERY → DELIVERED → COMPLETED
```

DynamoDB record:
```json
{
  "PK": "ORDER#ord-123",
  "SK": "METADATA",
  "orderId": "ord-123",
  "orderNumber": "VG-1234",
  "customerId": "cust-456",
  "sellerId": "seller-789",
  "status": "PENDING_SELLER_APPROVAL",
  "items": [
    { "productId": "prod-1", "name": "Amul Butter 500g", "price": 280, "quantity": 2 }
  ],
  "subtotal": 560,
  "channel": "whatsapp",
  "customerPhone": "+917001124396",
  "createdAt": "2026-04-06T10:00:00.000Z",
  "sellerResponseDeadline": "2026-04-06T10:30:00.000Z",
  "rejectionReason": null,
  "paymentLinkId": null,
  "paymentStatus": "unpaid"
}
```

### 2. Seller Inbox — Order Notification Card

When a new order arrives, the seller's Inbox should show a rich order card (via WebSocket push):

```typescript
// Rich message type: order_approval_request
{
  messageType: "order_approval_request",
  content: {
    orderId: "ord-123",
    orderNumber: "VG-1234",
    customerName: "Enigma",
    customerPhone: "+917001124396",
    channel: "whatsapp",
    items: [
      { name: "Amul Butter 500g", price: 280, quantity: 2 }
    ],
    subtotal: 560,
    createdAt: "2026-04-06T10:00:00.000Z",
    deadline: "2026-04-06T10:30:00.000Z"
  },
  actions: ["accept", "reject", "message"]
}
```

Frontend component: `OrderApprovalCard.tsx`
- Shows order details, item list, total
- Three action buttons: ✅ Accept, ❌ Reject (with reason dropdown), 💬 Message
- Countdown timer showing time remaining before auto-expiry
- Channel indicator (WhatsApp icon or Web icon showing where customer ordered from)

### 3. Order Action API Endpoints

```
POST /seller/orders/:orderId/accept
  → Updates status to CONFIRMED
  → Publishes order.confirmed to EventBridge
  → Generates Razorpay payment link (if COD not selected)
  → Returns confirmation

POST /seller/orders/:orderId/reject
  Body: { reason: "out_of_stock" | "store_closed" | "too_busy" | "custom", customReason?: string }
  → Updates status to REJECTED with reason
  → Publishes order.rejected to EventBridge
  → Returns confirmation

POST /seller/orders/:orderId/update
  Body: { items: [...updated items...] }
  → Updates order items and subtotal
  → Pushes updated order card to customer via their channel
```

### 4. Customer Confirmation Messages

**WhatsApp confirmation (order accepted):**
```
✅ *Order Confirmed!* #VG-1234

📦 Your order from Dragon Store:
  • 2x Amul Butter 500g — ₹560

🏪 Dragon Store is preparing your order

💳 Pay here: {razorpay_short_url}
   (Link expires in 30 minutes)

Type "status" anytime to check your order.
```

**WhatsApp rejection:**
```
❌ Sorry, Dragon Store couldn't accept your order #VG-1234.

Reason: Out of stock

Would you like to:
1. Search other stores for these items
2. Browse Dragon Store's available products
3. Cancel
```

**Web Chat confirmation (order_status card):**
```typescript
{
  messageType: "order_status",
  content: {
    orderId: "ord-123",
    orderNumber: "VG-1234",
    status: "confirmed",
    items: [...],
    subtotal: 560,
    sellerName: "Dragon Store",
    paymentLink: "https://rzp.io/...",
    estimatedTime: "15-20 minutes"
  }
}
```

### 5. Order Expiry (30-minute auto-cancel)

If seller doesn't respond within 30 minutes:
- EventBridge Scheduler fires → checks if order still PENDING_SELLER_APPROVAL
- If yes: update status to EXPIRED
- Notify customer: "Your order #VG-1234 expired because Dragon Store didn't respond. Would you like to try another store?"
- Log to audit: seller non-response for admin visibility

### 6. WhatsApp Order Flow Integration

Modify the WhatsApp worker to handle the order creation:

```
Customer: "I want 2 Amul Butter"
Bot: "📦 Amul Butter 500g — ₹280 each
      Quantity: 2
      Total: ₹560
      
      Confirm order? Reply YES or NO"
Customer: "yes"
Bot: "✅ Order #VG-1234 placed! Waiting for Dragon Store to confirm.
      You'll get a notification when they accept."
      → Create order in DynamoDB (PENDING_SELLER_APPROVAL)
      → Push to seller's Inbox
      → Start 30-min expiry timer
```

### 7. Order Status Tracking

Customer can check status anytime:
- WhatsApp: type "status" or "order status"
- Web: Orders page shows real-time status with timeline

Status updates pushed in real-time:
```
PENDING_SELLER_APPROVAL → "⏳ Waiting for Dragon Store to confirm..."
CONFIRMED → "✅ Dragon Store accepted! Preparing your order."
PREPARING → "👨‍🍳 Your order is being prepared"
READY → "📦 Your order is ready for pickup/delivery!"
DELIVERED → "🎉 Order delivered! Rate your experience?"
```

### 8. Seller Notification Sound + Badge

When a new order arrives in seller Inbox:
- Browser notification (if PWA/permission granted): "New order from Enigma — ₹560"
- Audio notification sound (subtle chime)
- Badge count on Inbox nav item updates
- Order card appears at top of Inbox with yellow/amber highlight

### 9. EventBridge Events

New events to add:
```
order.created → triggers seller inbox notification + 30min expiry timer
order.confirmed → triggers customer confirmation (WhatsApp + Web) + payment link generation
order.rejected → triggers customer rejection notification
order.expired → triggers customer expiry notification + admin audit log
order.status_updated → triggers customer status update notification
```

### 10. Files to Create/Modify

**New files:**
- `services/api/src/handlers/orders/accept.ts`
- `services/api/src/handlers/orders/reject.ts`
- `services/api/src/handlers/orders/update.ts`
- `services/api/src/handlers/workers/order-expiry-worker.ts`
- `services/api/src/services/order-notification.ts`
- `apps/web/src/components/inbox/OrderApprovalCard.tsx`
- `apps/web/src/components/orders/OrderTimeline.tsx`
- `apps/web/src/components/chat/OrderStatusCard.tsx`

**Modify:**
- `services/api/src/handlers/whatsapp/worker.ts` — add order creation from WhatsApp confirmation
- `services/api/src/handlers/websocket/sendMessage.ts` — handle order actions from seller Inbox
- `services/api/src/handlers/messaging/fanout.ts` — handle order.* events
- `services/api/src/services/order-service.ts` — add seller approval flow
- `services/api/src/services/message-router.ts` — route order notifications
- `infra/cdk/lib/stacks/events-stack.ts` — add order.* EventBridge rules
- `infra/cdk/lib/stacks/api-stack.ts` — add /seller/orders/:id/accept and /reject routes
- `apps/web/src/components/inbox/MessageList.tsx` — render OrderApprovalCard for order_approval_request type

## Acceptance Criteria

- [ ] Customer sends "I want 2 Amul Butter" on WhatsApp → order created with PENDING_SELLER_APPROVAL
- [ ] Seller sees order notification card in web Inbox within 1 second
- [ ] Seller taps Accept → customer gets WhatsApp confirmation with payment link within 2 seconds
- [ ] Seller taps Reject with reason → customer gets WhatsApp rejection with reason
- [ ] Order auto-expires after 30 minutes if seller doesn't respond
- [ ] Customer can check "status" on WhatsApp and get current order state
- [ ] Web app customer gets order confirmation in Chat as rich order_status card
- [ ] Seller gets browser notification + sound for new orders
- [ ] All order state transitions publish EventBridge events
- [ ] Payment link generated on acceptance (Razorpay)
- [ ] Seller can message customer before accepting/rejecting (human handoff activates)
- [ ] Order timeline shows all state transitions with timestamps
- [ ] Works end-to-end: WhatsApp order → seller accept → WhatsApp confirmation → UPI payment

## After Implementation

1. Run all tests: `pnpm --filter @vyapargyan/api test` (all must pass)
2. CDK deploy: `npx cdk deploy --all --context env=dev --context account=257656107715 --context region=ap-south-1`
3. Build frontend: `cd apps/web && pnpm build`
4. Push to GitHub: triggers GitHub Pages deploy
5. Smoke test the full flow with demo accounts

Create the Kiro spec (requirements.md → design.md → tasks.md) for this feature, then implement it.
