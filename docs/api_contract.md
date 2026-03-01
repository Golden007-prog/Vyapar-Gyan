# REST API Contract (AWS Serverless)

## Base URL

- **Development**: `https://dev-api.vyapargyan.com`
- **Staging**: `https://staging-api.vyapargyan.com`
- **Production**: `https://api.vyapargyan.com`

All endpoints served via Amazon API Gateway HTTP API.

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
- **Logic**: Delegates to Amazon Cognito. Creates user_profile in DynamoDB if first login.
- **Failures**: 401 invalid credentials, 403 account suspended

### `POST /auth/refresh`

- **Auth**: Refresh token in body
- **Request**: `{ "refresh_token": "str" }`
- **Response**: `{ "access_token": "str", "refresh_token": "str" }`
- **Failures**: 401 invalid/expired refresh token

### `GET /auth/me`

- **Auth**: Bearer JWT (Cognito)
- **Response**: `{ "id": "uuid", "email": "str", "phone": "str", "display_name": "str", "roles": ["admin"|"seller"|"customer"], "seller_id": "uuid|null", "customer_id": "uuid|null" }`
- **Failures**: 401 unauthenticated

### `POST /auth/logout`

- **Auth**: Bearer JWT
- **Request**: `{ "refresh_token": "str" }`
- **Response**: `{ "message": "Logged out" }`
- **Logic**: Revoke refresh token via Cognito

---

## 2. Admin Endpoints

### `PATCH /admin/sellers/{seller_id}/approve`

- **Auth**: Bearer JWT, cognito:groups=admin
- **Request**: `{ "notes": "str?" }`
- **Response**: `{ "seller": Seller }` (status=active, approved_at=now, is_verified=true)
- **Logic**: Update seller in DynamoDB, add user to Cognito seller group, publish event to EventBridge for notification
- **Failures**: 404 seller not found, 409 already approved

### `PATCH /admin/sellers/{seller_id}/reject`

- **Auth**: Bearer JWT, cognito:groups=admin
- **Request**: `{ "reason": "str" }`
- **Response**: `{ "seller": Seller }` (status=rejected)
- **Logic**: Update status in DynamoDB, publish event for notification
- **Failures**: 404, 409 already rejected

### `PATCH /admin/sellers/{seller_id}/suspend`

- **Auth**: Bearer JWT, cognito:groups=admin
- **Request**: `{ "reason": "str" }`
- **Response**: `{ "seller": Seller }` (status=suspended)
- **Logic**: Suspend seller, deactivate products (batch update), publish event

### `POST /admin/categories`

- **Auth**: Bearer JWT, cognito:groups=admin
- **Request**: `{ "name": "str", "slug": "str", "parent_id": "uuid?", "description": "str?", "image_url": "str?", "sort_order": 0 }`
- **Response**: `{ "category": Category }`

### `PUT /admin/categories/{id}`

- **Auth**: Bearer JWT, cognito:groups=admin
- **Request**: Same as POST (partial update)
- **Response**: `{ "category": Category }`

### `DELETE /admin/categories/{id}`

- **Auth**: Bearer JWT, cognito:groups=admin
- **Logic**: Soft delete (set deleted_at). Fail if products reference this category.
- **Failures**: 409 category has products

### `GET /admin/orders`

- **Auth**: Bearer JWT, cognito:groups=admin
- **Query**: `?status=pending&seller_id=uuid&date_from=&date_to=&page=1&per_page=20`
- **Response**: Paginated orders with customer + seller info
- **Logic**: Query DynamoDB with GSI filters, paginate with LastEvaluatedKey

### `GET /admin/disputes`

- **Auth**: Bearer JWT, cognito:groups=admin
- **Query**: `?status=open&reason=damaged&page=1`
- **Response**: Paginated disputes with order info

### `PATCH /admin/disputes/{id}`

- **Auth**: Bearer JWT, cognito:groups=admin
- **Request**: `{ "status": "investigating|resolved|closed", "resolution": "str?" }`
- **Logic**: Update dispute in DynamoDB, set resolved_by + resolved_at

### Analytics Endpoints

- `GET /admin/dashboard` - Platform-wide KPIs (aggregated from DynamoDB)
- `GET /admin/gmv` - Daily GMV with order count, discounts, tax
- `GET /admin/sellers/performance` - Per-seller revenue, orders, products
- `GET /admin/products/top` - Top products by revenue and units sold
- `GET /admin/products/low-stock` - Products with stock ≤ 5
- `GET /admin/payments/stats` - Daily payment stats with success rate
- `GET /admin/disputes/summary` - Dispute aggregation by status and reason

