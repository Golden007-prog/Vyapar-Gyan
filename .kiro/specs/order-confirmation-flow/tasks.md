# Implementation Plan: Order Confirmation Flow

## Overview

This plan implements the seller confirmation step into the VyaparGyan order lifecycle. The implementation follows an incremental approach: pure state machine first, then OrderService refactoring, API handlers, payment integration, EventBridge notifications, scheduler nudges, WhatsApp conversation updates, Web UI, demo data, and integration tests. Each step builds on the previous and wires into the existing codebase.

## Tasks

- [x] 1. Core order state machine and types
  - [x] 1.1 Create order state machine module
    - Create `services/api/src/services/order-state-machine.ts`
    - Implement `OrderStatus` type with all 12 statuses: `pending_seller_confirmation`, `confirmed`, `payment_pending`, `paid`, `preparing`, `shipped`, `delivered`, `completed`, `rejected`, `cancelled`, `payment_failed`, `expired`
    - Implement `TransitionActor` type: `customer`, `seller`, `system`, `webhook`
    - Implement `TRANSITIONS` lookup table mapping each status to valid (target, actors) pairs per the design status transition table
    - Implement `validateTransition(from, to, actor)` pure function returning `TransitionResult`
    - Implement `getValidTransitions(from, actor)` returning valid next statuses
    - Implement `isTerminalStatus(status)` returning true for statuses with no outgoing transitions
    - Implement `requiresStockUnreservation(status)` returning true for `rejected`, `cancelled`, `expired`
    - Implement `requiresStockFinalization(status)` returning true for `paid`
    - _Requirements: 1.1, 1.3, 1.4, 1.7_

  - [x] 1.2 Write property test for state machine transition validity (Property 1)
    - **Property 1: State Machine Transition Validity**
    - For any (from, to, actor) triple, `validateTransition` returns valid iff the triple is in the transition table; all undefined triples return valid=false with error message
    - Test file: `services/api/src/services/__tests__/order-state-machine.property.test.ts`
    - **Validates: Requirements 1.3, 1.4, 1.7**

  - [x] 1.3 Write property test for order ID format (Property 9)
    - **Property 9: Order ID Format**
    - For any generated order ID, it matches `^VG-\d{8}-\d{4}$` with a valid YYYYMMDD date
    - Test file: `services/api/src/services/__tests__/order-service.property.test.ts`
    - **Validates: Requirements 14.6**

