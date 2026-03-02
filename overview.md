# VyaparGyan Project Overview

**Last Updated**: March 2, 2026

## Project Vision

VyaparGyan is an AI-powered commerce platform designed for local Indian retailers (Bharat sellers). It enables sellers to manage products and orders via a web dashboard while customers browse and purchase through WhatsApp - the primary communication channel for millions of Indian users.

## Current Status: Foundation Complete, Core Features In Progress

### Overall Progress: ~60% Complete

The project has successfully transitioned from design to implementation, with foundational infrastructure and core WhatsApp orchestration complete. We're now in the middle phase of building out catalog, order, and payment features.

---

## 🎯 What We've Accomplished

### 1. Architecture & Design (100% Complete)

**Documentation Created:**
- ✅ Complete system design in `design.md`
- ✅ API contract specification (`docs/api_contract.md`)
- ✅ Authentication & RBAC design (`docs/auth_rbac.md`)
- ✅ WhatsApp orchestration architecture (`docs/whatsapp_orchestration.md`)
- ✅ Order lifecycle documentation (`docs/order_lifecycle.md`)
- ✅ Payment integration design (`docs/payment_integration.md`)
- ✅ DynamoDB schema reference (`services/api/DYNAMODB_SCHEMA.md`)
- ✅ Engineering development cards (`docs/engineering_cards.md`)
- ✅ Readiness audit (`docs/readiness_audit.md`)

**Key Decisions Made:**
- AWS Serverless architecture (Lambda + API Gateway + DynamoDB)
- Single-table DynamoDB design for operational efficiency
- Event-driven async processing (EventBridge + SQS)
- WhatsApp-first customer experience
- TypeScript/Node.js 20 for all backend code
- Amazon Cognito for authentication
- Razorpay for payments
- Google Gemini for AI features

### 2. Infrastructure as Code (80% Complete)

**CDK Stacks Implemented:**
- ✅ `auth-stack.ts` - Cognito User Pools with role-based groups
- ✅ `database-stack.ts` - DynamoDB single table with TTL
- ✅ `storage-stack.ts` - S3 buckets for media and documents
- ✅ `api-stack.ts` - API Gateway HTTP API with Lambda functions
- ✅ `events-stack.ts` - EventBridge + SQS for async processing
- ⏳ `monitoring-stack.ts` - CloudWatch alarms (pending)

**Configuration:**
- ✅ Environment configs (dev/staging/prod) in `infra/cdk/lib/config/`
- ✅ Deployment documentation (`infra/cdk/DEPLOYMENT.md`)
- ✅ CDK app structure with proper stack dependencies

**Status**: Ready for deployment after secrets configuration

### 3. WhatsApp Integration (90% Complete)

**Webhook Pipeline:**
- ✅ Webhook Lambda handler (`webhook.ts`)
  - GET verification endpoint
  - POST message receiver with signature verification
  - Fast-ack pattern (< 1 second response)
  - EventBridge event publishing
- ✅ Worker Lambda (`worker.ts`)
  - SQS event processing
  - Idempotency checking
  - Customer and session resolution
  - Message routing to state handlers
- ✅ Idempotency service (`utils/idempotency.ts`)
  - DynamoDB-based duplicate detection
  - 60-second TTL for automatic cleanup

**Session Orchestration:**
- ✅ Session state machine with 8 states
- ✅ State router (`states/router.ts`)
- ✅ Greeting handler - welcome messages with category display
- ✅ Browsing handler - catalog browsing, product search, intent detection
- ⏳ Checkout handler - placeholder for cart and payment
- ⏳ Order tracking handler - pending
- ⏳ Support handler - pending

**Message Capabilities:**
- ✅ Text messages
- ✅ Interactive button messages (≤3 buttons)
- ✅ Interactive list messages (>3 items)
- ✅ Message persistence with 30-day TTL
- ⏳ Image messages - pending
- ⏳ Voice transcription - pending
- ⏳ Template messages - pending

