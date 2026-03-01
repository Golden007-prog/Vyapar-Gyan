# AWS Serverless Implementation Sequence

## Sprint 1 (Days 1–3): Foundation + Infrastructure

| #   | Task                                        | Est | Output                                                                 |
| --- | ------------------------------------------- | --- | ---------------------------------------------------------------------- |
| 1   | Repository scaffold + workspace setup       | 2h  | Root package.json, pnpm-workspace.yaml, tsconfig.json                  |
| 2   | CDK app initialization                      | 2h  | `infra/cdk/bin/app.ts`, `infra/cdk/cdk.json`                           |
| 3   | Environment configuration                   | 1h  | `infra/cdk/lib/config/` (dev/staging/prod)                             |
| 4   | Cognito User Pool + Groups                  | 2h  | `infra/cdk/lib/stacks/auth-stack.ts` (admin/seller/customer groups)    |
| 5   | DynamoDB tables design                      | 3h  | `infra/cdk/lib/stacks/database-stack.ts` (all tables with GSIs)        |
| 6   | S3 buckets for storage                      | 1h  | `infra/cdk/lib/stacks/storage-stack.ts` (documents, media, raw-events) |
| 7   | API Gateway HTTP API                        | 1h  | `infra/cdk/lib/stacks/api-stack.ts` (base setup)                       |
| 8   | Lambda shared layer                         | 2h  | Shared utilities, AWS SDK v3 clients, logging                          |
| 9   | Structured logging + env validation         | 2h  | `services/api/src/utils/logger.ts`, `config.ts`                        |
| 10  | Health check Lambda + endpoint              | 1h  | `services/api/src/handlers/health.ts`, `/health` route                 |
| 11  | Shared contracts package                    | 2h  | `packages/shared/contracts/` (types, enums, interfaces)                |

## Sprint 2 (Days 4–6): Auth + RBAC

| #   | Task                                   | Est | Output                                                                |
| --- | -------------------------------------- | --- | --------------------------------------------------------------------- |
| 12  | Cognito JWT authorizer                 | 2h  | API Gateway authorizer configuration                                  |
| 13  | Auth middleware for Lambda             | 3h  | `services/api/src/middleware/auth.ts` (JWT validation, claims)        |
| 14  | RBAC guards                            | 2h  | `services/api/src/middleware/rbac.ts` (role/ownership checks)         |
| 15  | User profile DynamoDB adapter          | 2h  | `services/api/src/adapters/user-profile-adapter.ts`                   |
| 16  | Auth endpoints (login/refresh/me)      | 3h  | `services/api/src/handlers/auth/` (Cognito integration)               |
| 17  | Error handling middleware              | 2h  | `services/api/src/middleware/error-handler.ts`                        |
| 18  | API response formatter                 | 1h  | `services/api/src/utils/response.ts` (consistent envelope)            |

## Sprint 3 (Days 7–9): Seller Onboarding + Catalog

| #   | Task                                   | Est | Output                                                                |
| --- | -------------------------------------- | --- | --------------------------------------------------------------------- |
| 19  | Seller profile APIs                    | 3h  | `services/api/src/handlers/seller/profile.ts` (CRUD)                  |
| 20  | Document upload to S3                  | 2h  | `services/api/src/handlers/seller/upload-document.ts` (presigned URL) |
| 21  | Seller DynamoDB adapter                | 2h  | `services/api/src/adapters/seller-adapter.ts`                         |
| 22  | Category CRUD (admin)                  | 2h  | `services/api/src/handlers/admin/categories.ts`                       |
| 23  | Category DynamoDB adapter              | 2h  | `services/api/src/adapters/category-adapter.ts`                       |
| 24  | Product CRUD (seller)                  | 4h  | `services/api/src/handlers/seller/products.ts`                        |
| 25  | Product image upload to S3             | 2h  | `services/api/src/handlers/seller/upload-product-image.ts`            |
| 26  | Product DynamoDB adapter               | 3h  | `services/api/src/adapters/product-adapter.ts` (with GSI queries)     |
| 27  | Inventory management APIs              | 3h  | `services/api/src/handlers/seller/inventory.ts`                       |
| 28  | Inventory log DynamoDB adapter         | 2h  | `services/api/src/adapters/inventory-adapter.ts`                      |

## Sprint 4 (Days 10–12): Orders + Payments

| #   | Task                                        | Est | Output                                                                |
| --- | ------------------------------------------- | --- | --------------------------------------------------------------------- |
| 29  | Order creation with stock reservation       | 4h  | `services/api/src/handlers/orders/create-order.ts` (TransactWrite)    |
| 30  | Order DynamoDB adapter                      | 3h  | `services/api/src/adapters/order-adapter.ts` (conditional writes)     |
| 31  | Seller order accept/reject                  | 3h  | `services/api/src/handlers/seller/manage-order.ts`                    |
| 32  | Razorpay client adapter                     | 2h  | `services/api/src/adapters/razorpay-adapter.ts`                       |
| 33  | Payment link creation                       | 3h  | `services/api/src/handlers/payments/create-link.ts`                   |
| 34  | Payment DynamoDB adapter                    | 2h  | `services/api/src/adapters/payment-adapter.ts` (idempotency)          |
| 35  | Razorpay webhook handler                    | 4h  | `services/api/src/handlers/payments/webhook.ts` (signature verify)    |
| 36  | Order status lifecycle                      | 2h  | `services/api/src/core/order-service.ts` (state machine)              |
| 37  | Stock finalization on payment               | 2h  | Update order adapter with TransactWrite for payment confirmation      |

