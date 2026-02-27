# Part D — REST API Contract

## Base URL: `/api/v1`

## Shared Response Format

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": { "page": 1, "per_page": 20, "total": 100, "request_id": "uuid" }
}
```

Error format:

```json
{
  "success": false,
  "data": null,
  "error": { "code": "INSUFFICIENT_STOCK", "message": "...", "details": {} },
  "meta": { "request_id": "uuid" }
}
```

---

## 1. Auth Endpoints

### `POST /auth/login`

- **Auth**: None
- **Request**: `{ "email": "str", "password": "str" }` OR `{ "phone": "str", "otp": "str" }`
- **Response**: `{ "access_token": "str", "refresh_token": "str", "user": UserProfile }`
- **Logic**: Delegates to Supabase GoTrue. Creates user_profile if first login.
- **Failures**: 401 invalid credentials, 403 account suspended

### `POST /auth/refresh`

- **Auth**: Refresh token in body
- **Request**: `{ "refresh_token": "str" }`
- **Response**: `{ "access_token": "str", "refresh_token": "str" }`
- **Failures**: 401 invalid/expired refresh token

### `GET /auth/me`

- **Auth**: Bearer JWT
- **Response**: `{ "id": "uuid", "email": "str", "phone": "str", "display_name": "str", "roles": ["admin"|"seller"|"customer"], "seller_id": "uuid|null", "customer_id": "uuid|null" }`
- **Failures**: 401 unauthenticated

### `POST /auth/logout`

- **Auth**: Bearer JWT
- **Request**: `{ "refresh_token": "str" }`
- **Response**: `{ "message": "Logged out" }`
- **Logic**: Revoke refresh token via Supabase

---

## 2. Admin Endpoints

### `PATCH /admin/sellers/{seller_id}/approve`

- **Auth**: Bearer JWT, role=admin
- **Request**: `{ "notes": "str?" }`
- **Response**: `{ "seller": Seller }` (status=active, approved_at=now, is_verified=true)
- **Logic**: Update seller status, create user_role=seller, send notification, audit log
- **Failures**: 404 seller not found, 409 already approved

### `PATCH /admin/sellers/{seller_id}/reject`

- **Auth**: Bearer JWT, role=admin
- **Request**: `{ "reason": "str" }`
- **Response**: `{ "seller": Seller }` (status=rejected)
- **Logic**: Update status, send notification with reason, audit log
- **Failures**: 404, 409 already rejected

### `PATCH /admin/sellers/{seller_id}/suspend`

- **Auth**: Bearer JWT, role=admin
- **Request**: `{ "reason": "str" }`
- **Response**: `{ "seller": Seller }` (status=suspended)
- **Logic**: Suspend seller, deactivate products, notify, audit log

### `POST /admin/categories`

- **Auth**: Bearer JWT, role=admin
- **Request**: `{ "name": "str", "slug": "str", "parent_id": "uuid?", "description": "str?", "image_url": "str?", "sort_order": 0 }`
- **Response**: `{ "category": Category }`

### `PUT /admin/categories/{id}`

- **Auth**: Bearer JWT, role=admin
- **Request**: Same as POST (partial update)
- **Response**: `{ "category": Category }`

### `DELETE /admin/categories/{id}`

- **Auth**: Bearer JWT, role=admin
- **Logic**: Soft delete. Fail if products reference this category.
- **Failures**: 409 category has products

### `GET /admin/orders`

- **Auth**: Bearer JWT, role=admin
- **Query**: `?status=pending&seller_id=uuid&date_from=&date_to=&page=1&per_page=20`
- **Response**: Paginated orders with customer + seller info

### `GET /admin/disputes`

- **Auth**: Bearer JWT, role=admin
- **Query**: `?status=open&reason=damaged&page=1`
- **Response**: Paginated disputes with order info

### `PATCH /admin/disputes/{id}`

- **Auth**: Bearer JWT, role=admin
- **Request**: `{ "status": "investigating|resolved|closed", "resolution": "str?" }`
- **Logic**: Update dispute, set resolved_by + resolved_at

### Analytics — `GET /admin/dashboard`, `GET /admin/gmv`, `GET /admin/sellers/performance`, `GET /admin/products/top`, `GET /admin/products/low-stock`, `GET /admin/payments/stats`, `GET /admin/disputes/summary`

- **Auth**: Bearer JWT, role=admin
- **Response**: Direct query on corresponding `v_admin_*` views
- **Query params**: Date range filters where applicable

---

## 3. Seller Endpoints

### `GET /seller/profile`

- **Auth**: Bearer JWT, role=seller
- **Response**: Seller profile with documents summary

### `PUT /seller/profile`

- **Auth**: Bearer JWT, role=seller
- **Request**: `{ "business_name": "str?", "description": "str?", "address": "str?", "city": "str?", "state": "str?", "pincode": "str?", "gstin": "str?", "logo_url": "str?" }`

### `POST /seller/products`

- **Auth**: Bearer JWT, role=seller
- **Request**: `{ "name": "str", "description": "str?", "category_id": "uuid", "sku": "str?", "unit": "piece", "cost_price": 100.00, "base_ask_price": 150.00, "min_margin_percent": 10.0, "stock_quantity": 50 }`
- **Response**: Product (status=draft)
- **Logic**: Auto-set tenant_id from auth. Create inventory_log for initial stock.

### `PUT /seller/products/{id}`

- **Auth**: Bearer JWT, role=seller (ownership enforced)
- **Request**: Partial product update
- **Failures**: 404, 403 not owner

### `DELETE /seller/products/{id}`

- **Auth**: Bearer JWT, role=seller
- **Logic**: Soft delete (set deleted_at). Fail if open orders exist.

### `POST /seller/products/{id}/images`

- **Auth**: Bearer JWT, role=seller
- **Request**: multipart/form-data with image file
- **Logic**: Upload to Supabase Storage, create product_images record
- **Response**: `{ "image": ProductImage }`

### `POST /seller/products/{id}/inventory`

- **Auth**: Bearer JWT, role=seller
- **Request**: `{ "change_type": "restock|adjustment", "quantity_change": 50, "notes": "str?" }`
- **Logic**: Validate, update stock_quantity, create inventory_log

### `GET /seller/orders`

- **Auth**: Bearer JWT, role=seller
- **Query**: `?status=pending&page=1`

### `PATCH /seller/orders/{id}/accept`

- **Auth**: Bearer JWT, role=seller (ownership)
- **Logic**: status → confirmed, trigger payment link creation, notify customer

### `PATCH /seller/orders/{id}/reject`

- **Auth**: Bearer JWT, role=seller (ownership)
- **Request**: `{ "reason": "str" }`
- **Logic**: status → cancelled, unreserve stock, create inventory_log (unreserved), notify customer

### `GET /seller/notifications`

- **Auth**: Bearer JWT, role=seller
- **Query**: `?is_read=false&type=new_order&page=1`

### `PATCH /seller/notifications/{id}/read`

- **Auth**: Bearer JWT, role=seller (ownership)

### `GET /seller/dashboard`

- **Auth**: Bearer JWT, role=seller
- **Response**: `{ "total_orders": N, "pending_orders": N, "total_revenue": Decimal, "active_products": N, "low_stock_products": N }`

---

## 4. Customer / Catalog Endpoints

### `GET /catalog/categories`

- **Auth**: None
- **Response**: Hierarchical category tree (is_active=true only)

### `GET /catalog/products`

- **Auth**: None
- **Query**: `?category_id=uuid&seller_id=uuid&search=text&min_price=100&max_price=1000&sort=price_asc|price_desc|newest&page=1&per_page=20`
- **Response**: Paginated products (status=active only) with primary image + seller name

### `GET /catalog/products/{id}`

- **Auth**: None
- **Response**: Full product detail with all images, seller info, available stock (stock_quantity - reserved_stock)

### `POST /orders`

- **Auth**: Bearer JWT (customer) OR service_role (WhatsApp flow)
- **Request**: `{ "seller_id": "uuid", "items": [{"product_id": "uuid", "quantity": 1}], "shipping_name": "str", "shipping_phone": "str", "shipping_address": "str", "shipping_city": "str", "shipping_state": "str", "shipping_pincode": "str", "source": "whatsapp|web", "negotiation_session_id": "uuid?" }`
- **Response**: `{ "order": Order }` with order_number
- **Logic**: Validate stock, calculate totals, reserve stock, create order + items
- **Failures**: 400 insufficient stock, 404 product/seller not found

### `GET /orders/{order_number}/track`

- **Auth**: Bearer JWT (customer) OR phone-based lookup
- **Response**: `{ "order_number": "str", "status": "str", "items": [...], "total_amount": Decimal, "created_at": "datetime" }`

---

## 5. WhatsApp Endpoints

### `GET /whatsapp/webhook`

- **Auth**: None (Meta verification)
- **Query**: `hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE`
- **Response**: echo `hub.challenge`

### `POST /whatsapp/webhook`

- **Auth**: X-Hub-Signature-256 verification
- **Request**: Meta webhook payload (messages, statuses)
- **Response**: 200 OK (always, per Meta requirements)
- **Logic**: Parse → deduplicate → route to session engine → respond

### `POST /whatsapp/send` (internal only)

- **Auth**: Service-to-service (internal API key)
- **Request**: `{ "phone": "str", "type": "text|template|interactive", "content": {...} }`
- **Logic**: Send via WhatsApp Cloud API, store in whatsapp_messages

### `POST /whatsapp/status` (internal callback)

- **Auth**: X-Hub-Signature-256
- **Logic**: Update wa_status on whatsapp_messages by wa_message_id

---

## 6. Payment Endpoints

### `POST /payments/create-link`

- **Auth**: Bearer JWT (seller) OR service_role
- **Request**: `{ "order_id": "uuid", "amount": Decimal, "currency": "INR", "description": "str" }`
- **Response**: `{ "payment_link_url": "str", "payment_link_id": "str", "payment_id": "uuid" }`
- **Logic**: Create Razorpay payment link, store in payments table
- **Failures**: 409 payment already exists for order, 404 order not found

### `POST /payments/webhook`

- **Auth**: Razorpay X-Razorpay-Signature verification (NO JWT)
- **Request**: Razorpay webhook event payload
- **Response**: 200 OK
- **Logic**: Verify signature → parse event → update payment → update order → log inventory → notify

### `GET /payments/{order_id}/status`

- **Auth**: Bearer JWT (customer or seller of order)
- **Response**: `{ "status": "str", "amount": Decimal, "payment_method": "str?", "paid_at": "datetime?", "payment_link_url": "str?" }`
