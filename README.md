# VyaparGyan

AI-powered multi-seller marketplace for local Indian retailers. Sellers manage products and orders via web dashboard while customers browse and purchase through WhatsApp and web chat. The platform acts as an intelligent business manager with proactive AI insights, automated marketing campaigns, and Khata book OCR.

**GitHub:** https://github.com/Golden007-prog/Vyapar-Gyan.git

## Demo Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Golden007-prog/Vyapar-Gyan.git
cd Vyapar-Gyan
pnpm install

# 2. Start the web app
pnpm --filter @vyapargyan/web dev

# 3. Open http://localhost:3000 and click "Try the Demo"
```

### Demo Accounts

| Role | Phone | Password | What You'll See |
|------|-------|----------|-----------------|
| Seller (Dragon Store Owner) | +91 8927049085 | DemoSeller@123 | AI insights, approval inbox, inventory upload (CSV + OCR), customer inbox, orders, campaigns |
| Customer (Enigma) | +91 7001124396 | DemoCustomer@123 | Product catalog, real-time chat with seller, order tracking, account settings |
| Admin (Platform) | 9000000001 | DemoAdmin@123 | Platform metrics, seller moderation, system health, audit logs |

**WhatsApp Bot:** +1 (947) 234-9399 — Send any message to start the omnichannel experience (role-based routing auto-detects seller/customer/new user).

## Overview

VyaparGyan bridges the gap between traditional retail and digital commerce by providing:

- **Omnichannel Commerce**: Customers shop via web chat and WhatsApp (Twilio), sellers manage everything from one unified inbox
- **Voice-First Shopping**: Multilingual voice note support (Hindi, English, Tamil, Telugu, Marathi, Bengali, Gujarati, Kannada) with automatic transcription and product intent extraction via Gemini 2.0
- **AI Business Manager**: Proactive insights for dead stock detection, dynamic pricing, and automated WhatsApp marketing campaigns (Bedrock + Gemini + Grok)
- **Khata Book OCR**: Sellers photograph handwritten ledgers; Gemini Vision digitizes inventory automatically
- **CSV Stock Ingestion**: Bulk inventory upload with smart column mapping and error feedback
- **Smart Payments**: Razorpay Route handles commission splitting and direct seller payouts
- **Full Admin Control**: Platform moderation, seller approval/rejection, system health monitoring, audit trails
- **Event-driven workflows**: Automated order processing, AI campaign execution, notifications, and audit trails

## Architecture

Modern AWS serverless architecture built for scale and operational simplicity:

- **Compute**: AWS Lambda (Node.js 20, TypeScript) — 65+ handlers across 12 domains
- **API**: API Gateway HTTP API with JWT authorization + WebSocket API for real-time messaging
- **Authentication**: Amazon Cognito User Pools with role-based groups (admin/seller/customer)
- **Database**: DynamoDB (single-table design with multi-seller partition strategy, 6 GSIs including phone lookup, seller orders, location, city, stock, transfers)
- **Search**: OpenSearch Serverless with zero-ETL pipeline from DynamoDB Streams
- **Storage**: S3 (product images, Khata book photos, voice notes, documents, exports)
- **Events**: EventBridge + SQS for async workflows, AI pipelines, campaign execution, and cart abandonment
- **Scheduling**: EventBridge Scheduler for trend alerts, cart nudges, and payment link expiry
- **Messaging**: Twilio SDK for omnichannel messaging (WhatsApp, SMS, in-app chat routing)
- **Payments**: Razorpay Route (Transfers) for automated commission splitting, seller payouts, and UPI Payment Links
- **AI — Orchestration**: Amazon Bedrock for dead-stock detection and discount campaign generation
- **AI — Analysis**: Google Gemini 2.0 Flash for OCR, multilingual voice transcription, TTS, intent extraction, product image analysis, and market research
- **AI — Trends**: xAI Grok for live market trend research and dynamic pricing
- **Frontend**: Next.js 14 with Tailwind CSS (30+ pages, 20+ components)
- **Observability**: CloudWatch Logs, Metrics, Alarms, and X-Ray tracing
- **Infrastructure**: AWS CDK v2 with TypeScript (8 CloudFormation stacks)
- **Developer Tools**: Kiro IDE with 3 MCP servers for platform data access
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
└── backend/                      # Backend configuration and environment
```

## Prerequisites

