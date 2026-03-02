# VyaparGyan

AI-powered commerce platform for local Indian retailers, enabling sellers to manage products and orders via web dashboard while customers browse and purchase through WhatsApp.

## Overview

VyaparGyan bridges the gap between traditional retail and digital commerce by providing:

- **WhatsApp-first commerce**: Customers browse products, place orders, and make payments through familiar WhatsApp conversations
- **Web dashboard**: Sellers and admins manage inventory, orders, and operations through a modern Next.js interface
- **AI assistance**: Voice transcription, image analysis, and multilingual support powered by Google Gemini
- **Payment integration**: Seamless UPI, card, and wallet payments via Razorpay
- **Event-driven workflows**: Automated order processing, notifications, and audit trails

## Architecture

Modern AWS serverless architecture built for scale and operational simplicity:

- **Compute**: AWS Lambda (Node.js 20, TypeScript)
- **API**: API Gateway HTTP API with JWT authorization
- **Authentication**: Amazon Cognito User Pools with role-based groups
- **Database**: DynamoDB (single-table design for efficient access patterns)
- **Storage**: S3 (product images, documents, raw payloads, exports)
- **Events**: EventBridge + SQS for async workflows and domain events
- **Messaging**: WhatsApp Cloud API for customer interactions
- **Payments**: Razorpay integration with webhook handling
- **AI**: Google Gemini for voice, image, and language processing
- **Observability**: CloudWatch Logs, Metrics, Alarms, and X-Ray tracing
- **Infrastructure**: AWS CDK v2 with TypeScript
- **Package Manager**: pnpm workspaces for monorepo management

## Repository Structure

```
vyapargyan/
├── infra/cdk/                    # AWS CDK infrastructure as code
│   ├── bin/                      # CDK app entry point
│   ├── lib/
│   │   ├── config/               # Environment-specific configuration (dev, staging, prod)
│   │   ├── stacks/               # CDK stack definitions (auth, database, storage, API, events)
│   │   └── constructs/           # Reusable CDK constructs
│   └── cdk.json                  # CDK configuration
├── services/api/                 # Lambda handlers and backend logic
│   ├── src/
│   │   ├── handlers/             # Lambda function handlers by domain
│   │   │   ├── whatsapp/         # WhatsApp webhook and message processing
│   │   │   ├── auth/             # Authentication endpoints
│   │   │   ├── admin/            # Admin operations
│   │   │   ├── seller/           # Seller operations
│   │   │   ├── catalog/          # Public catalog browsing
│   │   │   ├── orders/           # Order management
│   │   │   └── payments/         # Payment webhooks
│   │   ├── repositories/         # Data access layer for DynamoDB
│   │   ├── services/             # Business logic and external integrations
│   │   └── utils/                # Shared utilities and configuration
│   ├── DYNAMODB_SCHEMA.md        # Single-table design documentation
│   └── package.json
├── apps/web/                     # Next.js Admin/Seller web application
│   ├── src/
│   │   ├── app/                  # Next.js app router pages
│   │   ├── components/           # React components
│   │   └── lib/                  # Client utilities
│   └── package.json
├── packages/
│   └── shared-contracts/         # Shared TypeScript types and API contracts
├── tools/mcp/                    # MCP servers for developer/operator tooling
│   ├── commerce-ops/             # Operations data access (orders, payments, logs)
│   ├── commerce-catalog/         # Catalog data access (products, categories)
│   └── commerce-admin/           # Admin data access (approvals, disputes)
├── powers/
│   └── commerce-platform/        # Kiro power for platform data access
├── .kiro/
│   ├── steering/                 # Project steering documentation
│   ├── settings/                 # Kiro configuration (MCP servers)
│   └── specs/                    # Feature specifications
├── docs/                         # Design and architecture documentation
│   ├── api_contract.md           # API endpoint specifications
│   ├── auth_rbac.md              # Authentication and authorization
│   ├── whatsapp_orchestration.md # WhatsApp conversation flows
│   ├── order_lifecycle.md        # Order state machine
│   └── payment_integration.md    # Razorpay integration
└── backend/                      # Legacy FastAPI application (being phased out)
```

## Prerequisites

