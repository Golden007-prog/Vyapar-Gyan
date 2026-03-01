# Project Structure

## Repository Layout

```
├── infra/cdk/           # AWS CDK infrastructure as code
│   ├── bin/             # CDK app entry point
│   ├── lib/
│   │   ├── config/      # Environment-specific configuration
│   │   ├── stacks/      # CDK stack definitions
│   │   └── constructs/  # Reusable CDK constructs
│   ├── cdk.json
│   └── package.json
├── services/api/        # Lambda handlers and backend logic
│   ├── src/
│   │   ├── handlers/    # Lambda function handlers by domain
│   │   ├── core/        # Core utilities (auth, config, logging)
│   │   ├── adapters/    # External service adapters
│   │   ├── middleware/  # Request/response middleware
│   │   └── shared/      # Shared types, errors, utilities
│   ├── package.json
│   └── tsconfig.json
├── apps/web/            # Next.js Admin/Seller web application
│   ├── src/
│   │   ├── app/         # Next.js app router pages
│   │   ├── components/  # React components
│   │   └── lib/         # Client utilities
│   ├── package.json
│   └── tsconfig.json
├── packages/
│   └── shared-contracts/# Shared TypeScript types and API contracts
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── tools/mcp/           # MCP servers for developer/operator tooling
│   ├── commerce-ops/    # Operations data access
│   ├── commerce-catalog/# Catalog data access
│   └── commerce-admin/  # Admin data access
├── powers/              # Kiro power definitions
│   └── commerce-platform/
├── .kiro/
│   ├── steering/        # Project steering documentation
│   ├── settings/        # Kiro configuration
│   └── specs/           # Feature specifications
└── docs/                # Design and architecture documentation
```

## Backend Application Structure

### `services/api/src/handlers/`
Lambda function handlers organized by domain:
- `auth/` - Authentication (login, refresh, token validation)
- `admin/` - Admin operations (seller approval, categories, disputes)
- `seller/` - Seller operations (products, inventory, orders)
- `catalog/` - Public catalog browsing
- `orders/` - Order creation and tracking
- `whatsapp/` - WhatsApp webhook handling
- `payments/` - Payment webhooks and status updates
- `websocket/` - WebSocket connection handlers (future)
- `profile/` - User profile management

Each domain folder contains handler files like:
- `create-product-handler.ts`
- `whatsapp-webhook-handler.ts`
- `payment-webhook-handler.ts`

### `services/api/src/core/`
Core framework utilities:
- `config.ts` - Environment configuration and AWS SDK clients
- `auth.ts` - Cognito JWT verification and user context extraction
- `authorization.ts` - Role-based access control logic
- `errors.ts` - Custom error classes and error handling
- `logger.ts` - Structured logging with request context
- `validation.ts` - Zod schema validation utilities

### `services/api/src/adapters/`
External service adapters:
- `dynamodb-adapter.ts` - DynamoDB operations with single-table design
- `s3-adapter.ts` - S3 operations for media and document storage
- `eventbridge-adapter.ts` - EventBridge event publishing
- `sqs-adapter.ts` - SQS message sending
- `whatsapp-adapter.ts` - WhatsApp Cloud API client
- `razorpay-adapter.ts` - Razorpay payment gateway client
- `gemini-adapter.ts` - Google Gemini AI client

### `services/api/src/middleware/`
Lambda middleware and utilities:
- `api-gateway-middleware.ts` - API Gateway request/response handling
- `auth-middleware.ts` - Authentication and authorization middleware
- `error-middleware.ts` - Error handling and formatting
- `logging-middleware.ts` - Request logging and tracing
- `validation-middleware.ts` - Request validation

### `services/api/src/shared/`
Shared types and utilities:
- `types.ts` - Common TypeScript types and interfaces
- `constants.ts` - Application constants and enums
- `utils.ts` - Utility functions
- `schemas.ts` - Zod validation schemas

## Code Organization Patterns

### Layered Architecture