**Test Coverage:**
- ✅ Unit tests for webhook handler
- ✅ Unit tests for idempotency service
- ✅ Integration test plan documented
- ✅ All TypeScript compilation passes (0 errors)

### 4. Data Layer (70% Complete)

**Repositories Implemented:**
- ✅ `customer-repository.ts` - Customer CRUD with phone lookup
- ✅ `session-repository.ts` - WhatsApp session management
- ✅ `message-repository.ts` - Message persistence with TTL
- ✅ `catalog-repository.ts` - Read-only catalog access
- ⏳ Order repository - pending
- ⏳ Payment repository - pending
- ⏳ Seller repository - pending

**DynamoDB Schema:**
- ✅ Sessions: `PK: SESSION#{customerId}, SK: WHATSAPP#{phoneNumber}`
- ✅ Messages: `PK: SESSION#{sessionId}, SK: MESSAGE#{timestamp}#{waMessageId}`
- ✅ Customers: `PK: CUSTOMER#{phoneNumber}, SK: PROFILE`
- ✅ Categories: `PK: CATEGORY, SK: CATEGORY#{categoryId}`
- ✅ Products: `PK: PRODUCT#{productId}, SK: METADATA`
- ✅ Idempotency: `PK: IDEMPOTENCY#{messageId}, SK: LOCK`
- ⏳ Orders - schema defined, not implemented
- ⏳ Payments - schema defined, not implemented

**GSI Indexes:**
- ✅ PhoneIndex - session lookup by phone number
- ✅ CategoryIndex - products by category
- ⏳ SellerOrdersIndex - pending
- ⏳ CustomerOrdersIndex - pending
- ⏳ PaymentLinkIndex - pending

### 5. Services & Business Logic (40% Complete)

**Implemented:**
- ✅ `whatsapp-sender.ts` - Outbound message sending with retry logic
- ✅ Intent detection for browsing (deterministic, no LLM)
- ✅ Category browsing flow
- ✅ Product search flow
- ✅ Product details display

**Pending:**
- ⏳ Cart management
- ⏳ Order creation service
- ⏳ Payment link generation
- ⏳ Inventory reservation
- ⏳ Notification service
- ⏳ Address collection flow

### 6. Utilities & Core (90% Complete)

**Implemented:**
- ✅ Structured JSON logger (`utils/logger.ts`)
- ✅ Configuration management (`utils/config.ts`)
- ✅ Request context propagation with AsyncLocalStorage
- ✅ Error handling utilities
- ✅ Idempotency utilities
- ⏳ Auth middleware - pending
- ⏳ RBAC middleware - pending

### 7. Developer Tools (100% Complete)

**MCP Servers:**
- ✅ `commerce-ops-mcp` - 7 tools for orders, payments, inventory, sessions, logs
- ✅ `commerce-catalog-mcp` - 6 tools for products, categories, stock
- ✅ `commerce-admin-mcp` - 6 tools for seller approvals, disputes, audit logs
- ✅ Shared utilities for AWS clients and error handling
- ✅ Installation script (`install-all.sh`)
- ✅ Kiro Power definition (`powers/commerce-platform/`)

**Configuration:**
- ✅ MCP servers configured in `.kiro/settings/mcp.json`
- ✅ All tools are read-only and safe to auto-approve
- ✅ Documentation for each server

### 8. AI Integration (10% Complete)

**Bedrock Integration:**
- ✅ OpenAPI 3.0.3 schema for catalog endpoints (`docs/bedrock-catalog-action-group.json`)
- ✅ Bedrock action group executor handler (`handlers/bedrock/action-group-executor.ts`)
  - Routes catalog API calls from Bedrock Agent
  - Supports GET /catalog/categories
  - Supports GET /catalog/categories/{categoryId}/products
  - Supports GET /catalog/products/search
  - Returns responses in Bedrock-required format

