# System Design Document: VyaparGyan

## System Overview

VyaparGyan is a production-grade, event-driven AI-powered commerce platform built on AWS serverless infrastructure. The system enables local Indian retailers to manage their business operations, serve customers via WhatsApp, and leverage AI for improved efficiency and decision-making.

### Key Personas

- **Admin**: Platform operators who moderate sellers, manage categories, resolve disputes, and monitor system health
- **Seller**: Local retailers who manage products, fulfill orders, and interact with customers
- **Customer**: End users who browse products, place orders, and make payments primarily through WhatsApp

### High-Level Architecture

The platform follows a serverless, event-driven architecture:

```
Web App (Admin/Seller) → API Gateway → Lambda → DynamoDB/S3
WhatsApp Cloud API → API Gateway Webhook → Lambda → DynamoDB/EventBridge/SQS
Payment Gateway → API Gateway Webhook → Lambda → DynamoDB
EventBridge → Lambda (async workflows)
SQS → Lambda (retries, outbound messages)
```

### Why AWS Serverless

**Cost Efficiency**: Pay only for actual usage with no idle costs. Perfect for small retailers with variable traffic patterns.

**Scalability**: Automatic scaling from zero to thousands of concurrent requests without capacity planning.

**Reliability**: Built-in redundancy across multiple availability zones with automatic failover.

**Operational Simplicity**: No server management, patching, or infrastructure maintenance required.

**Developer Productivity**: Focus on business logic rather than infrastructure management.

### Why DynamoDB Over Relational Databases

**Access Patterns**: Commerce workloads are key-value oriented (get order by ID, get products by seller, get messages by session).

**Performance**: Single-digit millisecond latency at any scale with predictable performance.

**Scalability**: Seamless scaling to millions of items without sharding or replication complexity.

**Cost**: On-demand pricing with no minimum costs. Pay only for reads and writes.

**Serverless Integration**: Native integration with Lambda, EventBridge, and other AWS services.

### Why Cognito for Authentication

**Managed Service**: No need to build and maintain authentication infrastructure.

**Security**: Built-in protection against common attacks with MFA support.

**Scalability**: Handles millions of users without performance degradation.

**Integration**: Native integration with API Gateway for JWT validation.

**Compliance**: SOC, PCI DSS, and HIPAA compliant out of the box.

### Why WhatsApp as Primary Channel

**Ubiquity**: 500+ million users in India with high engagement rates.

**Familiarity**: No app download or registration required for customers.

**Rich Media**: Support for text, voice, images, and documents.

**Trust**: Customers trust WhatsApp more than unknown e-commerce apps.

**Conversational**: Natural language interface reduces friction in shopping experience.

## Architecture Overview

### Request Flow Patterns

#### Web App Request Flow
```
User Browser → CloudFront → S3 (static assets)
User Action → API Gateway → Lambda Authorizer (Cognito JWT) → Lambda Function → DynamoDB
Lambda → S3 (image upload) → CloudFront (CDN)
```

#### WhatsApp Inbound Flow
```
Customer Message → WhatsApp Cloud API → API Gateway Webhook → Lambda
Lambda → Validate Signature → Parse Message → DynamoDB (session lookup)
Lambda → Gemini API (voice transcription/AI) → Generate Response
Lambda → DynamoDB (save state) → EventBridge (domain event)
Lambda → SQS (outbound queue) → WhatsApp Cloud API
```

#### Payment Webhook Flow
```
Payment Gateway → API Gateway Webhook → Lambda
Lambda → Validate Signature → Verify Payment → DynamoDB (conditional write)
Lambda → EventBridge (payment.succeeded) → Lambda (order confirmation)
Lambda → SQS (notification queue) → WhatsApp/Email
```

#### Async Event Flow
```
EventBridge Rule → Lambda (business logic) → DynamoDB
Lambda → SQS (retry queue) → Lambda (with backoff)
Lambda → CloudWatch (metrics) → Alarms → SNS
```

### WebSocket Updates (Optional)

For real-time dashboard updates:

```
Admin/Seller Dashboard → API Gateway WebSocket API → Lambda
Lambda → DynamoDB (connection management)
EventBridge → Lambda → API Gateway Management API → WebSocket Clients
```


## Role-Based Access Control

### Cognito User Pools

**User Pool Structure**:
- Single user pool for all user types
- Groups: `admin`, `seller`, `customer`
- Custom attributes: `seller_id`, `business_name`, `approval_status`

**Authentication Flow**:
1. User signs up with phone number
2. Cognito sends OTP via SMS
3. User verifies OTP
4. Lambda post-confirmation trigger assigns group
5. Cognito issues JWT with group claims

### JWT Claims

**Standard Claims**:
```json
{
  "sub": "user-uuid",
  "phone_number": "+919876543210",
  "cognito:groups": ["seller"],
  "custom:seller_id": "seller-uuid",
  "custom:approval_status": "approved"
}
```

**Custom Claims** (added by Lambda authorizer):
```json
{
  "tenant_id": "seller-uuid",
  "permissions": ["product:write", "order:read"],
  "rate_limit_tier": "standard"
}
```

### Lambda Authorization

**API Gateway Lambda Authorizer**:
```python
def lambda_authorizer(event):
    token = event['authorizationToken']
    
    # Verify JWT signature with Cognito public keys
    claims = verify_jwt(token)
    
    # Extract user context
    user_id = claims['sub']
    groups = claims.get('cognito:groups', [])
    
    # Build policy document
    policy = generate_policy(user_id, groups, event['methodArn'])
    
    # Add context for downstream Lambdas
    context = {
        'userId': user_id,
        'groups': ','.join(groups),
        'sellerId': claims.get('custom:seller_id'),
        'approvalStatus': claims.get('custom:approval_status')
    }
    
    return {
        'principalId': user_id,
        'policyDocument': policy,
        'context': context
    }
```

**Application-Level Authorization**:
```python
def check_authorization(event, required_permission):
    # Extract context from authorizer
    user_id = event['requestContext']['authorizer']['userId']
    groups = event['requestContext']['authorizer']['groups'].split(',')
    
    # Check group-based permissions
    if 'admin' in groups:
        return True  # Admins have all permissions
    
    if required_permission == 'product:write':
        if 'seller' not in groups:
            raise UnauthorizedException("Sellers only")
        
        # Check seller approval status
        approval_status = event['requestContext']['authorizer']['approvalStatus']
        if approval_status != 'approved':
            raise UnauthorizedException("Seller not approved")
        
        return True
    
    return False
```

### IAM Service-to-Service Permissions

**Lambda Execution Roles**:
```yaml
ProductServiceRole:
  Policies:
    - DynamoDB: GetItem, PutItem, Query on products table
    - S3: PutObject on product-images bucket
    - EventBridge: PutEvents to default bus
    - CloudWatch: PutMetricData, CreateLogStream

OrderServiceRole:
  Policies:
    - DynamoDB: TransactWriteItems on orders, products tables
    - SQS: SendMessage to notification queue
    - Secrets Manager: GetSecretValue for payment API keys
    - EventBridge: PutEvents to default bus
```

**Cross-Account Access** (if using multiple AWS accounts):
```yaml
ProductionAccount:
  AssumeRole: arn:aws:iam::PROD_ACCOUNT:role/DeploymentRole
  Permissions:
    - CloudFormation: CreateStack, UpdateStack
    - Lambda: UpdateFunctionCode
    - S3: GetObject from artifact bucket
```


## DynamoDB Data Model

### Design Philosophy

VyaparGyan uses a **single-table design** to minimize costs, reduce latency, and simplify operations. All entities are stored in one DynamoDB table with carefully designed partition and sort keys to support required access patterns.

### Table Structure

**Table Name**: `vyapargyan-main`

**Primary Key**:
- Partition Key (PK): String
- Sort Key (SK): String

**Global Secondary Indexes**:
- GSI1: GSI1PK (partition), GSI1SK (sort)
- GSI2: GSI2PK (partition), GSI2SK (sort)
- GSI3: GSI3PK (partition), GSI3SK (sort)

**Attributes**: Flexible schema with entity-specific attributes

### Entity Patterns

#### User Profiles

**Admin/Seller/Customer Profiles**:
```
PK: USER#<user_id>
SK: PROFILE
Attributes: {
  user_id, phone_number, email, name, role,
  created_at, updated_at, status
}
```

**Access Patterns**:
- Get user by ID: Query PK=USER#<user_id>, SK=PROFILE
- List users by role: Scan with filter (infrequent operation)

#### Sellers

**Seller Entity**:
```
PK: SELLER#<seller_id>
SK: METADATA
Attributes: {
  seller_id, user_id, business_name, business_category,
  phone_number, email, approval_status, documents,
  created_at, approved_at, suspended, suspension_reason
}
GSI1PK: STATUS#<approval_status>
GSI1SK: CREATED#<timestamp>
```

**Seller Documents**:
```
PK: SELLER#<seller_id>
SK: DOC#<document_type>
Attributes: {
  document_type, s3_key, uploaded_at, verified,
  verification_notes
}
```

**Access Patterns**:
- Get seller by ID: Query PK=SELLER#<seller_id>, SK=METADATA
- List sellers by status: Query GSI1 where GSI1PK=STATUS#pending
- Get seller documents: Query PK=SELLER#<seller_id>, SK begins_with DOC#

#### Products

**Product Entity**:
```
PK: SELLER#<seller_id>
SK: PRODUCT#<product_id>
Attributes: {
  product_id, seller_id, name, description, category,
  price, cost_price, stock_quantity, sku,
  images, status, created_at, updated_at
}
GSI1PK: CATEGORY#<category_id>
GSI1SK: CREATED#<timestamp>
GSI2PK: PRODUCT#<product_id>
GSI2SK: METADATA
```

**Access Patterns**:
- Get product by ID: Query GSI2 where GSI2PK=PRODUCT#<product_id>
- List products by seller: Query PK=SELLER#<seller_id>, SK begins_with PRODUCT#
- List products by category: Query GSI1 where GSI1PK=CATEGORY#<category_id>
- Search products: Use DynamoDB Streams → OpenSearch (future)

#### Categories

**Category Entity**:
```
PK: CATEGORY#<category_id>
SK: METADATA
Attributes: {
  category_id, name, description, parent_category_id,
  display_order, active, created_at
}
GSI1PK: CATEGORIES
GSI1SK: ORDER#<display_order>
```

**Access Patterns**:
- Get category by ID: Query PK=CATEGORY#<category_id>, SK=METADATA
- List all categories: Query GSI1 where GSI1PK=CATEGORIES

#### Product Images

**Image Metadata**:
```
PK: PRODUCT#<product_id>
SK: IMAGE#<image_id>
Attributes: {
  image_id, s3_key, s3_bucket, cdn_url,
  display_order, uploaded_at, size_bytes
}
```

**Access Patterns**:
- List images for product: Query PK=PRODUCT#<product_id>, SK begins_with IMAGE#

**Storage**: Images stored in S3, metadata in DynamoDB

#### Orders

**Order Entity**:
```
PK: ORDER#<order_id>
SK: METADATA
Attributes: {
  order_id, seller_id, customer_id, session_id,
  status, total_amount, payment_status,
  delivery_address, created_at, updated_at
}
GSI1PK: SELLER#<seller_id>
GSI1SK: CREATED#<timestamp>
GSI2PK: CUSTOMER#<customer_id>
GSI2SK: CREATED#<timestamp>
```

**Order Items**:
```
PK: ORDER#<order_id>
SK: ITEM#<item_id>
Attributes: {
  item_id, product_id, product_name, quantity,
  unit_price, total_price, product_snapshot
}
```