- [x] 2. Refactor OrderService for new state machine
  - [x] 2.1 Refactor order creation to use `pending_seller_confirmation` and stock reservation
    - Modify `services/api/src/services/order-service.ts`
    - Change initial order status from `PENDING_PAYMENT` to `pending_seller_confirmation`
    - Replace direct `stockQuantity` deduction with `reserved_stock` increment: `SET reserved_stock = if_not_exists(reserved_stock, :zero) + :qty` with condition `stockQuantity - if_not_exists(reserved_stock, :zero) >= :qty`
    - Add `channel` field (`whatsapp` | `web`) to `CreateOrderInput` and order record
    - Add seller index entry (PK: `SELLER#{sellerId}`, SK: `ORDER#{createdAt}#{orderUUID}`)
    - Add customer index entry (PK: `CUSTOMER#{customerId}`, SK: `ORDER#{createdAt}#{orderUUID}`)
    - Add audit log entry (PK: `AUDIT#{date}#{auditUUID}`, SK: `ORDER#{orderUUID}`)
    - Publish `order.created` event to EventBridge after successful transaction
    - _Requirements: 1.2, 1.8, 4.1, 14.1, 14.2, 14.3, 14.5_

  - [x] 2.2 Implement `transitionOrder()` method
    - Add `TransitionOrderInput` interface with orderId, targetStatus, actor, actorId, reason
    - Validate transition using `validateTransition()` from state machine module
    - Execute DynamoDB conditional update with `ConditionExpression: #status = :expectedStatus`
    - Update status on ORDER metadata, SELLER index, and CUSTOMER index entries in same transaction
    - Create audit log entry for every transition
    - Handle stock unreservation for `rejected`, `cancelled`, `expired` transitions
    - Handle stock finalization for `paid` transition (decrement both `stock_quantity` and `reserved_stock`)
    - Publish EventBridge event `order.{newStatus}` after successful transition
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 14.4_

  - [x] 2.3 Implement `listSellerOrders()` and `listCustomerOrders()` methods
    - Query by PK: `SELLER#{sellerId}`, SK begins_with `ORDER#` for seller orders
    - Query by PK: `CUSTOMER#{customerId}`, SK begins_with `ORDER#` for customer orders
    - Support optional status filter
    - Return results sorted by creation date descending (ScanIndexForward: false)
    - _Requirements: 14.2, 14.3_

  - [x] 2.4 Write property test for stock reservation on order creation (Property 2)
    - **Property 2: Stock Reservation on Order Creation**
    - For any valid cart, creating an order results in `pending_seller_confirmation` status and `reserved_stock` incremented by ordered quantity; totalAmount equals sum of (unitPrice × quantity)
    - Test file: `services/api/src/services/__tests__/order-service.property.test.ts`
    - **Validates: Requirements 1.2, 2.5, 3.4**

  - [x] 2.5 Write property test for stock unreservation on terminal states (Property 3)
    - **Property 3: Stock Unreservation on Terminal States**
    - For any order transitioning to rejected/cancelled/expired, reserved_stock decremented by ordered quantity and remains non-negative
    - Test file: `services/api/src/services/__tests__/order-service.property.test.ts`
    - **Validates: Requirements 1.5, 5.4, 8.7**

  - [x] 2.6 Write property test for stock finalization on payment (Property 4)
    - **Property 4: Stock Finalization on Payment**
    - For any order transitioning to paid, both stock_quantity and reserved_stock decremented by ordered quantity; both remain non-negative
    - Test file: `services/api/src/services/__tests__/order-service.property.test.ts`
    - **Validates: Requirements 1.6, 8.3**

  - [x] 2.7 Write property test for stock conservation invariant (Property 5)
    - **Property 5: Stock Conservation Invariant**
    - For any sequence of order operations, `stock_quantity >= reserved_stock >= 0` holds at all times
    - Test file: `services/api/src/services/__tests__/order-service.property.test.ts`
    - **Validates: Requirements 1.2, 1.5, 1.6**

- [x] 3. Checkpoint — Core state machine and OrderService
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Seller order management API handlers
  - [x] 4.1 Create seller accept order handler
    - Create `services/api/src/handlers/seller/order-accept-handler.ts`
    - POST `/api/v1/seller/orders/:orderId/accept` with seller auth
    - Call `orderService.transitionOrder({ targetStatus: 'confirmed', actor: 'seller' })`
    - Return 200 with updated order on success, 400 for invalid transition, 409 for concurrent modification
    - _Requirements: 5.3, 5.5_

  - [x] 4.2 Create seller reject order handler
    - Create `services/api/src/handlers/seller/order-reject-handler.ts`
    - POST `/api/v1/seller/orders/:orderId/reject` with seller auth, body: `{ reason: string }`
    - Call `orderService.transitionOrder({ targetStatus: 'rejected', actor: 'seller', reason })`
    - Return 200 with updated order on success
    - _Requirements: 5.4, 5.6_

  - [x] 4.3 Create seller fulfillment status update handler
    - Create `services/api/src/handlers/seller/order-status-handler.ts`
    - POST `/api/v1/seller/orders/:orderId/status` with seller auth, body: `{ status: 'preparing' | 'shipped' | 'delivered' }`
    - Validate target status is a valid fulfillment transition from current status
    - Call `orderService.transitionOrder()` with appropriate parameters
    - _Requirements: 5.7, 9.1, 9.2, 9.3_

  - [x] 4.4 Create seller orders list handler
    - Create `services/api/src/handlers/seller/seller-orders-handler.ts`
    - GET `/api/v1/seller/orders` with seller auth, optional `?status=` query param
    - Call `orderService.listSellerOrders(sellerId, statusFilter)`
    - Return paginated order list
    - _Requirements: 5.1, 13.1_

