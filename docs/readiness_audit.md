# AWS Serverless Readiness Audit

## Current Implementation Status

**Target Architecture**: AWS Serverless (Lambda + API Gateway + DynamoDB + Cognito + S3 + EventBridge + SQS)

## A. AWS Account & Bootstrap Readiness

### AWS Account Setup

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| AWS Account                | ✅ Ready | Account ID configured                                         |
| CDK Bootstrap              | ⚠️ Pending | Run `cdk bootstrap` in target regions                         |
| IAM Permissions            | ⚠️ Pending | Admin/PowerUser access needed for CDK deployment              |
| AWS CLI Configuration      | ✅ Ready | Credentials configured locally                                |
| AWS Regions                | ⚠️ Pending | Choose primary region (ap-south-1 recommended for India)      |
| Cost Budgets               | ⚠️ Pending | Set up billing alerts and budgets                             |

**Blockers**:
- CDK bootstrap required before first deployment
- IAM permissions need verification

**Recommended Actions**:
1. Run `cdk bootstrap aws://ACCOUNT-ID/ap-south-1`
2. Verify IAM user/role has sufficient permissions
3. Set up AWS Budgets with alerts at $50, $100, $200

---

## B. Cognito Readiness

### User Pool Configuration

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| User Pool                  | ⚠️ Pending | Define in `infra/cdk/lib/stacks/auth-stack.ts`                |
| User Groups                | ⚠️ Pending | Create admin, seller, customer groups                         |
| Custom Attributes          | ⚠️ Pending | seller_id, customer_id, display_name                          |
| Password Policy            | ⚠️ Pending | Min 8 chars, complexity requirements                          |
| MFA Configuration          | ⚠️ Pending | Optional MFA for admin users                                  |
| Email/SMS Configuration    | ⚠️ Pending | Configure SES or SNS for auth emails/SMS                      |
| JWT Configuration          | ⚠️ Pending | Token expiration (1 hour access, 30 days refresh)             |

**Blockers**:
- User pool not yet created
- Email/SMS provider not configured

**Recommended Actions**:
1. Create Cognito User Pool via CDK
2. Configure SES for email delivery (verify domain)
3. Set up SNS for SMS (if phone auth needed)
4. Create initial admin user manually

---

## C. DynamoDB Readiness

### Table Design

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| Single Table Design        | ⚠️ Pending | Define PK/SK patterns for all entities                        |
| Main Table                 | ⚠️ Pending | Create in `infra/cdk/lib/stacks/database-stack.ts`            |
| GSI: PhoneIndex            | ⚠️ Pending | For WhatsApp session lookup by phone                          |
| GSI: SellerOrdersIndex     | ⚠️ Pending | For seller's orders query                                     |
| GSI: CustomerOrdersIndex   | ⚠️ Pending | For customer's orders query                                   |
| GSI: StatusIndex           | ⚠️ Pending | For orders by status query                                    |
| GSI: PaymentLinkIndex      | ⚠️ Pending | For payment lookup by payment_link_id                         |
| GSI: IdempotencyIndex      | ⚠️ Pending | For payment idempotency key lookup                            |
| TTL Configuration          | ⚠️ Pending | Enable TTL on expires_at attribute                            |
| Capacity Mode              | ⚠️ Pending | Choose on-demand or provisioned (recommend on-demand for dev) |
| Backup Configuration       | ⚠️ Pending | Enable point-in-time recovery for production                  |

**Blockers**:
- Table schema not finalized
- GSI access patterns need validation

**Recommended Actions**:
1. Finalize single-table design with all PK/SK patterns
2. Create table with all GSIs via CDK
3. Enable TTL on expires_at attribute
4. Use on-demand capacity for dev/staging
5. Enable point-in-time recovery for production

---

## D. S3 Bucket Readiness

### Storage Buckets

| Bucket                     | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| product-images             | ⚠️ Pending | Public read, presigned write                                  |
| seller-documents           | ⚠️ Pending | Private, presigned read/write                                 |
| raw-webhook-events         | ⚠️ Pending | Private, lifecycle policy (archive after 90 days)             |
| CORS Configuration         | ⚠️ Pending | Allow uploads from web dashboard domains                      |
| Lifecycle Policies         | ⚠️ Pending | Archive old webhooks to Glacier                               |
| Versioning                 | ⚠️ Pending | Enable for seller-documents (compliance)                      |
| Encryption                 | ⚠️ Pending | Enable SSE-S3 or SSE-KMS                                      |