- **Node.js**: 20.x LTS or higher
- **pnpm**: 8.x or higher (`npm install -g pnpm`)
- **AWS CLI**: v2 configured with appropriate credentials
- **AWS CDK**: v2 installed globally (`npm install -g aws-cdk`)
- **Python**: 3.11+ (for MCP servers)
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
- Omnichannel messaging: customers and sellers communicate via web chat and WhatsApp (Twilio) with unified message storage and bi-directional sync
- Role-based WhatsApp routing: seller → Copilot (stock check, trend alerts, campaign approval), customer → Discovery (favorites, pincode/city search, global search), unregistered → Onboarding
- Voice-first shopping: send voice notes in any Indian language (Hindi, English, Tamil, Telugu, Marathi, Bengali, Gujarati, Kannada) — Gemini 2.0 transcribes, extracts product intents, and matches catalog automatically
- Voice-activated financial reports: sellers ask business questions via voice note and receive text + audio responses in their language
- Automated stock ingestion: CSV/Excel upload and Khata book OCR via WhatsApp or web dashboard (Gemini Vision)
- Gemini intent extraction: contextual routing based on product intent, store intent, and detected language
- Human handoff protocol: seller takes over from AI bot via web inbox, auto-resets after 30 min inactivity
- Proactive AI insights: dead stock detection, dynamic pricing, restock alerts (Bedrock + Gemini + Grok) with severity, confidence, and financial impact
- Omnichannel campaign dispatch: Web Chat, WhatsApp, or both — with per-customer per-channel delivery tracking
- UPI payment links: Razorpay Payment Links for WhatsApp checkout with 30-min expiry and auto-reminder
- Automated abandoned cart nudges: 2h + 24h reminders via preferred channel (WhatsApp or Web Chat)
- Order lifecycle management with commission-based payment splitting (Razorpay Route)
- Admin dashboard: 10 pages including customers, disputes, financials, campaigns, catalog manager with multilingual aliases and merge operations
- AI assistance for catalog extraction, voice transcription, multilingual support, and product intent extraction
- Omnichannel pipeline reliability: 7 interconnected bug fixes ensuring end-to-end message delivery between web chat, WhatsApp, and seller Inbox — verified with property-based testing (bug condition methodology)

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

All core documentation lives in the [`docs/`](docs/) directory.

### Project Overview
- [Overview](docs/overview.md) — Full project overview, current status, and feature inventory
- [Design Document](docs/design.md) — System architecture and design decisions
- [Requirements](docs/requirements.md) — Product requirements document
- [Implementation History](docs/implementation_history.md) — Chronological changelog of all milestones

### Architecture and Integration
- [API Contract](docs/api_contract.md) — REST API endpoint specifications
- [Authentication & RBAC](docs/auth_rbac.md) — Cognito integration and role-based access control
- [WhatsApp Orchestration](docs/whatsapp_orchestration.md) — Conversation flows and state management
- [WhatsApp Seller Routing](docs/whatsapp-seller-routing.md) — Seller message routing design
- [WhatsApp Voice Pipeline](.kiro/specs/whatsapp-voice-pipeline/design.md) — Multilingual voice note transcription and product intent extraction
- [Order Lifecycle](docs/order_lifecycle.md) — Order state machine and transitions
- [Payment Integration](docs/payment_integration.md) — Razorpay webhook handling and reconciliation
- [Razorpay Integration Reference](docs/RAZORPAY_INTEGRATION_REFERENCE.md) — Razorpay Route setup and configuration
- [Bedrock Architecture](docs/bedrock-architecture.md) — Amazon Bedrock AI orchestration design
- [Bedrock Seller Copilot](docs/bedrock-seller-copilot-flow.md) — Seller copilot conversation flow
- [DynamoDB Schema](services/api/DYNAMODB_SCHEMA.md) — Single-table design and access patterns
- [TypeScript Setup](docs/typescript-setup.md) — Monorepo configuration and tooling

### Development and Operations
- [Coding Sequence](docs/coding_sequence.md) — Development workflow and best practices
- [Engineering Cards](docs/engineering_cards.md) — Feature implementation cards
- [Readiness Audit](docs/readiness_audit.md) — Production readiness checklist
- [CDK Deployment Guide](infra/cdk/DEPLOYMENT.md) — Infrastructure deployment procedures
- [Judge Demo Plan](docs/JUDGE_DEMO_PLAN.md) — Demo storyline and preparation checklist

### Testing
- [WhatsApp Test Plan](services/api/src/handlers/whatsapp/__tests__/TEST_PLAN.md) — WhatsApp integration testing
- [Test Results](services/api/TEST_RESULTS.md) — Latest test execution results

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
