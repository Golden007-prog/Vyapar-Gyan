# Part A — Backend Readiness Audit + Part B — Recommended Phases

## A. Current Backend Readiness Audit

**Supabase Project**: `lunwpfgllsklucsulrlz` (ap-south-1, ACTIVE_HEALTHY)

### Tables Summary (22 tables, all RLS-enabled)

| Table                   | Status    | Rows | Ready for API?    | Notes                                                         |
| ----------------------- | --------- | ---- | ----------------- | ------------------------------------------------------------- |
| `roles`                 | ✅ Seeded | 3    | ✅ Immediate      | admin, seller, customer pre-seeded                            |
| `user_profiles`         | ✅ Ready  | 0    | ✅ Immediate      | auth_user_id → auth.users, auto-created via trigger           |
| `user_roles`            | ✅ Ready  | 0    | ✅ Immediate      | Links profiles ↔ roles, granted_by tracking                   |
| `sellers`               | ✅ Ready  | 0    | ✅ Immediate      | Full lifecycle: pending_approval→active→suspended→rejected    |
| `customers`             | ✅ Ready  | 0    | ✅ Immediate      | WhatsApp-first, optional auth_user_id                         |
| `categories`            | ✅ Ready  | 0    | ✅ Immediate      | Hierarchical (parent_id self-ref), admin-managed              |
| `products`              | ✅ Ready  | 0    | ✅ Immediate      | Dual-pricing (human + AI), vector embedding, status lifecycle |
| `product_images`        | ✅ Ready  | 0    | ✅ Immediate      | Multi-image with sort_order + is_primary                      |
| `inventory_logs`        | ✅ Ready  | 0    | ✅ Immediate      | Full change_type enum, reference tracking                     |
| `orders`                | ✅ Ready  | 0    | ✅ Immediate      | 8-status lifecycle, multi-source (whatsapp/web/manual)        |
| `order_items`           | ✅ Ready  | 0    | ✅ Immediate      | Denormalized product_name for history                         |
| `payments`              | ✅ Ready  | 0    | ✅ Needs Razorpay | idempotency_key, provider fields, fraud review                |
| `disputes`              | ✅ Ready  | 0    | ✅ Immediate      | Full dispute lifecycle with resolution tracking               |
| `seller_documents`      | ✅ Ready  | 0    | ✅ Immediate      | KYC doc types (aadhaar/pan/gstin/etc)                         |
| `seller_notifications`  | ✅ Ready  | 0    | ✅ Immediate      | Multi-channel (in_app/whatsapp/email/sms)                     |
| `audit_logs`            | ✅ Ready  | 0    | ✅ Immediate      | Full actor/action/resource tracking with diff                 |
| `whatsapp_sessions`     | ✅ Ready  | 0    | ✅ Needs WA API   | 10-state machine, JSONB conversation_state                    |
| `whatsapp_messages`     | ✅ Ready  | 0    | ✅ Needs WA API   | Bi-directional, status tracking, error tracking               |
| `market_trends`         | ✅ Ready  | 0    | ✅ Immediate      | AI/trend intelligence                                         |
| `product_trend_mapping` | ✅ Ready  | 0    | ✅ Immediate      | Product↔Trend link with relevance                             |
| `negotiation_sessions`  | ✅ Ready  | 0    | ✅ Immediate      | Full negotiation state + payment tracking                     |
| `broadcast_campaigns`   | ✅ Ready  | 0    | ✅ Immediate      | Campaign lifecycle (draft→scheduled→sent)                     |

### Custom Functions (7 business functions)

| Function                   | Purpose                                 | Used In                   |
| -------------------------- | --------------------------------------- | ------------------------- |
| `is_admin()`               | Check if current user has admin role    | 18+ RLS policies          |
| `get_my_seller_id()`       | Get seller UUID for current auth user   | 15+ RLS policies          |
| `get_my_customer_id()`     | Get customer UUID for current auth user | 8+ RLS policies           |
| `get_my_roles()`           | Return text array of user's roles       | Available for API         |
| `generate_order_number()`  | Trigger: auto-generates order number    | orders INSERT trigger     |
| `handle_new_auth_user()`   | Trigger: auto-creates user_profile      | auth.users INSERT trigger |
| `trigger_set_updated_at()` | Trigger: auto-sets updated_at           | Multiple tables           |

### Analytics Views (7 views)

| View                         | Purpose                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `v_admin_dashboard`          | Platform-wide KPIs (sellers, customers, products, GMV, disputes, WA sessions) |
| `v_admin_gmv`                | Daily GMV with order count, discounts, tax, avg order value                   |
| `v_admin_seller_performance` | Per-seller revenue, orders, products, disputes                                |
| `v_admin_top_products`       | Top products by revenue and units sold                                        |
| `v_admin_low_stock`          | Products with stock ≤ 5                                                       |
| `v_admin_payment_stats`      | Daily payment stats with success rate                                         |
| `v_admin_dispute_summary`    | Dispute aggregation by status and reason                                      |

### RLS Policy Coverage (58 policies)

All 22 tables have RLS enabled with proper policies:

- **Admin bypass**: `is_admin()` on all tables
- **Seller ownership**: `get_my_seller_id()` scoping on products, orders, inventory, notifications, documents
- **Customer ownership**: `get_my_customer_id()` scoping on orders, disputes, WhatsApp
- **Public read**: categories, roles, active products, active sellers, market_trends, product_images

### Missing Pieces for API Implementation

1. **No service_role key exposed** — FastAPI backend needs the Supabase service_role key for server-side operations (webhook processing, background jobs)
2. **No Supabase Storage buckets** — Need buckets for product images and seller documents
3. **No RLS policy for payments INSERT** by non-admin — WhatsApp/webhook payment creation needs service_role or a new policy
4. **No index on `whatsapp_sessions.phone_number`** — Will be high-traffic lookup
5. **No index on `orders.order_number`** — Needed for order tracking queries
6. **No cron/pg_cron for session cleanup** — Expired WhatsApp sessions need periodic cleanup

---

## B. Recommended Next Implementation Phases

### Phase 1 — Foundation (Week 1)

- FastAPI project scaffold
- Supabase client integration
- Auth middleware (JWT verification)
- RBAC middleware
- Shared response format + error handling
- Logging + audit trail infrastructure
- Redis client setup

### Phase 2 — Core APIs (Week 2)

- Auth endpoints (login/refresh/me/logout)
- Admin: seller management (approve/reject/suspend)
- Admin: category CRUD
- Seller: profile + product CRUD
- Seller: product image upload
- Inventory management APIs

### Phase 3 — Order & Payment (Week 3)

- Customer catalog browsing + search
- Order creation flow
- Seller order accept/reject
- Razorpay payment link creation
- Payment webhook verification
- Order status lifecycle management

### Phase 4 — WhatsApp Integration (Week 4)

- WhatsApp Cloud API webhook setup
- Inbound message processing
- Session state machine engine
- Outbound message sending
- Message status callback handling
- Session expiry/cleanup

### Phase 5 — Intelligence & Notifications (Week 5)

- Seller notification service
- Admin analytics APIs (using existing views)
- Seller dashboard APIs
- WhatsApp notification delivery
- Broadcast campaign execution

### Phase 6 — Production Hardening (Week 6)

- Rate limiting
- Request validation hardening
- Idempotency enforcement
- Monitoring + alerting
- Load testing
- Security audit