**Access Patterns**:
- Get order by ID: Query PK=ORDER#<order_id>, SK=METADATA
- List orders by seller: Query GSI1 where GSI1PK=SELLER#<seller_id>
- List orders by customer: Query GSI2 where GSI2PK=CUSTOMER#<customer_id>
- Get order items: Query PK=ORDER#<order_id>, SK begins_with ITEM#

#### Payments

**Payment Entity**:
```
PK: PAYMENT#<payment_id>
SK: METADATA
Attributes: {
  payment_id, order_id, amount, currency,
  payment_method, gateway_transaction_id,
  status, created_at, completed_at, failure_reason
}
GSI1PK: ORDER#<order_id>
GSI1SK: CREATED#<timestamp>
```

**Payment Events** (for idempotency):
```
PK: PAYMENT#<payment_id>
SK: EVENT#<event_id>
Attributes: {
  event_id, event_type, webhook_payload,
  processed, processed_at, idempotency_key
}
```

**Access Patterns**:
- Get payment by ID: Query PK=PAYMENT#<payment_id>, SK=METADATA
- Get payments by order: Query GSI1 where GSI1PK=ORDER#<order_id>
- Check event processed: Query PK=PAYMENT#<payment_id>, SK=EVENT#<event_id>

#### WhatsApp Sessions

**Session Entity**:
```
PK: SESSION#<session_id>
SK: METADATA
Attributes: {
  session_id, customer_phone, seller_id,
  status, context, last_message_at,
  created_at, expires_at
}
GSI1PK: PHONE#<customer_phone>
GSI1SK: CREATED#<timestamp>
```

**Session Messages**:
```
PK: SESSION#<session_id>
SK: MSG#<timestamp>#<message_id>
Attributes: {
  message_id, direction, message_type, content,
  media_url, transcription, timestamp, wa_message_id
}
```

**Access Patterns**:
- Get session by ID: Query PK=SESSION#<session_id>, SK=METADATA
- Get active session by phone: Query GSI1 where GSI1PK=PHONE#<phone>, filter status=active
- Get session messages: Query PK=SESSION#<session_id>, SK begins_with MSG#

#### Audit Logs

**Audit Entry**:
```
PK: AUDIT#<date>
SK: <timestamp>#<event_id>
Attributes: {
  event_id, user_id, action, resource_type,
  resource_id, changes, ip_address, user_agent,
  timestamp
}
GSI1PK: USER#<user_id>
GSI1SK: <timestamp>
```

**Access Patterns**:
- Get audits by date: Query PK=AUDIT#<date>
- Get audits by user: Query GSI1 where GSI1PK=USER#<user_id>

#### Disputes

**Dispute Entity**:
```
PK: DISPUTE#<dispute_id>
SK: METADATA
Attributes: {
  dispute_id, order_id, raised_by, assigned_to,
  status, category, description, resolution,
  created_at, resolved_at
}
GSI1PK: STATUS#<status>
GSI1SK: CREATED#<timestamp>
GSI2PK: ORDER#<order_id>
GSI2SK: CREATED#<timestamp>
```

**Access Patterns**:
- Get dispute by ID: Query PK=DISPUTE#<dispute_id>, SK=METADATA
- List disputes by status: Query GSI1 where GSI1PK=STATUS#open
- Get disputes for order: Query GSI2 where GSI2PK=ORDER#<order_id>

### Soft Delete and Archival

**Soft Delete Pattern**:
- Add `deleted` boolean attribute (default: false)
- Add `deleted_at` timestamp
- Filter deleted items in queries
- Use TTL for automatic cleanup after retention period

**Archival Pattern**:
- Use DynamoDB Streams to capture changes
- Lambda function writes to S3 for long-term storage
- Compress and partition by date
- Query S3 with Athena for historical analysis


## API Design

### Authentication APIs

**POST /auth/signup**
- Purpose: Register new user
- Auth: None
- Request: `{ phone_number, role, business_name? }`
- Response: `{ user_id, verification_required }`

**POST /auth/verify**
- Purpose: Verify OTP
- Auth: None
- Request: `{ phone_number, otp_code }`
- Response: `{ access_token, refresh_token, user }`

**POST /auth/refresh**
- Purpose: Refresh access token
- Auth: Refresh token
- Request: `{ refresh_token }`
- Response: `{ access_token }`

### Seller APIs

**POST /sellers/onboard**
- Purpose: Submit seller application
- Auth: Seller JWT
- Request: `{ business_details, documents[] }`
- Response: `{ seller_id, status: "pending" }`

**GET /sellers/{seller_id}**
- Purpose: Get seller profile
- Auth: Seller JWT (own profile) or Admin JWT
- Response: `{ seller_id, business_name, status, ... }`

**PATCH /sellers/{seller_id}**
- Purpose: Update seller profile
- Auth: Seller JWT (own profile) or Admin JWT
- Request: `{ business_name?, phone?, email? }`
- Response: `{ seller_id, updated_fields }`

**POST /sellers/{seller_id}/documents**
- Purpose: Upload verification document
- Auth: Seller JWT
- Request: Multipart form with file
- Response: `{ document_id, s3_key, status }`

### Product APIs

**POST /products**
- Purpose: Create new product
- Auth: Seller JWT
- Request: `{ name, description, category_id, price, stock_quantity }`
- Response: `{ product_id, seller_id, ... }`

**GET /products/{product_id}**
- Purpose: Get product details
- Auth: Public or JWT
- Response: `{ product_id, name, price, images[], ... }`

**PATCH /products/{product_id}**
- Purpose: Update product
- Auth: Seller JWT (own product) or Admin JWT
- Request: `{ name?, price?, stock_quantity? }`
- Response: `{ product_id, updated_fields }`

**DELETE /products/{product_id}**
- Purpose: Delete product (soft delete)
- Auth: Seller JWT (own product) or Admin JWT
- Response: `{ product_id, deleted: true }`

**GET /products**
- Purpose: List products with filters
- Auth: Public or JWT
- Query: `?seller_id=&category_id=&limit=20&next_token=`
- Response: `{ products[], next_token? }`

**POST /products/{product_id}/images**
- Purpose: Upload product image
- Auth: Seller JWT
- Request: Multipart form with image file
- Response: `{ image_id, cdn_url }`

### Inventory APIs

**PATCH /products/{product_id}/stock**
- Purpose: Update stock quantity
- Auth: Seller JWT
- Request: `{ quantity, operation: "set"|"increment"|"decrement" }`
- Response: `{ product_id, new_quantity }`

**GET /products/{product_id}/stock-history**
- Purpose: Get stock movement history
- Auth: Seller JWT
- Response: `{ movements[] }`

### Order APIs

**POST /orders**
- Purpose: Create new order
- Auth: Customer JWT or WhatsApp session
- Request: `{ seller_id, items[], delivery_address }`
- Response: `{ order_id, total_amount, payment_link }`

**GET /orders/{order_id}**
- Purpose: Get order details
- Auth: Seller/Customer JWT (own order) or Admin JWT
- Response: `{ order_id, status, items[], payment_status, ... }`

**PATCH /orders/{order_id}/status**
- Purpose: Update order status
- Auth: Seller JWT (own order) or Admin JWT
- Request: `{ status: "accepted"|"rejected"|"shipped"|"delivered" }`
- Response: `{ order_id, new_status }`

**GET /orders**
- Purpose: List orders with filters
- Auth: Seller/Customer/Admin JWT
- Query: `?seller_id=&customer_id=&status=&limit=20&next_token=`
- Response: `{ orders[], next_token? }`

### Payment APIs

**POST /payments/create-link**
- Purpose: Generate payment link
- Auth: System (internal) or Seller JWT
- Request: `{ order_id, amount, currency }`
- Response: `{ payment_id, payment_link, expires_at }`

**POST /payments/webhook**
- Purpose: Handle payment gateway webhooks
- Auth: Webhook signature validation
- Request: Gateway-specific payload
- Response: `{ received: true }`

**GET /payments/{payment_id}**
- Purpose: Get payment details
- Auth: Seller/Customer JWT (own payment) or Admin JWT
- Response: `{ payment_id, status, amount, ... }`

### WhatsApp Webhook APIs

**POST /webhooks/whatsapp**
- Purpose: Receive WhatsApp messages
- Auth: Meta signature validation
- Request: WhatsApp Cloud API webhook payload
- Response: `{ status: "received" }`

**GET /webhooks/whatsapp**
- Purpose: Verify webhook endpoint
- Auth: Meta verification token
- Query: `?hub.mode=subscribe&hub.verify_token=&hub.challenge=`
- Response: `hub.challenge` value

### Admin APIs

**GET /admin/sellers**
- Purpose: List sellers for review
- Auth: Admin JWT
- Query: `?status=pending&limit=20&next_token=`
- Response: `{ sellers[], next_token? }`

**POST /admin/sellers/{seller_id}/approve**
- Purpose: Approve seller application
- Auth: Admin JWT
- Request: `{ notes? }`
- Response: `{ seller_id, status: "approved" }`

**POST /admin/sellers/{seller_id}/reject**
- Purpose: Reject seller application
- Auth: Admin JWT
- Request: `{ reason }`
- Response: `{ seller_id, status: "rejected" }`

**POST /admin/sellers/{seller_id}/suspend**
- Purpose: Suspend seller account
- Auth: Admin JWT
- Request: `{ reason }`
- Response: `{ seller_id, suspended: true }`

**POST /admin/categories**
- Purpose: Create product category
- Auth: Admin JWT
- Request: `{ name, description, parent_category_id? }`
- Response: `{ category_id, ... }`

**GET /admin/disputes**
- Purpose: List disputes
- Auth: Admin JWT
- Query: `?status=open&limit=20&next_token=`
- Response: `{ disputes[], next_token? }`

**PATCH /admin/disputes/{dispute_id}**
- Purpose: Update dispute status
- Auth: Admin JWT
- Request: `{ status, resolution?, assigned_to? }`
- Response: `{ dispute_id, new_status }`

**GET /admin/analytics**
- Purpose: Get platform analytics
- Auth: Admin JWT
- Query: `?metric=gmv&start_date=&end_date=&group_by=day`
- Response: `{ data_points[] }`

### Catalog Query APIs

**GET /catalog/categories**
- Purpose: List all categories
- Auth: Public
- Response: `{ categories[] }`

**GET /catalog/search**
- Purpose: Search products
- Auth: Public
- Query: `?q=saree&category_id=&min_price=&max_price=&limit=20`
- Response: `{ products[], total_count }`


## WhatsApp Integration Design

### Meta WhatsApp Cloud API

**Setup Requirements**:
- Meta Business Account
- WhatsApp Business App
- Phone number verification
- Webhook URL configuration
- Access token from Meta Developer Portal

### Webhook Flow

**Inbound Message Processing**:

```python
def handle_whatsapp_webhook(event):
    # Step 1: Validate signature
    signature = event['headers']['x-hub-signature-256']
    if not validate_meta_signature(event['body'], signature):
        return {'statusCode': 403, 'body': 'Invalid signature'}
    
    # Step 2: Parse webhook payload
    payload = json.loads(event['body'])
    
    # Step 3: Extract message details
    for entry in payload.get('entry', []):
        for change in entry.get('changes', []):
            if change['field'] == 'messages':
                message = change['value']['messages'][0]
                process_message(message)
    
    # Step 4: Return 200 immediately (fast-ack pattern)
    return {'statusCode': 200, 'body': 'OK'}

def process_message(message):
    # Extract message details
    from_number = message['from']
    message_type = message['type']  # text, audio, image, etc.
    message_id = message['id']
    
    # Check idempotency
    if is_message_processed(message_id):
        return
    
    # Get or create session
    session = get_or_create_session(from_number)
    
    # Process based on message type
    if message_type == 'text':
        content = message['text']['body']
        handle_text_message(session, content, message_id)
    
    elif message_type == 'audio':
        audio_id = message['audio']['id']
        handle_voice_message(session, audio_id, message_id)
    
    elif message_type == 'image':
        image_id = message['image']['id']
        handle_image_message(session, image_id, message_id)
    
    # Save message to DynamoDB
    save_message(session['session_id'], message)
```