**Pending:**
- ⏳ Gemini voice transcription
- ⏳ Gemini image analysis
- ⏳ Gemini multilingual support
- ⏳ Bedrock Agent deployment and testing

### 9. Testing (40% Complete)

**Completed:**
- ✅ Unit tests for webhook handler
- ✅ Unit tests for idempotency service
- ✅ TypeScript compilation validation (0 errors across all files)
- ✅ Integration test plan documented

**Pending:**
- ⏳ Repository unit tests
- ⏳ State handler unit tests
- ⏳ End-to-end integration tests
- ⏳ Load testing
- ⏳ Security testing

---

## 📋 What's Left to Build

### Phase 1: Cart & Order Creation (Next Priority)

**Estimated: 2-3 weeks**

1. **Cart Management**
   - Add "add to cart" intent detection in browsing handler
   - Store cart items in `session.context.cart`
   - Implement cart summary display
   - Handle quantity updates and item removal

2. **Order Creation**
   - Create OrderRepository with DynamoDB operations
   - Implement order creation handler
   - Generate order numbers (VG-YYYYMMDD-NNNN format)
   - Calculate totals (subtotal, tax, shipping)
   - Reserve inventory using TransactWriteItems
   - Publish OrderCreated event to EventBridge

3. **Address Collection**
   - Multi-step conversation flow for shipping address
   - Store in `session.context.shipping_draft`
   - Validate pincode and address format
   - Confirm address before order creation

### Phase 2: Payment Integration (3-4 weeks)

1. **Razorpay Setup**
   - Create Razorpay business account
   - Complete KYC verification
   - Generate API credentials
   - Store in AWS Secrets Manager

2. **Payment Link Generation**
   - Create PaymentRepository
   - Implement payment link creation handler
   - Store payment metadata in DynamoDB
   - Send payment link via WhatsApp

3. **Payment Webhook**
   - Implement Razorpay webhook handler
   - Verify webhook signatures
   - Handle payment events (paid, failed, refunded)
   - Update order status atomically
   - Publish PaymentCaptured event

4. **Order Confirmation**
   - Finalize inventory (unreserve → sold)
   - Send order confirmation to customer
   - Notify seller of new order

### Phase 3: Seller & Admin Features (4-5 weeks)

1. **Seller APIs**
   - Product CRUD endpoints
   - Inventory management
   - Order management (accept/reject/update status)
   - Dashboard analytics
   - Profile management
   - Document upload for KYC

2. **Admin APIs**
   - Seller approval workflow
   - Category management
   - Dispute resolution
   - Platform analytics
   - Payment monitoring

3. **Authentication & Authorization**
   - Implement auth middleware
   - Implement RBAC guards
   - Cognito User Pool integration
   - JWT token validation
   - Role-based access control

### Phase 4: Notifications & Tracking (2-3 weeks)

1. **Notification Service**
   - EventBridge rules for notification triggers
   - WhatsApp template messages
   - In-app notifications
   - Email notifications (optional)

2. **Order Tracking**
   - Implement tracking state handler
   - Show order status updates
   - Handle seller status changes
   - Delivery confirmation

### Phase 5: Production Hardening (3-4 weeks)

1. **Observability**
   - CloudWatch alarms for errors, latency, throttling
   - X-Ray tracing for all Lambda functions
   - Custom metrics for business KPIs
   - CloudWatch dashboard

2. **Error Handling**
   - DLQ monitoring and alerts
   - Retry policies for failed messages
   - Circuit breakers for external APIs
   - Graceful degradation

3. **Security**
   - Tighten IAM policies (least privilege)
   - Enable encryption at rest and in transit
   - Implement rate limiting
   - Security audit and penetration testing

4. **Performance**
   - Lambda memory optimization
   - DynamoDB capacity planning
   - API Gateway caching
   - Connection pooling

5. **CI/CD**
   - GitHub Actions or CodePipeline
   - Automated testing
   - Automated deployment to dev/staging
   - Manual approval for production
   - Rollback mechanism