**Blockers**:
- Buckets not created
- CORS and lifecycle policies not configured

**Recommended Actions**:
1. Create buckets via CDK in `infra/cdk/lib/stacks/storage-stack.ts`
2. Configure CORS for web dashboard domains
3. Set up lifecycle policies for webhook archive
4. Enable versioning for seller-documents
5. Enable default encryption (SSE-S3)

---

## E. API Gateway Readiness

### HTTP API Configuration

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| HTTP API                   | ⚠️ Pending | Create in `infra/cdk/lib/stacks/api-stack.ts`                 |
| JWT Authorizer             | ⚠️ Pending | Configure with Cognito User Pool                              |
| Custom Domain              | ⚠️ Pending | api.vyapargyan.com (requires Route53 + ACM certificate)       |
| CORS Configuration         | ⚠️ Pending | Allow admin/seller dashboard origins                          |
| Throttling                 | ⚠️ Pending | Set rate limits (1000 req/min authenticated)                  |
| Usage Plans                | ⚠️ Pending | Different limits for anonymous vs authenticated               |
| Access Logging             | ⚠️ Pending | Enable CloudWatch access logs                                 |

**Blockers**:
- API Gateway not created
- Custom domain requires DNS and SSL certificate

**Recommended Actions**:
1. Create HTTP API via CDK
2. Configure JWT authorizer with Cognito
3. Set up custom domain (requires ACM certificate in us-east-1)
4. Configure CORS for web dashboard domains
5. Enable access logging to CloudWatch
6. Set up throttling and usage plans

---

## F. Lambda Readiness

### Lambda Configuration

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| Node.js 20 Runtime         | ✅ Ready | Latest LTS runtime                                            |
| Lambda Layer               | ⚠️ Pending | Shared dependencies (AWS SDK v3, logging)                     |
| Handler Functions          | ⚠️ Pending | Create in `services/api/src/handlers/`                        |
| Environment Variables      | ⚠️ Pending | TABLE_NAME, BUCKET_NAMES, etc.                                |
| IAM Execution Roles        | ⚠️ Pending | Least-privilege policies per function                         |
| Memory Configuration       | ⚠️ Pending | Start with 512MB, tune based on metrics                       |
| Timeout Configuration      | ⚠️ Pending | 30s for API handlers, 5min for async processors              |
| Reserved Concurrency       | ⚠️ Pending | Set for critical functions (payment processing)               |
| X-Ray Tracing              | ⚠️ Pending | Enable active tracing for all functions                       |

**Blockers**:
- Lambda functions not yet created
- IAM policies need definition

**Recommended Actions**:
1. Create Lambda layer with shared dependencies
2. Implement handler functions in TypeScript
3. Configure environment variables via CDK
4. Define least-privilege IAM policies per function
5. Enable X-Ray tracing for all functions
6. Set appropriate memory and timeout values

---

## G. EventBridge & SQS Readiness

### Async Processing

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| EventBridge Bus            | ⚠️ Pending | Default bus or custom bus                                     |
| Event Rules                | ⚠️ Pending | OrderCreated, PaymentCaptured, etc.                           |
| SQS Queues                 | ⚠️ Pending | WhatsApp processing, notifications, etc.                      |
| Dead Letter Queues         | ⚠️ Pending | DLQ for each processing queue                                 |
| Retry Configuration        | ⚠️ Pending | Max 2 retries before DLQ                                      |
| Scheduled Rules            | ⚠️ Pending | Session cleanup (daily), stale order cleanup                  |
| Event Archive              | ⚠️ Pending | Optional: archive all events for replay                       |

**Blockers**:
- EventBridge rules not defined
- SQS queues not created

**Recommended Actions**:
1. Define event schemas in shared contracts
2. Create EventBridge rules for each event type
3. Create SQS queues with DLQs
4. Configure retry policies (2 retries, exponential backoff)
5. Set up scheduled rules for cleanup jobs
6. Consider event archive for production

---

## H. CloudWatch Readiness

### Observability

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| Log Groups                 | ⚠️ Pending | Auto-created by Lambda, configure retention                   |
| Structured Logging         | ⚠️ Pending | Implement in `services/api/src/utils/logger.ts`               |
| Metrics                    | ⚠️ Pending | Custom metrics for business KPIs                              |
| Alarms                     | ⚠️ Pending | Error rate, latency, DLQ depth, etc.                          |
| Dashboard                  | ⚠️ Pending | Create unified dashboard for key metrics                      |
| Log Insights Queries       | ⚠️ Pending | Saved queries for common investigations                       |
| SNS Topics                 | ⚠️ Pending | Alarm notifications to email/Slack                            |