**Signature Validation**:

```python
import hmac
import hashlib

def validate_meta_signature(payload, signature_header):
    # Get app secret from Secrets Manager
    app_secret = get_secret('whatsapp/app_secret')
    
    # Calculate expected signature
    expected_signature = hmac.new(
        app_secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    # Extract signature from header (format: sha256=<signature>)
    received_signature = signature_header.split('=')[1]
    
    # Constant-time comparison
    return hmac.compare_digest(expected_signature, received_signature)
```

### Session Management

**Session State Machine**:

```python
class SessionState:
    IDLE = 'idle'
    BROWSING = 'browsing'
    PRODUCT_INQUIRY = 'product_inquiry'
    CART_BUILDING = 'cart_building'
    CHECKOUT = 'checkout'
    AWAITING_PAYMENT = 'awaiting_payment'
    ORDER_TRACKING = 'order_tracking'

def get_or_create_session(phone_number):
    # Try to get active session
    response = dynamodb.query(
        IndexName='GSI1',
        KeyConditionExpression='GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        FilterExpression='#status = :status',
        ExpressionAttributeNames={'#status': 'status'},
        ExpressionAttributeValues={
            ':pk': f'PHONE#{phone_number}',
            ':sk': 'SESSION#',
            ':status': 'active'
        }
    )
    
    if response['Items']:
        return response['Items'][0]
    
    # Create new session
    session_id = generate_uuid()
    session = {
        'PK': f'SESSION#{session_id}',
        'SK': 'METADATA',
        'GSI1PK': f'PHONE#{phone_number}',
        'GSI1SK': f'SESSION#{int(time.time())}',
        'session_id': session_id,
        'customer_phone': phone_number,
        'status': 'active',
        'state': SessionState.IDLE,
        'context': {},
        'created_at': datetime.utcnow().isoformat(),
        'expires_at': (datetime.utcnow() + timedelta(hours=24)).isoformat()
    }
    
    dynamodb.put_item(Item=session)
    return session
```

**Context Persistence**:

```python
def update_session_context(session_id, updates):
    # Atomic update of session context
    dynamodb.update_item(
        Key={'PK': f'SESSION#{session_id}', 'SK': 'METADATA'},
        UpdateExpression='SET context = :context, last_message_at = :timestamp',
        ExpressionAttributeValues={
            ':context': updates,
            ':timestamp': datetime.utcnow().isoformat()
        }
    )

# Example context structure
context = {
    'current_category': 'fashion',
    'viewed_products': ['prod-123', 'prod-456'],
    'cart': [
        {'product_id': 'prod-123', 'quantity': 2},
        {'product_id': 'prod-789', 'quantity': 1}
    ],
    'delivery_address': '123 Main St, Mumbai',
    'preferred_language': 'hi'
}
```

### Message Processing

**Intent Detection**:

```python
def detect_intent(message_text, session_context):
    # Use Gemini for intent classification
    prompt = f"""
    Classify the customer's intent from this message.
    
    Message: {message_text}
    Context: {json.dumps(session_context)}
    
    Possible intents:
    - browse_products: Customer wants to see products
    - product_inquiry: Customer asking about specific product
    - add_to_cart: Customer wants to add item to cart
    - checkout: Customer ready to place order
    - track_order: Customer checking order status
    - support: Customer needs help
    
    Respond with JSON: {{"intent": "...", "confidence": 0.0-1.0, "entities": {{}}}}
    """
    
    response = gemini_client.generate_content(prompt)
    return json.loads(response.text)
```

**Voice Transcription**:

```python
def handle_voice_message(session, audio_id, message_id):
    # Download audio from WhatsApp
    audio_url = get_media_url(audio_id)
    audio_data = download_media(audio_url)
    
    # Transcribe using Gemini
    transcription = gemini_client.transcribe_audio(
        audio_data,
        language='hi-IN'  # Hindi
    )
    
    # Save transcription
    save_message(session['session_id'], {
        'message_id': message_id,
        'type': 'audio',
        'transcription': transcription,
        'timestamp': datetime.utcnow().isoformat()
    })
    
    # Process as text message
    handle_text_message(session, transcription, message_id)
```

### Outbound Messaging

**Message Queue Pattern**:

```python
def send_whatsapp_message(phone_number, message_data):
    # Add to SQS queue for reliable delivery
    sqs.send_message(
        QueueUrl=OUTBOUND_QUEUE_URL,
        MessageBody=json.dumps({
            'phone_number': phone_number,
            'message_data': message_data,
            'retry_count': 0,
            'timestamp': datetime.utcnow().isoformat()
        })
    )

def process_outbound_queue(event):
    for record in event['Records']:
        message = json.loads(record['body'])
        
        try:
            # Send via WhatsApp Cloud API
            response = requests.post(
                f'https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages',
                headers={
                    'Authorization': f'Bearer {WHATSAPP_ACCESS_TOKEN}',
                    'Content-Type': 'application/json'
                },
                json=message['message_data']
            )
            
            if response.status_code == 200:
                # Delete from queue
                sqs.delete_message(
                    QueueUrl=OUTBOUND_QUEUE_URL,
                    ReceiptHandle=record['receiptHandle']
                )
            else:
                # Retry with backoff
                handle_send_failure(message, record)
        
        except Exception as e:
            # Send to DLQ after max retries
            if message['retry_count'] >= 3:
                send_to_dlq(message, str(e))
            else:
                retry_with_backoff(message, record)
```

**Message Templates**:

```python
def send_product_catalog(phone_number, products):
    message_data = {
        'messaging_product': 'whatsapp',
        'to': phone_number,
        'type': 'interactive',
        'interactive': {
            'type': 'list',
            'header': {'type': 'text', 'text': 'Our Products'},
            'body': {'text': 'Select a product to view details'},
            'action': {
                'button': 'View Products',
                'sections': [
                    {
                        'title': product['category'],
                        'rows': [
                            {
                                'id': product['product_id'],
                                'title': product['name'],
                                'description': f"₹{product['price']}"
                            }
                            for product in products
                        ]
                    }
                ]
            }
        }
    }
    
    send_whatsapp_message(phone_number, message_data)

def send_payment_link(phone_number, order_id, payment_link):
    message_data = {
        'messaging_product': 'whatsapp',
        'to': phone_number,
        'type': 'text',
        'text': {
            'body': f'Your order #{order_id} is confirmed! Pay here: {payment_link}'
        }
    }
    
    send_whatsapp_message(phone_number, message_data)
```

### Idempotency Handling

```python
def is_message_processed(message_id):
    # Check if message already processed
    response = dynamodb.get_item(
        Key={
            'PK': f'IDEMPOTENCY#{message_id}',
            'SK': 'METADATA'
        }
    )
    
    return 'Item' in response

def mark_message_processed(message_id):
    # Store with TTL for automatic cleanup
    dynamodb.put_item(
        Item={
            'PK': f'IDEMPOTENCY#{message_id}',
            'SK': 'METADATA',
            'processed_at': datetime.utcnow().isoformat(),
            'ttl': int(time.time()) + 86400  # 24 hours
        }
    )
```


## Order and Payment Flow

### Order Lifecycle

**States**:
1. `pending` - Order created, awaiting seller acceptance
2. `accepted` - Seller accepted, awaiting payment
3. `paid` - Payment confirmed, awaiting fulfillment
4. `processing` - Seller preparing order
5. `shipped` - Order dispatched
6. `delivered` - Order completed
7. `cancelled` - Order cancelled
8. `rejected` - Seller rejected order

### Order Creation Flow

```python
def create_order(customer_id, seller_id, items, delivery_address):
    order_id = generate_uuid()
    timestamp = datetime.utcnow().isoformat()
    
    # Step 1: Validate stock availability
    for item in items:
        product = get_product(item['product_id'])
        if product['stock_quantity'] < item['quantity']:
            raise InsufficientStockError(item['product_id'])
    
    # Step 2: Calculate total
    total_amount = sum(
        get_product(item['product_id'])['price'] * item['quantity']
        for item in items
    )
    
    # Step 3: Create order and reserve stock atomically
    try:
        dynamodb.transact_write_items(
            TransactItems=[
                # Create order
                {
                    'Put': {
                        'TableName': TABLE_NAME,
                        'Item': {
                            'PK': f'ORDER#{order_id}',
                            'SK': 'METADATA',
                            'GSI1PK': f'SELLER#{seller_id}',
                            'GSI1SK': f'CREATED#{timestamp}',
                            'GSI2PK': f'CUSTOMER#{customer_id}',
                            'GSI2SK': f'CREATED#{timestamp}',
                            'order_id': order_id,
                            'seller_id': seller_id,
                            'customer_id': customer_id,
                            'status': 'pending',
                            'payment_status': 'pending',
                            'total_amount': Decimal(str(total_amount)),
                            'delivery_address': delivery_address,
                            'created_at': timestamp
                        }
                    }
                },
                # Create order items and reserve stock
                *[
                    {
                        'Put': {
                            'TableName': TABLE_NAME,
                            'Item': {
                                'PK': f'ORDER#{order_id}',
                                'SK': f'ITEM#{item["product_id"]}',
                                'product_id': item['product_id'],
                                'quantity': item['quantity'],
                                'unit_price': get_product(item['product_id'])['price']
                            }
                        }
                    }
                    for item in items
                ],
                # Decrement stock with condition
                *[
                    {
                        'Update': {
                            'TableName': TABLE_NAME,
                            'Key': {
                                'PK': f'SELLER#{seller_id}',
                                'SK': f'PRODUCT#{item["product_id"]}'
                            },
                            'UpdateExpression': 'SET stock_quantity = stock_quantity - :qty',
                            'ConditionExpression': 'stock_quantity >= :qty',
                            'ExpressionAttributeValues': {
                                ':qty': item['quantity']
                            }
                        }
                    }
                    for item in items
                ]
            ]
        )
    except ClientError as e:
        if e.response['Error']['Code'] == 'TransactionCanceledException':
            # Stock reservation failed
            raise InsufficientStockError()
        raise
    
    # Step 4: Publish event
    eventbridge.put_events(
        Entries=[{
            'Source': 'vyapargyan.orders',
            'DetailType': 'OrderCreated',
            'Detail': json.dumps({
                'order_id': order_id,
                'seller_id': seller_id,
                'customer_id': customer_id,
                'total_amount': float(total_amount)
            })
        }]
    )
    
    return order_id
```

### Payment Link Generation

```python
def create_payment_link(order_id):
    # Get order details
    order = get_order(order_id)
    
    # Generate payment link via Razorpay
    payment_link = razorpay_client.payment_link.create({
        'amount': int(order['total_amount'] * 100),  # Convert to paise
        'currency': 'INR',
        'description': f'Order #{order_id}',
        'customer': {
            'contact': order['customer_phone']
        },
        'notify': {
            'sms': True,
            'whatsapp': False  # We'll send via our system
        },
        'callback_url': f'https://api.vyapargyan.com/payments/callback',
        'callback_method': 'get',
        'notes': {
            'order_id': order_id,
            'seller_id': order['seller_id']
        }
    })
    
    # Store payment record
    payment_id = generate_uuid()
    dynamodb.put_item(
        Item={
            'PK': f'PAYMENT#{payment_id}',
            'SK': 'METADATA',
            'GSI1PK': f'ORDER#{order_id}',
            'GSI1SK': f'CREATED#{datetime.utcnow().isoformat()}',
            'payment_id': payment_id,
            'order_id': order_id,
            'amount': order['total_amount'],
            'currency': 'INR',
            'gateway_payment_id': payment_link['id'],
            'status': 'pending',
            'payment_link': payment_link['short_url'],
            'expires_at': payment_link['expire_by'],
            'created_at': datetime.utcnow().isoformat()
        }
    )
    
    return payment_link['short_url']
```