**Auth**: Bearer JWT, cognito:groups=admin  
**Response**: Aggregated data from DynamoDB queries  
**Query params**: Date range filters where applicable

---

## 3. Seller Endpoints

### `GET /seller/profile`

- **Auth**: Bearer JWT, cognito:groups=seller
- **Response**: Seller profile with documents summary
- **Logic**: Query DynamoDB by seller_id from JWT claims

### `PUT /seller/profile`

- **Auth**: Bearer JWT, cognito:groups=seller
- **Request**: `{ "business_name": "str?", "description": "str?", "address": "str?", "city": "str?", "state": "str?", "pincode": "str?", "gstin": "str?", "logo_url": "str?" }`

### `POST /seller/products`

- **Auth**: Bearer JWT, cognito:groups=seller
- **Request**: `{ "name": "str", "description": "str?", "category_id": "uuid", "sku": "str?", "unit": "piece", "cost_price": 100.00, "base_ask_price": 150.00, "min_margin_percent": 10.0, "stock_quantity": 50 }`
- **Response**: Product (status=draft)
- **Logic**: Auto-set seller_id from JWT claims. Create inventory_log for initial stock.

### `PUT /seller/products/{id}`

- **Auth**: Bearer JWT, cognito:groups=seller (ownership enforced)
- **Request**: Partial product update
- **Failures**: 404, 403 not owner

### `DELETE /seller/products/{id}`

- **Auth**: Bearer JWT, cognito:groups=seller
- **Logic**: Soft delete (set deleted_at). Fail if open orders exist.

### `POST /seller/products/{id}/images`

- **Auth**: Bearer JWT, cognito:groups=seller
- **Request**: `{ "file_name": "str", "content_type": "str" }`
- **Response**: `{ "upload_url": "str", "image_id": "uuid" }`
- **Logic**: Generate S3 presigned URL for upload, create product_images record in DynamoDB

### `POST /seller/products/{id}/inventory`

- **Auth**: Bearer JWT, cognito:groups=seller
- **Request**: `{ "change_type": "restock|adjustment", "quantity_change": 50, "notes": "str?" }`
- **Logic**: Validate, update stock_quantity in DynamoDB, create inventory_log

### `GET /seller/orders`

- **Auth**: Bearer JWT, cognito:groups=seller
- **Query**: `?status=pending&page=1`
- **Logic**: Query DynamoDB SellerOrdersIndex GSI

### `PATCH /seller/orders/{id}/accept`

- **Auth**: Bearer JWT, cognito:groups=seller (ownership)
- **Logic**: status → confirmed, trigger payment link creation Lambda, publish event for notification

### `PATCH /seller/orders/{id}/reject`

- **Auth**: Bearer JWT, cognito:groups=seller (ownership)
- **Request**: `{ "reason": "str" }`
- **Logic**: status → cancelled, unreserve stock (TransactWrite), create inventory_log (unreserved), publish event

### `GET /seller/notifications`

- **Auth**: Bearer JWT, cognito:groups=seller
- **Query**: `?is_read=false&type=new_order&page=1`

### `PATCH /seller/notifications/{id}/read`

- **Auth**: Bearer JWT, cognito:groups=seller (ownership)

### `GET /seller/dashboard`

- **Auth**: Bearer JWT, cognito:groups=seller
- **Response**: `{ "total_orders": N, "pending_orders": N, "total_revenue": Decimal, "active_products": N, "low_stock_products": N }`
- **Logic**: Aggregate queries on DynamoDB with seller_id filter

---

## 4. Customer / Catalog Endpoints

### `GET /catalog/categories`

- **Auth**: None
- **Response**: Hierarchical category tree (is_active=true only)
- **Logic**: Query DynamoDB categories, filter by is_active, build tree structure

### `GET /catalog/products`

- **Auth**: None
- **Query**: `?category_id=uuid&seller_id=uuid&search=text&min_price=100&max_price=1000&sort=price_asc|price_desc|newest&page=1&per_page=20`
- **Response**: Paginated products (status=active only) with primary image + seller name
- **Logic**: Query DynamoDB with GSI filters, paginate with LastEvaluatedKey

### `GET /catalog/products/{id}`

- **Auth**: None
- **Response**: Full product detail with all images, seller info, available stock (stock_quantity - reserved_stock)

### `POST /orders`

- **Auth**: Bearer JWT (customer) OR internal service auth (WhatsApp flow)
- **Request**: `{ "seller_id": "uuid", "items": [{"product_id": "uuid", "quantity": 1}], "shipping_name": "str", "shipping_phone": "str", "shipping_address": "str", "shipping_city": "str", "shipping_state": "str", "shipping_pincode": "str", "source": "whatsapp|web", "negotiation_session_id": "uuid?" }`
- **Response**: `{ "order": Order }` with order_number
- **Logic**: Validate stock, calculate totals, reserve stock (TransactWrite), create order + items
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
- **Logic**: Verify signature → fast-ack → publish to EventBridge → async processing via SQS