**Blockers**:
- Logging infrastructure not implemented
- Alarms not configured

**Recommended Actions**:
1. Implement structured JSON logging with request IDs
2. Set log retention to 30 days (dev), 90 days (prod)
3. Create CloudWatch alarms for critical metrics
4. Set up SNS topic for alarm notifications
5. Create CloudWatch dashboard with key metrics
6. Save common Log Insights queries

---

## I. Secrets Manager Readiness

### Secrets Configuration

| Secret                     | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| Razorpay API Key           | ⚠️ Pending | Store key_id and key_secret                                   |
| Razorpay Webhook Secret    | ⚠️ Pending | For webhook signature verification                            |
| WhatsApp Access Token      | ⚠️ Pending | Meta WhatsApp Business API token                              |
| WhatsApp App Secret        | ⚠️ Pending | For webhook signature verification                            |
| WhatsApp Phone Number ID   | ⚠️ Pending | Business phone number ID                                      |
| WhatsApp Verify Token      | ⚠️ Pending | For webhook verification endpoint                             |
| Rotation Configuration     | ⚠️ Pending | Set up automatic rotation where possible                      |

**Blockers**:
- Secrets not stored in Secrets Manager
- Razorpay and WhatsApp accounts need setup

**Recommended Actions**:
1. Create Razorpay account and get API credentials
2. Set up Meta WhatsApp Business API and get credentials
3. Store all secrets in AWS Secrets Manager
4. Configure Lambda to retrieve secrets at cold start
5. Set up secret rotation policies

---

## J. Razorpay Readiness

### Payment Gateway

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| Razorpay Account           | ⚠️ Pending | Create business account                                       |
| API Keys                   | ⚠️ Pending | Generate test and live keys                                   |
| Webhook Configuration      | ⚠️ Pending | Point to API Gateway webhook endpoint                         |
| Webhook Secret             | ⚠️ Pending | Store in Secrets Manager                                      |
| Payment Link Settings      | ⚠️ Pending | Configure branding, callback URLs                             |
| Settlement Account         | ⚠️ Pending | Link bank account for settlements                             |
| KYC Verification           | ⚠️ Pending | Complete business KYC                                         |

**Blockers**:
- Razorpay account not created
- KYC not completed

**Recommended Actions**:
1. Create Razorpay business account
2. Complete KYC verification
3. Generate test API keys for development
4. Configure webhook endpoint (after API Gateway deployed)
5. Store credentials in Secrets Manager
6. Test payment flow in test mode

---

## K. Meta WhatsApp Readiness

### WhatsApp Business API

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| Meta Business Account      | ⚠️ Pending | Create at business.facebook.com                               |
| WhatsApp Business App      | ⚠️ Pending | Create app in Meta Developer Portal                           |
| Phone Number               | ⚠️ Pending | Register business phone number                                |
| Webhook Configuration      | ⚠️ Pending | Point to API Gateway webhook endpoint                         |
| Verify Token               | ⚠️ Pending | Generate and store in Secrets Manager                         |
| Access Token               | ⚠️ Pending | Generate permanent token, store in Secrets Manager            |
| Message Templates          | ⚠️ Pending | Create and get approved (welcome, order confirmation, etc.)   |
| Business Verification      | ⚠️ Pending | Complete Meta business verification                           |

**Blockers**:
- Meta Business Account not created
- Phone number not registered
- Message templates not approved

**Recommended Actions**:
1. Create Meta Business Account
2. Create WhatsApp Business App in Meta Developer Portal
3. Register and verify business phone number
4. Configure webhook endpoint (after API Gateway deployed)
5. Create message templates and submit for approval
6. Generate permanent access token
7. Store all credentials in Secrets Manager

---

## L. MCP Tooling Readiness

### Local Development Tools

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| commerce-ops-mcp           | ✅ Ready | Read-only access to orders, payments, inventory               |
| commerce-catalog-mcp       | ✅ Ready | Read-only access to products, categories                      |
| commerce-admin-mcp         | ✅ Ready | Read-only access to seller approvals, disputes                |
| AWS Credentials            | ⚠️ Pending | Configure profile `kiro-mcp` with DynamoDB read permissions   |
| DynamoDB Access            | ⚠️ Pending | Grant read-only access to main table                          |
| CloudWatch Logs Access     | ⚠️ Pending | Grant read access for log search                              |