- [x] 5. Customer order API handlers
  - [x] 5.1 Create web order creation handler
    - Create `services/api/src/handlers/orders/create-order-handler.ts`
    - POST `/api/v1/orders` with customer auth
    - Validate cart, call `orderService.createOrder({ channel: 'web' })`
    - Return 201 with orderId on success, 409 with unavailable items on stock failure
    - _Requirements: 3.4, 3.5, 3.6_

  - [x] 5.2 Create get order detail handler
    - Create `services/api/src/handlers/orders/get-order-handler.ts`
    - GET `/api/v1/orders/:orderId` with customer auth
    - Return order detail with items, timeline, payment link info
    - _Requirements: 12.2_

  - [x] 5.3 Create list customer orders handler
    - Create `services/api/src/handlers/orders/list-orders-handler.ts`
    - GET `/api/v1/orders` with customer auth
    - Call `orderService.listCustomerOrders(customerId)`
    - Return paginated order list sorted by creation date descending
    - _Requirements: 12.1_

  - [x] 5.4 Create customer cancel order handler
    - Create `services/api/src/handlers/orders/cancel-order-handler.ts`
    - POST `/api/v1/orders/:orderId/cancel` with customer auth
    - Call `orderService.transitionOrder({ targetStatus: 'cancelled', actor: 'customer' })`
    - Return 200 on success, 400 if order is not in a cancellable state
    - _Requirements: 1.4, 12.4_

- [x] 6. Register new API routes in CDK ApiStack
  - Modify `infra/cdk/lib/stacks/api-stack.ts`
  - Add seller order routes: GET/POST `/api/v1/seller/orders`, POST `/api/v1/seller/orders/{orderId}/accept`, `/reject`, `/status`
  - Add customer order routes: POST `/api/v1/orders`, GET `/api/v1/orders`, GET `/api/v1/orders/{orderId}`, POST `/api/v1/orders/{orderId}/cancel`
  - Configure Cognito authorizer for all new routes
  - _Requirements: 5.1–5.7, 12.1–12.4_

- [x] 7. Checkpoint — API handlers and routes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Razorpay integration updates
  - [x] 8.1 Update RazorpayAdapter for new payment link settings
    - Modify `services/api/src/adapters/razorpay-adapter.ts`
    - Set `notify.sms` to `false` and `notify.whatsapp` to `false` (platform sends its own notifications)
    - Add `expire_by` parameter set to 30 minutes from creation
    - Ensure `reference_id` is set to orderId for webhook correlation
    - _Requirements: 15.2, 15.3, 15.4_

  - [x] 8.2 Implement payment link generation on seller acceptance
    - Add logic in order confirmed event handler or inline in accept handler
    - Call `razorpayAdapter.createPaymentLink()` after successful `confirmed` transition
    - Update order with `paymentLinkId`, `paymentLinkUrl`, transition to `payment_pending`
    - Publish `order.payment_pending` event with paymentLinkUrl
    - Implement 3-retry with exponential backoff on Razorpay API failure
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 7.7_

  - [x] 8.3 Refactor Razorpay webhook handler for new state machine
    - Modify `services/api/src/handlers/payment/razorpay-webhook.ts`
    - Update `handlePaymentLinkPaid` to transition from `payment_pending` → `paid` using `orderService.transitionOrder()`
    - Add idempotency check using EVENT#{eventId} record with `attribute_not_exists(PK)` conditional write
    - Validate payment amount matches order totalAmount
    - Update `handlePaymentLinkExpired` to transition from `payment_pending` → `expired` with stock unreservation
    - Update `handlePaymentFailed` to transition to `payment_failed`
    - Cancel pending nudge schedules on payment/expiry
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 8.7, 8.8_

  - [x] 8.4 Write property test for Razorpay payload construction (Property 7)
    - **Property 7: Razorpay Payload Construction**
    - For any order with totalAmount > 0 and commissionRate in (0,1), payment link payload has correct amount in paise, INR currency, reference_id = orderId, transfers amount = (totalAmount - commissionAmount) × 100, notify.sms = false, notify.whatsapp = false
    - Test file: `services/api/src/adapters/__tests__/razorpay-adapter.property.test.ts`
    - **Validates: Requirements 7.6, 15.2, 15.3, 15.4**

  - [x] 8.5 Write property test for webhook signature round-trip (Property 8)
    - **Property 8: Webhook Signature Verification Round-Trip**
    - For any payload and secret, HMAC-SHA256 verification round-trips correctly; any modification causes failure
    - Test file: `services/api/src/adapters/__tests__/razorpay-adapter.property.test.ts`
    - **Validates: Requirements 15.6**

  - [x] 8.6 Write property test for webhook idempotency (Property 6)
    - **Property 6: Webhook Idempotency**
    - Processing the same webhook event twice produces the same final state as processing it once
    - Test file: `services/api/src/handlers/payment/__tests__/razorpay-webhook.property.test.ts`
    - **Validates: Requirements 8.8**

