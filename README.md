# VyaparGyan

AI-powered commerce platform for local Indian retailers, enabling sellers to manage products and orders via web dashboard while customers browse and purchase through WhatsApp.

## Architecture

This project is migrating from a legacy FastAPI/Supabase stack to a modern AWS serverless architecture:

- **Compute**: AWS Lambda (Node.js 20, TypeScript)
- **API**: API Gateway (HTTP API v2 + WebSocket)
- **Authentication**: Amazon Cognito User Pools
- **Database**: DynamoDB (single-table design)
- **Storage**: S3 (product images, documents, logs)
- **Events**: EventBridge + SQS
- **Infrastructure**: AWS CDK v2 with TypeScript
- **Package Manager**: pnpm workspaces

## Repository Structure

```
vyapargyan/
├── infra/cdk/          # AWS CDK infrastructure code
├── services/api/       # Lambda backend services
├── apps/web/           # Web applications (admin, seller dashboards)
├── packages/shared/    # Shared TypeScript types and utilities
├── backend/            # Legacy FastAPI application (being phased out)
├── tools/mcp/          # MCP servers for platform data access
└── powers/             # Kiro power definitions
```

## Prerequisites

- **Node.js**: 20.x or higher
- **pnpm**: 8.x or higher
- **AWS CLI**: Configured with appropriate credentials
- **AWS CDK**: Installed globally (`npm install -g aws-cdk`)

## Quick Start

### 1. Install Dependencies

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Install all workspace dependencies
pnpm install
```

### 2. Configure Environment

```bash
# Copy environment example files
cp services/api/.env.example services/api/.env

# Edit .env files with your configuration
# - AWS credentials and region
# - Cognito User Pool details
# - External API keys (WhatsApp, Razorpay, Gemini)
```

### 3. Deploy Infrastructure

```bash
# Synthesize CDK stacks (verify configuration)
pnpm cdk:synth

# Deploy to dev environment
pnpm cdk:deploy --all --context environment=dev

# Deploy specific stack
pnpm cdk:deploy DatabaseStack --context environment=dev
```

### 4. Local Development

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint
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
pnpm --filter @vyapargyan/infra <command>
pnpm --filter @vyapargyan/api <command>

# Run command in all workspaces
pnpm -r <command>
```

### CDK Commands

```bash
# Synthesize CloudFormation templates
pnpm cdk:synth

# Show differences between deployed and local stacks
pnpm cdk:diff

# Deploy all stacks
pnpm cdk:deploy --all

# Destroy all stacks (use with caution!)
pnpm cdk:destroy --all
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests in specific workspace
pnpm --filter @vyapargyan/api test

# Run tests with coverage
pnpm --filter @vyapargyan/api test:coverage
```

## Environment Configuration

The platform supports three environments:

- **dev**: Development environment with relaxed settings
- **staging**: Pre-production environment mirroring production
- **prod**: Production environment with strict security and monitoring

Environment-specific configuration is managed through:
- CDK context variables (`cdk.json`)
- Environment config files (`infra/cdk/lib/config/`)
- AWS Secrets Manager (sensitive values)
- SSM Parameter Store (non-sensitive values)

## MCP Servers

Three local MCP servers provide read-only access to platform data:

- **commerce-ops-mcp**: Orders, payments, inventory, WhatsApp sessions, logs
- **commerce-catalog-mcp**: Products, categories, stock levels, media
- **commerce-admin-mcp**: Seller approvals, disputes, audit logs, analytics

Install all MCP servers:

```bash
cd tools/mcp
./install-all.sh
```

Requires AWS credentials configured with profile `kiro-mcp` and DynamoDB read permissions.

## Documentation

- [Design Document](.kiro/specs/platform-foundation/design.md) - Architecture and design decisions
- [Implementation Tasks](.kiro/specs/platform-foundation/tasks.md) - Development roadmap
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
