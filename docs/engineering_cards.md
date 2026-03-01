# Engineering Development Cards (AWS Serverless)

## Card 1: Backend Foundation

**Objective**: Scaffold AWS serverless infrastructure with CDK

**Dependencies**: None (first card)

**Tasks**:

1. Initialize CDK app with TypeScript
2. Create environment configs (dev/staging/prod) in `infra/cdk/lib/config/`
3. Implement shared utilities in `services/api/src/utils/` (logger, config validator)
4. Create Lambda layer for shared dependencies (AWS SDK v3, logging)
5. Implement health check Lambda + API Gateway route
6. Set up structured JSON logging with CloudWatch
7. Create shared contracts package in `packages/shared/contracts/`
8. Configure esbuild/tsup for Lambda bundling

**Acceptance Criteria**: `cdk deploy` succeeds, health endpoint returns 200, logs appear in CloudWatch

---

## Card 2: Cognito Auth Context

**Objective**: Set up Amazon Cognito for authentication

**Dependencies**: Card 1

**Tasks**:

1. Create Cognito User Pool in `infra/cdk/lib/stacks/auth-stack.ts`
2. Configure user groups: admin, seller, customer
3. Set up API Gateway JWT authorizer
4. Implement auth middleware in `services/api/src/middleware/auth.ts`
5. Create `AuthenticatedUser` interface in shared contracts
6. Implement JWT claims extraction from API Gateway authorizer context

**Endpoints**: `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/logout`

**Acceptance Criteria**: Valid Cognito JWT → user object loaded. Invalid/expired → 401. Groups correctly mapped to roles.

---

## Card 3: RBAC Middleware

**Objective**: Role-based access control enforcement

**Dependencies**: Card 2

**Tasks**:

1. Create `requireRoles()` guard function
2. Create `requireSellerOwnsResource()` ownership check
3. Create `requireCustomerOwnsOrder()` ownership check
4. Create `isAdmin()` bypass logic
5. Implement audit logging for authorization decisions

**Acceptance Criteria**: Admin can access all. Seller scoped to own resources. Customer scoped to own orders. Unauthorized → 403.

---

## Card 4: DynamoDB Tables

**Objective**: Create all DynamoDB tables with GSIs

**Dependencies**: Card 1

**Tasks**:

1. Design single-table schema with PK/SK patterns
2. Create tables in `infra/cdk/lib/stacks/database-stack.ts`:
   - Main table (orders, products, sellers, customers, sessions, etc.)