### Payment Webhook Handling

```python
def handle_payment_webhook(event):
    # Step 1: Validate signature
    signature = event['headers']['x-razorpay-signature']
    if not validate_razorpay_signature(event['body'], signature):
        return {'statusCode': 403, 'body': 'Invalid signature'}
    
    # Step 2: Parse payload
    payload = json.loads(event['body'])
    event_type = payload['event']
    payment_data = payload['payload']['payment']['entity']
    
    # Step 3: Check idempotency
    event_id = payload['payload']['payment']['entity']['id']
    if is_event_processed(event_id):
        return {'statusCode': 200, 'body': 'Already processed'}
    
    # Step 4: Process based on event type
    if event_type == 'payment.captured':
        handle_payment_success(payment_data)
    elif event_type == 'payment.failed':
        handle_payment_failure(payment_data)
    
    # Step 5: Mark event as processed
    mark_event_processed(event_id)
    
    return {'statusCode': 200, 'body': 'OK'}

def handle_payment_success(payment_data):
    order_id = payment_data['notes']['order_id']
    gateway_payment_id = payment_data['id']
    
    # Update payment and order status atomically
    try:
        dynamodb.transact_write_items(
            TransactItems=[
                # Update payment status
                {
                    'Update': {
                        'TableName': TABLE_NAME,
                        'Key': {
                            'PK': f'PAYMENT#{get_payment_id_by_gateway_id(gateway_payment_id)}',
                            'SK': 'METADATA'
                        },
                        'UpdateExpression': 'SET #status = :status, completed_at = :timestamp',
                        'ConditionExpression': '#status = :pending',
                        'ExpressionAttributeNames': {'#status': 'status'},
                        'ExpressionAttributeValues': {
                            ':status': 'completed',
                            ':pending': 'pending',
                            ':timestamp': datetime.utcnow().isoformat()
                        }
                    }
                },
                # Update order status
                {
                    'Update': {
                        'TableName': TABLE_NAME,
                        'Key': {
                            'PK': f'ORDER#{order_id}',
                            'SK': 'METADATA'
                        },
                        'UpdateExpression': 'SET payment_status = :paid, #status = :accepted',
                        'ConditionExpression': 'payment_status = :pending',
                        'ExpressionAttributeNames': {'#status': 'status'},
                        'ExpressionAttributeValues': {
                            ':paid': 'paid',
                            ':accepted': 'accepted',
                            ':pending': 'pending'
                        }
                    }
                }
            ]
        )
    except ClientError as e:
        if e.response['Error']['Code'] == 'TransactionCanceledException':
            # Payment already processed or order cancelled
            logger.warning(f'Payment already processed for order {order_id}')
            return
        raise
    
    # Publish event
    eventbridge.put_events(
        Entries=[{
            'Source': 'vyapargyan.payments',
            'DetailType': 'PaymentSucceeded',
            'Detail': json.dumps({
                'order_id': order_id,
                'payment_id': gateway_payment_id,
                'amount': payment_data['amount'] / 100
            })
        }]
    )
```

### Rollback Logic

**Order Cancellation**:

```python
def cancel_order(order_id, reason):
    order = get_order(order_id)
    
    # Can only cancel if not yet shipped
    if order['status'] in ['shipped', 'delivered']:
        raise InvalidStateError('Cannot cancel shipped order')
    
    # Get order items
    items = get_order_items(order_id)
    
    # Restore stock and update order atomically
    try:
        dynamodb.transact_write_items(
            TransactItems=[
                # Update order status
                {
                    'Update': {
                        'TableName': TABLE_NAME,
                        'Key': {
                            'PK': f'ORDER#{order_id}',
                            'SK': 'METADATA'
                        },
                        'UpdateExpression': 'SET #status = :cancelled, cancellation_reason = :reason',
                        'ConditionExpression': '#status IN (:pending, :accepted, :paid)',
                        'ExpressionAttributeNames': {'#status': 'status'},
                        'ExpressionAttributeValues': {
                            ':cancelled': 'cancelled',
                            ':reason': reason,
                            ':pending': 'pending',
                            ':accepted': 'accepted',
                            ':paid': 'paid'
                        }
                    }
                },
                # Restore stock
                *[
                    {
                        'Update': {
                            'TableName': TABLE_NAME,
                            'Key': {
                                'PK': f'SELLER#{order["seller_id"]}',
                                'SK': f'PRODUCT#{item["product_id"]}'
                            },
                            'UpdateExpression': 'SET stock_quantity = stock_quantity + :qty',
                            'ExpressionAttributeValues': {
                                ':qty': item['quantity']
                            }
                        }
                    }
                    for item in items
                ]
            ]
        )
    except ClientError as e:
        if e.response['Error']['Code'] == 'TransactionCanceledException':
            raise InvalidStateError('Order already cancelled or in invalid state')
        raise
    
    # Initiate refund if payment was made
    if order['payment_status'] == 'paid':
        initiate_refund(order_id)
    
    # Publish event
    eventbridge.put_events(
        Entries=[{
            'Source': 'vyapargyan.orders',
            'DetailType': 'OrderCancelled',
            'Detail': json.dumps({
                'order_id': order_id,
                'reason': reason
            })
        }]
    )
```

### Concurrency Handling

**Optimistic Locking**:

```python
def update_order_status(order_id, new_status, expected_status):
    try:
        dynamodb.update_item(
            Key={'PK': f'ORDER#{order_id}', 'SK': 'METADATA'},
            UpdateExpression='SET #status = :new_status, updated_at = :timestamp',
            ConditionExpression': '#status = :expected_status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':new_status': new_status,
                ':expected_status': expected_status,
                ':timestamp': datetime.utcnow().isoformat()
            }
        )
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise ConcurrentModificationError('Order status changed by another process')
        raise
```

**Preventing Overselling**:

```python
# Stock decrement with condition ensures atomic operation
dynamodb.update_item(
    Key={'PK': f'SELLER#{seller_id}', 'SK': f'PRODUCT#{product_id}'},
    UpdateExpression='SET stock_quantity = stock_quantity - :qty',
    ConditionExpression='stock_quantity >= :qty',  # Prevents negative stock
    ExpressionAttributeValues={':qty': quantity}
)
```


## Event-Driven Workflows

### Synchronous vs Asynchronous Operations

**Synchronous** (API Gateway → Lambda → Response):
- User authentication and authorization
- Product catalog queries
- Order creation (with stock reservation)
- Payment link generation
- Real-time WhatsApp message acknowledgment

**Asynchronous** (EventBridge → Lambda):
- Order confirmation notifications
- Payment success notifications
- Low stock alerts
- Analytics aggregation
- Audit log processing
- Email/SMS notifications

### EventBridge Event Patterns

**Order Events**:

```json
{
  "source": "vyapargyan.orders",
  "detail-type": "OrderCreated",
  "detail": {
    "order_id": "order-uuid",
    "seller_id": "seller-uuid",
    "customer_id": "customer-uuid",
    "total_amount": 1500.00,
    "items": [...]
  }
}
```

**Payment Events**:

```json
{
  "source": "vyapargyan.payments",
  "detail-type": "PaymentSucceeded",
  "detail": {
    "order_id": "order-uuid",
    "payment_id": "payment-uuid",
    "amount": 1500.00,
    "gateway": "razorpay"
  }
}
```

**Inventory Events**:

```json
{
  "source": "vyapargyan.inventory",
  "detail-type": "LowStockAlert",
  "detail": {
    "product_id": "product-uuid",
    "seller_id": "seller-uuid",
    "current_stock": 5,
    "threshold": 10
  }
}
```

### Event Rules and Targets

**Order Notification Rule**:

```python
# EventBridge Rule
{
    "Name": "order-created-notification",
    "EventPattern": {
        "source": ["vyapargyan.orders"],
        "detail-type": ["OrderCreated"]
    },
    "Targets": [
        {
            "Arn": "arn:aws:lambda:region:account:function:notify-seller",
            "Id": "1"
        },
        {
            "Arn": "arn:aws:sqs:region:account:analytics-queue",
            "Id": "2"
        }
    ]
}

# Lambda Handler
def notify_seller(event, context):
    order_data = event['detail']
    seller_id = order_data['seller_id']
    
    # Get seller phone number
    seller = get_seller(seller_id)
    
    # Send WhatsApp notification
    send_whatsapp_message(
        seller['phone_number'],
        {
            'messaging_product': 'whatsapp',
            'to': seller['phone_number'],
            'type': 'text',
            'text': {
                'body': f"New order #{order_data['order_id']} received! Amount: ₹{order_data['total_amount']}"
            }
        }
    )
```

**Payment Success Rule**:

```python
{
    "Name": "payment-success-workflow",
    "EventPattern": {
        "source": ["vyapargyan.payments"],
        "detail-type": ["PaymentSucceeded"]
    },
    "Targets": [
        {
            "Arn": "arn:aws:lambda:region:account:function:confirm-order",
            "Id": "1"
        },
        {
            "Arn": "arn:aws:lambda:region:account:function:send-receipt",
            "Id": "2"
        },
        {
            "Arn": "arn:aws:lambda:region:account:function:update-analytics",
            "Id": "3"
        }
    ]
}
```

### SQS Queue Patterns

**Outbound Message Queue**:

```python
# Queue: outbound-whatsapp-messages
# Purpose: Reliable delivery of WhatsApp messages with retries
# Visibility Timeout: 30 seconds
# Message Retention: 4 days
# DLQ: outbound-whatsapp-dlq (after 3 retries)

def process_outbound_messages(event, context):
    for record in event['Records']:
        message = json.loads(record['body'])
        
        try:
            send_to_whatsapp(message)
            # Message automatically deleted on success
        except Exception as e:
            # Message returns to queue for retry
            logger.error(f'Failed to send message: {e}')
            raise
```

**Analytics Aggregation Queue**:

```python
# Queue: analytics-events
# Purpose: Batch processing of analytics events
# Batch Size: 100 messages
# Batch Window: 5 minutes

def aggregate_analytics(event, context):
    events = [json.loads(record['body']) for record in event['Records']]
    
    # Group by metric type
    metrics = defaultdict(list)
    for event in events:
        metrics[event['metric_type']].append(event)
    
    # Write aggregated metrics to DynamoDB
    for metric_type, data in metrics.items():
        write_aggregated_metric(metric_type, data)
```

### Retry and Error Handling

**Exponential Backoff**:

```python
def lambda_handler_with_retry(event, context):
    max_retries = 3
    base_delay = 1  # seconds
    
    for attempt in range(max_retries):
        try:
            return process_event(event)
        except RetryableError as e:
            if attempt == max_retries - 1:
                # Send to DLQ
                send_to_dlq(event, str(e))
                raise
            
            # Exponential backoff
            delay = base_delay * (2 ** attempt)
            time.sleep(delay)
```

**Dead Letter Queue Processing**:

