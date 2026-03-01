# Environment Configuration

This directory contains environment-specific configuration for the VyaparGyan CDK infrastructure. Each environment (dev, staging, prod) has its own configuration file with tailored settings for AWS resources.

## Files

- **environment.ts**: TypeScript types and interfaces for environment configuration
- **dev.ts**: Development environment configuration (cost-optimized, relaxed security)
- **staging.ts**: Staging environment configuration (production-like for testing)
- **prod.ts**: Production environment configuration (maximum reliability and security)
- **index.ts**: Central export point and configuration factory functions

## Usage

### Loading Configuration

```typescript
import { getEnvironmentConfig, validateConfig } from './lib/config';

// Load configuration for a specific environment
const config = getEnvironmentConfig('dev', 'AWS_ACCOUNT_ID', 'us-east-1');

// Validate configuration
validateConfig(config);
```

### Using Configuration in Stacks

```typescript
import { DatabaseStack } from './lib/stacks/database-stack';
import { getEnvironmentConfig } from './lib/config';

const config = getEnvironmentConfig('dev', account, region);

// Pass configuration to stacks
const databaseStack = new DatabaseStack(app, 'DatabaseStack', {
  env: { account: config.account, region: config.region },
  config: config,
});
```

## Configuration Structure

Each environment configuration includes:

### DynamoDB Settings
- Billing mode (on-demand vs provisioned)
- Point-in-time recovery
- Deletion protection
- Read/write capacity (for provisioned mode)

### S3 Settings
- Versioning
- Lifecycle policies (transition to IA, Glacier, expiration)
- Access logging

### CloudWatch Logs Settings
- Retention period (7 days for dev, 30 for staging, 90 for prod)
- Log level (debug, info, warn, error)

### Lambda Settings
- Memory size
- Timeout duration
- Reserved concurrent executions
- X-Ray tracing

### API Gateway Settings
- Throttle rate and burst limits
- Access logging
- Detailed metrics

### SQS Settings
- Visibility timeout
- Message retention period
- Max receive count for DLQ
- DLQ retention period

### Cognito Settings
- Password policy requirements
- Token validity durations
- MFA configuration

### CloudWatch Alarms Settings
- Error rate thresholds
- Throttle thresholds
- Evaluation periods
- Alarm enable/disable

### CORS Settings
- Allowed origins
- Allowed methods and headers
- Max age for preflight cache

### Resource Naming
- Resource prefix (e.g., "dev-vyapargyan")
- Common tags for all resources

## Environment Differences

### Development (dev)
- **Cost-optimized**: On-demand billing, no versioning, short retention
- **Relaxed security**: Simpler password policy, no MFA
- **Debug logging**: Detailed logs for troubleshooting
- **Alarms disabled**: Reduce noise during development
- **CORS**: Allows localhost origins

### Staging (staging)
- **Production-like**: Similar settings to prod for realistic testing
- **Moderate costs**: Balance between cost and production readiness
- **Info logging**: Standard logging level
- **Alarms enabled**: Moderate thresholds
- **CORS**: Allows staging domains

### Production (prod)
- **Maximum reliability**: Provisioned capacity, versioning, PITR
- **Strict security**: Strong password policy, MFA enabled
- **Info logging**: Production-appropriate logging
- **Alarms enabled**: Strict thresholds for early detection
- **CORS**: Production domains only
- **Data protection**: No automatic deletion, comprehensive backups

## Adding New Configuration

To add a new configuration parameter:

1. Add the type definition to `environment.ts`
2. Add the value to each environment file (`dev.ts`, `staging.ts`, `prod.ts`)
3. Update validation in `index.ts` if needed
4. Document the new parameter in this README

## Validation

The `validateConfig()` function ensures:
- Required fields are present (account, region, environment)
- Environment is one of: dev, staging, prod
- Provisioned DynamoDB has capacity values
- Lambda memory is within AWS limits (128-10240 MB)
- API Gateway throttle limits are positive
- CORS has at least one allowed origin

## Example: Creating a New Environment

To add a new environment (e.g., "qa"):

1. Create `infra/cdk/lib/config/qa.ts`:
```typescript
export function getQAConfig(account: string, region: string = 'us-east-1'): EnvironmentConfig {
  return {
    environment: 'qa',
    // ... configuration values
  };
}
```

2. Update `environment.ts` to include 'qa' in `EnvironmentType`:
```typescript
export type EnvironmentType = 'dev' | 'staging' | 'prod' | 'qa';
```

3. Update `index.ts` to export and handle the new environment:
```typescript
export { getQAConfig } from './qa';

// Add case in getEnvironmentConfig()
case 'qa':
  return getQAConfig(account, region);
```

4. Update validation in `index.ts` to include 'qa'

## Best Practices

1. **Environment Isolation**: Each environment has completely separate resources with distinct naming
2. **Cost Optimization**: Dev uses cheaper settings, prod uses reliable settings
3. **Security Progression**: Security increases from dev → staging → prod
4. **Consistent Structure**: All environments use the same configuration structure
5. **Validation**: Always validate configuration before using it
6. **Documentation**: Keep this README updated when adding new parameters