**Blockers**:
- AWS credentials not configured for MCP servers
- DynamoDB table not yet created

**Recommended Actions**:
1. Create IAM user/role for MCP servers with read-only DynamoDB access
2. Configure AWS profile `kiro-mcp` locally
3. Update MCP server configs with table name and region
4. Test MCP servers after DynamoDB table created

---

## M. CDK Deployment Readiness

### Infrastructure as Code

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| CDK App Structure          | ✅ Ready | Defined in `infra/cdk/`                                       |
| Environment Configs        | ✅ Ready | dev, staging, prod configs                                    |
| Stack Definitions          | ⚠️ Pending | Complete all stacks (auth, database, storage, api, etc.)      |
| CDK Context                | ⚠️ Pending | Create `cdk.context.json` from example                        |
| Deployment Scripts         | ⚠️ Pending | Add npm scripts for deploy/diff/destroy                       |
| Stack Dependencies         | ⚠️ Pending | Define proper stack dependencies                              |
| Output Exports             | ⚠️ Pending | Export values for cross-stack references                      |

**Blockers**:
- Stack definitions incomplete
- CDK context not configured

**Recommended Actions**:
1. Complete all CDK stack definitions
2. Create `cdk.context.json` with environment-specific values
3. Add deployment scripts to package.json
4. Test `cdk synth` and `cdk diff`
5. Deploy to dev environment first

---

## N. CI/CD Readiness

### Deployment Pipeline

| Component                  | Status | Notes                                                         |
| -------------------------- | ------ | ------------------------------------------------------------- |
| GitHub Actions Workflow    | ⚠️ Pending | Or AWS CodePipeline                                           |
| Build Stage                | ⚠️ Pending | TypeScript compilation, bundling                              |
| Test Stage                 | ⚠️ Pending | Unit tests, integration tests                                 |
| Deploy Stage               | ⚠️ Pending | CDK deploy to dev/staging/prod                                |
| Rollback Mechanism         | ⚠️ Pending | Automated rollback on deployment failure                      |
| Environment Promotion      | ⚠️ Pending | Manual approval for prod deployment                           |

**Blockers**:
- CI/CD pipeline not configured
- Test suite not implemented

**Recommended Actions**:
1. Create GitHub Actions workflow or CodePipeline
2. Implement basic unit tests
3. Set up automated deployment to dev on merge
4. Require manual approval for staging/prod
5. Implement rollback mechanism

---

## Summary: Critical Blockers

### Must Complete Before Development

1. **AWS Account Bootstrap**: Run `cdk bootstrap` in target region
2. **Cognito User Pool**: Create and configure user pool with groups
3. **DynamoDB Table**: Finalize schema and create table with GSIs
4. **S3 Buckets**: Create buckets for images, documents, webhooks
5. **Secrets Manager**: Store Razorpay and WhatsApp credentials
6. **API Gateway**: Create HTTP API with JWT authorizer

### Must Complete Before Production

1. **Razorpay Account**: Complete KYC and get live API keys
2. **WhatsApp Business**: Complete verification and get message templates approved
3. **Custom Domain**: Set up DNS and SSL certificate
4. **CloudWatch Alarms**: Configure alarms for critical metrics
5. **Backup & Recovery**: Enable DynamoDB point-in-time recovery
6. **CI/CD Pipeline**: Automated deployment with rollback

### Estimated Timeline

- **Phase 1 - Foundation** (Week 1): AWS setup, CDK stacks, basic infrastructure
- **Phase 2 - Core APIs** (Week 2): Auth, catalog, products, inventory
- **Phase 3 - Orders & Payments** (Week 3): Order flow, Razorpay integration
- **Phase 4 - WhatsApp** (Week 4): Webhook processing, session engine
- **Phase 5 - Hardening** (Week 5): Monitoring, alarms, CI/CD
- **Phase 6 - Production** (Week 6): Load testing, security audit, go-live

### Next Immediate Steps

1. Run `cdk bootstrap` in ap-south-1 region
2. Create Cognito User Pool via CDK
3. Finalize DynamoDB single-table schema
4. Create S3 buckets via CDK
5. Set up Razorpay test account
6. Set up Meta WhatsApp Business test account
7. Deploy first Lambda function (health check)
8. Test end-to-end: API Gateway → Lambda → DynamoDB