```python
def process_dlq(event, context):
    for record in event['Records']:
        failed_message = json.loads(record['body'])
        
        # Log failure details
        logger.error(f'DLQ message: {failed_message}')
        
        # Store in DynamoDB for manual review
        dynamodb.put_item(
            Item={
                'PK': f'FAILED#{datetime.utcnow().date()}',
                'SK': f'{datetime.utcnow().isoformat()}#{generate_uuid()}',
                'message': failed_message,
                'error': record['messageAttributes'].get('ErrorMessage'),
                'retry_count': record['messageAttributes'].get('ApproximateReceiveCount')
            }
        )
        
        # Alert operations team
        sns.publish(
            TopicArn=ALERT_TOPIC_ARN,
            Subject='DLQ Alert',
            Message=f'Failed message in DLQ: {failed_message}'
        )
```

### Low Stock Alert Workflow

```python
# Triggered by DynamoDB Stream on product updates
def check_low_stock(event, context):
    for record in event['Records']:
        if record['eventName'] in ['MODIFY', 'INSERT']:
            new_image = record['dynamodb']['NewImage']
            
            product_id = new_image['product_id']['S']
            stock_quantity = int(new_image['stock_quantity']['N'])
            threshold = int(new_image.get('low_stock_threshold', {'N': '10'})['N'])
            
            if stock_quantity <= threshold:
                # Publish low stock event
                eventbridge.put_events(
                    Entries=[{
                        'Source': 'vyapargyan.inventory',
                        'DetailType': 'LowStockAlert',
                        'Detail': json.dumps({
                            'product_id': product_id,
                            'seller_id': new_image['seller_id']['S'],
                            'current_stock': stock_quantity,
                            'threshold': threshold
                        })
                    }]
                )
```

### Metrics Aggregation Workflow

```python
# Scheduled Lambda (every 5 minutes)
def aggregate_metrics(event, context):
    now = datetime.utcnow()
    five_minutes_ago = now - timedelta(minutes=5)
    
    # Query recent orders
    orders = query_orders_by_time_range(five_minutes_ago, now)
    
    # Calculate metrics
    metrics = {
        'order_count': len(orders),
        'total_gmv': sum(order['total_amount'] for order in orders),
        'avg_order_value': sum(order['total_amount'] for order in orders) / len(orders) if orders else 0
    }
    
    # Write to CloudWatch
    cloudwatch.put_metric_data(
        Namespace='VyaparGyan',
        MetricData=[
            {
                'MetricName': 'OrderCount',
                'Value': metrics['order_count'],
                'Unit': 'Count',
                'Timestamp': now
            },
            {
                'MetricName': 'GMV',
                'Value': metrics['total_gmv'],
                'Unit': 'None',
                'Timestamp': now
            }
        ]
    )
    
    # Store in DynamoDB for dashboard
    dynamodb.put_item(
        Item={
            'PK': f'METRICS#{now.date()}',
            'SK': f'INTERVAL#{now.isoformat()}',
            'metrics': metrics,
            'timestamp': now.isoformat()
        }
    )
```


## Security Design

### Authentication and Authorization

**Cognito Configuration**:

```python
# User Pool Settings
{
    "PasswordPolicy": {
        "MinimumLength": 8,
        "RequireUppercase": False,  # Phone-based auth
        "RequireLowercase": False,
        "RequireNumbers": True,
        "RequireSymbols": False
    },
    "MfaConfiguration": "OPTIONAL",
    "SmsConfiguration": {
        "SnsCallerArn": "arn:aws:iam::account:role/CognitoSMSRole"
    },
    "AccountRecoverySetting": {
        "RecoveryMechanisms": [
            {"Name": "verified_phone_number", "Priority": 1}
        ]
    }
}
```

**Password Handling**:
- All password operations handled by Cognito
- No password storage in application code
- Passwords never logged or transmitted in plain text
- Cognito enforces password policies automatically

### API Gateway Security

**Throttling**:

```yaml
ApiGateway:
  ThrottleSettings:
    RateLimit: 1000  # requests per second
    BurstLimit: 2000  # concurrent requests
  
  UsagePlans:
    Standard:
      Quota: 100000  # requests per month
      Throttle:
        RateLimit: 100
        BurstLimit: 200
    
    Premium:
      Quota: 1000000
      Throttle:
        RateLimit: 1000
        BurstLimit: 2000
```

**Request Validation**:

```python
# API Gateway Request Validator
{
    "validateRequestBody": True,
    "validateRequestParameters": True
}

# JSON Schema for request validation
{
    "type": "object",
    "required": ["name", "price"],
    "properties": {
        "name": {"type": "string", "minLength": 1, "maxLength": 255},
        "price": {"type": "number", "minimum": 0},
        "stock_quantity": {"type": "integer", "minimum": 0}
    }
}
```

### Webhook Security

**Signature Validation**:

```python
def validate_webhook_signature(payload, signature, secret):
    """
    Validate webhook signature using HMAC-SHA256
    """
    expected_signature = hmac.new(
        secret.encode('utf-8'),
        payload.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    # Constant-time comparison to prevent timing attacks
    return hmac.compare_digest(expected_signature, signature)

# WhatsApp webhook validation
def validate_whatsapp_webhook(event):
    signature = event['headers'].get('x-hub-signature-256', '')
    payload = event['body']
    secret = get_secret('whatsapp/app_secret')
    
    if not signature.startswith('sha256='):
        raise UnauthorizedException('Invalid signature format')
    
    signature = signature[7:]  # Remove 'sha256=' prefix
    
    if not validate_webhook_signature(payload, signature, secret):
        raise UnauthorizedException('Invalid signature')

# Razorpay webhook validation
def validate_razorpay_webhook(event):
    signature = event['headers'].get('x-razorpay-signature', '')
    payload = event['body']
    secret = get_secret('razorpay/webhook_secret')
    
    if not validate_webhook_signature(payload, signature, secret):
        raise UnauthorizedException('Invalid signature')
```

### Secrets Management

**AWS Secrets Manager**:

```python
import boto3
import json
from functools import lru_cache

secrets_client = boto3.client('secretsmanager')

@lru_cache(maxsize=128)
def get_secret(secret_name):
    """
    Get secret from Secrets Manager with caching
    """
    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
        
        if 'SecretString' in response:
            return json.loads(response['SecretString'])
        else:
            return base64.b64decode(response['SecretBinary'])
    
    except ClientError as e:
        logger.error(f'Failed to retrieve secret {secret_name}: {e}')
        raise

# Usage
whatsapp_token = get_secret('whatsapp/access_token')['token']
razorpay_key = get_secret('razorpay/api_key')['key_id']
razorpay_secret = get_secret('razorpay/api_key')['key_secret']
```

**Secret Rotation**:

```python
# Lambda function for automatic secret rotation
def rotate_secret(event, context):
    secret_arn = event['SecretId']
    token = event['ClientRequestToken']
    step = event['Step']
    
    if step == 'createSecret':
        # Generate new secret
        new_secret = generate_new_api_key()
        secrets_client.put_secret_value(
            SecretId=secret_arn,
            ClientRequestToken=token,
            SecretString=json.dumps(new_secret),
            VersionStages=['AWSPENDING']
        )
    
    elif step == 'setSecret':
        # Update service with new secret
        update_service_credentials(new_secret)
    
    elif step == 'testSecret':
        # Verify new secret works
        test_service_connection(new_secret)
    
    elif step == 'finishSecret':
        # Mark new secret as current
        secrets_client.update_secret_version_stage(
            SecretId=secret_arn,
            VersionStage='AWSCURRENT',
            MoveToVersionId=token
        )
```

### Encryption

**Data at Rest**:

```yaml
DynamoDB:
  Encryption:
    Type: AWS_MANAGED  # AWS-managed KMS keys
    # Or use customer-managed keys:
    # Type: CUSTOMER_MANAGED
    # KMSMasterKeyId: arn:aws:kms:region:account:key/key-id

S3:
  Encryption:
    ServerSideEncryptionConfiguration:
      Rules:
        - ApplyServerSideEncryptionByDefault:
            SSEAlgorithm: AES256
            # Or use KMS:
            # SSEAlgorithm: aws:kms
            # KMSMasterKeyID: arn:aws:kms:region:account:key/key-id

SecretsManager:
  Encryption:
    KmsKeyId: arn:aws:kms:region:account:key/key-id
```

**Data in Transit**:

```yaml
ApiGateway:
  SecurityPolicy: TLS_1_2
  MinimumCompressionSize: 0
  
CloudFront:
  ViewerProtocolPolicy: redirect-to-https
  MinimumProtocolVersion: TLSv1.2_2021
```

### Logging and Audit

**Structured Logging**:

```python
import json
import logging
from datetime import datetime

class StructuredLogger:
    def __init__(self, name):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.INFO)
    
    def log(self, level, message, **kwargs):
        log_entry = {
            'timestamp': datetime.utcnow().isoformat(),
            'level': level,
            'message': message,
            'request_id': kwargs.get('request_id'),
            'user_id': kwargs.get('user_id'),
            'action': kwargs.get('action'),
            'resource': kwargs.get('resource'),
            'ip_address': kwargs.get('ip_address'),
            **kwargs
        }
        
        self.logger.log(
            getattr(logging, level.upper()),
            json.dumps(log_entry)
        )

# Usage
logger = StructuredLogger('vyapargyan')

logger.log('INFO', 'Order created', 
    request_id='req-123',
    user_id='user-456',
    action='create_order',
    resource='order-789',
    order_amount=1500.00
)
```

**Audit Trail**:

```python
def audit_log(user_id, action, resource_type, resource_id, changes=None):
    """
    Create audit log entry
    """
    event_id = generate_uuid()
    timestamp = datetime.utcnow().isoformat()
    date = datetime.utcnow().date().isoformat()
    
    dynamodb.put_item(
        Item={
            'PK': f'AUDIT#{date}',
            'SK': f'{timestamp}#{event_id}',
            'GSI1PK': f'USER#{user_id}',
            'GSI1SK': timestamp,
            'event_id': event_id,
            'user_id': user_id,
            'action': action,
            'resource_type': resource_type,
            'resource_id': resource_id,
            'changes': changes,
            'timestamp': timestamp,
            'ttl': int(time.time()) + (365 * 86400)  # 1 year retention
        }
    )

# Usage
audit_log(
    user_id='admin-123',
    action='approve_seller',
    resource_type='seller',
    resource_id='seller-456',
    changes={'status': {'from': 'pending', 'to': 'approved'}}
)
```

### Input Validation and Sanitization

```python
from typing import Optional
from pydantic import BaseModel, validator, constr, conint

class CreateProductRequest(BaseModel):
    name: constr(min_length=1, max_length=255)
    description: Optional[constr(max_length=5000)]
    category_id: str
    price: float
    stock_quantity: conint(ge=0)
    
    @validator('price')
    def validate_price(cls, v):
        if v < 0:
            raise ValueError('Price must be non-negative')
        if v > 1000000:
            raise ValueError('Price exceeds maximum allowed')
        return round(v, 2)
    
    @validator('name', 'description')
    def sanitize_text(cls, v):
        if v is None:
            return v
        # Remove potentially dangerous characters
        return v.replace('<', '').replace('>', '').strip()

# Usage in Lambda
def create_product(event, context):
    try:
        request = CreateProductRequest(**json.loads(event['body']))
        # Proceed with validated data
    except ValidationError as e:
        return {
            'statusCode': 400,
            'body': json.dumps({'errors': e.errors()})
        }
```

### Rate Limiting

```python
def check_rate_limit(user_id, action, limit=100, window=60):
    """
    Check if user has exceeded rate limit
    """
    key = f'RATELIMIT#{user_id}#{action}'
    now = int(time.time())
    window_start = now - window
    
    # Get request count in window
    response = dynamodb.query(
        KeyConditionExpression='PK = :pk AND SK > :start',
        ExpressionAttributeValues={
            ':pk': key,
            ':start': str(window_start)
        }
    )
    
    if len(response['Items']) >= limit:
        raise RateLimitExceededError(f'Rate limit exceeded for {action}')
    
    # Record this request
    dynamodb.put_item(
        Item={
            'PK': key,
            'SK': str(now),
            'ttl': now + window
        }
    )
```


