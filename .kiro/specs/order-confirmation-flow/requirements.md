# Requirements Document: Order Confirmation Flow

## Introduction

This specification defines the end-to-end order confirmation flow for VyaparGyan — the core commerce loop that proves the platform works. A customer discovers a product, places an order, the seller confirms it, and the customer pays. The flow must work across both WhatsApp and Web channels with full omnichannel sync.

### Current State Summary

**What exists today:**
- OrderService (`services/api/src/services/order-service.ts`) creates orders with DynamoDB TransactWriteItems, deducts inventory atomically, generates VG-YYYYMMDD-NNNN order IDs. Orders are created with status `PENDING_PAYMENT`.
- RazorpayAdapter (`services/api/src/adapters/razorpay-adapter.ts`) creates payment links with commission splitting via Razorpay Route, verifies webhook signatures.
- Razorpay webhook handler (`services/api/src/handlers/payment/razorpay-webhook.ts`) handles `payment.captured`, `payment.failed`, `payment_link.paid`, `payment_link.expired` events. Updates order to `PAID` and notifies via WhatsApp.
- CartService (`services/api/src/services/cart-service.ts`) manages cart as first-class DynamoDB entity (PK: CART#{userId}, SK: ACTIVE) with optimistic concurrency, publishes CartUpdated events to EventBridge.
- WhatsApp state router (`services/api/src/handlers/whatsapp/states/router.ts`) routes messages to state handlers (greeting, browsing, checkout, onboarding).
- Checkout handler (`services/api/src/handlers/whatsapp/states/checkout-handler.ts`) handles cart → order creation → payment link generation in a single step with no seller confirmation.
- Cart checkout handler (`services/api/src/handlers/cart/cart-checkout-handler.ts`) publishes CheckoutInitiated event and clears cart for web flow.
- Events stack (`infra/cdk/lib/stacks/events-stack.ts`) has EventBridge bus, SQS queues, notification router, message fan-out Lambda, campaign workers.
- Existing order lifecycle design (`docs/order_lifecycle.md`) already documents the seller accept/reject flow and DynamoDB transaction boundaries.
- Existing payment integration design (`docs/payment_integration.md`) documents Razorpay webhook processing and stock finalization.

**The key gap:**
There is no seller confirmation step. Orders currently go straight from cart → `PENDING_PAYMENT` → `PAID`. The new flow needs: cart → `pending_seller_confirmation` → `confirmed` → `payment_pending` → `paid` → `preparing` → `shipped` → `delivered`.

### What This Spec Delivers

1. Order state machine with seller confirmation as a required step before payment
2. Seller order acceptance and rejection via Web Dashboard and WhatsApp
3. Razorpay payment link generation triggered by seller acceptance (not order creation)
4. Omnichannel order status notifications via EventBridge fan-out
5. Cart abandonment nudges via EventBridge Scheduler
6. Web App order tracking UI for customers and order management UI for sellers
7. Demo data seeding for end-to-end demonstration

## Glossary

- **System**: The VyaparGyan omnichannel commerce platform
- **Order_Service**: Backend service responsible for order creation, status transitions, and DynamoDB transactions
- **Order_State_Machine**: The set of valid order statuses and enforced transitions between them
- **Seller_Confirmation**: The step where a seller reviews and accepts or rejects a pending order before payment is requested
- **Payment_Link**: A Razorpay-generated URL that allows a customer to complete payment via UPI, card, netbanking, or wallet
- **Embedded_Checkout**: Razorpay checkout widget rendered inside the Web App for in-browser payment
- **Notification_Router**: Lambda function that routes order status change events to all active channels for a given user
- **Fan_Out_Lambda**: Lambda function that pushes messages to all active recipient channels (WhatsApp via Twilio, Web via WebSocket)
- **Cart_Abandonment_Nudge**: Automated reminder sent to a customer who has confirmed an order but not completed payment within a configured time window
- **Order_Timeline**: Chronological UI component showing all status transitions for an order with timestamps
- **Channel**: Communication medium — WhatsApp (via Twilio) or Web (via Next.js app with WebSocket)
- **Seller_Dashboard**: Next.js web application at `/seller/orders` where sellers manage incoming orders
- **Customer_Web_App**: Next.js web application at `/(customer)/orders` where customers track order status
- **EventBridge_Bus**: The `vyapargyan-{env}-events` EventBridge bus used for all async domain events
- **Razorpay_Webhook**: HTTP endpoint that receives payment status callbacks from Razorpay
- **Commission_Split**: Platform takes a configurable percentage (default 15%) of each order; remainder is transferred to seller via Razorpay Route
- **Stock_Reservation**: Atomic DynamoDB TransactWriteItems operation that increments `reserved_stock` on product records when an order is created
- **Stock_Finalization**: Atomic DynamoDB TransactWriteItems operation that decrements both `stock_quantity` and `reserved_stock` when payment is confirmed
- **Stock_Unreservation**: Atomic DynamoDB TransactWriteItems operation that decrements `reserved_stock` when an order is rejected, cancelled, or expired
- **Demo_Data**: Pre-seeded products, customer profile, and seller profile used for end-to-end demonstration

## Requirements

### Requirement 1: Order State Machine with Seller Confirmation

**User Story:** As a platform operator, I want orders to require seller confirmation before payment is requested, so that sellers maintain control over which orders they fulfill.

#### Acceptance Criteria

1. THE Order_State_Machine SHALL define the following valid statuses: `pending_seller_confirmation`, `confirmed`, `payment_pending`, `paid`, `preparing`, `shipped`, `delivered`, `completed`, `rejected`, `cancelled`, `payment_failed`, `expired`
2. WHEN a customer confirms an order (via WhatsApp "CONFIRM" reply or Web App "Place Order" button), THE Order_Service SHALL create the order with status `pending_seller_confirmation` and reserve stock atomically using DynamoDB TransactWriteItems
3. THE Order_State_Machine SHALL enforce the following transitions: `pending_seller_confirmation` → `confirmed` (seller accepts), `pending_seller_confirmation` → `rejected` (seller declines), `confirmed` → `payment_pending` (payment link generated), `payment_pending` → `paid` (payment captured), `paid` → `preparing` (seller starts preparation), `preparing` → `shipped` (seller ships), `shipped` → `delivered` (seller confirms delivery), `delivered` → `completed` (auto or manual)
4. THE Order_State_Machine SHALL enforce the following cancellation transitions: `pending_seller_confirmation` → `cancelled` (customer cancels), `confirmed` → `cancelled` (customer cancels before payment), `payment_pending` → `expired` (payment link expires without payment), `payment_pending` → `payment_failed` (Razorpay reports failure)
5. WHEN an order transitions to `rejected`, `cancelled`, or `expired`, THE Order_Service SHALL unreserve stock atomically using DynamoDB TransactWriteItems by decrementing `reserved_stock` for each order item
6. WHEN an order transitions to `paid`, THE Order_Service SHALL finalize stock by decrementing both `stock_quantity` and `reserved_stock` atomically using DynamoDB TransactWriteItems
7. THE Order_Service SHALL reject any status transition not defined in the Order_State_Machine by returning a 400 error with the current status and attempted target status
8. THE Order_Service SHALL record every status transition as an audit log entry with PK: AUDIT#{timestamp}#{uuid}, SK: ORDER#{orderId}, including actor_id, actor_role, old_status, new_status, and timestamp


### Requirement 2: Order Creation from WhatsApp

**User Story:** As a customer using WhatsApp, I want to place an order by chatting with the VyaparGyan bot, so that I can shop conversationally without opening a web browser.

#### Acceptance Criteria

1. WHEN a customer sends a product inquiry message (e.g., "I want 2 packets of Amul Butter"), THE System SHALL extract the product name and quantity using Gemini intent detection and search the seller's catalog by name similarity
2. WHEN a matching product is found with sufficient stock, THE System SHALL reply with a product card containing product name, unit price, requested quantity, line total, and stock availability
3. WHEN the customer replies "YES" to the product card, THE System SHALL add the product to the cart entity (PK: CART#{userId}, SK: ACTIVE) using a conditional write with version checking
4. WHEN items are added to the cart, THE System SHALL send an order summary message listing all cart items with quantities, unit prices, line totals, and cart subtotal, followed by the prompt "Reply CONFIRM to place your order"
5. WHEN the customer replies "CONFIRM", THE Order_Service SHALL create the order with status `pending_seller_confirmation`, reserve stock atomically, clear the cart, and transition the WhatsApp session state to `tracking`
6. IF stock is insufficient for any requested item during order creation, THEN THE System SHALL notify the customer with the product name and current available quantity, and keep the cart intact for modification
7. WHEN order creation succeeds, THE System SHALL send a WhatsApp confirmation message to the customer: "🛒 Order #{orderId} placed! Waiting for {sellerName} to confirm. We'll notify you once confirmed."

### Requirement 3: Order Creation from Web App

**User Story:** As a customer using the Web App, I want to browse products, add them to my cart, and place an order, so that I can shop from my browser.

#### Acceptance Criteria

1. WHEN a customer navigates to the catalog page, THE Customer_Web_App SHALL display products in a responsive grid with product name, price, stock status, and an "Add to Cart" button
2. WHEN a customer clicks "Add to Cart", THE System SHALL update the cart entity (PK: CART#{userId}, SK: ACTIVE) using a conditional write with version checking and publish a CartUpdated event to EventBridge
3. WHEN a customer navigates to the cart page, THE Customer_Web_App SHALL display all cart items with quantities (editable), unit prices, line totals, subtotal, and a "Place Order" button
4. WHEN a customer clicks "Place Order", THE Order_Service SHALL create the order with status `pending_seller_confirmation`, reserve stock atomically, clear the cart, and return the orderId to the Web App
5. WHEN order creation succeeds, THE Customer_Web_App SHALL redirect the customer to the order tracking page showing status `pending_seller_confirmation` with a message: "Order placed! Waiting for seller confirmation."
6. IF stock is insufficient for any cart item during order creation, THEN THE System SHALL return a 409 response listing unavailable items with their current available quantities
7. WHEN the customer also has an active WhatsApp session, THE System SHALL send a WhatsApp notification: "🛒 Order #{orderId} placed via web! Waiting for seller confirmation."

### Requirement 4: Seller Order Notification

**User Story:** As a seller, I want to receive real-time notifications when a new order arrives, so that I can respond promptly.

#### Acceptance Criteria

1. WHEN an order is created with status `pending_seller_confirmation`, THE Order_Service SHALL publish an `order.created` event to EventBridge with orderId, sellerId, customerId, items, subtotal, and channel (whatsapp or web)
2. WHEN the `order.created` event is received, THE Notification_Router SHALL send a notification to the seller on all active channels: Web Dashboard push notification and WhatsApp message (if seller has WhatsApp configured)
3. THE seller WhatsApp notification SHALL contain: order number, customer display name, item list with quantities, order total, and instructions "Reply ACCEPT to confirm or REJECT to decline"
4. THE Seller_Dashboard SHALL display a toast notification with order number and total amount when a new order arrives via WebSocket push
5. THE Seller_Dashboard orders page SHALL display a badge count of pending orders requiring action
6. WHEN a seller does not respond to an order within 30 minutes, THE System SHALL send a reminder notification to the seller on all active channels
7. WHEN a seller does not respond to an order within 2 hours, THE System SHALL notify the customer: "⏳ The seller hasn't responded to your order yet. We'll keep you updated."

### Requirement 5: Seller Order Acceptance via Web Dashboard

**User Story:** As a seller using the Web Dashboard, I want to review and accept or reject orders, so that I can manage my order fulfillment.

#### Acceptance Criteria

1. WHEN a seller navigates to the orders page, THE Seller_Dashboard SHALL display a list of all orders filterable by status (pending, confirmed, paid, preparing, shipped, delivered, rejected, cancelled) and sortable by creation date
2. WHEN a seller selects an order, THE Seller_Dashboard SHALL display the order detail view with: customer display name, item list with quantities and prices, order total, commission breakdown, order timeline, and action buttons
3. WHEN a seller clicks "Accept Order", THE Order_Service SHALL transition the order status from `pending_seller_confirmation` to `confirmed` using a DynamoDB conditional update (ConditionExpression: status = pending_seller_confirmation)
4. WHEN a seller clicks "Reject Order", THE Seller_Dashboard SHALL require a rejection reason text input, and THE Order_Service SHALL transition the order status to `rejected`, store the rejection reason, and unreserve stock atomically
5. WHEN an order is accepted, THE Order_Service SHALL publish an `order.confirmed` event to EventBridge with orderId, sellerId, customerId, and totalAmount
6. WHEN an order is rejected, THE Order_Service SHALL publish an `order.rejected` event to EventBridge with orderId, sellerId, customerId, and rejectionReason
7. THE Seller_Dashboard SHALL provide action buttons for subsequent status transitions: "Mark as Preparing" (confirmed/paid → preparing), "Mark as Shipped" (preparing → shipped), "Mark as Delivered" (shipped → delivered)

### Requirement 6: Seller Order Acceptance via WhatsApp

**User Story:** As a seller using WhatsApp, I want to accept or reject orders by replying to the bot, so that I can manage orders on the go.

#### Acceptance Criteria

1. WHEN a seller replies "ACCEPT" to an order notification on WhatsApp, THE System SHALL parse the most recent pending order for that seller and transition the order status from `pending_seller_confirmation` to `confirmed`
2. WHEN a seller replies "REJECT" to an order notification on WhatsApp, THE System SHALL transition the order status to `rejected` with a default rejection reason "Seller declined via WhatsApp", and unreserve stock atomically
3. WHEN a seller replies "ACCEPT {orderId}" or "REJECT {orderId}", THE System SHALL apply the action to the specified order, allowing sellers with multiple pending orders to act on a specific one
4. WHEN the seller acceptance via WhatsApp succeeds, THE System SHALL send a confirmation message to the seller: "✅ Order #{orderId} accepted! Payment link sent to customer."
5. WHEN the seller rejection via WhatsApp succeeds, THE System SHALL send a confirmation message to the seller: "❌ Order #{orderId} rejected. Customer has been notified."
6. IF the order is no longer in `pending_seller_confirmation` status when the seller replies, THEN THE System SHALL notify the seller: "⚠️ Order #{orderId} is already {currentStatus}. No action needed."


### Requirement 7: Payment Link Generation on Seller Acceptance

**User Story:** As a customer, I want to receive a payment link only after the seller confirms my order, so that I only pay for orders that will be fulfilled.

#### Acceptance Criteria

1. WHEN the `order.confirmed` event is received, THE System SHALL generate a Razorpay Payment Link using the RazorpayAdapter with amount in paise, INR currency, customer contact info, 30-minute expiry, reference_id set to orderId, and UPI, card, netbanking, and wallet payment methods enabled
2. WHEN the Payment_Link is generated, THE Order_Service SHALL update the order record with paymentLinkId, paymentLinkUrl, and transition status to `payment_pending`
3. WHEN the Payment_Link is generated for a WhatsApp-originated order, THE System SHALL send a WhatsApp message to the customer: "✅ {sellerName} accepted your order! Pay ₹{amount} here: {paymentLinkUrl}"
4. WHEN the Payment_Link is generated for a Web-originated order, THE Customer_Web_App SHALL display a "Pay Now" button with an embedded Razorpay checkout widget on the order tracking page
5. WHEN the Payment_Link is generated and the customer has both WhatsApp and Web active, THE System SHALL notify on both channels: WhatsApp message with payment link URL and Web App real-time update with embedded checkout button
6. THE Payment_Link SHALL include Razorpay Route transfer configuration to split the payment: platform commission (configurable, default 15%) retained by platform, remainder transferred to seller's linked Razorpay account
7. IF Payment_Link generation fails after 3 retries, THEN THE System SHALL log the error, keep the order in `confirmed` status, and notify the seller: "⚠️ Payment link generation failed for order #{orderId}. Retrying automatically."

### Requirement 8: Payment Processing and Confirmation

**User Story:** As a customer, I want to complete payment and receive confirmation, so that I know my order is being processed.

#### Acceptance Criteria

1. WHEN a customer completes payment via the Razorpay link or embedded checkout, THE Razorpay_Webhook SHALL receive a `payment_link.paid` or `payment.captured` event
2. WHEN the Razorpay_Webhook receives a payment success event, THE Order_Service SHALL verify the webhook signature, validate the payment amount matches the order total, and transition the order status from `payment_pending` to `paid` using DynamoDB TransactWriteItems
3. WHEN the order transitions to `paid`, THE Order_Service SHALL finalize stock (decrement `stock_quantity` and `reserved_stock`) and publish an `order.paid` event to EventBridge
4. WHEN the `order.paid` event is received, THE Notification_Router SHALL notify the customer on all active channels: WhatsApp message "🎉 Payment received! Your order #{orderId} is being prepared." and Web App real-time status update
5. WHEN the `order.paid` event is received, THE Notification_Router SHALL notify the seller on all active channels: WhatsApp message "💰 Payment received for order #{orderId} — ₹{amount}" and Web Dashboard notification
6. WHEN the Razorpay_Webhook receives a `payment.failed` event, THE Order_Service SHALL update the order status to `payment_failed` and notify the customer: "❌ Payment failed for order #{orderId}. Reason: {errorDescription}. Reply PAY to get a new payment link."
7. WHEN the Razorpay_Webhook receives a `payment_link.expired` event and the order is still in `payment_pending` status, THE Order_Service SHALL transition the order to `expired`, unreserve stock, and notify the customer: "⏰ Payment link expired for order #{orderId}. Reply REORDER to place a new order."
8. THE Razorpay_Webhook SHALL process each event idempotently by checking the order's current status before applying transitions, returning 200 OK for already-processed events

### Requirement 9: Order Fulfillment Status Updates

**User Story:** As a customer, I want to track my order through preparation, shipping, and delivery, so that I know when to expect my items.

#### Acceptance Criteria

1. WHEN a seller clicks "Mark as Preparing" on the Seller_Dashboard, THE Order_Service SHALL transition the order from `paid` to `preparing` and publish an `order.preparing` event to EventBridge
2. WHEN a seller clicks "Mark as Shipped" on the Seller_Dashboard, THE Order_Service SHALL transition the order from `preparing` to `shipped` and publish an `order.shipped` event to EventBridge
3. WHEN a seller clicks "Mark as Delivered" on the Seller_Dashboard, THE Order_Service SHALL transition the order from `shipped` to `delivered` and publish an `order.delivered` event to EventBridge
4. WHEN an `order.delivered` event is received, THE Notification_Router SHALL notify the customer on all active channels: WhatsApp message "📦 Your order #{orderId} has been delivered! Thank you for shopping at {sellerName}." and Web App real-time status update
5. WHEN any order status change event is received, THE Notification_Router SHALL determine the customer's active channels by checking for active WebSocket connections and WhatsApp service window, and deliver notifications to all active channels
6. WHEN a customer has an active WebSocket connection, THE Fan_Out_Lambda SHALL push the status update via the WebSocket API Gateway Management API within 2 seconds
7. WHEN a customer has an active WhatsApp service window (last inbound message within 24 hours), THE Fan_Out_Lambda SHALL send a WhatsApp message via Twilio

### Requirement 10: Omnichannel Order Notification Routing

**User Story:** As a platform operator, I want every order status change to trigger notifications on all active channels for both customer and seller, so that no one misses an update.

#### Acceptance Criteria

1. WHEN any order status changes, THE Order_Service SHALL publish an event to EventBridge with source `vyapargyan.orders`, detailType `order.{newStatus}`, and detail containing orderId, sellerId, customerId, oldStatus, newStatus, items, amount, and timestamp
2. WHEN an order event is received, THE Notification_Router SHALL query the customer's active channels (WebSocket connection record in DynamoDB, WhatsApp service window in consent record) and deliver the notification to each active channel
3. WHEN an order event is received, THE Notification_Router SHALL query the seller's active channels (WebSocket connection record, WhatsApp phone number) and deliver the notification to each active channel
4. THE Notification_Router SHALL use the existing message fan-out Lambda and EventBridge rules already deployed in the events stack for message delivery
5. THE Notification_Router SHALL format notifications appropriately for each channel: WhatsApp messages use emoji-rich text with order details, Web notifications use structured JSON for the frontend to render as toast notifications and timeline updates
6. IF notification delivery fails on one channel, THEN THE Notification_Router SHALL log the failure and continue delivering to remaining channels without blocking the order status transition
7. THE Notification_Router SHALL create a notification record in DynamoDB (PK: NOTIFICATION#{notificationId}, SK: METADATA) for each sent notification with channel, recipientId, orderId, status (sent, delivered, failed), and timestamp

### Requirement 11: Cart Abandonment and Payment Reminder Nudges

**User Story:** As a platform operator, I want to nudge customers who abandon their cart or don't complete payment, so that we recover potential revenue.

#### Acceptance Criteria

1. WHEN an order is created with status `pending_seller_confirmation` and the seller accepts but the customer does not complete payment within 2 hours, THE System SHALL send a nudge message to the customer on their last active channel: "🛒 Your order #{orderId} worth ₹{amount} is waiting for payment. Tap here to pay: {paymentLinkUrl}"
2. WHEN the customer still has not paid 24 hours after the first nudge, THE System SHALL send a second nudge with an urgency message: "⏰ Last chance! Your order #{orderId} payment link expires soon. Pay now: {paymentLinkUrl}"
3. THE System SHALL implement payment reminder nudges using EventBridge Scheduler, creating a one-time schedule when the payment link is generated with a 2-hour delay for the first nudge
4. WHEN the customer completes payment, THE System SHALL cancel any pending nudge schedules for that order by deleting the EventBridge Scheduler rule
5. WHEN a cart has items but no order has been placed for 24 hours, THE System SHALL send a cart abandonment nudge to the customer using the existing cart-abandonment-worker: "🛒 You have {itemCount} items in your cart worth ₹{subtotal}. Ready to checkout?"
6. THE System SHALL respect the customer's consent preferences: no nudges if the customer has opted out (consent record optedOut = true), and no nudges during quiet hours (22:00–09:00 IST)

### Requirement 12: Customer Order Tracking Web UI

**User Story:** As a customer using the Web App, I want to view my orders and track their status in real-time, so that I know the current state of each order.

#### Acceptance Criteria

1. WHEN a customer navigates to the orders page (`/(customer)/orders`), THE Customer_Web_App SHALL display a list of all orders sorted by creation date descending, showing order number, seller name, item count, total amount, current status badge, and creation date
2. WHEN a customer selects an order, THE Customer_Web_App SHALL display the order detail page (`/(customer)/orders/{orderId}`) with: item list (name, quantity, unit price, line total), subtotal, order timeline showing all status transitions with timestamps, and current status
3. WHEN the order status is `payment_pending`, THE Customer_Web_App SHALL display a "Pay Now" button that opens the Razorpay embedded checkout widget
4. WHEN the order status is `pending_seller_confirmation`, THE Customer_Web_App SHALL display a "Cancel Order" button that allows the customer to cancel before seller confirmation
5. WHEN the order status changes while the customer is viewing the order detail page, THE Customer_Web_App SHALL update the status badge and timeline in real-time via WebSocket push without requiring a page refresh
6. THE Order_Timeline component SHALL display each status transition as a step with: status label, timestamp, actor (customer, seller, or system), and optional note (e.g., rejection reason)
7. THE Customer_Web_App SHALL display a StatusPill component for each order status using color-coded badges: yellow for pending states, blue for in-progress states, green for completed states, red for failed/rejected/cancelled states

### Requirement 13: Seller Order Management Web UI

**User Story:** As a seller using the Web Dashboard, I want a dedicated orders page to manage all incoming and active orders, so that I can efficiently process my order queue.

#### Acceptance Criteria

1. WHEN a seller navigates to the orders page (`/seller/orders`), THE Seller_Dashboard SHALL display a list of all orders with columns: order number, customer name, items summary, total amount, status badge, creation date, and action buttons
2. THE Seller_Dashboard SHALL provide status filter tabs: "All", "Pending" (pending_seller_confirmation), "Confirmed", "Paid", "Preparing", "Shipped", "Delivered", "Rejected/Cancelled"
3. WHEN a seller selects an order, THE Seller_Dashboard SHALL display the order detail view with: customer display name and phone, item list with quantities and prices, subtotal, platform commission, seller amount, order timeline, and contextual action buttons
4. THE Seller_Dashboard SHALL display contextual action buttons based on current order status: "Accept Order" and "Reject Order" for pending_seller_confirmation, "Mark as Preparing" for paid, "Mark as Shipped" for preparing, "Mark as Delivered" for shipped
5. WHEN a new order arrives while the seller is on the orders page, THE Seller_Dashboard SHALL add the order to the list in real-time via WebSocket push and display a toast notification
6. THE Seller_Dashboard SHALL display an order count badge on the "Pending" filter tab showing the number of orders awaiting seller action
7. WHEN a seller performs an action (accept, reject, status update), THE Seller_Dashboard SHALL show a loading state on the action button and update the order status optimistically, reverting on failure with an error toast


### Requirement 14: DynamoDB Order Record Schema

**User Story:** As a backend developer, I want a well-defined DynamoDB schema for order records, so that I can efficiently query orders by seller, customer, and status.

#### Acceptance Criteria

1. THE Order_Service SHALL store order records with PK: ORDER#{orderId}, SK: METADATA containing: orderId, customerId, sellerId, items (array of {productId, name, quantity, unitPrice}), subtotal, commissionRate, commissionAmount, sellerAmount, totalAmount, status, paymentLinkId, paymentLinkUrl, razorpayPaymentId, channel (whatsapp or web), rejectionReason, createdAt, confirmedAt, paidAt, deliveredAt, updatedAt
2. THE Order_Service SHALL create a seller index entry with PK: SELLER#{sellerId}, SK: ORDER#{createdAt}#{orderId} containing orderId, customerId, totalAmount, status, and createdAt for querying a seller's order list sorted by date
3. THE Order_Service SHALL create a customer index entry with PK: CUSTOMER#{customerId}, SK: ORDER#{createdAt}#{orderId} containing orderId, sellerId, totalAmount, status, and createdAt for querying a customer's order list sorted by date
4. WHEN an order status changes, THE Order_Service SHALL update the status field on the ORDER#{orderId} METADATA record and on both the SELLER#{sellerId} and CUSTOMER#{customerId} index entries within the same DynamoDB transaction
5. THE Order_Service SHALL store order item records with PK: ORDER#{orderId}, SK: ITEM#{index} containing productId, productName (denormalized), quantity, unitPrice, and lineTotal for order detail queries
6. THE Order_Service SHALL generate human-readable order IDs in the format VG-YYYYMMDD-NNNN using the existing generateOrderId method

### Requirement 15: Razorpay Integration for Test Mode

**User Story:** As a demo operator, I want Razorpay to work in test mode with test credentials, so that I can demonstrate the full payment flow without real money.

#### Acceptance Criteria

1. THE System SHALL use Razorpay Test API Keys stored in environment variables (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) for all payment operations in non-production environments
2. WHEN generating a Payment_Link, THE RazorpayAdapter SHALL set the amount in paise (amount × 100), currency to INR, accept_partial to false, reference_id to orderId, and expiry to 30 minutes
3. WHEN generating a Payment_Link, THE RazorpayAdapter SHALL configure Razorpay Route transfers to split the payment: seller receives (totalAmount - commissionAmount) transferred to the seller's linked Razorpay account
4. WHEN generating a Payment_Link for WhatsApp delivery, THE RazorpayAdapter SHALL set notify.sms to false and notify.whatsapp to false (the platform sends its own WhatsApp notification with the link)
5. WHEN generating an embedded checkout session for Web delivery, THE System SHALL return the Razorpay payment link ID and key ID to the frontend for initializing the Razorpay checkout widget
6. THE Razorpay_Webhook handler SHALL verify the X-Razorpay-Signature header using HMAC-SHA256 with the webhook secret before processing any event
7. THE System SHALL support test payment methods: test card 4111 1111 1111 1111 (any expiry, any CVV) and test UPI success@razorpay

### Requirement 16: WhatsApp Bot Order Conversation States

**User Story:** As a customer using WhatsApp, I want the bot to guide me through the order flow with clear prompts at each step, so that I can complete my purchase conversationally.

#### Acceptance Criteria

1. WHEN the bot finds a matching product for a customer's inquiry, THE System SHALL send a product card message in the format: "📦 {productName} {variant} — ₹{unitPrice} × {quantity} = ₹{lineTotal}. Add to cart? Reply YES to confirm"
2. WHEN the customer replies "YES" and the item is added to cart, THE System SHALL send a cart summary: "🛒 Your order: {itemCount}× {productName} = ₹{subtotal}. Confirm order? Reply CONFIRM"
3. WHEN the customer replies "CONFIRM" and the order is created, THE System SHALL send: "🛒 Order #{orderId} placed! Waiting for {sellerName} to confirm. We'll notify you once confirmed."
4. WHEN the seller accepts the order, THE System SHALL send: "✅ {sellerName} accepted your order! Pay ₹{amount} here: {paymentLinkUrl}"
5. WHEN payment is received, THE System SHALL send: "🎉 Payment received! Your order #{orderId} is being prepared."
6. WHEN the order is delivered, THE System SHALL send: "📦 Your order has been delivered! Thank you for shopping at {sellerName}."
7. WHEN the seller rejects the order, THE System SHALL send: "❌ Sorry, {sellerName} couldn't fulfill your order #{orderId}. Reason: {rejectionReason}. Your cart has been restored — reply BROWSE to find alternatives."
8. THE WhatsApp state router SHALL handle the following order-related states: `checkout` (cart management and order confirmation), `tracking` (order status inquiries), and route seller ACCEPT/REJECT replies through the seller copilot flow

### Requirement 17: Demo Data Seeding

**User Story:** As a demo operator, I want pre-seeded data so that the order confirmation flow works out of the box for demonstrations.

#### Acceptance Criteria

1. THE System SHALL provide a seed script (`scripts/seed-demo-data.ts`) that creates the following products in Dragon Store's catalog: Amul Butter 500g (₹280, stock: 45), Surf Excel 1kg (₹199, stock: 30), USB-C Cable 1m (₹149, stock: 100)
2. THE seed script SHALL create a seller profile for Dragon Store with phone +91 89270 49085, business name "Dragon Store", seller status "approved", and a linked Razorpay test account ID
3. THE seed script SHALL create a customer profile for Enigma with phone +91 70011 24396, display name "Enigma", phone verification status "verified", and preferred channel "both"
4. THE seed script SHALL configure Razorpay test API keys in the environment: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET from Secrets Manager or environment variables
5. THE seed script SHALL be idempotent: running it multiple times shall not create duplicate records, using DynamoDB conditional writes (attribute_not_exists(PK)) for each seeded item
6. THE seed script SHALL log each seeded item with its PK and status (created or already_exists) for verification
