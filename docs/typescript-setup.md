# TypeScript Configuration

This document describes the TypeScript configuration setup for the VyaparGyan AWS serverless mono-repo.

## Configuration Structure

The repository uses a hierarchical TypeScript configuration with a root `tsconfig.json` that defines base settings, and workspace-specific configurations that extend the base. All TypeScript code targets Node.js 20 runtime for AWS Lambda compatibility.

### Root Configuration (`tsconfig.json`)

The root configuration establishes strict type checking and modern ES standards:

- **Target**: ES2022 for modern JavaScript features
- **Module System**: Node16 for native ESM support
- **Strict Mode**: Enabled with all strictness flags
- **Type Checking**: Comprehensive checks including unused locals, implicit returns, and indexed access
- **Runtime**: Node.js 20 compatible (AWS Lambda runtime)

### Workspace Configurations

Each workspace extends the root configuration and adds workspace-specific settings:

#### 1. Infrastructure (`infra/cdk/tsconfig.json`)

CDK infrastructure-as-code configuration:
- **Root Dir**: `./` (includes bin/ and lib/)
- **Output**: `dist/` for compiled CDK app
- **Path Aliases**:
  - `@config/*` → `./lib/config/*`
  - `@stacks/*` → `./lib/stacks/*`
  - `@constructs/*` → `./lib/constructs/*`
- **Build Tool**: tsc (TypeScript compiler)
- **Purpose**: Define AWS resources (Lambda, API Gateway, DynamoDB, Cognito, S3, EventBridge, SQS, CloudWatch)

#### 2. API Service (`services/api/tsconfig.json`)

Lambda backend service configuration:
- **Root Dir**: `./src`
- **Output**: `dist/` for bundled Lambda handlers
- **Path Aliases**:
  - `@handlers/*` → `./src/handlers/*` (Lambda entry points)
  - `@core/*` → `./src/core/*` (use-cases, domain logic)
  - `@adapters/*` → `./src/adapters/*` (DynamoDB, S3, Cognito, external APIs)
  - `@middleware/*` → `./src/middleware/*` (auth, logging, error handling)
  - `@utils/*` → `./src/utils/*` (helpers, validators)
  - `@shared/contracts` → `../../packages/shared/contracts`
- **Build Tool**: esbuild or tsup for fast bundling
- **Purpose**: Lambda handlers for API Gateway endpoints, EventBridge consumers, SQS processors

#### 3. Shared Packages (`packages/shared/tsconfig.json`)

Shared contracts and utilities configuration:
- **Composite**: Enabled for project references
- **Output**: `dist/` for compiled shared code
- **Path Aliases**:
  - `@contracts/*` → `./contracts/*` (API types, DynamoDB models, event schemas)
  - `@utils/*` → `./utils/*` (shared helpers)
- **Purpose**: Type-safe contracts shared between services/api, infra/cdk, apps/web, and MCP servers

#### 4. Web Applications (`apps/web/tsconfig.json`)

Frontend applications configuration:
- **Lib**: Includes DOM types for browser APIs
- **JSX**: Preserve mode for Next.js
- **Path Aliases**:
  - `@admin/*` → `./admin/*`
  - `@seller/*` → `./seller/*`
  - `@shared/*` → `./shared/*`
  - `@contracts/*` → `../../packages/shared/contracts/*`
- **Purpose**: Admin and seller dashboards (Next.js apps)

#### 5. MCP Servers (`tools/mcp/*/tsconfig.json`)

MCP server configuration for local development tools:
- **Target**: ES2022
- **Module**: Node16
- **Output**: `dist/` for compiled MCP servers
- **Purpose**: Local read-only access to DynamoDB data for development and debugging

#### 6. Test Configuration (`tsconfig.test.json`)

Test-specific configuration:
- Extends root configuration
- Includes Jest types
- Covers all `*.test.ts` and `*.spec.ts` files

## Path Aliases

Path aliases enable clean imports without relative path hell:

```typescript
// Without aliases (bad)
import { DynamoDBAdapter } from '../../../adapters/dynamodb-adapter';

// With aliases (good)
import { DynamoDBAdapter } from '@adapters/dynamodb-adapter';
```

### Usage in Lambda Handlers

When importing from other modules:

```typescript
// In services/api/src/handlers/orders/create-order.ts
import { OrderCreateRequest } from '@shared/contracts';
import { formatApiResponse } from '@utils/response';
import { OrderService } from '@core/order-service';
import { DynamoDBAdapter } from '@adapters/dynamodb-adapter';
import { authMiddleware } from '@middleware/auth';
```

