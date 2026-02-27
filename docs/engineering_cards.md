# Part C — Engineering Development Cards

## Card 1: Backend Foundation

**Objective**: Scaffold FastAPI project with core infrastructure

**Dependencies**: None (first card)

**Tasks**:

1. Initialize FastAPI project with uvicorn
2. Implement `app/core/config.py` — Pydantic Settings with env vars
3. Implement `app/core/exceptions.py` — Custom exception hierarchy + handlers
4. Implement `app/core/logging.py` — Structured JSON logging with request correlation IDs
5. Implement `app/schemas/common.py` — Shared response envelope `{success, data, error, meta}`
6. Implement `app/integrations/supabase_client.py` — Async Supabase client wrapper
7. Setup Redis client with connection pooling
8. Write docker-compose with FastAPI + Redis
9. Create `.env.example` with all required vars

**Acceptance Criteria**: `uvicorn app.main:app` starts, health endpoint returns 200, Supabase client connects

---

## Card 2: Auth Middleware

**Objective**: Verify Supabase JWT tokens on incoming requests

**Dependencies**: Card 1

**Tasks**:

1. Implement JWT decode using Supabase JWKS endpoint
2. Create `get_current_user` FastAPI dependency
3. Load `user_profiles` + `user_roles` from Supabase on each request (cached in Redis)
4. Create `AuthenticatedUser` model with id, roles, seller_id, customer_id
5. Handle token refresh flow via Supabase GoTrue

**Endpoints**: `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`

**Acceptance Criteria**: Valid Supabase JWT → user object loaded. Invalid/expired → 401. Roles correctly attached.

---

## Card 3: RBAC Middleware

**Objective**: Role-based access control enforcement

**Dependencies**: Card 2

**Tasks**:

1. Create `require_roles(*roles)` dependency factory
2. Create `require_seller_ownership(resource)` dependency
3. Create `require_customer_ownership(resource)` dependency
4. Create `admin_or_owner()` composite dependency
5. Write audit log entry on every role-gated action

**Acceptance Criteria**: Admin can access all. Seller scoped to own resources. Customer scoped to own orders. Unauthorized → 403.

---

## Card 4: Catalog APIs

**Objective**: Public product browsing and search

**Dependencies**: Card 1

**Tasks**:

1. `GET /api/v1/catalog/categories` — list active categories (hierarchical)
2. `GET /api/v1/catalog/products` — paginated list with filters (category, price range, search text, seller)
3. `GET /api/v1/catalog/products/{id}` — full product detail with images, seller info
4. `GET /api/v1/catalog/sellers` — list active sellers
5. `GET /api/v1/catalog/sellers/{id}` — seller profile with products
6. Implement full-text search on product name/description

**Acceptance Criteria**: Unauthenticated users can browse. Only `status='active'` products shown. Pagination with cursor or offset.

---

## Card 5: Seller Product APIs

**Objective**: Seller CRUD for their own products

**Dependencies**: Cards 2, 3

**Tasks**:

1. `POST /api/v1/seller/products` — create product (draft status)
2. `PUT /api/v1/seller/products/{id}` — update product
3. `DELETE /api/v1/seller/products/{id}` — soft delete
4. `POST /api/v1/seller/products/{id}/images` — upload image to Supabase Storage
5. `DELETE /api/v1/seller/products/{id}/images/{img_id}`
6. `PATCH /api/v1/seller/products/{id}/status` — publish/unpublish
7. Seller ownership enforced on all mutations

**Acceptance Criteria**: Seller can only CRUD their own products. Images stored in Supabase Storage. Product status transitions enforced.

---

## Card 6: Inventory APIs

**Objective**: Stock management with audit trail

**Dependencies**: Card 5

**Tasks**:

1. `POST /api/v1/seller/products/{id}/inventory` — adjust stock (restock/adjustment)
2. `GET /api/v1/seller/products/{id}/inventory/logs` — inventory history
3. Auto-create `inventory_logs` entry on every stock change
4. Validate stock cannot go negative
5. Handle `reserved_stock` for pending orders

**Acceptance Criteria**: Every stock change logged. `quantity_before` + `quantity_change` = `quantity_after`. Negative stock prevented.

---

## Card 7: Order Creation Flow

**Objective**: Create orders from WhatsApp or web

**Dependencies**: Cards 4, 6

**Tasks**:

1. `POST /api/v1/orders` — create order with items (validates stock, reserves inventory)
2. Generate order_number via DB trigger
3. Calculate subtotal, tax, shipping, total
4. Create `order_items` with denormalized product_name and unit_price
5. Reserve stock: increment `reserved_stock`, log as `reserved` in inventory_logs
6. Set initial status = `pending`

**Acceptance Criteria**: Stock validated before order. Reserved stock updated atomically. Order number auto-generated. Insufficient stock → 400 error.

---

## Card 8: Seller Order Management

**Objective**: Seller accepts/rejects/manages orders

**Dependencies**: Card 7

**Tasks**:

1. `GET /api/v1/seller/orders` — list orders for seller (filterable by status)
2. `GET /api/v1/seller/orders/{id}` — order detail with items
3. `PATCH /api/v1/seller/orders/{id}/accept` — confirm order → trigger payment link
4. `PATCH /api/v1/seller/orders/{id}/reject` — reject → unreserve stock → notify customer
5. `PATCH /api/v1/seller/orders/{id}/status` — update to processing/shipped/delivered
6. Create seller notification on new order

**Acceptance Criteria**: Only seller's own orders. Accept → status=confirmed. Reject → stock unreserved + inventory_log. Status transitions enforced (no skipping).

---

