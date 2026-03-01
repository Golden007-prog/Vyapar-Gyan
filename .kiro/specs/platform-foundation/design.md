# Platform Foundation Design

## Overview

This design establishes the production-ready AWS serverless foundation for VyaparGyan, a WhatsApp-first commerce platform serving three personas (Admin, Seller, Customer). This represents a strategic architecture replacement, migrating from the legacy FastAPI/Supabase stack to a modern AWS-native serverless architecture.

### Architecture Principles

- **Serverless-first**: Leverage AWS managed services to minimize operational overhead
- **Event-driven**: Use EventBridge and SQS for asynchronous workflows and service decoupling
- **Infrastructure as Code**: All infrastructure defined in AWS CDK with TypeScript
- **Multi-environment**: Support dev, staging, and prod with complete isolation
- **Observability**: Structured logging, distributed tracing, and comprehensive monitoring
- **Security**: Least-privilege IAM, secrets management, and defense in depth

### Technology Stack

- **Compute**: AWS Lambda (Node.js 20 runtime, TypeScript)
- **API**: API Gateway (HTTP API v2 for REST, WebSocket API for real-time)
- **Authentication**: Amazon Cognito User Pools
- **Database**: DynamoDB (single-table design with GSIs)
- **Storage**: S3 (product images, documents, logs)
- **Events**: EventBridge (event bus) + SQS (queues)
- **Monitoring**: CloudWatch Logs, Metrics, Alarms
- **Secrets**: AWS Secrets Manager + SSM Parameter Store
- **IaC**: AWS CDK v2 with TypeScript
- **Package Manager**: pnpm with workspaces

### Migration Context