## Sprint 5 (Days 13–15): WhatsApp Integration

| #   | Task                                               | Est | Output                                                                |
| --- | -------------------------------------------------- | --- | --------------------------------------------------------------------- |
| 38  | WhatsApp webhook receiver                          | 2h  | `services/api/src/handlers/whatsapp/webhook.ts` (verify + fast-ack)  |
| 39  | WhatsApp signature verification                    | 1h  | `services/api/src/utils/whatsapp-verify.ts`                           |
| 40  | WhatsApp Cloud API client                          | 2h  | `services/api/src/adapters/whatsapp-adapter.ts`                       |
| 41  | Session DynamoDB adapter                           | 3h  | `services/api/src/adapters/session-adapter.ts` (phone lookup)         |
| 42  | Session state machine                              | 4h  | `services/api/src/core/session-service.ts` (10 states)                |
| 43  | Message handlers (browsing, ordering)              | 4h  | `services/api/src/core/message-handlers/` (by state)                  |
| 44  | WhatsApp message DynamoDB adapter                  | 2h  | `services/api/src/adapters/whatsapp-message-adapter.ts`               |
| 45  | Async message processing with SQS                  | 3h  | EventBridge rule → SQS → Lambda consumer                              |
| 46  | Outbound message sender                            | 2h  | `services/api/src/handlers/whatsapp/send-message.ts`                  |
| 47  | Session cleanup with EventBridge scheduled rule    | 2h  | Lambda triggered daily to expire old sessions                         |

## Sprint 6 (Days 16–17): Admin + Analytics

| #   | Task                                  | Est | Output                                                                |
| --- | ------------------------------------- | --- | --------------------------------------------------------------------- |
| 48  | Seller approval workflow              | 3h  | `services/api/src/handlers/admin/approve-seller.ts`                   |
| 49  | Admin analytics APIs                  | 3h  | `services/api/src/handlers/admin/analytics.ts` (DynamoDB aggregates)  |
| 50  | Seller dashboard APIs                 | 2h  | `services/api/src/handlers/seller/dashboard.ts`                       |
| 51  | Notification service                  | 3h  | `services/api/src/core/notification-service.ts` (WhatsApp + in-app)   |
| 52  | Notification DynamoDB adapter         | 2h  | `services/api/src/adapters/notification-adapter.ts`                   |
| 53  | Dispute management APIs               | 3h  | `services/api/src/handlers/admin/disputes.ts`                         |
| 54  | Audit log DynamoDB adapter            | 2h  | `services/api/src/adapters/audit-adapter.ts`                          |

## Sprint 7 (Days 18–19): Hardening + Observability

| #   | Task                                  | Est | Output                                                                |
| --- | ------------------------------------- | --- | --------------------------------------------------------------------- |
| 55  | CloudWatch alarms                     | 2h  | `infra/cdk/lib/stacks/monitoring-stack.ts` (errors, latency, DLQ)     |
| 56  | Dead letter queues                    | 1h  | SQS DLQs for all async processors                                     |
| 57  | IAM least-privilege policies          | 3h  | Tighten Lambda execution roles per function                           |
| 58  | Secrets Manager integration           | 2h  | Store Razorpay/WhatsApp secrets, load in Lambda                       |
| 59  | Request ID propagation                | 1h  | CloudWatch structured logging with correlation IDs                    |
| 60  | Rate limiting with API Gateway        | 2h  | Usage plans and throttling configuration                              |
| 61  | Integration tests                     | 4h  | Test critical flows with LocalStack or AWS SAM                        |
| 62  | CDK deployment pipeline               | 3h  | GitHub Actions or CodePipeline for CI/CD                              |

## Critical Path

```
Foundation (1-11) → Auth (12-18) → Catalog (19-28) → Orders (29-37) → WhatsApp (38-47)
                                                           ↓
                                                    Payments (32-37) ← depends on Razorpay
```

## Blocking External Dependencies

- **AWS Account**: Bootstrapped with CDK, IAM permissions configured
- **Cognito**: User pool created with admin/seller/customer groups
- **Razorpay**: API key + secret + webhook secret configured in Secrets Manager
- **Meta WhatsApp Business API**: Access token + phone number ID + verify token in Secrets Manager
- **DynamoDB**: Tables created with proper GSIs and capacity settings
- **S3**: Buckets created with CORS and lifecycle policies
- **CloudWatch**: Log groups and metric namespaces configured

## Architecture Decisions

- **DynamoDB**: Single-table design with composite keys (PK/SK) and GSIs for access patterns
- **Lambda**: One function per endpoint or logical operation (not monolithic)
- **EventBridge + SQS**: Async workflows for WhatsApp processing, notifications, retries
- **S3**: Raw webhook payloads archived for audit, documents/media with presigned URLs
- **Cognito**: JWT-based auth with groups for RBAC, Lambda validates claims
- **API Gateway**: HTTP API with JWT authorizer, throttling, and CORS
- **CloudWatch**: Structured JSON logs with request IDs, metrics, and alarms
- **CDK**: Infrastructure as code with environment-specific configs (dev/staging/prod)
