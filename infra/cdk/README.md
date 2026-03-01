# VyaparGyan CDK Infrastructure

This directory contains the AWS CDK infrastructure code for the VyaparGyan platform. The infrastructure is defined using TypeScript and AWS CDK v2.

## Prerequisites

- Node.js 20.x or later
- pnpm 8.x or later
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

## Project Structure

```
infra/cdk/
├── bin/
│   └── app.ts              # CDK app entry point
├── lib/
│   ├── config/             # Environment-specific configuration
│   ├── stacks/             # CDK stack definitions
│   └── constructs/         # Reusable CDK constructs
├── cdk.json                # CDK configuration
├── package.json            # Dependencies and scripts
└── tsconfig.json           # TypeScript configuration
```

## Installation

From the repository root:

```bash
pnpm install
```

Or from this directory:

```bash
pnpm install
```

## Configuration

The CDK application supports three environments: `dev`, `staging`, and `prod`. Environment-specific configuration is loaded from `lib/config/{environment}.ts`.

### Context Variables

You can pass configuration via CDK context:

```bash
cdk synth -c environment=dev -c account=123456789012 -c region=us-east-1
```

### Environment Variables

Alternatively, use environment variables:

```bash
export ENVIRONMENT=dev
export CDK_DEFAULT_ACCOUNT=123456789012
export CDK_DEFAULT_REGION=us-east-1
```

## Available Commands

### Build

Compile TypeScript to JavaScript:

```bash
pnpm build
```

### Synthesize

Generate CloudFormation templates:

```bash
pnpm synth
# or
pnpm cdk synth
```

### Deploy

Deploy stacks to AWS:

```bash
# Deploy all stacks
pnpm deploy

# Deploy specific stack
pnpm cdk deploy VyaparGyan-Dev-DatabaseStack

# Deploy with context
pnpm cdk deploy -c environment=staging
```

### Diff

Compare deployed stack with current state:

```bash
pnpm diff
# or
pnpm cdk diff
```

### Destroy

Remove deployed stacks:

```bash
pnpm destroy
# or
pnpm cdk destroy
```

### Test

Run unit tests:

```bash
pnpm test
```

## Environment-Specific Deployments

### Development

```bash
pnpm cdk deploy -c environment=dev
```

### Staging

```bash
pnpm cdk deploy -c environment=staging
```

### Production

```bash
pnpm cdk deploy -c environment=prod
```

## Stack Organization

The infrastructure is organized into logical stacks with clear dependencies:

1. **DatabaseStack**: DynamoDB tables with GSIs
2. **StorageStack**: S3 buckets for images, documents, logs
3. **AuthStack**: Cognito User Pools and App Clients
4. **ApiStack**: API Gateway, Lambda functions, integrations
5. **EventsStack**: EventBridge event bus, SQS queues, worker Lambdas
6. **MonitoringStack**: CloudWatch alarms and dashboards

## Useful CDK Commands

- `cdk ls` - List all stacks in the app
- `cdk synth` - Emit the synthesized CloudFormation template
- `cdk deploy` - Deploy this stack to your default AWS account/region
- `cdk diff` - Compare deployed stack with current state
- `cdk docs` - Open CDK documentation
- `cdk bootstrap` - Bootstrap CDK in your AWS account (one-time setup)

## Bootstrap

Before deploying for the first time, bootstrap CDK in your AWS account:

```bash
cdk bootstrap aws://ACCOUNT-NUMBER/REGION
```

Example:

```bash
cdk bootstrap aws://123456789012/us-east-1
```

## Troubleshooting

### "Unable to resolve AWS account"

Ensure your AWS CLI is configured:

```bash
aws configure
```

Or set environment variables:

```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_DEFAULT_REGION=us-east-1
```

### "Stack already exists"

If a stack already exists and you want to update it, use `cdk deploy`. If you want to start fresh, use `cdk destroy` first.

### TypeScript compilation errors

Ensure you have the latest dependencies:

```bash
pnpm install
pnpm build
```

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/latest/guide/home.html)
- [AWS CDK API Reference](https://docs.aws.amazon.com/cdk/api/latest/)
- [CDK Patterns](https://cdkpatterns.com/)