This design replaces the legacy FastAPI/Python/Supabase architecture. The legacy system is considered prior architecture and will be phased out. Migration planning may be handled in a separate migration spec; this design focuses on the target-state platform foundation optimized for AWS serverless.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Web Admin   │  │  Web Seller  │  │   WhatsApp   │          │
│  │     App      │  │     App      │  │   Customer   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
          └──────────────────┴──────────────────┘
                             │
          ┌──────────────────▼──────────────────┐
          │      Amazon CloudFront (CDN)        │
          └──────────────────┬──────────────────┘
                             │
          ┌──────────────────▼──────────────────┐
          │      API Gateway (HTTP + WS)        │
          │  - REST endpoints (/api/v1/*)       │
          │  - WebSocket (/ws)                  │
          │  - Cognito Authorizer               │
          └──────────────────┬──────────────────┘
                             │
          ┌──────────────────▼──────────────────┐
          │         Lambda Functions            │
          │  ┌────────────────────────────┐     │
          │  │  Auth  │ Catalog │ Orders  │     │
          │  │  Admin │ Seller  │ WhatsApp│     │
          │  │  Payments │ WebSocket      │     │
          │  └────────────────────────────┘     │
          └──────────┬───────────┬───────────────┘
                     │           │
       ┌─────────────▼───┐   ┌───▼──────────────┐
       │   DynamoDB      │   │  EventBridge     │
       │  - Single table │   │  - Event bus     │
       │  - GSIs         │   │  - Event rules   │
       └─────────────────┘   └───┬──────────────┘
                                 │
                     ┌───────────▼───────────┐
                     │    SQS Queues         │
                     │  - Order processing   │
                     │  - Notification queue │
                     │  - DLQ                │
                     └───────────┬───────────┘
                                 │
                     ┌───────────▼───────────┐
                     │  Worker Lambdas       │
                     │  - Async processors   │
                     └───────────────────────┘

       ┌─────────────────────────────────────────┐
       │         Supporting Services              │
       │  ┌──────────┐  ┌──────────┐  ┌────────┐│
       │  │ Cognito  │  │    S3    │  │Secrets ││
       │  │User Pools│  │ Buckets  │  │Manager ││
       │  └──────────┘  └──────────┘  └────────┘│
       └─────────────────────────────────────────┘
```

### Repository Structure

The mono-repo is organized into four top-level directories:

```
vyapargyan/
├── infra/
│   └── cdk/
│       ├── bin/
│       │   └── app.ts                    # CDK app entry point
│       ├── lib/
│       │   ├── stacks/
│       │   │   ├── network-stack.ts      # VPC, subnets (if needed)
│       │   │   ├── database-stack.ts     # DynamoDB tables
│       │   │   ├── storage-stack.ts      # S3 buckets
│       │   │   ├── auth-stack.ts         # Cognito user pools
│       │   │   ├── api-stack.ts          # API Gateway + Lambda
│       │   │   ├── events-stack.ts       # EventBridge + SQS
│       │   │   └── monitoring-stack.ts   # CloudWatch alarms
│       │   ├── constructs/
│       │   │   ├── lambda-function.ts    # Reusable Lambda construct
│       │   │   ├── api-route.ts          # API route construct
│       │   │   └── queue-processor.ts    # SQS processor construct
│       │   └── config/
│       │       ├── environment.ts        # Environment config types
│       │       ├── dev.ts                # Dev environment config
│       │       ├── staging.ts            # Staging environment config
│       │       └── prod.ts               # Prod environment config
│       ├── cdk.json
│       ├── package.json
│       └── tsconfig.json
├── services/
│   └── api/
│       ├── src/
│       │   ├── handlers/
│       │   │   ├── auth/
│       │   │   │   ├── login.ts
│       │   │   │   ├── refresh.ts
│       │   │   │   └── logout.ts
│       │   │   ├── admin/
│       │   │   │   ├── approve-seller.ts
│       │   │   │   ├── manage-categories.ts
│       │   │   │   └── resolve-dispute.ts
│       │   │   ├── seller/
│       │   │   │   ├── create-product.ts
│       │   │   │   ├── update-inventory.ts
│       │   │   │   └── list-orders.ts
│       │   │   ├── catalog/
│       │   │   │   ├── browse-products.ts
│       │   │   │   └── search-products.ts
│       │   │   ├── orders/
│       │   │   │   ├── create-order.ts
│       │   │   │   ├── get-order.ts
│       │   │   │   └── update-status.ts
│       │   │   ├── whatsapp/
│       │   │   │   ├── webhook.ts
│       │   │   │   └── send-message.ts
│       │   │   ├── payments/
│       │   │   │   └── webhook.ts
│       │   │   └── websocket/
│       │   │       ├── connect.ts
│       │   │       ├── disconnect.ts
│       │   │       └── message.ts
│       │   ├── middleware/
│       │   │   ├── auth.ts               # JWT verification
│       │   │   ├── error-handler.ts      # Global error handling
│       │   │   ├── logger.ts             # Request logging
│       │   │   ├── validator.ts          # Schema validation
│       │   │   └── cors.ts               # CORS handling
│       │   ├── repositories/
│       │   │   ├── base-repository.ts    # Base DynamoDB operations
│       │   │   ├── user-repository.ts
│       │   │   ├── product-repository.ts
│       │   │   ├── order-repository.ts
│       │   │   └── session-repository.ts
│       │   ├── services/
│       │   │   ├── catalog-service.ts
│       │   │   ├── order-service.ts
│       │   │   ├── whatsapp-service.ts
│       │   │   └── payment-service.ts
│       │   ├── integrations/
│       │   │   ├── whatsapp-client.ts
│       │   │   ├── razorpay-client.ts
│       │   │   └── gemini-client.ts
│       │   └── utils/
│       │       ├── config.ts             # Environment config loader
│       │       ├── logger.ts             # Structured logging
│       │       ├── response.ts           # Response formatters
│       │       ├── errors.ts             # Custom error classes
│       │       └── validation.ts         # Validation helpers
│       ├── package.json
│       └── tsconfig.json
├── apps/
│   └── web/
│       ├── admin/                        # Admin dashboard (Next.js)
│       ├── seller/                       # Seller dashboard (Next.js)
│       └── shared/                       # Shared UI components
├── packages/
│   └── shared/
│       ├── contracts/                    # Shared TypeScript types
│       │   ├── api/
│       │   │   ├── requests.ts
│       │   │   └── responses.ts
│       │   ├── domain/
│       │   │   ├── user.ts
│       │   │   ├── product.ts
│       │   │   ├── order.ts
│       │   │   └── payment.ts
│       │   └── events/
│       │       ├── order-events.ts
│       │       └── payment-events.ts
│       └── utils/                        # Shared utilities
├── pnpm-workspace.yaml
├── package.json
├── .gitignore
└── README.md
```

### Stack Organization

Infrastructure is organized into logical CDK stacks with clear dependencies:

1. **NetworkStack** (optional): VPC and networking resources if Lambda needs VPC access
2. **DatabaseStack**: DynamoDB tables with GSIs
3. **StorageStack**: S3 buckets for images, documents, logs
4. **AuthStack**: Cognito User Pools and App Clients
5. **ApiStack**: API Gateway, Lambda functions, integrations (depends on Database, Storage, Auth)
6. **EventsStack**: EventBridge event bus, SQS queues, worker Lambdas (depends on Database)
7. **MonitoringStack**: CloudWatch alarms, dashboards (depends on all stacks)

Stack dependencies are explicitly declared in CDK to ensure correct deployment order.

## Components and Interfaces

### Lambda Function Architecture

All Lambda functions follow a consistent structure:

```typescript
// Handler structure
export const handler = async (
  event: APIGatewayProxyEventV2 | SQSEvent | EventBridgeEvent,
  context: Context
): Promise<APIGatewayProxyResultV2 | void> => {
  const logger = createLogger({ requestId: context.requestId });
  
  try {
    // 1. Middleware chain
    await applyMiddleware(event, [
      loggerMiddleware(logger),
      errorHandlerMiddleware,
      authMiddleware, // if protected
      validatorMiddleware(schema) // if validation needed
    ]);
    
    // 2. Parse and validate input
    const input = parseInput(event);
    
    // 3. Business logic
    const result = await executeBusinessLogic(input);
    
    // 4. Format response
    return formatResponse(200, result);
  } catch (error) {
    logger.error('Handler error', { error });
    return formatErrorResponse(error);
  }
};
```

### Middleware System

Middleware provides cross-cutting concerns:

**Logger Middleware**:
```typescript
export const loggerMiddleware = (logger: Logger) => async (
  event: APIGatewayProxyEventV2,
  next: NextFunction
) => {
  logger.info('Request received', {
    method: event.requestContext.http.method,
    path: event.requestContext.http.path,
    sourceIp: event.requestContext.http.sourceIp
  });
  
  const startTime = Date.now();
  const result = await next();
  
  logger.info('Request completed', {
    duration: Date.now() - startTime,
    statusCode: result.statusCode
  });
  
  return result;
};
```

**Auth Middleware**:
```typescript
export const authMiddleware = async (
  event: APIGatewayProxyEventV2,
  next: NextFunction
) => {
  const token = extractToken(event.headers.authorization);
  
  if (!token) {
    throw new UnauthorizedError('Missing authorization token');
  }
  
  const user = await verifyToken(token);
  event.requestContext.authorizer = { user };
  
  return next();
};
```

**Validator Middleware**:
```typescript
export const validatorMiddleware = (schema: ZodSchema) => async (
  event: APIGatewayProxyEventV2,
  next: NextFunction
) => {
  const body = JSON.parse(event.body || '{}');
  const validated = schema.parse(body); // Throws if invalid
  event.body = JSON.stringify(validated);
  return next();
};
```

### Repository Layer

The repository layer abstracts DynamoDB operations:

**Base Repository**:
```typescript
export abstract class BaseRepository<T> {
  constructor(
    protected tableName: string,
    protected docClient: DynamoDBDocumentClient
  ) {}
  
  async get(pk: string, sk?: string): Promise<T | null> {
    const params = {
      TableName: this.tableName,
      Key: sk ? { PK: pk, SK: sk } : { PK: pk }
    };
    
    const result = await this.docClient.send(new GetCommand(params));
    return result.Item as T | null;
  }
  
  async put(item: T): Promise<void> {
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item
    }));
  }
  
  async query(params: QueryCommandInput): Promise<T[]> {
    const result = await this.docClient.send(new QueryCommand(params));
    return result.Items as T[];
  }
  
  async scan(params: ScanCommandInput): Promise<T[]> {
    const result = await this.docClient.send(new ScanCommand(params));
    return result.Items as T[];
  }
  
  async delete(pk: string, sk?: string): Promise<void> {
    await this.docClient.send(new DeleteCommand({
      TableName: this.tableName,
      Key: sk ? { PK: pk, SK: sk } : { PK: pk }
    }));
  }
}
```

**Domain Repository Example**:
```typescript
export class ProductRepository extends BaseRepository<Product> {
  async getProductById(productId: string): Promise<Product | null> {
    return this.get(`PRODUCT#${productId}`, `METADATA`);
  }
  
  async listProductsBySeller(sellerId: string): Promise<Product[]> {
    return this.query({
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :sellerId',
      ExpressionAttributeValues: {
        ':sellerId': `SELLER#${sellerId}`
      }
    });
  }
  
  async createProduct(product: Product): Promise<void> {
    const item = {
      PK: `PRODUCT#${product.id}`,
      SK: 'METADATA',
      GSI1PK: `SELLER#${product.sellerId}`,
      GSI1SK: `PRODUCT#${product.id}`,
      ...product,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await this.put(item);
  }
}
```

### API Gateway Integration

**HTTP API Routes**:
```typescript
// In CDK ApiStack
const httpApi = new HttpApi(this, 'HttpApi', {
  apiName: `${props.environment}-vyapargyan-api`,
  corsPreflight: {
    allowOrigins: props.allowedOrigins,
    allowMethods: [CorsHttpMethod.ANY],
    allowHeaders: ['*'],
    maxAge: Duration.days(1)
  }
});

// Add routes
httpApi.addRoutes({
  path: '/api/v1/auth/login',
  methods: [HttpMethod.POST],
  integration: new HttpLambdaIntegration('LoginIntegration', loginFunction)
});

httpApi.addRoutes({
  path: '/api/v1/products',
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration('ListProductsIntegration', listProductsFunction),
  authorizer: cognitoAuthorizer
});
```

**WebSocket API**:
```typescript
const webSocketApi = new WebSocketApi(this, 'WebSocketApi', {
  apiName: `${props.environment}-vyapargyan-ws`,
  connectRouteOptions: {
    integration: new WebSocketLambdaIntegration('ConnectIntegration', connectFunction)
  },
  disconnectRouteOptions: {
    integration: new WebSocketLambdaIntegration('DisconnectIntegration', disconnectFunction)
  },
  defaultRouteOptions: {
    integration: new WebSocketLambdaIntegration('MessageIntegration', messageFunction)
  }
});
```

### Event-Driven Architecture

**EventBridge Integration**:
```typescript
// Publish events
export const publishEvent = async (
  eventBus: string,
  detailType: string,
  detail: any
) => {
  const eventBridge = new EventBridgeClient({});
  
  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      EventBusName: eventBus,
      Source: 'vyapargyan.orders',
      DetailType: detailType,
      Detail: JSON.stringify(detail),
      Time: new Date()
    }]
  }));
};

// Example: Order created event
await publishEvent(
  process.env.EVENT_BUS_NAME!,
  'OrderCreated',
  {
    orderId: order.id,
    sellerId: order.sellerId,
    customerId: order.customerId,
    totalAmount: order.totalAmount
  }
);
```

**SQS Queue Processing**:
```typescript
export const handler = async (event: SQSEvent): Promise<void> => {
  const logger = createLogger({ handler: 'order-processor' });
  
  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      await processOrder(message);
      
      logger.info('Order processed', { orderId: message.orderId });
    } catch (error) {
      logger.error('Failed to process order', { error, record });
      throw error; // Will send to DLQ after retries
    }
  }
};
```

### Configuration Management

**Environment Configuration**:
```typescript
// utils/config.ts
import { z } from 'zod';

const configSchema = z.object({
  environment: z.enum(['dev', 'staging', 'prod']),
  region: z.string(),
  tableName: z.string(),
  eventBusName: z.string(),
  userPoolId: z.string(),
  whatsappApiUrl: z.string(),
  whatsappToken: z.string(),
  razorpayKeyId: z.string(),
  razorpayKeySecret: z.string(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type Config = z.infer<typeof configSchema>;

let cachedConfig: Config | null = null;

export const getConfig = async (): Promise<Config> => {
  if (cachedConfig) {
    return cachedConfig;
  }
  
  const ssm = new SSMClient({});
  const secrets = new SecretsManagerClient({});
  
  // Load from environment variables and AWS services
  const config = {
    environment: process.env.ENVIRONMENT!,
    region: process.env.AWS_REGION!,
    tableName: process.env.TABLE_NAME!,
    eventBusName: process.env.EVENT_BUS_NAME!,
    userPoolId: process.env.USER_POOL_ID!,
    whatsappApiUrl: process.env.WHATSAPP_API_URL!,
    whatsappToken: await getSecret(secrets, 'whatsapp-token'),
    razorpayKeyId: await getParameter(ssm, '/razorpay/key-id'),
    razorpayKeySecret: await getSecret(secrets, 'razorpay-key-secret'),
    logLevel: process.env.LOG_LEVEL || 'info'
  };
  
  cachedConfig = configSchema.parse(config);
  return cachedConfig;
};
```

## Data Models

### DynamoDB Single-Table Design

The platform uses a single DynamoDB table with the following structure:

**Table Schema**:
- **Primary Key**: `PK` (Partition Key), `SK` (Sort Key)
- **GSI1**: `GSI1PK` (Partition Key), `GSI1SK` (Sort Key)
- **GSI2**: `GSI2PK` (Partition Key), `GSI2SK` (Sort Key)
- **GSI3**: `GSI3PK` (Partition Key), `GSI3SK` (Sort Key)

**Access Patterns**:

| Entity | PK | SK | GSI1PK | GSI1SK | GSI2PK | GSI2SK | Access Pattern |
|--------|----|----|--------|--------|--------|--------|----------------|
| User | USER#{userId} | METADATA | ROLE#{role} | USER#{userId} | EMAIL#{email} | USER#{userId} | Get user by ID, list by role, find by email |
| Product | PRODUCT#{productId} | METADATA | SELLER#{sellerId} | PRODUCT#{productId} | CATEGORY#{categoryId} | PRODUCT#{productId} | Get product, list by seller, list by category |
| Order | ORDER#{orderId} | METADATA | CUSTOMER#{customerId} | ORDER#{orderId}#{timestamp} | SELLER#{sellerId} | ORDER#{orderId}#{timestamp} | Get order, list by customer, list by seller |
| OrderItem | ORDER#{orderId} | ITEM#{productId} | - | - | - | - | Get order items |
| Inventory | PRODUCT#{productId} | INVENTORY | - | - | - | - | Get/update inventory |
| WhatsAppSession | SESSION#{phoneNumber} | METADATA | - | - | - | - | Get session by phone |
| Payment | PAYMENT#{paymentId} | METADATA | ORDER#{orderId} | PAYMENT#{paymentId} | - | - | Get payment, list by order |

**Entity Schemas**:

```typescript
// User
interface User {
  PK: string;              // USER#{userId}
  SK: string;              // METADATA
  GSI1PK: string;          // ROLE#{role}
  GSI1SK: string;          // USER#{userId}
  GSI2PK: string;          // EMAIL#{email}
  GSI2SK: string;          // USER#{userId}
  userId: string;
  email: string;
  phone: string;
  role: 'admin' | 'seller' | 'customer';
  status: 'pending' | 'approved' | 'suspended';
  profile: {
    name: string;
    businessName?: string;
    address?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// Product
interface Product {
  PK: string;              // PRODUCT#{productId}
  SK: string;              // METADATA
  GSI1PK: string;          // SELLER#{sellerId}
  GSI1SK: string;          // PRODUCT#{productId}
  GSI2PK: string;          // CATEGORY#{categoryId}
  GSI2SK: string;          // PRODUCT#{productId}
  productId: string;
  sellerId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  images: string[];
  status: 'active' | 'inactive' | 'out_of_stock';
  createdAt: string;
  updatedAt: string;
}

// Order
interface Order {
  PK: string;              // ORDER#{orderId}
  SK: string;              // METADATA
  GSI1PK: string;          // CUSTOMER#{customerId}
  GSI1SK: string;          // ORDER#{orderId}#{timestamp}
  GSI2PK: string;          // SELLER#{sellerId}
  GSI2SK: string;          // ORDER#{orderId}#{timestamp}
  orderId: string;
  customerId: string;
  sellerId: string;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  totalAmount: number;
  currency: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  deliveryAddress: {
    street: string;
    city: string;
    state: string;
    pincode: string;
  };
  createdAt: string;
  updatedAt: string;
}

// WhatsApp Session
interface WhatsAppSession {
  PK: string;              // SESSION#{phoneNumber}
  SK: string;              // METADATA
  phoneNumber: string;
  customerId?: string;
  state: 'browsing' | 'cart' | 'checkout' | 'order_placed';
  context: {
    currentCategory?: string;
    currentProduct?: string;
    cart?: Array<{ productId: string; quantity: number }>;
  };
  lastMessageAt: string;
  createdAt: string;
  ttl: number;             // Auto-expire after 24 hours
}
```

### S3 Bucket Structure

**Product Images Bucket**:
```
s3://vyapargyan-{env}-product-images/
  ├── {sellerId}/
  │   ├── {productId}/
  │   │   ├── original/
  │   │   │   └── {imageId}.jpg
  │   │   ├── thumbnail/
  │   │   │   └── {imageId}_thumb.jpg
  │   │   └── medium/
  │   │       └── {imageId}_medium.jpg
```

**Documents Bucket**:
```
s3://vyapargyan-{env}-documents/
  ├── seller-verification/
  │   ├── {sellerId}/
  │   │   ├── gst-certificate.pdf
  │   │   ├── pan-card.pdf
  │   │   └── address-proof.pdf
```

**Logs Bucket**:
```
s3://vyapargyan-{env}-logs/
  ├── api-gateway/
  │   └── {year}/{month}/{day}/
  ├── cloudfront/
  │   └── {year}/{month}/{day}/
  └── application/
      └── {year}/{month}/{day}/
```

### Cognito User Pool Structure

**User Attributes**:
- Standard: `email`, `phone_number`, `name`
- Custom: `custom:role` (admin|seller|customer), `custom:userId`, `custom:status`

**User Groups**:
- `Admins`: Platform administrators
- `Sellers`: Verified sellers
- `Customers`: End customers

**App Clients**:
- `web-admin`: Admin dashboard (authorization code flow)
- `web-seller`: Seller dashboard (authorization code flow)
- `api-service`: Backend service (client credentials flow)


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Environment Isolation Through Naming

*For any* AWS resource created by the CDK application, the resource name or tags SHALL include the environment identifier (dev, staging, or prod) to ensure complete isolation between environments.

**Validates: Requirements 2.5, 2.6**

### Property 2: IAM Least Privilege

*For any* IAM policy created for Lambda functions, DynamoDB access, S3 access, or Secrets Manager access, the policy SHALL specify explicit resource ARNs rather than wildcard ("*") resources, ensuring least-privilege access.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 3: IAM Role Tagging

*For any* IAM role created by the CDK application, the role SHALL have tags for "service" and "environment" to support auditing and cost allocation.

**Validates: Requirements 5.6**

### Property 4: Stack Parameterization

*For any* CDK stack, the stack SHALL accept environment-specific configuration through constructor parameters or context variables, enabling environment-specific deployments.

**Validates: Requirements 6.3**

### Property 5: Stack Synthesis Validation

*For any* CDK stack, attempting to synthesize the stack without providing all required parameters SHALL fail with a clear error message indicating which parameters are missing.

**Validates: Requirements 6.5**

### Property 6: Error Handling Consistency

*For any* Lambda handler function, the function SHALL use the error handling middleware to catch and format errors consistently, ensuring uniform error responses across the API.

**Validates: Requirements 7.4**

### Property 7: Structured Logging with Request IDs

*For any* log entry written by Lambda functions, the log SHALL be valid JSON and SHALL include a requestId field for distributed tracing.

**Validates: Requirements 7.5, 8.1**

### Property 8: Request Logging Completeness

*For any* request log entry, the log SHALL include requestId, userId (if authenticated), timestamp, HTTP method, path, and status code.

**Validates: Requirements 8.2**

### Property 9: Error Logging Completeness

*For any* error log entry, the log SHALL include the error message, stack trace, request context (requestId, userId, path), and timestamp.

**Validates: Requirements 8.3**

### Property 10: Log Group Naming Convention

*For any* CloudWatch Log Group created for Lambda functions, the log group name SHALL follow the pattern `/aws/lambda/{environment}-{service}-{function}` to ensure consistent organization.

**Validates: Requirements 8.4**

### Property 11: Environment-Specific Log Retention

*For any* CloudWatch Log Group, the retention period SHALL be 7 days for dev environment, 30 days for staging environment, and 90+ days for prod environment.

**Validates: Requirements 8.5**

### Property 12: Secrets Storage Separation

*For any* sensitive configuration value (API keys, credentials, tokens), the value SHALL be loaded from AWS Secrets Manager, and *for any* non-sensitive configuration value, the value SHALL be loaded from SSM Parameter Store.

**Validates: Requirements 9.1, 9.2**

### Property 13: Secret Naming Convention

*For any* secret or parameter created in Secrets Manager or SSM Parameter Store, the name SHALL include the environment prefix (e.g., `/dev/`, `/staging/`, `/prod/`) to prevent cross-environment access.

**Validates: Requirements 9.4**

### Property 14: Configuration Validation

*For any* required configuration value, if the value is missing or invalid at Lambda initialization, the configuration loader SHALL throw an error and prevent the Lambda from handling requests.

**Validates: Requirements 9.6, 9.7**

### Property 15: S3 Bucket Public Access Block

*For any* S3 bucket created by the CDK application, the bucket SHALL have public access blocked by default unless explicitly configured otherwise for specific use cases.

**Validates: Requirements 11.2**

### Property 16: S3 Key Environment Prefixing

*For any* file uploaded to S3, the object key SHALL include the environment prefix to organize content by environment and prevent cross-environment data access.

**Validates: Requirements 11.3**

### Property 17: Protected Route Authorization

*For any* API Gateway route that requires authentication, the route SHALL have a Cognito authorizer configured to validate JWT tokens before invoking the Lambda function.

**Validates: Requirements 12.4**

### Property 18: Cognito User Pool Environment Isolation

*For any* Cognito User Pool created by the CDK application, the user pool name SHALL include the environment identifier to ensure separate user bases per environment.

**Validates: Requirements 13.1**

### Property 19: MCP Tool Response Structure

*For any* MCP server tool response, the response SHALL be valid JSON with a consistent structure including status, data, and metadata fields suitable for AI analysis.

**Validates: Requirements 15.6**

## Error Handling

### Error Classification

Errors are classified into four categories:

1. **Client Errors (4xx)**: Invalid input, authentication failures, authorization failures
2. **Server Errors (5xx)**: Unexpected errors, service unavailability, timeout errors
3. **Integration Errors**: External service failures (WhatsApp, Razorpay, Gemini)
4. **Infrastructure Errors**: AWS service failures, throttling, capacity issues

### Error Response Format

All API errors follow a consistent format:

```typescript
interface ErrorResponse {
  error: {
    code: string;           // Machine-readable error code
    message: string;        // Human-readable error message
    details?: any;          // Additional error details
    requestId: string;      // Request ID for tracing
    timestamp: string;      // ISO 8601 timestamp
  };
}
```

### Error Handling Strategy

**Lambda Function Level**:
```typescript
export const handler = async (event, context) => {
  const logger = createLogger({ requestId: context.requestId });
  
  try {
    // Business logic
    return successResponse(result);
  } catch (error) {
    logger.error('Handler error', { error, event });
    
    if (error instanceof ValidationError) {
      return errorResponse(400, 'VALIDATION_ERROR', error.message);
    }
    
    if (error instanceof UnauthorizedError) {
      return errorResponse(401, 'UNAUTHORIZED', error.message);
    }
    
    if (error instanceof ForbiddenError) {
      return errorResponse(403, 'FORBIDDEN', error.message);
    }
    
    if (error instanceof NotFoundError) {
      return errorResponse(404, 'NOT_FOUND', error.message);
    }
    
    if (error instanceof ConflictError) {
      return errorResponse(409, 'CONFLICT', error.message);
    }
    
    // Unknown errors
    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
};
```

**DynamoDB Error Handling**:
```typescript
try {
  await repository.put(item);
} catch (error) {
  if (error.name === 'ConditionalCheckFailedException') {
    throw new ConflictError('Item already exists');
  }
  
  if (error.name === 'ProvisionedThroughputExceededException') {
    logger.warn('DynamoDB throttled', { error });
    // Retry with exponential backoff
    await retryWithBackoff(() => repository.put(item));
  }
  
  throw error; // Re-throw unknown errors
}
```

**External Service Error Handling**:
```typescript
try {
  const response = await whatsappClient.sendMessage(message);
  return response;
} catch (error) {
  logger.error('WhatsApp API error', { error, message });
  
  if (error.response?.status === 429) {
    // Rate limited - queue for retry
    await queueForRetry(message);
    throw new ServiceUnavailableError('WhatsApp rate limit exceeded');
  }
  
  if (error.response?.status >= 500) {
    // WhatsApp service error - queue for retry
    await queueForRetry(message);
    throw new ServiceUnavailableError('WhatsApp service unavailable');
  }
  
  // Client error - don't retry
  throw new IntegrationError('Failed to send WhatsApp message', error);
}
```

### Dead Letter Queues

All SQS queues have associated Dead Letter Queues (DLQs) for failed messages:

- **Max Receive Count**: 3 attempts before moving to DLQ
- **DLQ Retention**: 14 days
- **DLQ Alarms**: CloudWatch alarm triggers when DLQ receives messages
- **DLQ Processing**: Manual review and reprocessing workflow

### Circuit Breaker Pattern

For external service integrations, implement circuit breaker pattern:

```typescript
class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime! > 60000) {
        this.state = 'HALF_OPEN';
      } else {
        throw new ServiceUnavailableError('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= 5) {
      this.state = 'OPEN';
    }
  }
}
```

### Retry Strategy

Use exponential backoff with jitter for retries:

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * delay * 0.1;
      await sleep(delay + jitter);
    }
  }
  
  throw new Error('Retry failed');
}
```

## Testing Strategy

### Dual Testing Approach

The platform uses both unit testing and property-based testing for comprehensive coverage:

- **Unit Tests**: Verify specific examples, edge cases, error conditions, and integration points
- **Property Tests**: Verify universal properties across all inputs through randomization

Both approaches are complementary and necessary. Unit tests catch concrete bugs in specific scenarios, while property tests verify general correctness across a wide range of inputs.

### Unit Testing

**Framework**: Jest with TypeScript support

**Test Organization**:
```
services/api/
├── src/
│   └── handlers/
│       └── auth/
│           └── login.ts
└── tests/
    └── handlers/
        └── auth/
            └── login.test.ts
```

**Unit Test Focus**:
- Specific examples demonstrating correct behavior
- Edge cases (empty inputs, boundary values, null/undefined)
- Error conditions (invalid input, missing auth, service failures)
- Integration points between components
- Mock external dependencies (DynamoDB, S3, external APIs)

**Example Unit Test**:
```typescript
describe('Login Handler', () => {
  it('should return JWT tokens for valid credentials', async () => {
    const event = createMockEvent({
      body: JSON.stringify({
        email: 'seller@example.com',
        password: 'SecurePass123!'
      })
    });
    
    const response = await handler(event, createMockContext());
    
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data).toHaveProperty('accessToken');
    expect(body.data).toHaveProperty('refreshToken');
  });
  
  it('should return 401 for invalid credentials', async () => {
    const event = createMockEvent({
      body: JSON.stringify({
        email: 'seller@example.com',
        password: 'WrongPassword'
      })
    });
    
    const response = await handler(event, createMockContext());
    
    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });
  
  it('should return 400 for missing email', async () => {
    const event = createMockEvent({
      body: JSON.stringify({
        password: 'SecurePass123!'
      })
    });
    
    const response = await handler(event, createMockContext());
    
    expect(response.statusCode).toBe(400);
  });
});
```

### Property-Based Testing

**Framework**: fast-check (JavaScript/TypeScript property-based testing library)

**Configuration**: Minimum 100 iterations per property test due to randomization

**Property Test Focus**:
- Universal properties that hold for all inputs
- Comprehensive input coverage through randomization
- Invariants that must be maintained
- Round-trip properties (serialize/deserialize, encode/decode)
- Metamorphic properties (relationships between operations)

**Test Tagging**: Each property test must reference its design document property using a comment tag:
```typescript
// Feature: platform-foundation, Property 7: Structured Logging with Request IDs
```

**Example Property Test**:
```typescript
import fc from 'fast-check';

describe('Property Tests: Structured Logging', () => {
  // Feature: platform-foundation, Property 7: Structured Logging with Request IDs
  it('all log entries should be valid JSON with requestId', () => {
    fc.assert(
      fc.property(
        fc.record({
          level: fc.constantFrom('debug', 'info', 'warn', 'error'),
          message: fc.string(),
          context: fc.dictionary(fc.string(), fc.anything())
        }),
        fc.uuid(),
        (logData, requestId) => {
          const logger = createLogger({ requestId });
          const logOutput = captureLogOutput(() => {
            logger[logData.level](logData.message, logData.context);
          });
          
          // Verify log is valid JSON
          const parsed = JSON.parse(logOutput);
          
          // Verify requestId is present
          expect(parsed.requestId).toBe(requestId);
          
          // Verify required fields
          expect(parsed).toHaveProperty('level');
          expect(parsed).toHaveProperty('message');
          expect(parsed).toHaveProperty('timestamp');
        }
      ),
      { numRuns: 100 }
    );
  });
  
  // Feature: platform-foundation, Property 16: S3 Key Environment Prefixing
  it('all S3 uploads should include environment prefix in key', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('dev', 'staging', 'prod'),
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        async (environment, bucket, filename) => {
          process.env.ENVIRONMENT = environment;
          
          const s3Helper = new S3Helper();
          const key = s3Helper.generateKey(filename);
          
          // Verify key starts with environment prefix
          expect(key).toMatch(new RegExp(`^${environment}/`));
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Infrastructure Testing

**CDK Testing**: Use AWS CDK assertions to test infrastructure:

```typescript
import { Template } from 'aws-cdk-lib/assertions';
import { DatabaseStack } from '../lib/stacks/database-stack';

describe('DatabaseStack', () => {
  it('should create DynamoDB table with correct configuration', () => {
    const app = new cdk.App();
    const stack = new DatabaseStack(app, 'TestStack', {
      environment: 'dev'
    });
    
    const template = Template.fromStack(stack);
    
    // Verify table exists
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: false // dev environment
      }
    });
  });
  
  // Feature: platform-foundation, Property 11: Environment-Specific Log Retention
  it('should configure log retention based on environment', () => {
    const environments = [
      { env: 'dev', retention: 7 },
      { env: 'staging', retention: 30 },
      { env: 'prod', retention: 90 }
    ];
    
    environments.forEach(({ env, retention }) => {
      const app = new cdk.App();
      const stack = new ApiStack(app, 'TestStack', { environment: env });
      const template = Template.fromStack(stack);
      
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: retention
      });
    });
  });
});
```

### Integration Testing

**Local Integration Tests**: Use LocalStack or DynamoDB Local for integration tests:

```typescript
describe('Product Repository Integration', () => {
  let repository: ProductRepository;
  let docClient: DynamoDBDocumentClient;
  
  beforeAll(async () => {
    // Connect to DynamoDB Local
    const client = new DynamoDBClient({
      endpoint: 'http://localhost:8000'
    });
    docClient = DynamoDBDocumentClient.from(client);
    repository = new ProductRepository('test-table', docClient);
    
    // Create test table
    await createTestTable();
  });
  
  afterAll(async () => {
    await deleteTestTable();
  });
  
  it('should create and retrieve product', async () => {
    const product = {
      id: 'prod-123',
      sellerId: 'seller-456',
      name: 'Test Product',
      price: 999
    };
    
    await repository.createProduct(product);
    const retrieved = await repository.getProductById('prod-123');
    
    expect(retrieved).toMatchObject(product);
  });
});
```

### End-to-End Testing

**Framework**: Playwright or Cypress for web applications

**Scope**: Critical user journeys across the full stack:
- Admin approves seller
- Seller creates product
- Customer browses and orders via WhatsApp
- Payment processing and order fulfillment

**Environment**: Run against staging environment before production deployment

### Test Coverage Goals

- **Unit Test Coverage**: Minimum 80% code coverage
- **Property Test Coverage**: All correctness properties from design document
- **Integration Test Coverage**: All repository and service layer operations
- **E2E Test Coverage**: All critical user journeys

### Continuous Testing

- **Pre-commit**: Run linting and type checking
- **PR Validation**: Run unit tests and property tests
- **Staging Deployment**: Run integration tests and E2E tests
- **Production Deployment**: Run smoke tests after deployment