## Observability and Operations

### CloudWatch Logging

**Log Groups Structure**:

```
/aws/lambda/product-service
/aws/lambda/order-service
/aws/lambda/payment-service
/aws/lambda/whatsapp-handler
/aws/lambda/notification-service
/aws/apigateway/vyapargyan-api
```

**Log Retention**:

```yaml
LogGroups:
  ProductionLogs:
    RetentionInDays: 30
  StagingLogs:
    RetentionInDays: 7
  DevelopmentLogs:
    RetentionInDays: 3
```

**Structured Logging Pattern**:

```python
def lambda_handler(event, context):
    request_id = context.request_id
    
    logger.info('Request started', extra={
        'request_id': request_id,
        'function_name': context.function_name,
        'event_type': event.get('requestContext', {}).get('eventType')
    })
    
    try:
        result = process_request(event)
        
        logger.info('Request completed', extra={
            'request_id': request_id,
            'status': 'success',
            'duration_ms': context.get_remaining_time_in_millis()
        })
        
        return result
    
    except Exception as e:
        logger.error('Request failed', extra={
            'request_id': request_id,
            'error_type': type(e).__name__,
            'error_message': str(e),
            'stack_trace': traceback.format_exc()
        })
        raise
```

### CloudWatch Metrics

**Custom Metrics**:

```python
def publish_metrics(namespace, metrics):
    """
    Publish custom metrics to CloudWatch
    """
    cloudwatch.put_metric_data(
        Namespace=namespace,
        MetricData=[
            {
                'MetricName': metric['name'],
                'Value': metric['value'],
                'Unit': metric.get('unit', 'None'),
                'Timestamp': datetime.utcnow(),
                'Dimensions': metric.get('dimensions', [])
            }
            for metric in metrics
        ]
    )

# Business Metrics
publish_metrics('VyaparGyan/Business', [
    {
        'name': 'OrdersCreated',
        'value': 1,
        'unit': 'Count',
        'dimensions': [
            {'Name': 'SellerId', 'Value': seller_id},
            {'Name': 'Environment', 'Value': 'production'}
        ]
    },
    {
        'name': 'GMV',
        'value': order_amount,
        'unit': 'None',
        'dimensions': [
            {'Name': 'Currency', 'Value': 'INR'},
            {'Name': 'Environment', 'Value': 'production'}
        ]
    }
])

# Technical Metrics
publish_metrics('VyaparGyan/Technical', [
    {
        'name': 'APILatency',
        'value': response_time_ms,
        'unit': 'Milliseconds',
        'dimensions': [
            {'Name': 'Endpoint', 'Value': '/orders'},
            {'Name': 'Method', 'Value': 'POST'}
        ]
    },
    {
        'name': 'DynamoDBThrottles',
        'value': 1,
        'unit': 'Count'
    }
])
```

### CloudWatch Alarms

**Critical Alarms**:

```yaml
Alarms:
  HighErrorRate:
    MetricName: Errors
    Namespace: AWS/Lambda
    Statistic: Sum
    Period: 300  # 5 minutes
    EvaluationPeriods: 2
    Threshold: 10
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref CriticalAlertTopic
  
  HighAPILatency:
    MetricName: Latency
    Namespace: AWS/ApiGateway
    Statistic: Average
    Period: 60
    EvaluationPeriods: 3
    Threshold: 1000  # 1 second
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref WarningAlertTopic
  
  PaymentWebhookFailures:
    MetricName: PaymentWebhookErrors
    Namespace: VyaparGyan/Payments
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 1
    Threshold: 5
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref CriticalAlertTopic
  
  DLQMessages:
    MetricName: ApproximateNumberOfMessagesVisible
    Namespace: AWS/SQS
    Dimensions:
      - Name: QueueName
        Value: outbound-whatsapp-dlq
    Statistic: Average
    Period: 300
    EvaluationPeriods: 1
    Threshold: 1
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref WarningAlertTopic
```

### Request Tracing

**X-Ray Integration**:

```python
from aws_xray_sdk.core import xray_recorder
from aws_xray_sdk.core import patch_all

# Patch all supported libraries
patch_all()

@xray_recorder.capture('process_order')
def process_order(order_data):
    # Add metadata
    xray_recorder.put_metadata('order_id', order_data['order_id'])
    xray_recorder.put_metadata('seller_id', order_data['seller_id'])
    
    # Add annotations (indexed for search)
    xray_recorder.put_annotation('order_amount', order_data['total_amount'])
    xray_recorder.put_annotation('payment_method', order_data['payment_method'])
    
    # Subsegments for detailed tracing
    with xray_recorder.capture('validate_stock'):
        validate_stock(order_data['items'])
    
    with xray_recorder.capture('create_payment_link'):
        payment_link = create_payment_link(order_data)
    
    return payment_link
```

### Dashboards

**Operations Dashboard**:

```yaml
Dashboard:
  Name: VyaparGyan-Operations
  Widgets:
    - Type: Metric
      Properties:
        Title: API Request Rate
        Metrics:
          - [AWS/ApiGateway, Count, ApiName, vyapargyan-api]
        Period: 300
        Stat: Sum
    
    - Type: Metric
      Properties:
        Title: Lambda Errors
        Metrics:
          - [AWS/Lambda, Errors, FunctionName, product-service]
          - [AWS/Lambda, Errors, FunctionName, order-service]
          - [AWS/Lambda, Errors, FunctionName, payment-service]
        Period: 300
        Stat: Sum
    
    - Type: Metric
      Properties:
        Title: DynamoDB Consumed Capacity
        Metrics:
          - [AWS/DynamoDB, ConsumedReadCapacityUnits, TableName, vyapargyan-main]
          - [AWS/DynamoDB, ConsumedWriteCapacityUnits, TableName, vyapargyan-main]
        Period: 300
        Stat: Sum
    
    - Type: Log
      Properties:
        Title: Recent Errors
        Query: |
          fields @timestamp, @message
          | filter @message like /ERROR/
          | sort @timestamp desc
          | limit 20
```

**Business Dashboard**:

```yaml
Dashboard:
  Name: VyaparGyan-Business
  Widgets:
    - Type: Metric
      Properties:
        Title: Orders Created
        Metrics:
          - [VyaparGyan/Business, OrdersCreated]
        Period: 3600
        Stat: Sum
    
    - Type: Metric
      Properties:
        Title: GMV
        Metrics:
          - [VyaparGyan/Business, GMV]
        Period: 3600
        Stat: Sum
    
    - Type: Metric
      Properties:
        Title: Payment Success Rate
        Metrics:
          - Expression: m1/m2*100
            Label: Success Rate %
          - [VyaparGyan/Payments, PaymentSucceeded, {id: m1, visible: false}]
          - [VyaparGyan/Payments, PaymentAttempted, {id: m2, visible: false}]
        Period: 3600
```

### Debugging Tools

**CloudWatch Insights Queries**:

```sql
-- Find slow API requests
fields @timestamp, @message, @duration
| filter @message like /Request completed/
| filter @duration > 1000
| sort @duration desc
| limit 20

-- Track order flow
fields @timestamp, @message
| filter @message like /order-123/
| sort @timestamp asc

-- Payment webhook failures
fields @timestamp, @message, error_type
| filter @message like /Payment webhook failed/
| stats count() by error_type

-- WhatsApp message processing time
fields @timestamp, @message, duration_ms
| filter @message like /WhatsApp message processed/
| stats avg(duration_ms), max(duration_ms), min(duration_ms) by bin(5m)
```

**Lambda Insights**:

```yaml
LambdaInsights:
  Enabled: true
  Layer: arn:aws:lambda:region:580247275435:layer:LambdaInsightsExtension:21
  
  Metrics:
    - cpu_total_time
    - memory_utilization
    - cold_start_duration
    - init_duration
```

### Incident Response

**Runbook Structure**:

```markdown
# Incident: High API Error Rate

## Detection
- CloudWatch Alarm: HighErrorRate triggered
- Threshold: >10 errors in 5 minutes

## Investigation Steps
1. Check CloudWatch Logs for error patterns
2. Query: `fields @timestamp, @message | filter level = "ERROR" | sort @timestamp desc`
3. Check X-Ray traces for failed requests
4. Review recent deployments in CodePipeline
5. Check DynamoDB throttling metrics

## Common Causes
- DynamoDB throttling due to hot partition
- Lambda timeout due to external API latency
- Invalid request payload from client
- Downstream service unavailable

## Resolution Steps
1. If DynamoDB throttling: Increase on-demand capacity or fix access pattern
2. If Lambda timeout: Increase timeout or optimize code
3. If external API issue: Enable circuit breaker, use cached data
4. If deployment issue: Rollback to previous version

## Communication
- Update status page
- Notify affected sellers via WhatsApp
- Post incident update in Slack #incidents channel
```


## Deployment Design

### AWS CDK Infrastructure as Code

**Project Structure**:

```
infrastructure/
├── bin/
│   └── app.ts                 # CDK app entry point
├── lib/
│   ├── stacks/
│   │   ├── network-stack.ts   # VPC, subnets (if needed)
│   │   ├── database-stack.ts  # DynamoDB tables
│   │   ├── storage-stack.ts   # S3 buckets
│   │   ├── auth-stack.ts      # Cognito user pools
│   │   ├── api-stack.ts       # API Gateway, Lambda functions
│   │   ├── events-stack.ts    # EventBridge, SQS
│   │   ├── monitoring-stack.ts # CloudWatch, alarms
│   │   └── frontend-stack.ts  # CloudFront, S3 for web app
│   ├── constructs/
│   │   ├── lambda-function.ts # Reusable Lambda construct
│   │   ├── api-endpoint.ts    # API Gateway endpoint construct
│   │   └── event-rule.ts      # EventBridge rule construct
│   └── config/
│       ├── dev.ts
│       ├── staging.ts
│       └── prod.ts
├── cdk.json
└── package.json
```

**Environment Configuration**:

```typescript
// lib/config/prod.ts
export const prodConfig = {
  environment: 'production',
  region: 'ap-south-1',  // Mumbai
  
  dynamodb: {
    billingMode: 'PAY_PER_REQUEST',
    pointInTimeRecovery: true,
    deletionProtection: true
  },
  
  lambda: {
    memorySize: 1024,
    timeout: 30,
    reservedConcurrentExecutions: 100,
    logRetention: 30  // days
  },
  
  apiGateway: {
    throttle: {
      rateLimit: 1000,
      burstLimit: 2000
    }
  },
  
  cognito: {
    mfaConfiguration: 'OPTIONAL',
    passwordPolicy: {
      minLength: 8,
      requireNumbers: true
    }
  },
  
  monitoring: {
    enableXRay: true,
    enableLambdaInsights: true,
    alarmEmail: 'ops@vyapargyan.com'
  }
};
```

