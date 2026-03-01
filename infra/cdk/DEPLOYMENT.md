# VyaparGyan CDK Deployment Guide

This guide covers deploying the VyaparGyan infrastructure to AWS using CDK.

## Prerequisites

1. **AWS Account**: You need an AWS account with appropriate permissions
2. **AWS CLI**: Install and configure AWS CLI v2
3. **Node.js**: Version 20.x or later
4. **pnpm**: Version 8.x or later
5. **AWS CDK**: Install globally with `npm install -g aws-cdk`

## Initial Setup

### 1. Configure AWS Credentials

```bash
# Configure AWS CLI with your credentials
aws configure

# Verify configuration
aws sts get-caller-identity
```

### 2. Install Dependencies

From the repository root:

```bash
pnpm install
```

### 3. Bootstrap CDK (One-time per account/region)

Bootstrap CDK in your AWS account for each region you plan to deploy to:

```bash
# Bootstrap for us-east-1
cdk bootstrap aws://ACCOUNT-ID/us-east-1

# Example
cdk bootstrap aws://123456789012/us-east-1
```

## Environment Configuration

The CDK application supports three environments:

- **dev**: Development environment with minimal resources and costs
- **staging**: Pre-production environment mirroring production
- **prod**: Production environment with high availability and durability

### Setting Environment Variables

Create a `.env` file or export environment variables:

```bash
export ENVIRONMENT=dev
export CDK_DEFAULT_ACCOUNT=123456789012
export CDK_DEFAULT_REGION=us-east-1
```

### Using Context Variables

Alternatively, pass configuration via CDK context:

```bash
cdk synth -c environment=dev -c account=123456789012 -c region=us-east-1
```

## Deployment Process

### Development Environment

```bash
# Synthesize CloudFormation templates
pnpm --filter @vyapargyan/infra cdk synth -c environment=dev

# Review changes
pnpm --filter @vyapargyan/infra cdk diff -c environment=dev

# Deploy all stacks
pnpm --filter @vyapargyan/infra cdk deploy --all -c environment=dev

# Deploy specific stack
pnpm --filter @vyapargyan/infra cdk deploy VyaparGyan-Dev-DatabaseStack -c environment=dev
```

### Staging Environment

```bash
# Synthesize
pnpm --filter @vyapargyan/infra cdk synth -c environment=staging

# Review changes
pnpm --filter @vyapargyan/infra cdk diff -c environment=staging

# Deploy
pnpm --filter @vyapargyan/infra cdk deploy --all -c environment=staging
```

### Production Environment

```bash
# Synthesize
pnpm --filter @vyapargyan/infra cdk synth -c environment=prod

# Review changes (IMPORTANT!)
pnpm --filter @vyapargyan/infra cdk diff -c environment=prod

# Deploy with approval
pnpm --filter @vyapargyan/infra cdk deploy --all -c environment=prod --require-approval broadening
```

## Stack Deployment Order

CDK automatically handles stack dependencies, but for reference, the deployment order is:

1. **DatabaseStack**: DynamoDB tables
2. **StorageStack**: S3 buckets
3. **AuthStack**: Cognito User Pools
4. **ApiStack**: API Gateway + Lambda functions (depends on Database, Storage, Auth)
5. **EventsStack**: EventBridge + SQS (depends on Database)
6. **MonitoringStack**: CloudWatch alarms (depends on all stacks)

## Post-Deployment Steps

### 1. Verify Stack Deployment

```bash
# List all stacks
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE

# Describe specific stack
aws cloudformation describe-stacks --stack-name VyaparGyan-Dev-DatabaseStack
```

### 2. Configure Secrets

After deployment, populate secrets in AWS Secrets Manager:

```bash
# WhatsApp API token
aws secretsmanager put-secret-value \
  --secret-id /dev/whatsapp/api-token \
  --secret-string "your-whatsapp-token"

# Razorpay credentials
aws secretsmanager put-secret-value \
  --secret-id /dev/razorpay/key-secret \
  --secret-string "your-razorpay-secret"

# Gemini API key
aws secretsmanager put-secret-value \
  --secret-id /dev/gemini/api-key \
  --secret-string "your-gemini-key"
```

