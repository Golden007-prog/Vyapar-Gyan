# Tech Stack

## Backend Runtime

- **TypeScript** - Type-safe JavaScript with modern language features
- **Node.js 20** - LTS runtime for AWS Lambda
- **AWS Lambda** - Serverless compute for API handlers and async workers
- **API Gateway HTTP API** - RESTful API endpoints with JWT authorizers
- **Zod** - Runtime schema validation and type inference

## Data and Storage

- **DynamoDB** - NoSQL database for operational commerce data (single-table design)
- **S3** - Object storage for media uploads, documents, raw payloads, exports
- **Cognito User Pools** - User authentication and identity management
- **Cognito Identity Pools** - Temporary AWS credentials for client uploads (future)

## Authentication and Authorization

- **Cognito User Pools** - User sign-up, sign-in, token management
- **Cognito Groups** - Role mapping (admin, seller, customer)
- **JWT Tokens** - ID tokens for authentication, access tokens for authorization
- **Lambda Authorizers** - Token validation at API Gateway (optional)
- **Application-level RBAC** - Role checks in Lambda handlers
- **IAM Policies** - Least privilege access for Lambda execution roles

## Async and Eventing

- **EventBridge** - Event bus for domain events and async workflows
- **SQS** - Message queues for reliable async processing
- **Lambda Event Source Mappings** - Process SQS messages and EventBridge events
- **Dead Letter Queues** - Failed message handling and retry logic

## Observability

- **CloudWatch Logs** - Centralized structured logging
- **CloudWatch Metrics** - Custom metrics and operational dashboards
- **CloudWatch Alarms** - Alerting on errors, latency, throttles
- **AWS X-Ray** - Distributed tracing (optional)
- **Lambda Insights** - Enhanced Lambda monitoring (optional)

## Infrastructure

- **AWS CDK** - Infrastructure as code with TypeScript
- **CloudFormation** - Underlying deployment mechanism
- **Secrets Manager** - Secure storage for API keys and secrets
- **SSM Parameter Store** - Configuration values and non-sensitive settings
- **IAM** - Identity and access management

## External Integrations

- **WhatsApp Cloud API** - Meta's WhatsApp Business Platform for customer messaging
- **Razorpay** - Payment gateway for UPI, cards, wallets, net banking
- **Google Gemini** - AI for voice transcription, image analysis, multilingual support

## Frontend

- **Next.js 14+** - React framework for Admin and Seller web application
- **React** - UI component library
- **TypeScript** - Type-safe frontend code
- **Tailwind CSS** - Utility-first styling (assumed)

## Developer Tooling

- **Kiro** - AI-powered IDE and development assistant
- **MCP Servers** - Model Context Protocol servers for platform data access
- **pnpm** - Fast, disk-efficient package manager for monorepo
- **TypeScript** - Type checking across all packages
- **Jest** - Testing framework for unit and integration tests
- **ESLint** - Code linting and style enforcement
- **Prettier** - Code formatting

## Common Commands

### Local Development

```bash
# Install dependencies (from repository root)
pnpm install

# Build shared packages
pnpm --filter @vyapargyan/shared-contracts build

# Build API service
pnpm --filter @vyapargyan/api build

# Run type checking
pnpm --filter @vyapargyan/api typecheck

# Run linting
pnpm --filter @vyapargyan/api lint

# Run unit tests
pnpm --filter @vyapargyan/api test

# Run Next.js web app locally
pnpm --filter @vyapargyan/web dev

# Build MCP servers
cd tools/mcp/commerce-ops && pnpm build
cd tools/mcp/commerce-catalog && pnpm build
cd tools/mcp/commerce-admin && pnpm build
```

### Infrastructure and Deployment

```bash
# Navigate to CDK directory
cd infra/cdk

# Install CDK dependencies
pnpm install

# Synthesize CloudFormation templates
pnpm cdk synth

# Deploy to dev environment
pnpm cdk deploy --all --context env=dev

# Deploy to staging environment
pnpm cdk deploy --all --context env=staging

# Deploy to production environment
pnpm cdk deploy --all --context env=prod

# Diff changes before deployment
pnpm cdk diff --context env=dev

# Destroy stacks (use with caution)
pnpm cdk destroy --all --context env=dev
```

### Testing

```bash
# Run unit tests
pnpm --filter @vyapargyan/api test

# Run integration tests
pnpm --filter @vyapargyan/api test:integration

# Run contract tests
pnpm --filter @vyapargyan/shared-contracts test

# Test MCP servers
cd tools/mcp/commerce-ops && pnpm test
```

### AWS CLI Operations

```bash
# Tail Lambda logs
aws logs tail /aws/lambda/vyapargyan-dev-createProduct --follow --profile kiro-mcp

# Invoke Lambda function locally
aws lambda invoke --function-name vyapargyan-dev-createProduct \
  --payload file://test-event.json response.json --profile kiro-mcp

# Query DynamoDB table
aws dynamodb scan --table-name vyapargyan-dev-main \
  --profile kiro-mcp --region us-east-1

# List S3 objects
aws s3 ls s3://vyapargyan-dev-media/ --profile kiro-mcp
```

## Configuration

### Environment Variables

- Lambda functions receive configuration via environment variables
- Secrets stored in AWS Secrets Manager (API keys, credentials)
- Non-sensitive config in SSM Parameter Store
- Environment-specific values defined in CDK config files

### Required Configuration

- `AWS_REGION` - AWS region for services
- `TABLE_NAME` - DynamoDB table name
- `MEDIA_BUCKET` - S3 bucket for media uploads
- `USER_POOL_ID` - Cognito User Pool ID
- `USER_POOL_CLIENT_ID` - Cognito App Client ID
- `WHATSAPP_PHONE_NUMBER_ID` - WhatsApp Business Phone Number ID
- `WHATSAPP_ACCESS_TOKEN` - WhatsApp API access token (from Secrets Manager)
- `RAZORPAY_KEY_ID` - Razorpay API key ID (from Secrets Manager)
- `RAZORPAY_KEY_SECRET` - Razorpay API key secret (from Secrets Manager)
- `GEMINI_API_KEY` - Google Gemini API key (from Secrets Manager)

### AWS Profiles

- Use AWS CLI profiles for local development and MCP servers
- Profile `kiro-mcp` configured with read-only DynamoDB access
- Separate profiles for deployment (admin access)

## API Documentation

- API contracts defined in `docs/api_contract.md`
- Shared TypeScript types in `packages/shared-contracts/`
- Zod schemas provide runtime validation and type inference
- OpenAPI/Swagger generation possible via tooling (future)

## MCP Servers

Three local MCP servers provide read-only access to platform data:

- **commerce-ops-mcp** - Orders, payments, inventory, WhatsApp sessions, logs
- **commerce-catalog-mcp** - Products, categories, stock levels, media
- **commerce-admin-mcp** - Seller approvals, disputes, audit logs, analytics

Install all: `cd tools/mcp && ./install-all.sh`

Requires AWS credentials configured with profile `kiro-mcp` and DynamoDB read permissions.