**DynamoDB Stack**:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class DatabaseStack extends cdk.Stack {
  public readonly mainTable: dynamodb.Table;
  
  constructor(scope: cdk.App, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    
    this.mainTable = new dynamodb.Table(this, 'MainTable', {
      tableName: 'vyapargyan-main',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      
      timeToLiveAttribute: 'ttl'
    });
    
    // GSI1
    this.mainTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });
    
    // GSI2
    this.mainTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });
    
    // GSI3
    this.mainTable.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });
  }
}
```

**Lambda Function Stack**:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';

export class LambdaConstruct extends cdk.Construct {
  public readonly function: lambda.Function;
  
  constructor(scope: cdk.Construct, id: string, props: {
    functionName: string;
    handler: string;
    environment: { [key: string]: string };
    timeout?: cdk.Duration;
  }) {
    super(scope, id);
    
    this.function = new lambda.Function(this, 'Function', {
      functionName: props.functionName,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: props.handler,
      code: lambda.Code.fromAsset('../backend'),
      memorySize: 1024,
      timeout: props.timeout || cdk.Duration.seconds(30),
      environment: props.environment,
      
      tracing: lambda.Tracing.ACTIVE,  // X-Ray
      
      logRetention: logs.RetentionDays.ONE_MONTH,
      
      insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0
    });
  }
}
```

### Environment Strategy

**Environments**:

```yaml
Development:
  Purpose: Local development and testing
  Deployment: Manual via CDK
  Data: Synthetic test data
  Monitoring: Basic CloudWatch logs
  Cost: Minimal (free tier)

Staging:
  Purpose: Pre-production testing
  Deployment: Automated via CI/CD on merge to develop
  Data: Anonymized production data
  Monitoring: Full observability stack
  Cost: ~20% of production

Production:
  Purpose: Live customer traffic
  Deployment: Automated via CI/CD on merge to main (with approval)
  Data: Real customer data
  Monitoring: Full observability + alerting
  Cost: Optimized for scale
```

### Environment Variables

**Lambda Environment Variables**:

```typescript
const environment = {
  // Environment
  ENVIRONMENT: 'production',
  REGION: 'ap-south-1',
  
  // DynamoDB
  DYNAMODB_TABLE: mainTable.tableName,
  
  // S3
  PRODUCT_IMAGES_BUCKET: imagesBucket.bucketName,
  DOCUMENTS_BUCKET: documentsBucket.bucketName,
  
  // EventBridge
  EVENT_BUS_NAME: eventBus.eventBusName,
  
  // SQS
  OUTBOUND_QUEUE_URL: outboundQueue.queueUrl,
  
  // Secrets (ARNs only, not values)
  WHATSAPP_SECRET_ARN: whatsappSecret.secretArn,
  RAZORPAY_SECRET_ARN: razorpaySecret.secretArn,
  GEMINI_SECRET_ARN: geminiSecret.secretArn,
  
  // Feature Flags
  ENABLE_AI_FEATURES: 'true',
  ENABLE_VOICE_TRANSCRIPTION: 'true',
  
  // Logging
  LOG_LEVEL: 'INFO'
};
```

### Secret Management

**Secrets in Secrets Manager**:

```typescript
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// WhatsApp credentials
const whatsappSecret = new secretsmanager.Secret(this, 'WhatsAppSecret', {
  secretName: 'vyapargyan/whatsapp',
  description: 'WhatsApp Cloud API credentials',
  generateSecretString: {
    secretStringTemplate: JSON.stringify({
      phone_number_id: '',
      business_account_id: ''
    }),
    generateStringKey: 'access_token'
  }
});

// Razorpay credentials
const razorpaySecret = new secretsmanager.Secret(this, 'RazorpaySecret', {
  secretName: 'vyapargyan/razorpay',
  description: 'Razorpay API credentials',
  secretObjectValue: {
    key_id: cdk.SecretValue.unsafePlainText(''),  // Set manually
    key_secret: cdk.SecretValue.unsafePlainText(''),
    webhook_secret: cdk.SecretValue.unsafePlainText('')
  }
});

// Grant Lambda read access
whatsappSecret.grantRead(whatsappHandlerFunction);
razorpaySecret.grantRead(paymentHandlerFunction);
```

### S3 Bucket Strategy

**Bucket Configuration**:

```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';

// Product images bucket
const imagesBucket = new s3.Bucket(this, 'ProductImages', {
  bucketName: 'vyapargyan-product-images-prod',
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  versioned: false,
  
  lifecycleRules: [
    {
      id: 'DeleteOldVersions',
      noncurrentVersionExpiration: cdk.Duration.days(30)
    }
  ],
  
  cors: [
    {
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
      allowedOrigins: ['https://app.vyapargyan.com'],
      allowedHeaders: ['*'],
      maxAge: 3000
    }
  ]
});

// CloudFront distribution for images
const imagesCdn = new cloudfront.Distribution(this, 'ImagesCDN', {
  defaultBehavior: {
    origin: new origins.S3Origin(imagesBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED
  }
});

// Webhook payloads bucket (for audit)
const webhooksBucket = new s3.Bucket(this, 'WebhookPayloads', {
  bucketName: 'vyapargyan-webhooks-prod',
  encryption: s3.BucketEncryption.S3_MANAGED,
  
  lifecycleRules: [
    {
      id: 'ArchiveOldPayloads',
      transitions: [
        {
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: cdk.Duration.days(90)
        }
      ],
      expiration: cdk.Duration.days(365)
    }
  ]
});
```

### DynamoDB Backup Strategy

```typescript
// Point-in-time recovery (enabled in table definition)
pointInTimeRecovery: true

// Backup plan using AWS Backup
import * as backup from 'aws-cdk-lib/aws-backup';

const backupPlan = new backup.BackupPlan(this, 'BackupPlan', {
  backupPlanName: 'vyapargyan-dynamodb-backup',
  backupPlanRules: [
    new backup.BackupPlanRule({
      ruleName: 'DailyBackup',
      scheduleExpression: cdk.aws_events.Schedule.cron({
        hour: '2',
        minute: '0'
      }),
      deleteAfter: cdk.Duration.days(30),
      moveToColdStorageAfter: cdk.Duration.days(7)
    })
  ]
});

backupPlan.addSelection('DynamoDBSelection', {
  resources: [
    backup.BackupResource.fromDynamoDbTable(mainTable)
  ]
});
```

### API Custom Domain

```typescript
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

// Certificate (must be in us-east-1 for CloudFront)
const certificate = certificatemanager.Certificate.fromCertificateArn(
  this,
  'Certificate',
  'arn:aws:acm:us-east-1:account:certificate/cert-id'
);

// Custom domain
const domainName = new apigateway.DomainName(this, 'CustomDomain', {
  domainName: 'api.vyapargyan.com',
  certificate: certificate,
  endpointType: apigateway.EndpointType.EDGE,
  securityPolicy: apigateway.SecurityPolicy.TLS_1_2
});

// Map to API
domainName.addBasePathMapping(api, { basePath: 'v1' });

// Route53 record
const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
  domainName: 'vyapargyan.com'
});

new route53.ARecord(this, 'ApiAliasRecord', {
  zone: hostedZone,
  recordName: 'api',
  target: route53.RecordTarget.fromAlias(
    new targets.ApiGatewayDomain(domainName)
  )
});
```

### Monitoring and Rollback

**Deployment Monitoring**:

```typescript
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';

// Lambda deployment config with canary
const deploymentConfig = new codedeploy.LambdaDeploymentConfig(this, 'CanaryConfig', {
  deploymentConfigName: 'Canary10Percent5Minutes',
  trafficRouting: codedeploy.TimeBasedCanaryTrafficRouting.custom({
    interval: cdk.Duration.minutes(5),
    percentage: 10
  })
});

// Deployment group with alarms
const deploymentGroup = new codedeploy.LambdaDeploymentGroup(this, 'DeploymentGroup', {
  alias: functionAlias,
  deploymentConfig: deploymentConfig,
  
  alarms: [
    errorRateAlarm,
    latencyAlarm
  ],
  
  autoRollback: {
    failedDeployment: true,
    deploymentInAlarm: true
  }
});
```


## Kiro + MCP Integration

### Overview

VyaparGyan uses Kiro as the primary development environment with Model Context Protocol (MCP) servers to streamline development, operations, and internal tooling. This integration enables developers to interact with the platform's infrastructure, data, and operations directly from the IDE.

### MCP Configuration