```
Lambda Handlers (services/api/src/handlers/)
    ↓
Business Logic / Use Cases
    ↓
Adapters (services/api/src/adapters/)
    ↓
External Services (DynamoDB, S3, EventBridge, WhatsApp, Razorpay, Gemini)
```

### Thin Lambda Handlers

- Handlers are thin entry points that orchestrate business logic
- Extract request context (auth, validation) via middleware
- Delegate to service/use-case functions for business logic
- Return standardized API Gateway responses
- Keep handlers focused on HTTP/event concerns

### Repository/Adapter Pattern

- Adapters encapsulate external service interactions
- DynamoDB adapter handles single-table design queries
- S3 adapter manages document and media operations
- EventBridge adapter publishes domain events
- SQS adapter sends async work messages
- External API adapters (WhatsApp, Razorpay, Gemini) handle integration logic

### Error Handling

- Custom error classes in `services/api/src/core/errors.ts`
- Error middleware catches and formats errors consistently
- API Gateway error responses follow standard format
- CloudWatch logs capture full error context
- Structured error logging with stack traces

### Logging and Observability

- Structured JSON logging to CloudWatch Logs
- Request ID propagation through all logs
- Log correlation with AWS X-Ray tracing
- Log all requests with method, path, status, duration
- Use logger instance from `services/api/src/core/logger.ts`

### Authentication and Authorization

- Cognito JWT tokens validated in auth middleware
- User context extracted from token claims
- Role-based authorization checks in handlers
- Cognito groups map to application roles (admin, seller, customer)
- IAM policies enforce least privilege at infrastructure level

## Naming Conventions

### Files and Modules
- Kebab case for handlers: `create-product-handler.ts`, `whatsapp-webhook-handler.ts`
- Kebab case for adapters: `dynamodb-adapter.ts`, `razorpay-adapter.ts`
- Kebab case for utilities: `api-gateway-middleware.ts`
- Group related functionality in domain folders

### Functions and Variables
- camelCase: `getUserProfile()`, `orderId`, `isValidToken`
- Async functions use `async` keyword naturally
- Private functions/methods prefixed with underscore: `_validateSignature()`
- Handler exports named clearly: `createProductHandler`, `whatsappWebhookHandler`

### Types and Interfaces
- PascalCase: `AppError`, `OrderService`, `WhatsAppAdapter`
- Interface prefix optional: `IOrderRepository` or `OrderRepository`
- Type aliases: `UserId`, `OrderStatus`, `ProductResponse`
- Zod schemas: `CreateProductSchema`, `OrderResponseSchema`

### Constants and Enums
- UPPER_SNAKE_CASE: `MAX_RETRIES`, `DEFAULT_TIMEOUT`, `TABLE_NAME`
- Enums in PascalCase: `OrderStatus`, `UserRole`, `PaymentMethod`
- Defined at module level or in `shared/constants.ts`

## Import Organization

```typescript
// Node.js built-ins
import { randomUUID } from 'crypto';

// AWS SDK
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';

// Third-party
import { z } from 'zod';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Local application
import { logger } from '../core/logger';
import { verifyToken } from '../core/auth';
import { requireRole } from '../core/authorization';
import { DynamoDBAdapter } from '../adapters/dynamodb-adapter';
```

## Documentation Standards

- JSDoc comments for all public functions and classes
- TypeScript types for all function parameters and return values
- Clear function and variable names that self-document intent
- README files in major directories explaining structure

## Testing

### Unit Tests
- Tests in `services/api/src/**/__tests__/` alongside source files
- Use Jest for test framework
- Mock AWS SDK clients and external services
- Test business logic in isolation

### Integration Tests
- Tests in `services/api/test/integration/`
- Test handler functions with mock events
- Validate DynamoDB queries and S3 operations
- Use LocalStack for local AWS service emulation

### Contract Tests
- Validate API Gateway request/response contracts
- Ensure Zod schemas match API documentation
- Test shared types in `packages/shared-contracts/`

### MCP Server Tests
- Tests in `tools/mcp/*/test/`
- Validate MCP tool inputs and outputs
- Test against real DynamoDB tables (read-only)
- Ensure data access patterns work correctly