### Usage in CDK

```typescript
// In infra/cdk/lib/stacks/api-stack.ts
import { EnvironmentConfig } from '@config/environment';
import { DatabaseStack } from '@stacks/database-stack';
import { AuthStack } from '@stacks/auth-stack';
import { createLambdaFunction } from '@constructs/lambda-function';
```

### Usage in Shared Contracts

```typescript
// In packages/shared/contracts/order.ts
export interface Order {
  orderId: string;
  orderNumber: string;
  sellerId: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItem[];
  totalAmount: number;
  createdAt: string;
}
```

## Strict Type Checking

The configuration enables comprehensive type checking:

- `strict: true` - All strict mode checks
- `noUnusedLocals: true` - Error on unused variables
- `noUnusedParameters: true` - Error on unused function parameters
- `noImplicitReturns: true` - Error on missing return statements
- `noFallthroughCasesInSwitch: true` - Error on switch fallthrough
- `noUncheckedIndexedAccess: true` - Require index access checks
- `exactOptionalPropertyTypes: true` - Distinguish undefined from missing
- `noImplicitOverride: true` - Require explicit override keyword

## Module Resolution

The configuration uses Node16 module resolution for native ESM support:

- Supports both CommonJS and ESM
- Requires explicit file extensions in imports (enforced by bundlers)
- Compatible with AWS Lambda Node.js 20 runtime
- esbuild/tsup handle bundling for Lambda deployment

## Build Output

Each workspace compiles to its own `dist/` directory:

- `infra/cdk/dist/` - Compiled CDK code for infrastructure deployment
- `services/api/dist/` - Bundled Lambda handlers (optimized for cold start)
- `packages/shared/dist/` - Compiled shared contracts and utilities
- `apps/web/dist/` - Compiled web applications (Next.js build)
- `tools/mcp/*/dist/` - Compiled MCP servers for local development

## Lambda Bundling Strategy

Lambda handlers use esbuild or tsup for optimal bundle size and cold start performance:

- **Tree-shaking**: Remove unused code
- **Minification**: Reduce bundle size
- **Source maps**: Enable for debugging in CloudWatch
- **External dependencies**: AWS SDK v3 marked as external (provided by Lambda runtime)
- **Target**: Node.js 20 runtime
- **Output**: Single file per handler or shared layer

## Source Maps

All configurations generate source maps for debugging:

- `sourceMap: true` - Generate .map files
- `declarationMap: true` - Generate .d.ts.map files for type navigation

## Verification

To verify TypeScript configuration:

```bash
# Check root configuration
npx tsc --noEmit

# Check specific workspace
cd infra/cdk && npx tsc --noEmit
cd services/api && npx tsc --noEmit
cd packages/shared && npx tsc --noEmit

# Build Lambda handlers
cd services/api && npm run build

# Build CDK app
cd infra/cdk && npm run build
```

## IDE Integration

Modern IDEs (VS Code, WebStorm) automatically detect TypeScript configurations:

- Path aliases work in auto-imports
- Type checking runs in real-time
- Go-to-definition navigates across workspaces
- Refactoring works across the mono-repo
- Lambda handler types are validated against AWS SDK v3

## AWS Lambda Considerations

### Node.js 20 Runtime

All TypeScript code must be compatible with Node.js 20:
- Use ES2022 features
- Avoid experimental features
- Test with Node.js 20 locally

### Cold Start Optimization

- Keep bundle sizes small (< 5MB compressed)
- Use Lambda layers for shared dependencies
- Minimize top-level imports
- Use lazy loading for heavy dependencies

### Environment Variables

Lambda handlers access environment variables via `process.env`:
```typescript
const tableName = process.env.ORDERS_TABLE_NAME!;
const region = process.env.AWS_REGION!;
```

Type-safe environment validation in `services/api/src/utils/config.ts`.

## Next Steps

After setting up TypeScript configuration:

1. Install TypeScript and AWS SDK v3 types in each workspace
2. Create Lambda handler entry points in `services/api/src/handlers/`
3. Define shared contracts in `packages/shared/contracts/`
4. Set up build scripts with esbuild/tsup in package.json
5. Configure CDK to bundle and deploy Lambda functions
6. Test locally with AWS SAM or Lambda runtime emulator