### Phase 6: AI Features (2-3 weeks)

1. **Voice Transcription**
   - Integrate Google Gemini API
   - Handle voice messages from WhatsApp
   - Transcribe to text
   - Process as text intent

2. **Image Analysis**
   - Analyze product images from customers
   - Extract product attributes
   - Assist with catalog search

3. **Multilingual Support**
   - Detect customer language
   - Translate messages
   - Respond in customer's language

4. **Bedrock Agent**
   - Deploy Bedrock Agent with catalog action group
   - Test conversational product search
   - Integrate with WhatsApp flow

---

## 📊 Progress by Component

| Component | Progress | Status |
|-----------|----------|--------|
| Architecture & Design | 100% | ✅ Complete |
| Infrastructure (CDK) | 80% | 🟡 In Progress |
| WhatsApp Integration | 90% | 🟡 Nearly Complete |
| Data Layer | 70% | 🟡 In Progress |
| Business Logic | 40% | 🟡 In Progress |
| Utilities & Core | 90% | 🟡 Nearly Complete |
| Developer Tools (MCP) | 100% | ✅ Complete |
| AI Integration | 10% | 🔴 Early Stage |
| Testing | 40% | 🟡 In Progress |
| Authentication | 20% | 🔴 Early Stage |
| Seller Features | 10% | 🔴 Early Stage |
| Admin Features | 10% | 🔴 Early Stage |
| Payments | 5% | 🔴 Early Stage |
| Notifications | 0% | ⚪ Not Started |
| Observability | 30% | 🔴 Early Stage |
| CI/CD | 0% | ⚪ Not Started |

**Overall Project Progress: ~60%**

---

## 🚀 Deployment Readiness

### Ready to Deploy (Dev Environment)

✅ **Can Deploy Now:**
- DynamoDB tables
- S3 buckets
- Cognito User Pools
- API Gateway with WhatsApp webhook
- EventBridge + SQS pipeline
- WhatsApp session orchestration

⚠️ **Requires Configuration:**
- AWS Secrets Manager secrets (WhatsApp, Razorpay, Gemini)
- SSM parameters (phone number IDs, etc.)
- Meta WhatsApp Business account setup
- Webhook URL configuration in Meta dashboard

🔴 **Not Ready:**
- Production deployment (needs hardening)
- Custom domain setup
- SSL certificates
- CloudWatch alarms
- CI/CD pipeline

### Estimated Timeline to Production

- **Phase 1 (Cart & Orders)**: 2-3 weeks
- **Phase 2 (Payments)**: 3-4 weeks
- **Phase 3 (Seller/Admin)**: 4-5 weeks
- **Phase 4 (Notifications)**: 2-3 weeks
- **Phase 5 (Hardening)**: 3-4 weeks
- **Phase 6 (AI Features)**: 2-3 weeks

**Total Estimated Time to Production: 16-22 weeks (4-5.5 months)**

---

## 💰 Current Cost Estimate (Dev Environment)

**Monthly AWS Costs (Low Traffic):**
- DynamoDB (on-demand): $5-10
- Lambda (1M requests): $2-5
- API Gateway: $3-5
- S3 Storage (10GB): $0.23
- CloudWatch Logs: $2-5
- EventBridge + SQS: $1-3
- Secrets Manager: $0.40
- **Total: ~$15-30/month**

**External Services:**
- Razorpay: Transaction fees (2% + ₹3 per transaction)
- WhatsApp Business API: Free for first 1,000 conversations/month
- Google Gemini: Pay-per-use (varies by model)

---

## 📁 Repository Structure