- **Node.js**: 20.x LTS or higher
- **pnpm**: 8.x or higher (`npm install -g pnpm`)
- **AWS CLI**: v2 configured with appropriate credentials
- **AWS CDK**: v2 installed globally (`npm install -g aws-cdk`)
- **Python**: 3.11+ (for legacy backend and MCP servers)
- **uv/uvx**: Python package manager for MCP servers ([installation guide](https://docs.astral.sh/uv/getting-started/installation/))

## Quick Start

### 1. Install Dependencies

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Install all workspace dependencies
pnpm install

# Build shared packages
pnpm --filter @vyapargyan/shared-contracts build
```

### 2. Configure AWS Credentials

```bash
# Configure AWS CLI with your credentials
aws configure --profile kiro-mcp

# Verify access
aws sts get-caller-identity --profile kiro-mcp
```

### 3. Set Up Environment Variables

```bash
# Copy environment example files
cp infra/cdk/cdk.context.json.example infra/cdk/cdk.context.json

# Edit cdk.context.json with your configuration
# - AWS account ID and region
# - Domain names and certificates
# - External service credentials
```

### 4. Deploy Infrastructure

```bash
# Navigate to CDK directory
cd infra/cdk

# Install CDK dependencies
pnpm install

# Synthesize CloudFormation templates (verify configuration)
pnpm cdk synth --context env=dev

# Deploy all stacks to dev environment
pnpm cdk deploy --all --context env=dev

# Note: First deployment creates Cognito User Pool, DynamoDB table, S3 buckets, etc.
```

### 5. Bootstrap Initial Data

```bash
# Create admin user in Cognito
cd services/api
pnpm run bootstrap:admin

# Seed product categories
pnpm run seed:categories
```

### 6. Install MCP Servers (Optional)

```bash
# Install all MCP servers for platform data access
cd tools/mcp
./install-all.sh

# Or install individually
cd tools/mcp/commerce-ops && pnpm install && pnpm build
cd tools/mcp/commerce-catalog && pnpm install && pnpm build
cd tools/mcp/commerce-admin && pnpm install && pnpm build
```

## Core Personas

- **Admin**: Platform operators who moderate sellers, manage categories, resolve disputes
- **Seller**: Local retailers managing products, inventory, and fulfilling orders
- **Customer**: End users browsing and ordering primarily via WhatsApp

## Key Features

- Seller onboarding with document verification and admin approval
- Product catalog management with image uploads and inventory tracking
- WhatsApp-based customer commerce (browsing, ordering, payment)
- Order lifecycle management with payment integration (Razorpay)
- Admin controls for moderation, analytics, and dispute resolution
- AI assistance for catalog extraction, voice transcription, and multilingual support

## Development Workflow

### Working with Workspaces

```bash
# Run command in specific workspace
pnpm --filter @vyapargyan/api <command>
pnpm --filter @vyapargyan/web <command>
pnpm --filter @vyapargyan/shared-contracts <command>

# Run command in all workspaces
pnpm -r <command>

# Build all packages
pnpm -r build

# Run all tests
pnpm -r test
```

### Local Development Commands

```bash
# Type checking
pnpm --filter @vyapargyan/api typecheck

# Linting
pnpm --filter @vyapargyan/api lint

# Run unit tests
pnpm --filter @vyapargyan/api test

# Run tests with coverage
pnpm --filter @vyapargyan/api test:coverage

# Run Next.js web app locally
pnpm --filter @vyapargyan/web dev
```

### CDK Commands

```bash
# Navigate to CDK directory
cd infra/cdk

# Synthesize CloudFormation templates
pnpm cdk synth --context env=dev

# Show differences between deployed and local stacks
pnpm cdk diff --context env=dev

# Deploy all stacks
pnpm cdk deploy --all --context env=dev

# Deploy specific stack
pnpm cdk deploy DatabaseStack --context env=dev

# Destroy all stacks (use with caution!)
pnpm cdk destroy --all --context env=dev
```

### AWS CLI Operations

```bash
# Tail Lambda logs
aws logs tail /aws/lambda/vyapargyan-dev-whatsappWebhook --follow --profile kiro-mcp

# Invoke Lambda function
aws lambda invoke \
  --function-name vyapargyan-dev-createProduct \
  --payload file://test-event.json \
  --profile kiro-mcp \
  response.json

# Query DynamoDB table
aws dynamodb scan \
  --table-name vyapargyan-dev-main \
  --profile kiro-mcp \
  --region us-east-1

# List S3 objects
aws s3 ls s3://vyapargyan-dev-media/ --profile kiro-mcp
```

## Environment Configuration

The platform supports three environments with complete isolation:

- **dev**: Development environment with relaxed settings and verbose logging
- **staging**: Pre-production environment mirroring production configuration
- **prod**: Production environment with strict security, monitoring, and alarms

### Configuration Management

Environment-specific configuration is managed through:

1. **CDK Context**: Environment selection via `--context env=dev|staging|prod`
2. **Config Files**: TypeScript config in `infra/cdk/lib/config/{dev,staging,prod}.ts`
3. **AWS Secrets Manager**: Sensitive values (API keys, credentials)
4. **SSM Parameter Store**: Non-sensitive configuration values
5. **Lambda Environment Variables**: Runtime configuration injected by CDK

### Required Configuration

Each environment requires:

- AWS account ID and region
- Cognito User Pool ID and Client ID
- DynamoDB table name
- S3 bucket names (media, documents, exports)
- WhatsApp Business Phone Number ID and Access Token
- Razorpay Key ID and Key Secret
- Google Gemini API Key
- Domain names and SSL certificates (staging/prod)

See `infra/cdk/lib/config/README.md` for detailed configuration guide.

## MCP Servers

Three local MCP servers provide read-only access to platform data for development and operations:

### commerce-ops-mcp
Operations and runtime data access:
- Fetch order details and complete order timelines
- Query payment status and transaction history
- Check product inventory levels and logs
- Retrieve WhatsApp session state and conversation history
- Search CloudWatch logs with filter patterns
- List seller orders with status filtering

### commerce-catalog-mcp
Product catalog and inventory data:
- Fetch product details by ID
- List products by seller or category
- Find low-stock products below threshold
- Get product media metadata and S3 keys
- Browse category hierarchy

### commerce-admin-mcp
Administrative and moderation data:
- List pending seller approval requests
- Fetch seller profiles with verification documents
- View open disputes requiring attention
- Get dispute details and resolution history
- Fetch audit timelines for resources
- List recent payment transactions

### Installation

```bash
# Install all MCP servers
cd tools/mcp
./install-all.sh

# Or install individually
cd tools/mcp/commerce-ops
pnpm install && pnpm build

cd tools/mcp/commerce-catalog
pnpm install && pnpm build

cd tools/mcp/commerce-admin
pnpm install && pnpm build
```

### Configuration

MCP servers require AWS credentials with DynamoDB read permissions:

```bash
# Configure AWS profile for MCP servers
aws configure --profile kiro-mcp

# Set environment variables
export AWS_PROFILE=kiro-mcp
export AWS_REGION=us-east-1
export TABLE_NAME=vyapargyan-dev-main
```

MCP server configuration is in `.kiro/settings/mcp.json` and automatically loaded by Kiro IDE.

## Documentation

### Architecture and Design
- [Design Document](design.md) - High-level architecture and design decisions
- [Platform Foundation Spec](.kiro/specs/platform-foundation/) - Requirements, design, and implementation tasks
- [DynamoDB Schema](services/api/DYNAMODB_SCHEMA.md) - Single-table design and access patterns
- [TypeScript Setup](docs/typescript-setup.md) - Monorepo configuration and tooling

### API and Integration
- [API Contract](docs/api_contract.md) - REST API endpoint specifications
- [Authentication & RBAC](docs/auth_rbac.md) - Cognito integration and role-based access control
- [WhatsApp Orchestration](docs/whatsapp_orchestration.md) - Conversation flows and state management
- [Order Lifecycle](docs/order_lifecycle.md) - Order state machine and transitions
- [Payment Integration](docs/payment_integration.md) - Razorpay webhook handling and reconciliation

### Development
- [Coding Sequence](docs/coding_sequence.md) - Development workflow and best practices
- [Engineering Cards](docs/engineering_cards.md) - Feature implementation cards
- [Readiness Audit](docs/readiness_audit.md) - Production readiness checklist
- [CDK Deployment Guide](infra/cdk/DEPLOYMENT.md) - Infrastructure deployment procedures

### Testing
- [WhatsApp Test Plan](services/api/src/handlers/whatsapp/__tests__/TEST_PLAN.md) - WhatsApp integration testing
- [Test Results](services/api/TEST_RESULTS.md) - Latest test execution results
- [Integration Testing](services/api/src/handlers/whatsapp/__tests__/integration.md) - Integration test scenarios

### Legacy
- [Legacy Backend](backend/README.md) - FastAPI application (being phased out)

## Design Philosophy

- **Serverless-first**: Leverage AWS managed services to minimize operational overhead
- **Event-driven**: Use EventBridge and SQS for asynchronous workflows
- **Infrastructure as Code**: All infrastructure defined in AWS CDK
- **Multi-environment**: Support dev, staging, and prod with complete isolation
- **Observability**: Structured logging, distributed tracing, and comprehensive monitoring
- **Security**: Least-privilege IAM, secrets management, and defense in depth

## Contributing

This is a private project. For team members:

1. Create a feature branch from `main`
2. Make your changes following the code style guidelines
3. Write tests for new functionality
4. Run `pnpm lint` and `pnpm test` before committing
5. Submit a pull request for review

## License

UNLICENSED - Private project