**Workspace MCP Config** (`.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "commerce-ops": {
      "command": "node",
      "args": ["./mcp-servers/commerce-ops/index.js"],
      "env": {
        "AWS_REGION": "ap-south-1",
        "DYNAMODB_TABLE": "vyapargyan-main",
        "LOG_LEVEL": "info"
      },
      "disabled": false,
      "autoApprove": [
        "get_order",
        "get_product",
        "get_seller",
        "search_orders"
      ]
    },
    
    "commerce-catalog": {
      "command": "node",
      "args": ["./mcp-servers/commerce-catalog/index.js"],
      "env": {
        "AWS_REGION": "ap-south-1",
        "DYNAMODB_TABLE": "vyapargyan-main",
        "S3_BUCKET": "vyapargyan-product-images-prod"
      },
      "disabled": false,
      "autoApprove": [
        "list_products",
        "get_product_details",
        "check_stock"
      ]
    },
    
    "commerce-admin": {
      "command": "node",
      "args": ["./mcp-servers/commerce-admin/index.js"],
      "env": {
        "AWS_REGION": "ap-south-1",
        "DYNAMODB_TABLE": "vyapargyan-main"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### MCP Server: commerce-ops

**Purpose**: Operations and debugging tools for order management, payments, and system health.

**Tools**:

- `get_order`: Retrieve order details by ID
  - Input: `{ order_id: string }`
  - Output: Order object with items, payment status, and history

- `search_orders`: Search orders by filters
  - Input: `{ seller_id?, customer_id?, status?, date_range? }`
  - Output: List of matching orders

- `get_payment_status`: Check payment status for an order
  - Input: `{ order_id: string }`
  - Output: Payment details and transaction history

- `check_webhook_logs`: View recent webhook deliveries
  - Input: `{ webhook_type: "whatsapp" | "payment", limit?: number }`
  - Output: Recent webhook events with status

- `get_session_context`: Retrieve WhatsApp session state
  - Input: `{ session_id: string }`
  - Output: Session context, messages, and state

- `trigger_notification`: Manually send notification
  - Input: `{ type: string, recipient: string, data: object }`
  - Output: Notification delivery status

- `check_system_health`: Get system health metrics
  - Input: `{ time_range?: string }`
  - Output: Error rates, latency, throughput metrics

**Use Cases**:
- Debug order issues during development
- Investigate payment failures
- Test WhatsApp conversation flows
- Monitor system health
- Manually trigger notifications for testing

### MCP Server: commerce-catalog

**Purpose**: Product catalog management and inventory operations.

**Tools**:

- `list_products`: List products with filters
  - Input: `{ seller_id?, category_id?, limit?: number }`
  - Output: List of products with details

- `get_product_details`: Get full product information
  - Input: `{ product_id: string }`
  - Output: Product details, images, stock, pricing

- `check_stock`: Check stock availability
  - Input: `{ product_id: string, quantity: number }`
  - Output: Availability status and current stock

- `update_stock`: Update product stock quantity
  - Input: `{ product_id: string, quantity: number, operation: "set" | "increment" | "decrement" }`
  - Output: Updated stock quantity

- `get_low_stock_products`: Find products with low stock
  - Input: `{ seller_id?: string, threshold?: number }`
  - Output: List of products below threshold

- `analyze_product_performance`: Get product sales metrics
  - Input: `{ product_id: string, time_range?: string }`
  - Output: Views, orders, conversion rate, revenue

- `generate_catalog_report`: Export catalog data
  - Input: `{ seller_id: string, format: "json" | "csv" }`
  - Output: Catalog export file

**Use Cases**:
- Test product creation and updates
- Verify stock management logic
- Debug inventory issues
- Generate reports for testing
- Analyze product performance during development

### MCP Server: commerce-admin

**Purpose**: Admin operations for seller management, moderation, and analytics.

**Tools**:

- `list_pending_sellers`: Get sellers awaiting approval
  - Input: `{ limit?: number }`
  - Output: List of pending seller applications

- `approve_seller`: Approve seller application
  - Input: `{ seller_id: string, notes?: string }`
  - Output: Approval confirmation

- `reject_seller`: Reject seller application
  - Input: `{ seller_id: string, reason: string }`
  - Output: Rejection confirmation

- `suspend_seller`: Suspend seller account
  - Input: `{ seller_id: string, reason: string }`
  - Output: Suspension confirmation

- `get_platform_metrics`: Get platform-wide analytics
  - Input: `{ metric: string, time_range?: string }`
  - Output: Metric data points

- `list_disputes`: Get open disputes
  - Input: `{ status?: string, limit?: number }`
  - Output: List of disputes

- `resolve_dispute`: Mark dispute as resolved
  - Input: `{ dispute_id: string, resolution: string }`
  - Output: Resolution confirmation

- `get_audit_logs`: Retrieve audit trail
  - Input: `{ user_id?: string, action?: string, date_range?: string }`
  - Output: Audit log entries

**Use Cases**:
- Test admin workflows during development
- Simulate seller approval process
- Debug dispute resolution
- Verify audit logging
- Generate test analytics data

### Project Power

**Power Location**: `powers/commerce-platform/`

**POWER.md** (documentation):

```markdown
# VyaparGyan Commerce Platform Power

## Overview

This power provides development and operations tools for the VyaparGyan commerce platform.

## MCP Servers

### commerce-ops
Operations and debugging tools for orders, payments, and system health.

### commerce-catalog
Product catalog management and inventory operations.

### commerce-admin
Admin operations for seller management and analytics.

## Steering Files

- `getting-started.md`: Quick start guide for new developers
- `debugging-orders.md`: How to debug order and payment issues
- `testing-whatsapp.md`: Testing WhatsApp integration locally
- `deployment.md`: Deployment procedures and rollback

## Usage

Activate this power to access commerce platform tools:
```

**Steering Files** (`.kiro/steering/`):

- `getting-started.md`: Onboarding guide for new developers
- `architecture-overview.md`: High-level system architecture
- `coding-standards.md`: Code style and best practices
- `testing-strategy.md`: Unit, integration, and E2E testing approach
- `deployment-guide.md`: How to deploy to different environments
- `debugging-guide.md`: Common issues and debugging techniques
- `api-conventions.md`: API design patterns and conventions
- `database-patterns.md`: DynamoDB access patterns and best practices

### Development Workflow with Kiro

**Typical Developer Session**:

1. **Start Development**:
   ```
   Developer: "Show me recent orders for seller-123"
   Kiro: [Uses commerce-ops MCP] "Found 5 orders in the last 24 hours..."
   ```

2. **Debug Issue**:
   ```
   Developer: "Why did order-456 fail?"
   Kiro: [Uses commerce-ops MCP] "Payment webhook was not received. Last status: pending..."
   ```

3. **Test Feature**:
   ```
   Developer: "Create a test order for product-789"
   Kiro: [Uses commerce-catalog + commerce-ops] "Created test order order-999..."
   ```

4. **Check System Health**:
   ```
   Developer: "Are there any errors in the last hour?"
   Kiro: [Uses commerce-ops MCP] "Found 3 errors: 2 DynamoDB throttles, 1 timeout..."
   ```

5. **Admin Operations**:
   ```
   Developer: "Approve seller seller-555"
   Kiro: [Uses commerce-admin MCP] "Seller approved. Sending notification..."
   ```

### Benefits of Kiro + MCP Integration

**For Development**:
- Query live data without leaving IDE
- Test features with real-like data
- Debug issues faster with context-aware tools
- Prototype new features quickly

**For Operations**:
- Monitor system health from IDE
- Investigate production issues efficiently
- Manually trigger operations when needed
- Access audit logs and metrics easily

**For Testing**:
- Create test data programmatically
- Verify system behavior interactively
- Simulate edge cases and failures
- Test integrations end-to-end

**For Documentation**:
- Steering files provide context-aware guidance
- Power documentation stays with code
- Onboarding new developers is faster
- Best practices are easily accessible


## Implementation Milestones

### Phase 1: Foundation (Weeks 1-2)

**Infrastructure Setup**:
- Set up AWS account and organization
- Configure IAM roles and policies
- Deploy DynamoDB table with GSIs
- Create S3 buckets for images and documents
- Set up Secrets Manager for API keys
- Configure CloudWatch log groups
- Deploy base CDK stacks

**Authentication**:
- Create Cognito user pool
- Configure user groups (admin, seller, customer)
- Implement Lambda authorizer
- Build signup and login flows
- Add OTP verification via SMS

**API Foundation**:
- Deploy API Gateway with base configuration
- Create Lambda functions for core services
- Implement error handling middleware
- Add request validation
- Set up CORS configuration

**Deliverables**:
- Working authentication system
- Base API infrastructure
- DynamoDB tables with access patterns
- Development environment ready

### Phase 2: Seller Onboarding (Weeks 3-4)

**Seller Registration**:
- Build seller signup API
- Implement document upload to S3
- Create seller profile management
- Add business details validation

**Admin Review**:
- Build admin dashboard for seller review
- Implement approve/reject workflows
- Add document verification UI
- Create notification system for approvals

**Product Catalog**:
- Implement product CRUD APIs
- Build image upload and CDN integration
- Add category management
- Create inventory tracking

**AI Catalog Assistance**:
- Integrate Gemini Vision API
- Build image-to-product extraction
- Add auto-categorization
- Implement quality validation

**Deliverables**:
- Complete seller onboarding flow
- Admin approval system
- Product catalog management
- AI-assisted catalog creation

### Phase 3: WhatsApp Integration (Weeks 5-6)

**WhatsApp Setup**:
- Configure Meta WhatsApp Cloud API
- Implement webhook endpoint
- Add signature validation
- Build message parsing logic

**Session Management**:
- Create session state machine
- Implement context persistence
- Add session timeout handling
- Build conversation history

**Message Processing**:
- Implement intent detection
- Add voice transcription via Gemini
- Build response generation
- Create message queue for outbound

**Product Browse Flow**:
- Implement category browsing
- Add product search
- Build product detail views
- Create interactive message templates

**Deliverables**:
- Working WhatsApp integration
- Voice message support
- Product browsing via WhatsApp
- Session management system

### Phase 4: Orders and Payments (Weeks 7-8)

**Order Creation**:
- Implement order creation API
- Add stock reservation logic
- Build atomic transactions
- Create order state machine

**Payment Integration**:
- Integrate Razorpay API
- Implement payment link generation
- Add webhook handling
- Build payment verification

**Order Management**:
- Create seller order notifications
- Implement accept/reject flows
- Add order status updates
- Build cancellation and refund logic

**Concurrency Handling**:
- Implement optimistic locking
- Add idempotency checks
- Build retry mechanisms
- Create dead letter queues

**Deliverables**:
- Complete order lifecycle
- Payment processing
- Seller order management
- Robust error handling

### Phase 5: Event-Driven Workflows (Weeks 9-10)

**EventBridge Setup**:
- Configure event bus
- Create event rules
- Add event targets
- Implement event schemas

**Async Workflows**:
- Build notification service
- Implement analytics aggregation
- Add low stock alerts
- Create audit logging

**SQS Integration**:
- Set up message queues
- Implement retry logic
- Add DLQ processing
- Build batch processing

**Monitoring**:
- Create CloudWatch dashboards
- Set up alarms
- Implement X-Ray tracing
- Add custom metrics

**Deliverables**:
- Event-driven architecture
- Async notification system
- Comprehensive monitoring
- Operational dashboards

### Phase 6: Admin Dashboard (Weeks 11-12)

**Admin UI**:
- Build React admin application
- Implement seller management
- Add category management
- Create dispute resolution

**Analytics**:
- Build analytics dashboards
- Implement reporting
- Add data export
- Create metric visualizations

**Operations Tools**:
- Add system health monitoring
- Implement manual interventions
- Build audit log viewer
- Create configuration management

**Deliverables**:
- Complete admin dashboard
- Analytics and reporting
- Operations tools
- System management UI

### Phase 7: AI Enhancements (Weeks 13-14)

**Multilingual Support**:
- Implement language detection
- Add translation for responses
- Build code-switching support
- Create language preferences

**Pricing Intelligence**:
- Build trend analysis pipeline
- Implement pricing suggestions
- Add market intelligence
- Create recommendation engine

**Customer Support**:
- Implement AI-powered FAQ
- Add contextual suggestions
- Build escalation logic
- Create support analytics

**Deliverables**:
- Multilingual WhatsApp support
- AI pricing assistance
- Enhanced customer support
- Recommendation features

### Phase 8: Production Hardening (Weeks 15-16)

**Security Audit**:
- Conduct penetration testing
- Review IAM policies
- Audit encryption settings
- Validate webhook security

**Performance Optimization**:
- Optimize Lambda functions
- Tune DynamoDB capacity
- Implement caching strategies
- Reduce API latency

**Reliability**:
- Add comprehensive error handling
- Implement circuit breakers
- Build fallback mechanisms
- Create disaster recovery plan

**Operations**:
- Create runbooks
- Train support team
- Set up on-call rotation
- Build incident response process

**Launch Preparation**:
- Conduct load testing
- Implement feature flags
- Set up gradual rollout
- Create rollback procedures

**Deliverables**:
- Production-ready system
- Security hardened
- Performance optimized
- Operations ready

## Future Enhancements

### Short-Term (3-6 months)

**Enhanced Analytics**:
- Build data lake on S3
- Implement Athena queries
- Add predictive analytics
- Create custom reports

**Logistics Integration**:
- Partner with shipping providers
- Add tracking integration
- Implement label generation
- Build delivery notifications

**Seller Tools**:
- Add bulk product import
- Implement inventory forecasting
- Build promotion management
- Create customer segmentation

### Medium-Term (6-12 months)

**ONDC Integration**:
- Connect to Open Network for Digital Commerce
- Implement multi-platform inventory sync
- Add cross-platform order management
- Build unified analytics

**Advanced AI**:
- Implement demand forecasting
- Add dynamic pricing engine
- Build personalization engine
- Create chatbot improvements

**Seller Financing**:
- Partner with financial institutions
- Implement credit scoring
- Add working capital loans
- Build payment terms

### Long-Term (12+ months)

**Platform Expansion**:
- Add B2B marketplace
- Implement wholesale features
- Build supplier network
- Create franchise model

**International Expansion**:
- Add multi-currency support
- Implement regional compliance
- Build localization framework
- Create country-specific features

**Ecosystem Development**:
- Open API for third-party integrations
- Build app marketplace
- Create developer platform
- Implement plugin architecture

## Conclusion

VyaparGyan is designed as a production-grade, scalable commerce platform built on AWS serverless infrastructure. The architecture prioritizes cost-efficiency, reliability, and developer productivity while providing a complete solution for local Indian retailers.

Key architectural decisions:
- **Serverless-first**: Pay-per-use pricing with automatic scaling
- **Event-driven**: Decoupled services with async workflows
- **Single-table DynamoDB**: Optimized for access patterns and cost
- **AI-assisted**: Gemini for multimodal tasks, optional intelligence features
- **WhatsApp-native**: Primary customer channel with rich interactions
- **Security-focused**: Encryption, authentication, audit logging throughout
- **Observable**: Comprehensive monitoring, logging, and tracing
- **Developer-friendly**: Kiro + MCP integration for efficient development

The system is designed to grow from supporting hundreds of sellers to thousands, with linear cost scaling and minimal operational overhead. The modular architecture allows for incremental feature additions and easy maintenance.