```
├── .kiro/                      # Kiro IDE configuration
│   ├── settings/               # MCP server configs
│   ├── specs/                  # Feature specifications
│   └── steering/               # Project guidelines
├── docs/                       # Architecture documentation
│   ├── api_contract.md
│   ├── auth_rbac.md
│   ├── whatsapp_orchestration.md
│   ├── order_lifecycle.md
│   ├── payment_integration.md
│   ├── engineering_cards.md
│   ├── readiness_audit.md
│   └── bedrock-catalog-action-group.json
├── infra/cdk/                  # AWS CDK infrastructure
│   ├── lib/
│   │   ├── config/             # Environment configs
│   │   └── stacks/             # CDK stack definitions
│   └── DEPLOYMENT.md
├── services/api/               # Lambda handlers & business logic
│   ├── src/
│   │   ├── handlers/           # Lambda function handlers
│   │   │   ├── whatsapp/       # WhatsApp webhook & worker
│   │   │   └── bedrock/        # Bedrock action group executor
│   │   ├── repositories/       # Data access layer
│   │   ├── services/           # Business logic
│   │   └── utils/              # Shared utilities
│   ├── DYNAMODB_SCHEMA.md
│   └── TEST_RESULTS.md
├── tools/mcp/                  # MCP servers for developer tools
│   ├── commerce-ops/           # Operations data access
│   ├── commerce-catalog/       # Catalog data access
│   ├── commerce-admin/         # Admin data access
│   └── IMPLEMENTATION_SUMMARY.md
├── powers/                     # Kiro Power definitions
│   └── commerce-platform/
├── design.md                   # System design document
├── overview.md                 # This file
└── README.md                   # Project README
```

---

## 🎯 Key Achievements

1. **Solid Foundation**: Complete architecture design with clear separation of concerns
2. **WhatsApp Integration**: End-to-end message flow from webhook to response
3. **Event-Driven**: Async processing with EventBridge + SQS for scalability
4. **Type Safety**: Full TypeScript implementation with 0 compilation errors
5. **Developer Experience**: MCP servers provide read-only access to all platform data
6. **AI-Ready**: Bedrock integration prepared for conversational commerce
7. **Production-Oriented**: Structured logging, idempotency, error handling from day one
8. **Infrastructure as Code**: Reproducible deployments across environments

---

## 🔧 Technology Stack

**Backend:**
- TypeScript 5.x
- Node.js 20 (AWS Lambda)
- AWS SDK v3
- Zod (validation)

**Infrastructure:**
- AWS CDK (TypeScript)
- Amazon API Gateway (HTTP API)
- AWS Lambda
- Amazon DynamoDB
- Amazon S3
- Amazon Cognito
- Amazon EventBridge
- Amazon SQS
- AWS Secrets Manager
- Amazon CloudWatch

**External Services:**
- Meta WhatsApp Cloud API
- Razorpay Payment Gateway
- Google Gemini AI
- Amazon Bedrock

**Developer Tools:**
- Kiro IDE
- MCP (Model Context Protocol)
- pnpm (package manager)
- Jest (testing)

---

## 📞 Next Immediate Steps

1. **Deploy to Dev Environment**
   - Run `cdk bootstrap` in AWS account
   - Configure secrets in Secrets Manager
   - Deploy all CDK stacks
   - Test WhatsApp webhook with real messages

2. **Complete Cart Management**
   - Implement "add to cart" intent
   - Build cart summary display
   - Test cart operations

3. **Build Order Creation**
   - Implement OrderRepository
   - Build order creation flow
   - Test inventory reservation

4. **Integrate Razorpay**
   - Set up Razorpay account
   - Implement payment link generation
   - Build payment webhook handler
   - Test end-to-end payment flow

---

## 📝 Summary

VyaparGyan has made significant progress with a solid foundation in place. The WhatsApp integration is nearly complete, infrastructure is defined and ready to deploy, and developer tools are fully operational. The next phase focuses on completing the core commerce features: cart management, order creation, and payment integration. With an estimated 4-5.5 months to production, the project is on track to deliver a production-ready platform for Bharat sellers.

**Current Focus**: Cart management and order creation  
**Next Milestone**: End-to-end order flow with payment integration  
**Target**: Production-ready platform by Q3 2026