## Card 9: WhatsApp Webhook Receiver

**Objective**: Receive and validate Meta WhatsApp Cloud API webhooks

**Dependencies**: Card 1

**Tasks**:

1. `GET /api/v1/whatsapp/webhook` — Meta verification challenge endpoint
2. `POST /api/v1/whatsapp/webhook` — inbound message/status webhook
3. Verify webhook signature (X-Hub-Signature-256)
4. Parse message types: text, image, interactive, button, location
5. Parse status updates: sent, delivered, read, failed
6. Deduplicate by `wa_message_id` (idempotent processing)
7. Store raw message in `whatsapp_messages`

**Acceptance Criteria**: Meta verification passes. Signature validation rejects tampered payloads. Duplicate messages ignored. All message types parsed.

---

## Card 10: WhatsApp Session Engine

**Objective**: Stateful conversation management via WhatsApp

**Dependencies**: Cards 4, 7, 9

**Tasks**:

1. Session lookup/creation by phone_number
2. State machine transitions: greeting→browsing→product_inquiry→ordering→payment→tracking
3. Message routing based on session_state
4. Product browse via interactive list messages
5. Order intent → draft order creation
6. Session state persistence in `conversation_state` JSONB
7. Hot state caching in Redis (phone_number → session_id + state)
8. Session expiry after 24h (WhatsApp window)

**Acceptance Criteria**: New phone → auto-creates customer + session. State transitions are valid. Session survives across messages. Expired sessions reset gracefully.

---

## Card 11: Payment Link Generation

**Objective**: Razorpay payment link creation for orders

**Dependencies**: Cards 7, 8

**Tasks**:

1. `POST /api/v1/payments/create-link` — create Razorpay payment link for order
2. Store `provider_order_id`, `payment_link_url`, `payment_link_id` in payments table
3. Set payment status = `created`
4. Set `idempotency_key` = `order_{order_id}_payment_{attempt}`
5. Return payment link URL for WhatsApp delivery

**Acceptance Criteria**: Payment link created with correct amount. Idempotency key prevents duplicate payments. Link URL stored and returned.

---

## Card 12: Razorpay Webhook Verification

**Objective**: Process payment status updates from Razorpay

**Dependencies**: Card 11

**Tasks**:

1. `POST /api/v1/payments/webhook` — Razorpay webhook endpoint (no JWT required)
2. Verify webhook signature using Razorpay webhook secret
3. Handle events: `payment_link.paid`, `payment.captured`, `payment.failed`, `refund.processed`
4. Update payment status + `provider_payment_id` + `provider_signature`
5. On `captured`: update order status → confirmed, unreserve stock → sale in inventory_logs
6. Store `raw_webhook_payload` for audit
7. Idempotent processing (check if already processed)

**Acceptance Criteria**: Invalid signature → rejected. Duplicate webhooks → no-op. Successful payment → order confirmed + stock finalized.

---

## Card 13: Notifications Service

**Objective**: Multi-channel notification delivery

**Dependencies**: Cards 8, 10

**Tasks**:

1. Notification creation service with channel routing
2. In-app: insert into `seller_notifications`
3. WhatsApp: send template message via WhatsApp Cloud API
4. Notification types: new_order, payment_received, order_cancelled, dispute_opened, low_stock
5. `GET /api/v1/seller/notifications` — list notifications (filterable, paginated)
6. `PATCH /api/v1/seller/notifications/{id}/read` — mark as read
7. Low stock alert: trigger when stock_quantity ≤ threshold

**Acceptance Criteria**: Notifications created for all order events. WhatsApp delivery tracked. Read status toggleable.

---

## Card 14: Admin Analytics APIs

**Objective**: Admin dashboard data from existing views

**Dependencies**: Cards 2, 3

**Tasks**:

1. `GET /api/v1/admin/dashboard` — KPIs from `v_admin_dashboard`
2. `GET /api/v1/admin/gmv` — GMV time series from `v_admin_gmv`
3. `GET /api/v1/admin/sellers/performance` — from `v_admin_seller_performance`
4. `GET /api/v1/admin/products/top` — from `v_admin_top_products`
5. `GET /api/v1/admin/products/low-stock` — from `v_admin_low_stock`
6. `GET /api/v1/admin/payments/stats` — from `v_admin_payment_stats`
7. `GET /api/v1/admin/disputes/summary` — from `v_admin_dispute_summary`
8. `GET /api/v1/admin/sellers` — list all sellers with status filter
9. `PATCH /api/v1/admin/sellers/{id}/approve` — approve seller
10. `PATCH /api/v1/admin/sellers/{id}/reject` — reject seller
11. `PATCH /api/v1/admin/sellers/{id}/suspend` — suspend seller
12. Admin category CRUD
13. Admin disputes management

**Acceptance Criteria**: All views queryable. Seller approval flow complete. Admin-only access enforced.

---

## Card 15: Seller Dashboard APIs

**Objective**: Seller-specific analytics and management

**Dependencies**: Cards 5, 6, 8

**Tasks**:

1. `GET /api/v1/seller/dashboard` — seller KPIs (orders, revenue, products, active sessions)
2. `GET /api/v1/seller/analytics/orders` — order stats by date range
3. `GET /api/v1/seller/analytics/products` — product performance
4. `GET /api/v1/seller/profile` — get seller profile
5. `PUT /api/v1/seller/profile` — update seller profile
6. `POST /api/v1/seller/documents` — upload KYC document
7. `GET /api/v1/seller/documents` — list documents with status

**Acceptance Criteria**: Seller sees only their own data. Analytics scoped to seller_id. KYC upload works with Supabase Storage.
