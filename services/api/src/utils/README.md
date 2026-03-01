# Utilities

This directory contains shared utility functions used across Lambda handlers.

## Configuration Loader (`config.ts`)

The configuration loader provides a centralized way to load and validate application configuration from multiple sources:

- **Environment Variables**: For simple, non-sensitive configuration
- **SSM Parameter Store**: For non-sensitive configuration that may change
- **AWS Secrets Manager**: For sensitive values like API keys and tokens

### Features

- **Zod Schema Validation**: All configuration is validated against a strict schema
- **Caching**: Configuration is cached after first load to avoid repeated AWS API calls
- **Environment-Specific Paths**: Secrets and parameters use environment prefixes (`/dev/`, `/staging/`, `/prod/`)
- **Clear Error Messages**: Validation errors provide detailed information about missing or invalid configuration

### Usage

```typescript
import { getConfig } from '@utils/config';

// In your Lambda handler
export const handler = async (event, context) => {
  const config = await getConfig();
  
  // Access configuration values
  console.log(`Environment: ${config.environment}`);
  console.log(`Table: ${config.tableName}`);
  
  // Use secrets
  const whatsappClient = new WhatsAppClient({
    apiUrl: config.whatsappApiUrl,
    token: config.whatsappToken,
  });
};
```

### Configuration Schema

The configuration includes the following values:

#### Environment Variables (Required)
- `ENVIRONMENT`: Environment name (`dev`, `staging`, or `prod`)
- `AWS_REGION`: AWS region (defaults to `us-east-1`)
- `TABLE_NAME`: DynamoDB table name
- `EVENT_BUS_NAME`: EventBridge event bus name
- `USER_POOL_ID`: Cognito User Pool ID
- `USER_POOL_CLIENT_ID`: Cognito User Pool Client ID
- `PRODUCT_IMAGES_BUCKET`: S3 bucket for product images
- `DOCUMENTS_BUCKET`: S3 bucket for documents
- `LOG_LEVEL`: Logging level (defaults to `info`)
- `WHATSAPP_API_URL`: WhatsApp API URL (defaults to `https://graph.facebook.com/v18.0`)

#### SSM Parameter Store
- `/{environment}/whatsapp/phone-number-id`: WhatsApp phone number ID
- `/{environment}/razorpay/key-id`: Razorpay API key ID

#### AWS Secrets Manager
- `/{environment}/whatsapp/token`: WhatsApp API token
- `/{environment}/razorpay/key-secret`: Razorpay API secret key
- `/{environment}/razorpay/webhook-secret`: Razorpay webhook secret
- `/{environment}/gemini/api-key`: Google Gemini API key

### Error Handling

The configuration loader throws errors in the following cases:

1. **Missing ENVIRONMENT variable**: The `ENVIRONMENT` environment variable must be set
2. **Invalid ENVIRONMENT value**: Must be `dev`, `staging`, or `prod`
3. **Missing required configuration**: Any required environment variable, parameter, or secret is missing
4. **Invalid configuration values**: Values don't match the schema (e.g., invalid URL format)
5. **AWS API errors**: Failed to retrieve parameters or secrets from AWS

### Testing

The configuration loader includes comprehensive unit tests covering:

- Successful configuration loading
- Configuration caching
- Environment-specific configuration
- Error handling for missing or invalid values
- Environment-specific secret paths

Run tests with:

```bash
npm test -- config.test.ts
```

### Cache Management

The configuration is cached after the first load to improve performance. In testing scenarios, you can clear the cache:

```typescript
import { clearConfigCache } from '@utils/config';

// Clear cache before each test
beforeEach(() => {
  clearConfigCache();
});
```

### Best Practices

1. **Load configuration once**: Call `getConfig()` at the start of your Lambda handler and reuse the result
2. **Don't log secrets**: Never log configuration values that contain secrets
3. **Use environment prefixes**: Always use environment-specific paths for secrets and parameters
4. **Validate early**: Configuration is validated at load time, so errors are caught before processing requests
5. **Cache across invocations**: Lambda containers are reused, so the cached configuration persists across invocations

### CDK Integration

When defining Lambda functions in CDK, ensure all required environment variables are set:

```typescript
const handler = new NodejsFunction(this, 'Handler', {
  entry: 'src/handlers/example.ts',
  environment: {
    ENVIRONMENT: props.environment,
    AWS_REGION: Stack.of(this).region,
    TABLE_NAME: table.tableName,
    EVENT_BUS_NAME: eventBus.eventBusName,
    USER_POOL_ID: userPool.userPoolId,
    USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
    PRODUCT_IMAGES_BUCKET: imagesBucket.bucketName,
    DOCUMENTS_BUCKET: documentsBucket.bucketName,
    LOG_LEVEL: 'info',
    WHATSAPP_API_URL: 'https://graph.facebook.com/v18.0',
  },
});

// Grant permissions to read secrets and parameters
handler.addToRolePolicy(new PolicyStatement({
  actions: [
    'ssm:GetParameter',
    'secretsmanager:GetSecretValue',
  ],
  resources: [
    `arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter/${props.environment}/*`,
    `arn:aws:secretsmanager:${Stack.of(this).region}:${Stack.of(this).account}:secret:/${props.environment}/*`,
  ],
}));
```

### Migration from Legacy System

This configuration loader replaces the legacy FastAPI/Supabase configuration system. Key differences:

- **AWS-native**: Uses AWS Secrets Manager and SSM instead of `.env` files
- **Type-safe**: Uses Zod for runtime validation instead of Pydantic
- **Cached**: Configuration is cached to avoid repeated AWS API calls
- **Environment-specific**: Secrets and parameters use environment prefixes for isolation

### Security Considerations

1. **Least Privilege IAM**: Lambda functions should only have access to secrets and parameters for their environment
2. **No Hardcoded Secrets**: Never hardcode secrets in code or environment variables
3. **Audit Logging**: AWS CloudTrail logs all Secrets Manager and SSM access
4. **Encryption**: Secrets Manager encrypts secrets at rest using AWS KMS
5. **Rotation**: Secrets should be rotated regularly (configure in Secrets Manager)

## Structured Logger (`logger.ts`)

The structured logger provides JSON-formatted logging with request ID context propagation for distributed tracing in CloudWatch Logs.

### Features

- **JSON Output**: All logs are output as JSON for easy parsing by CloudWatch Logs Insights
- **Request ID Propagation**: Automatic request ID tracking across async operations using AsyncLocalStorage
- **Log Levels**: Support for debug, info, warn, and error levels with environment-based filtering
- **Context Merging**: Merge default, async, and per-log context automatically
- **Error Formatting**: Automatic error object formatting with stack traces
- **Child Loggers**: Create child loggers with additional default context

### Usage

#### Basic Logging

```typescript
import { createLogger } from '@utils/logger';

const logger = createLogger();

logger.debug('Debug message');
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message', new Error('Something went wrong'));
```

#### With Context

```typescript
const logger = createLogger({ handler: 'auth-login' });

logger.info('User authenticated', { 
  userId: 'user-123',
  method: 'email',
  duration: 150 
});
```

#### Request ID Propagation

```typescript
import { createLogger, withContext } from '@utils/logger';
import { Context } from 'aws-lambda';

export const handler = async (event: any, context: Context) => {
  const logger = createLogger({ handler: 'auth-login' });
  
  // Run handler logic with request context
  return await withContext({ requestId: context.requestId }, async () => {
    logger.info('Request received', { method: event.requestContext.http.method });
    
    // All logs within this context will include the requestId
    const result = await processRequest(event);
    
    logger.info('Request completed', { statusCode: 200 });
    
    return result;
  });
};
```

#### Child Loggers

```typescript
const parentLogger = createLogger({ service: 'auth' });
const childLogger = parentLogger.child({ handler: 'login' });

// Child logger includes both service and handler in context
childLogger.info('Processing login');
```

### Log Output Format

All logs are output as JSON with the following structure:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "message": "User authenticated",
  "requestId": "aws-request-123",
  "userId": "user-456",
  "context": {
    "handler": "auth-login",
    "method": "email",
    "duration": 150
  }
}
```

Error logs include additional error information:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "error",
  "message": "Authentication failed",
  "requestId": "aws-request-123",
  "error": {
    "name": "AuthenticationError",
    "message": "Invalid credentials",
    "stack": "Error: Invalid credentials\n    at ..."
  },
  "context": {
    "handler": "auth-login"
  }
}
```

### Log Level Filtering

Set the `LOG_LEVEL` environment variable to control which logs are output:

- `debug`: All logs (debug, info, warn, error)
- `info`: Info, warn, and error logs (default)
- `warn`: Warn and error logs only
- `error`: Error logs only

```typescript
// In CDK stack
const handler = new NodejsFunction(this, 'Handler', {
  environment: {
    LOG_LEVEL: 'info', // or 'debug', 'warn', 'error'
  },
});
```

### Context Management

The logger uses Node.js AsyncLocalStorage for automatic context propagation:

```typescript
import { withContext, setContext, getContext } from '@utils/logger';

// Set initial context
await withContext({ requestId: 'req-123' }, async () => {
  // Add more context during execution
  setContext({ userId: 'user-456' });
  
  // Get current context
  const context = getContext();
  console.log(context); // { requestId: 'req-123', userId: 'user-456' }
  
  // All logs automatically include this context
  logger.info('Processing request');
});
```

### Best Practices

1. **Create logger once**: Create a logger instance at the module level or handler start
2. **Use request context**: Always wrap handler logic in `withContext()` for request ID tracking
3. **Add meaningful context**: Include relevant information in context for debugging
4. **Don't log secrets**: Never log sensitive information like passwords, tokens, or API keys
5. **Use appropriate levels**: Use debug for verbose info, info for normal flow, warn for issues, error for failures
6. **Include error objects**: Always pass error objects to `logger.error()` for stack traces

### CloudWatch Logs Insights Queries

Query logs by request ID:

```
fields @timestamp, level, message, context
| filter requestId = "aws-request-123"
| sort @timestamp desc
```

Query error logs:

```
fields @timestamp, message, error.message, error.stack
| filter level = "error"
| sort @timestamp desc
| limit 100
```

Query by user:

```
fields @timestamp, message, context
| filter userId = "user-456"
| sort @timestamp desc
```

### Testing

The logger includes comprehensive unit tests covering:

- Basic logging at all levels
- Context handling and merging
- Request ID propagation with AsyncLocalStorage
- Error formatting
- Log level filtering
- JSON output format validation

Run tests with:

```bash
npm test -- logger.test.ts
```

### Migration from Legacy System

This logger replaces the legacy FastAPI/structlog logging system. Key differences:

- **Lightweight**: No external dependencies (Winston/Pino), uses Node.js built-in capabilities
- **AsyncLocalStorage**: Uses Node.js AsyncLocalStorage instead of Python contextvars
- **JSON-only**: Always outputs JSON (no text formatting options)
- **CloudWatch-optimized**: Designed specifically for CloudWatch Logs parsing