3. Define GSIs for access patterns:
   - PhoneIndex (sessions lookup)
   - SellerOrdersIndex (seller's orders)
   - CustomerOrdersIndex (customer's orders)
   - StatusIndex (orders by status)
   - PaymentLinkIndex (payment lookup)
   - IdempotencyIndex (payment idempotency)
4. Enable DynamoDB TTL for session expiry and event deduplication
5. Create DynamoDB adapters in `services/api/src/adapters/`

**Acceptance Criteria**: Tables created with proper GSIs. TTL enabled. Adapters can query and write data.

---

## Card 5: S3 Storage

**Objective**: Set up S3 buckets for documents and media

**Dependencies**: Card 1

**Tasks**:

1. Create S3 buckets in `infra/cdk/lib/stacks/storage-stack.ts`:
   - product-images bucket
   - seller-documents bucket
   - raw-webhook-events bucket
2. Configure CORS for direct uploads
3. Set up lifecycle policies (archive old webhooks after 90 days)
4. Implement presigned URL generation in Lambda
5. Create S3 adapters in `services/api/src/adapters/s3-adapter.ts`

**Acceptance Criteria**: Buckets created. Presigned URLs work for upload. CORS configured correctly.

---

## Card 6: Catalog Read APIs

**Objective**: Public product browsing and search

**Dependencies**: Cards 4, 5

**Tasks**:

1. `GET /catalog/categories` — list active categories (hierarchical)
2. `GET /catalog/products` — paginated list with filters (category, price range, search, seller)
3. `GET /catalog/products/{id}` — full product detail with images, seller info
4. `GET /catalog/sellers` — list active sellers
5. `GET /catalog/sellers/{id}` — seller profile with products
6. Implement DynamoDB query patterns with GSIs
7. Implement cursor-based pagination with LastEvaluatedKey

**Acceptance Criteria**: Unauthenticated users can browse. Only `status='active'` products shown. Pagination works.

---

## Card 7: Seller Product APIs

**Objective**: Seller CRUD for their own products

**Dependencies**: Cards 2, 3, 4, 5

**Tasks**:

1. `POST /seller/products` — create product (draft status)
2. `PUT /seller/products/{id}` — update product
3. `DELETE /seller/products/{id}` — soft delete
4. `POST /seller/products/{id}/images` — generate presigned URL for S3 upload
5. `DELETE /seller/products/{id}/images/{img_id}` — delete image
6. `PATCH /seller/products/{id}/status` — publish/unpublish
7. Seller ownership enforced on all mutations

**Acceptance Criteria**: Seller can only CRUD their own products. Images stored in S3. Product status transitions enforced.

---

## Card 8: Inventory APIs

**Objective**: Stock management with audit trail

**Dependencies**: Card 7

**Tasks**:

1. `POST /seller/products/{id}/inventory` — adjust stock (restock/adjustment)
2. `GET /seller/products/{id}/inventory/logs` — inventory history
3. Auto-create inventory_logs entry on every stock change
4. Validate stock cannot go negative (conditional expressions)
5. Handle `reserved_stock` for pending orders

**Acceptance Criteria**: Every stock change logged. Negative stock prevented by DynamoDB conditional expressions.

---

## Card 9: Order Creation Flow

**Objective**: Create orders from WhatsApp or web

**Dependencies**: Cards 4, 8

**Tasks**:

1. `POST /orders` — create order with items (validates stock, reserves inventory)
2. Generate order_number (VG-YYYYMMDD-NNNN format)
3. Calculate subtotal, tax, shipping, total
4. Create order + order_items in DynamoDB
5. Reserve stock using TransactWriteItems with conditional expressions
6. Create inventory_logs (type=reserved)
7. Set initial status = `pending`
8. Publish OrderCreated event to EventBridge

**Acceptance Criteria**: Stock validated before order. Reserved stock updated atomically. Order number auto-generated. Insufficient stock → 400 error.

---

## Card 10: Seller Order Management

**Objective**: Seller accepts/rejects/manages orders

**Dependencies**: Card 9

**Tasks**:

1. `GET /seller/orders` — list orders for seller (filterable by status)
2. `GET /seller/orders/{id}` — order detail with items
3. `PATCH /seller/orders/{id}/accept` — confirm order → trigger payment link
4. `PATCH /seller/orders/{id}/reject` — reject → unreserve stock (TransactWrite) → notify customer
5. `PATCH /seller/orders/{id}/status` — update to processing/shipped/delivered
6. Publish events to EventBridge for notifications

**Acceptance Criteria**: Only seller's own orders. Accept → status=confirmed. Reject → stock unreserved + inventory_log. Status transitions enforced.

---

## Card 11: WhatsApp Webhook Receiver

**Objective**: Receive and validate Meta WhatsApp Cloud API webhooks

**Dependencies**: Cards 4, 5

**Tasks**:

1. `GET /whatsapp/webhook` — Meta verification challenge endpoint
2. `POST /whatsapp/webhook` — inbound message/status webhook (fast-ack pattern)
3. Verify webhook signature (X-Hub-Signature-256)
4. Archive raw payload to S3 (async)
5. Publish event to EventBridge for async processing
6. Return 200 OK within 1 second

**Acceptance Criteria**: Meta verification passes. Signature validation rejects tampered payloads. Fast-ack < 1s.

---

## Card 12: WhatsApp Session Engine

**Objective**: Stateful conversation management via WhatsApp

**Dependencies**: Cards 4, 9, 11

**Tasks**:

1. Create async processor Lambda (EventBridge → SQS → Lambda)
2. Session lookup/creation by phone_number (DynamoDB GSI)
3. State machine transitions: greeting→browsing→product_inquiry→ordering→payment→tracking
4. Message routing based on session_state
5. Product browse via interactive list messages
6. Order intent → draft order creation
7. Session state persistence in DynamoDB conversation_state attribute
8. Idempotency via DynamoDB conditional writes
9. Session expiry with EventBridge scheduled rule + DynamoDB TTL

**Acceptance Criteria**: New phone → auto-creates customer + session. State transitions are valid. Duplicate messages ignored.

---

## Card 13: Payment Link Generation

**Objective**: Razorpay payment link creation for orders

**Dependencies**: Cards 9, 10

**Tasks**:

1. `POST /payments/create-link` — create Razorpay payment link for order
2. Store payment metadata in DynamoDB
3. Set payment status = `created`
4. Set `idempotency_key` with GSI for lookup
5. Return payment link URL for WhatsApp delivery
6. Load Razorpay credentials from AWS Secrets Manager

**Acceptance Criteria**: Payment link created with correct amount. Idempotency key prevents duplicate payments. Link URL stored and returned.

---

## Card 14: Razorpay Webhook Verification

**Objective**: Process payment status updates from Razorpay

**Dependencies**: Card 13

**Tasks**:

1. `POST /payments/webhook` — Razorpay webhook endpoint (no JWT required)
2. Verify webhook signature using Razorpay webhook secret from Secrets Manager
3. Handle events: `payment_link.paid`, `payment.captured`, `payment.failed`, `refund.processed`
4. Update payment + order + inventory using TransactWriteItems
5. Archive raw webhook to S3
6. Idempotent processing via DynamoDB conditional writes
7. Publish PaymentCaptured event to EventBridge
8. Set up SQS DLQ for failed processing

**Acceptance Criteria**: Invalid signature → rejected. Duplicate webhooks → no-op. Successful payment → order confirmed + stock finalized.

---

## Card 15: Notifications Service

**Objective**: Multi-channel notification delivery

**Dependencies**: Cards 10, 12

**Tasks**:

1. Create EventBridge rules for notification triggers
2. Create notification Lambda (EventBridge → SQS → Lambda)
3. In-app: insert into DynamoDB seller_notifications
4. WhatsApp: send template message via WhatsApp Cloud API
5. Notification types: new_order, payment_received, order_cancelled, dispute_opened, low_stock
6. `GET /seller/notifications` — list notifications (filterable, paginated)
7. `PATCH /seller/notifications/{id}/read` — mark as read
8. Low stock alert: trigger when stock_quantity ≤ threshold

**Acceptance Criteria**: Notifications created for all order events. WhatsApp delivery tracked. Read status toggleable.

---

## Card 16: Admin Analytics APIs

**Objective**: Admin dashboard data from DynamoDB aggregates

**Dependencies**: Cards 2, 3, 4

**Tasks**:

1. `GET /admin/dashboard` — KPIs (aggregate queries on DynamoDB)
2. `GET /admin/gmv` — GMV time series
3. `GET /admin/sellers/performance` — per-seller metrics
4. `GET /admin/products/top` — top products by revenue
5. `GET /admin/products/low-stock` — products with stock ≤ 5
6. `GET /admin/payments/stats` — payment statistics
7. `GET /admin/disputes/summary` — dispute aggregation
8. `GET /admin/sellers` — list all sellers with status filter
9. `PATCH /admin/sellers/{id}/approve` — approve seller
10. `PATCH /admin/sellers/{id}/reject` — reject seller
11. `PATCH /admin/sellers/{id}/suspend` — suspend seller
12. Admin category CRUD
13. Admin disputes management

**Acceptance Criteria**: All analytics queryable. Seller approval flow complete. Admin-only access enforced.

---

## Card 17: Seller Dashboard APIs

**Objective**: Seller-specific analytics and management

**Dependencies**: Cards 7, 8, 10

**Tasks**:

1. `GET /seller/dashboard` — seller KPIs (orders, revenue, products, active sessions)
2. `GET /seller/analytics/orders` — order stats by date range
3. `GET /seller/analytics/products` — product performance
4. `GET /seller/profile` — get seller profile
5. `PUT /seller/profile` — update seller profile
6. `POST /seller/documents` — generate presigned URL for KYC document upload
7. `GET /seller/documents` — list documents with status

**Acceptance Criteria**: Seller sees only their own data. Analytics scoped to seller_id. KYC upload works with S3.

---

## Card 18: Observability & Hardening

**Objective**: Production-ready monitoring and error handling

**Dependencies**: All previous cards

**Tasks**:

1. Create CloudWatch alarms in `infra/cdk/lib/stacks/monitoring-stack.ts`:
   - Lambda errors > 1%
   - API Gateway 5xx > 1%
   - DynamoDB throttling
   - SQS DLQ depth > 10
   - Payment processing latency > 5s
2. Set up X-Ray tracing for all Lambdas
3. Configure SQS DLQs for all async processors
4. Tighten IAM policies (least privilege per Lambda)
5. Implement request ID propagation in CloudWatch logs
6. Set up API Gateway throttling and usage plans
7. Create CloudWatch dashboard for key metrics

**Acceptance Criteria**: Alarms trigger on errors. X-Ray traces show end-to-end flow. DLQs capture failed messages. IAM policies follow least privilege.

---

## Card 19: CI/CD Pipeline

**Objective**: Automated deployment pipeline

**Dependencies**: Card 18

**Tasks**:

1. Create GitHub Actions workflow or AWS CodePipeline
2. Stages: lint → test → build → deploy (dev) → deploy (staging) → deploy (prod)
3. Run TypeScript type checking
4. Run unit tests (if any)
5. CDK diff on pull requests
6. CDK deploy on merge to main
7. Rollback mechanism on deployment failure

**Acceptance Criteria**: Pipeline runs on every commit. Deployments are automated. Rollback works.

---

## Implementation Order

```
Foundation (1-5) → Auth (2-3) → Data (4-5) → Catalog (6-8) → Orders (9-10) → WhatsApp (11-12) → Payments (13-14) → Notifications (15) → Admin (16-17) → Hardening (18-19)
```

## Outputs

All cards produce:
- CDK infrastructure code in `infra/cdk/lib/stacks/`
- Lambda handlers in `services/api/src/handlers/`
- Shared contracts in `packages/shared/contracts/`
- DynamoDB adapters in `services/api/src/adapters/`
- Middleware in `services/api/src/middleware/`
- Core business logic in `services/api/src/core/`