### 3. Configure SSM Parameters

```bash
# Razorpay Key ID (non-sensitive)
aws ssm put-parameter \
  --name /dev/razorpay/key-id \
  --value "rzp_test_xxxxx" \
  --type String
```

### 4. Test API Endpoints

```bash
# Get API Gateway URL from stack outputs
aws cloudformation describe-stacks \
  --stack-name VyaparGyan-Dev-ApiStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text

# Test health endpoint
curl https://your-api-url/health
```

## Updating Infrastructure

### Making Changes

1. Modify CDK code in `lib/` directory
2. Build TypeScript: `pnpm build`
3. Review changes: `pnpm cdk diff -c environment=dev`
4. Deploy changes: `pnpm cdk deploy -c environment=dev`

### Rolling Back

If deployment fails or you need to rollback:

```bash
# Rollback to previous version (CloudFormation automatic rollback)
# Or manually destroy and redeploy
pnpm cdk destroy VyaparGyan-Dev-ApiStack -c environment=dev
pnpm cdk deploy VyaparGyan-Dev-ApiStack -c environment=dev
```

## Destroying Infrastructure

**WARNING**: This will delete all resources and data. Use with caution!

```bash
# Destroy all stacks
pnpm --filter @vyapargyan/infra cdk destroy --all -c environment=dev

# Destroy specific stack
pnpm --filter @vyapargyan/infra cdk destroy VyaparGyan-Dev-ApiStack -c environment=dev
```

## Troubleshooting

### "Unable to resolve AWS account"

Ensure AWS CLI is configured:

```bash
aws configure
aws sts get-caller-identity
```

### "Stack already exists"

If a stack exists and you want to update it, use `cdk deploy`. To start fresh:

```bash
pnpm cdk destroy <stack-name>
pnpm cdk deploy <stack-name>
```

### "Insufficient permissions"

Ensure your IAM user/role has the following permissions:
- CloudFormation full access
- IAM role creation
- Service-specific permissions (Lambda, DynamoDB, S3, etc.)

### "Resource limit exceeded"

Check AWS service quotas:

```bash
aws service-quotas list-service-quotas --service-code lambda
```

Request quota increases if needed through AWS Support.

### CDK Bootstrap Issues

If bootstrap fails, ensure you have:
- Administrator access or equivalent permissions
- Correct account ID and region
- No conflicting CDK bootstrap stacks

## Monitoring Deployments

### CloudFormation Events

```bash
# Watch stack events during deployment
aws cloudformation describe-stack-events \
  --stack-name VyaparGyan-Dev-ApiStack \
  --max-items 20
```

### CloudWatch Logs

```bash
# View Lambda function logs
aws logs tail /aws/lambda/VyaparGyan-Dev-LoginHandler --follow
```

## Cost Optimization

### Development Environment

- Use on-demand billing for DynamoDB
- Disable point-in-time recovery
- Use shorter log retention (7 days)
- Use smaller Lambda memory allocations

### Production Environment

- Use provisioned capacity for DynamoDB if predictable traffic
- Enable point-in-time recovery
- Use longer log retention (90+ days)
- Enable CloudWatch alarms for cost anomalies

## Security Best Practices

1. **Never commit secrets**: Use AWS Secrets Manager or SSM Parameter Store
2. **Use least privilege IAM**: Grant only necessary permissions
3. **Enable encryption**: All data at rest and in transit
4. **Enable CloudTrail**: Audit all API calls
5. **Use VPC endpoints**: For private communication between services
6. **Enable MFA**: For production deployments

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy CDK

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - name: Install dependencies
        run: pnpm install
      - name: Deploy to staging
        run: pnpm --filter @vyapargyan/infra cdk deploy --all -c environment=staging --require-approval never
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: us-east-1
```

## Additional Resources

- [AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/latest/guide/best-practices.html)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [CDK Workshop](https://cdkworkshop.com/)