- [x] 9. Checkpoint — Razorpay integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. EventBridge notification routing
  - [x] 10.1 Add order event notification rule to EventsStack
    - Modify `infra/cdk/lib/stacks/events-stack.ts`
    - Add new EventBridge rule `OrderEventNotificationRule` matching source `vyapargyan.orders` and all order detail types
    - Target: existing `notificationRouterFunction`
    - _Requirements: 10.1, 10.4_

  - [x] 10.2 Create order notification formatter
    - Create `services/api/src/services/order-notification-formatter.ts`
    - Implement `formatOrderNotification(event, channel, recipientRole)` returning formatted message
    - WhatsApp messages: emoji-rich text with order details per design
    - Web notifications: structured JSON for frontend rendering
    - Handle all event types: order.created, order.confirmed, order.payment_pending, order.paid, order.preparing, order.shipped, order.delivered, order.rejected, order.cancelled, order.expired, order.payment_failed
    - _Requirements: 10.5, 16.1–16.7_

  - [x] 10.3 Update notification router to handle order events
    - Modify notification router worker to detect `vyapargyan.orders` source events
    - Query recipient active channels (WebSocket connection, WhatsApp service window)
    - Format notification per channel using order notification formatter
    - Deliver to all active channels; log failures without blocking
    - Create notification record in DynamoDB (PK: NOTIFICATION#{id}, SK: METADATA)
    - _Requirements: 10.2, 10.3, 10.5, 10.6, 10.7_

  - [x] 10.4 Write property test for notification message completeness (Property 10)
    - **Property 10: Notification Message Completeness**
    - For any order event and channel, formatted message contains orderId; seller notifications for order.created contain customer name, items, total, ACCEPT/REJECT instructions; customer notifications for order.confirmed contain seller name, amount, payment link
    - Test file: `services/api/src/services/__tests__/order-notification-formatter.property.test.ts`
    - **Validates: Requirements 4.3, 10.5, 16.1–16.7**

- [x] 11. EventBridge Scheduler for nudges and timeouts
  - [x] 11.1 Create order scheduler service
    - Create `services/api/src/services/order-scheduler-service.ts`
    - Implement `scheduleSellerReminders(orderId, sellerId)`: 30min seller reminder + 2h customer notify
    - Implement `schedulePaymentNudges(orderId, customerId, paymentLinkUrl)`: 2h first nudge + 24h second nudge
    - Implement `cancelOrderSchedules(orderId)`: delete all pending schedules for an order
    - Use `@aws-sdk/client-scheduler` with `CreateScheduleCommand` and `DeleteScheduleCommand`
    - Target: notification router Lambda ARN
    - _Requirements: 4.6, 4.7, 11.1, 11.2, 11.3, 11.4_

  - [x] 11.2 Add EventBridge Scheduler IAM permissions to CDK
    - Modify `infra/cdk/lib/stacks/events-stack.ts`
    - Create scheduler IAM role for order nudges (separate from trend scheduler role)
    - Grant `scheduler:CreateSchedule`, `scheduler:DeleteSchedule`, `scheduler:GetSchedule` to API Lambda
    - Grant `iam:PassRole` for the scheduler role
    - Add `SCHEDULER_ROLE_ARN` and `NOTIFICATION_ROUTER_ARN` environment variables to relevant Lambda functions
    - _Requirements: 11.3_

  - [x] 11.3 Wire scheduler calls into order lifecycle
    - Call `scheduleSellerReminders()` after order creation in OrderService
    - Call `schedulePaymentNudges()` after payment link generation
    - Call `cancelOrderSchedules()` on payment success, cancellation, rejection, expiry
    - _Requirements: 4.6, 4.7, 11.1, 11.2, 11.4_

  - [x] 11.4 Write property test for consent-based nudge filtering (Property 12)
    - **Property 12: Consent-Based Nudge Filtering**
    - For any customer with optedOut=true, all nudges suppressed; during quiet hours (22:00–09:00 IST), all nudges suppressed
    - Test file: `services/api/src/services/__tests__/nudge-filter.property.test.ts`
    - **Validates: Requirements 11.6**

- [x] 12. Checkpoint — Notifications and scheduler
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. WhatsApp conversation updates
  - [x] 13.1 Update checkout handler for new order flow
    - Modify `services/api/src/handlers/cart/cart-checkout-handler.ts`
    - Update order creation to use `pending_seller_confirmation` status with `channel: 'whatsapp'`
    - Send confirmation message: "🛒 Order #{orderId} placed! Waiting for {sellerName} to confirm."
    - Transition WhatsApp session state to `tracking` after order creation
    - _Requirements: 2.5, 2.7, 16.3_

  - [x] 13.2 Create WhatsApp tracking handler
    - Create `services/api/src/handlers/whatsapp/states/tracking-handler.ts`
    - Handle order status inquiries (customer asks "where is my order")
    - Handle PAY command: look up latest payment_pending order, resend payment link
    - Handle REORDER command: recreate cart from last order items
    - _Requirements: 16.8_

  - [x] 13.3 Create WhatsApp seller order handler
    - Create `services/api/src/handlers/whatsapp/states/seller-order-handler.ts`
    - Parse ACCEPT / REJECT commands (case-insensitive)
    - Parse ACCEPT {orderId} / REJECT {orderId} for specific order targeting
    - For bare ACCEPT/REJECT, resolve most recent pending order for seller
    - Call `orderService.transitionOrder()` with appropriate parameters
    - Send confirmation: "✅ Order #{orderId} accepted!" or "❌ Order #{orderId} rejected."
    - Handle already-processed orders: "⚠️ Order #{orderId} is already {currentStatus}."
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 13.4 Update WhatsApp state router
    - Modify `services/api/src/handlers/whatsapp/states/router.ts`
    - Add `tracking` state routing to tracking handler
    - Add `seller_orders` state routing to seller order handler
    - Import new handler modules
    - _Requirements: 16.8_

  - [x] 13.5 Write property test for seller command parsing (Property 11)
    - **Property 11: Seller Command Parsing**
    - For any message matching ACCEPT/REJECT {orderId}, parser extracts correct orderId; bare ACCEPT/REJECT returns null orderId
    - Test file: `services/api/src/handlers/whatsapp/__tests__/seller-command-parser.property.test.ts`
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 14. Checkpoint — WhatsApp integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Customer order tracking Web UI
  - [x] 15.1 Create order API client for web app
    - Create `apps/web/lib/api-orders.ts` (or update existing)
    - Implement `listOrders()`, `getOrder(orderId)`, `cancelOrder(orderId)`, `createOrder()`
    - Use existing `api-client.ts` fetch wrapper with auth headers
    - _Requirements: 12.1, 12.2, 12.4_

  - [x] 15.2 Implement customer orders list page
    - Modify `apps/web/app/(customer)/orders/page.tsx`
    - Display orders sorted by creation date descending
    - Show order number, seller name, item count, total amount, StatusPill badge, creation date
    - Link each order to detail page
    - _Requirements: 12.1, 12.7_

  - [x] 15.3 Implement customer order detail page
    - Modify `apps/web/app/(customer)/orders/[orderId]/page.tsx`
    - Display item list with name, quantity, unit price, line total
    - Display OrderTimeline component with status transitions, timestamps, actors
    - Display "Pay Now" button with Razorpay embedded checkout when status = `payment_pending`
    - Display "Cancel Order" button when status = `pending_seller_confirmation` or `confirmed`
    - Real-time status updates via WebSocket push
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

- [x] 16. Seller order management Web UI
  - [x] 16.1 Implement seller orders page
    - Modify `apps/web/app/seller/orders/page.tsx`
    - Display order list with columns: order number, customer name, items summary, total, status badge, date, action buttons
    - Add status filter tabs: All, Pending, Confirmed, Paid, Preparing, Shipped, Delivered, Rejected/Cancelled
    - Show pending count badge on Pending tab
    - Real-time order arrival via WebSocket push with toast notification
    - _Requirements: 13.1, 13.2, 13.5, 13.6_

  - [x] 16.2 Implement seller order detail and actions
    - Add order detail modal/view with customer info, items, commission breakdown, timeline
    - Add Accept/Reject buttons for `pending_seller_confirmation` orders (reject requires reason input)
    - Add fulfillment buttons: "Mark as Preparing", "Mark as Shipped", "Mark as Delivered"
    - Optimistic UI updates with error rollback and toast notifications
    - _Requirements: 13.3, 13.4, 13.7_

- [x] 17. Checkpoint — Web UI
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Demo data seeding
  - [x] 18.1 Update seed script with demo data
    - Modify `scripts/seed-demo-data.ts`
    - Add Dragon Store products: Amul Butter 500g (₹280, stock 45), Surf Excel 1kg (₹199, stock 30), USB-C Cable 1m (₹149, stock 100) — all with `reserved_stock: 0`
    - Add Dragon Store seller profile with phone +918927049085, businessName "Dragon Store", razorpayAccountId "acc_test_dragon"
    - Add Enigma customer profile with phone +917001124396, displayName "Enigma", preferredChannel "both"
    - Use conditional writes (`attribute_not_exists(PK)`) for idempotency
    - Log each item with PK and status (created/already_exists)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [x] 19. Integration tests
  - [x] 19.1 Write integration test for WhatsApp order flow
    - CONFIRM → order.created → ACCEPT → payment link → webhook → paid
    - Verify state transitions, stock changes, and notifications at each step
    - Test file: `services/api/src/handlers/__tests__/order-confirmation-flow.integration.test.ts`
    - _Requirements: 1.3, 2.5, 6.1, 7.1, 8.2_

  - [x] 19.2 Write integration test for web order flow
    - Place Order → order.created → Accept → Pay Now → webhook → paid
    - Verify API responses, state transitions, and stock changes
    - Test file: `services/api/src/handlers/__tests__/order-confirmation-flow.integration.test.ts`
    - _Requirements: 3.4, 5.3, 7.4, 8.2_

  - [x] 19.3 Write integration test for seller rejection flow
    - order.created → REJECT → stock unreserved → customer notified
    - Verify reserved_stock decremented and order status is rejected
    - Test file: `services/api/src/handlers/__tests__/order-confirmation-flow.integration.test.ts`
    - _Requirements: 1.5, 5.4, 5.6_

  - [x] 19.4 Write integration test for payment expiry flow
    - payment_pending → payment_link.expired webhook → expired → stock unreserved
    - Verify stock unreservation and notification delivery
    - Test file: `services/api/src/handlers/__tests__/order-confirmation-flow.integration.test.ts`
    - _Requirements: 8.7_

  - [x] 19.5 Write integration test for concurrent acceptance
    - Two sellers accepting same order → one succeeds, one gets 409
    - Verify conditional update prevents double-acceptance
    - Test file: `services/api/src/handlers/__tests__/order-confirmation-flow.integration.test.ts`
    - _Requirements: 1.7_

- [x] 20. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at natural break points
- Property tests validate the 12 correctness properties defined in the design document using fast-check
- Unit tests validate specific examples and edge cases
- The implementation language is TypeScript throughout, matching the existing codebase