### `POST /whatsapp/send` (internal only)

- **Auth**: IAM service-to-service (Lambda execution role)
- **Request**: `{ "phone": "str", "type": "text|template|interactive", "content": {...} }`
- **Logic**: Send via WhatsApp Cloud API, store in DynamoDB whatsapp_messages

### `POST /whatsapp/status` (internal callback)

- **Auth**: X-Hub-Signature-256
- **Logic**: Update wa_status on whatsapp_messages in DynamoDB by wa_message_id

---

## 6. Payment Endpoints

### `POST /payments/create-link`

- **Auth**: Bearer JWT (seller) OR internal service auth
- **Request**: `{ "order_id": "uuid", "amount": Decimal, "currency": "INR", "description": "str" }`
- **Response**: `{ "payment_link_url": "str", "payment_link_id": "str", "payment_id": "uuid" }`
- **Logic**: Create Razorpay payment link, store in DynamoDB payments table
- **Failures**: 409 payment already exists for order, 404 order not found

### `POST /payments/webhook`

- **Auth**: Razorpay X-Razorpay-Signature verification (NO JWT)
- **Request**: Razorpay webhook event payload
- **Response**: 200 OK
- **Logic**: Verify signature → archive to S3 → parse event → update payment + order (TransactWrite) → publish event

### `GET /payments/{order_id}/status`

- **Auth**: Bearer JWT (customer or seller of order)
- **Response**: `{ "status": "str", "amount": Decimal, "payment_method": "str?", "paid_at": "datetime?", "payment_link_url": "str?" }`

---

## Authentication Methods

| Endpoint Type         | Auth Method                                  | Verified By                |
| --------------------- | -------------------------------------------- | -------------------------- |
| User APIs             | Bearer JWT (Cognito)                         | API Gateway JWT Authorizer |
| WhatsApp Webhook      | X-Hub-Signature-256                          | Lambda signature check     |
| Razorpay Webhook      | X-Razorpay-Signature                         | Lambda signature check     |
| Internal Service Calls| IAM execution role                           | AWS IAM                    |

## File Upload Flow

### Product Images

1. Client requests presigned URL: `POST /seller/products/{id}/images`
2. Lambda generates S3 presigned PUT URL (expires in 5 minutes)
3. Client uploads directly to S3 using presigned URL
4. Client confirms upload: `PATCH /seller/products/{id}/images/{image_id}/confirm`
5. Lambda validates S3 object exists, updates DynamoDB

### Seller Documents

Same flow as product images, but different S3 bucket and path prefix.

## Pagination

All list endpoints support cursor-based pagination:

**Request**:
```
GET /endpoint?per_page=20&next_token=base64_encoded_last_key
```

**Response**:
```json
{
  "data": [...],
  "meta": {
    "per_page": 20,
    "next_token": "base64_encoded_last_key",
    "has_more": true
  }
}
```

`next_token` is base64-encoded DynamoDB LastEvaluatedKey.

## Rate Limiting

API Gateway usage plans enforce rate limits:

- **Anonymous**: 100 requests/minute
- **Authenticated**: 1000 requests/minute
- **Webhooks**: 100 requests/second (burst: 200)

Exceeded limits return 429 Too Many Requests.

## CORS

API Gateway configured with CORS:

- **Allowed Origins**: `https://admin.vyapargyan.com`, `https://seller.vyapargyan.com`
- **Allowed Methods**: GET, POST, PUT, PATCH, DELETE, OPTIONS
- **Allowed Headers**: Authorization, Content-Type, X-Request-ID
- **Max Age**: 3600 seconds

## Key Differences from Supabase

| Aspect                | Supabase (Old)                      | AWS Serverless (New)                |
| --------------------- | ----------------------------------- | ----------------------------------- |
| Auth                  | Supabase GoTrue JWT                 | Amazon Cognito JWT                  |
| Authorization         | RLS policies (database-level)       | Lambda application logic            |
| File Upload           | Supabase Storage direct upload      | S3 presigned URLs                   |
| Database              | PostgreSQL via Supabase client      | DynamoDB via AWS SDK                |
| Service Auth          | service_role key                    | IAM execution roles                 |
| API Framework         | FastAPI routes                      | API Gateway + Lambda handlers       |
| Response Format       | Same (consistent envelope)          | Same (consistent envelope)          |
