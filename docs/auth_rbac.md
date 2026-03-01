# Auth & RBAC Implementation Design (AWS Serverless)

## JWT Verification Flow

```
Request with Authorization: Bearer <cognito_jwt>
    │
    ├─ 1. API Gateway JWT Authorizer
    │      - Validates JWT signature using Cognito JWKS
    │      - Verifies exp, iss, aud claims
    │      - Extracts sub (Cognito user ID) and cognito:groups
    │      - Passes claims to Lambda in event.requestContext.authorizer
    │
    ├─ 2. Lambda Auth Middleware
    │      - Extract user context from authorizer claims
    │      - Build AuthenticatedUser object
    │      - Attach to request context
    │
    ├─ 3. RBAC Guards (application-level)
    │      - Check cognito:groups for role membership
    │      - Verify resource ownership for seller/customer scoped operations
    │      - Query DynamoDB for additional context if needed
    │
    └─ Return user or raise 401/403
```

## Cognito Configuration

### User Pool

- **User Pool ID**: Defined in `infra/cdk/lib/stacks/auth-stack.ts`
- **Sign-in**: Email or phone number
- **MFA**: Optional (recommended for admin)
- **Password Policy**: Min 8 chars, uppercase, lowercase, number, special char
- **Account Recovery**: Email or SMS

### User Groups

| Group      | Description                                  | IAM Role (optional)       |
| ---------- | -------------------------------------------- | ------------------------- |
| `admin`    | Platform administrators                      | AdminRole (full access)   |
| `seller`   | Sellers managing products and orders         | SellerRole (scoped)       |
| `customer` | End customers placing orders                 | CustomerRole (read-only)  |

Groups are assigned during user registration or by admin.

### Custom Attributes

- `seller_id` (string): Links Cognito user to sellers table in DynamoDB
- `customer_id` (string): Links Cognito user to customers table in DynamoDB
- `display_name` (string): User's display name

## AuthenticatedUser Model

```typescript
// packages/shared/contracts/auth.ts
export interface AuthenticatedUser {
  userId: string;              // Cognito sub
  email?: string;
  phone?: string;
  displayName?: string;
  roles: string[];             // ["admin"] | ["seller"] | ["customer"]
  sellerId?: string;           // sellers.id if role=seller
  customerId?: string;         // customers.id if role=customer
  isActive: boolean;
  cognitoGroups: string[];     // Raw Cognito groups
}
```

## Lambda Auth Middleware

```typescript
// services/api/src/middleware/auth.ts
import { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export function extractAuthContext(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): AuthenticatedUser {
  const claims = event.requestContext.authorizer.jwt.claims;
  
  const userId = claims.sub as string;
  const email = claims.email as string | undefined;
  const phone = claims.phone_number as string | undefined;
  const displayName = claims['custom:display_name'] as string | undefined;
  const cognitoGroups = (claims['cognito:groups'] as string)?.split(',') || [];
  
  // Map Cognito groups to application roles
  const roles = cognitoGroups.map(group => group.toLowerCase());
  
  return {
    userId,
    email,
    phone,
    displayName,
    roles,
    sellerId: claims['custom:seller_id'] as string | undefined,
    customerId: claims['custom:customer_id'] as string | undefined,
    isActive: true, // Can be validated against DynamoDB if needed
    cognitoGroups
  };
}

export function requireAuth(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): AuthenticatedUser {
  if (!event.requestContext.authorizer) {
    throw new UnauthorizedError('Missing authorization');
  }
  
  return extractAuthContext(event);
}
```

## RBAC Guards

### Role-Based Access

```typescript
// services/api/src/middleware/rbac.ts
export function requireRoles(...requiredRoles: string[]) {
  return (user: AuthenticatedUser) => {
    const hasRole = requiredRoles.some(role => user.roles.includes(role));
    if (!hasRole) {
      throw new ForbiddenError(`Requires role: ${requiredRoles.join(' or ')}`);
    }
    return user;
  };
}

// Usage in handler:
export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const user = requireAuth(event);
  requireRoles('admin')(user);
  
  // Admin-only logic
}
```

### Seller Ownership Check

```typescript
export async function requireSellerOwnsResource(
  user: AuthenticatedUser,
  resourceType: 'product' | 'order',
  resourceId: string
): Promise<void> {
  // Admin bypass
  if (user.roles.includes('admin')) {
    return;
  }
  
  // Seller must have seller_id
  if (!user.roles.includes('seller') || !user.sellerId) {
    throw new ForbiddenError('Seller access required');
  }
  
  // Verify ownership in DynamoDB
  const resource = await dynamoAdapter.get(resourceType, resourceId);
  
  if (resource.sellerId !== user.sellerId) {
    throw new ForbiddenError('Not the owner of this resource');
  }
}

// Usage:
export async function updateProduct(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const user = requireAuth(event);
  const productId = event.pathParameters!.id!;
  
  await requireSellerOwnsResource(user, 'product', productId);
  
  // Update product logic
}
```

### Customer Ownership Check

```typescript
export async function requireCustomerOwnsOrder(
  user: AuthenticatedUser,
  orderId: string
): Promise<void> {
  // Admin bypass
  if (user.roles.includes('admin')) {
    return;
  }
  
  // Customer must have customer_id
  if (!user.roles.includes('customer') || !user.customerId) {
    throw new ForbiddenError('Customer access required');
  }
  
  // Verify ownership
  const order = await orderAdapter.get(orderId);
  
  if (order.customerId !== user.customerId) {
    throw new ForbiddenError('Not your order');
  }
}
```

## Admin Bypass Logic

Admin users bypass all ownership checks but still go through JWT verification:

```typescript
export function isAdmin(user: AuthenticatedUser): boolean {
  return user.roles.includes('admin');
}

export async function requireOwnershipOrAdmin(
  user: AuthenticatedUser,
  resourceType: string,
  resourceId: string
): Promise<void> {
  if (isAdmin(user)) {
    return; // Admin bypass
  }
  
  // Regular ownership check
  await requireSellerOwnsResource(user, resourceType as any, resourceId);
}
```

## Webhook Authentication (No JWT)

For WhatsApp and Razorpay webhooks, JWT is not used. Instead:

### WhatsApp Webhook

```typescript
// services/api/src/handlers/whatsapp/webhook.ts
import crypto from 'crypto';

export function verifyWhatsAppSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(`sha256=${expected}`),
    Buffer.from(signature)
  );
}

export async function handler(event: APIGatewayProxyEventV2) {
  const signature = event.headers['x-hub-signature-256'];
  const secret = await getSecret('whatsapp-app-secret');
  
  if (!verifyWhatsAppSignature(event.body!, signature!, secret)) {
    return { statusCode: 401, body: 'Invalid signature' };
  }
  
  // Process webhook with service-level permissions
}
```

### Razorpay Webhook

```typescript
// services/api/src/handlers/payments/webhook.ts
export function verifyRazorpaySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}
```

## IAM Service Permissions

Lambda functions have IAM execution roles with least-privilege permissions:

### Seller Product Handler

```typescript
// Defined in infra/cdk/lib/stacks/api-stack.ts
const sellerProductHandler = new NodejsFunction(this, 'SellerProductHandler', {
  // ...
});

// Grant DynamoDB permissions
productsTable.grantReadWriteData(sellerProductHandler);
inventoryTable.grantReadWriteData(sellerProductHandler);

// Grant S3 permissions for product images
productImagesBucket.grantReadWrite(sellerProductHandler);
```

### Admin Handler

```typescript
const adminHandler = new NodejsFunction(this, 'AdminHandler', {
  // ...
});

// Grant full access to all tables (admin operations)
sellersTable.grantReadWriteData(adminHandler);
categoriesTable.grantReadWriteData(adminHandler);
ordersTable.grantReadWriteData(adminHandler);
```

## Authorization Flow Summary

1. **API Gateway**: JWT authorizer validates token, extracts claims
2. **Lambda Middleware**: Builds AuthenticatedUser from claims
3. **RBAC Guards**: Application-level role and ownership checks
4. **IAM Policies**: Service-level permissions for AWS resources
5. **Audit Logging**: All authorization decisions logged to CloudWatch

## Key Differences from Supabase

| Aspect                | Supabase (Old)                          | AWS Serverless (New)                    |
| --------------------- | --------------------------------------- | --------------------------------------- |
| Auth Provider         | Supabase GoTrue                         | Amazon Cognito                          |
| JWT Verification      | Supabase JWT secret (HS256)             | Cognito JWKS (RS256)                    |
| Role Storage          | user_roles table with RLS               | Cognito groups                          |
| Authorization         | RLS policies (database-level)           | Lambda application logic                |
| Ownership Checks      | RLS with get_my_seller_id()             | DynamoDB queries in Lambda              |
| Service Auth          | service_role key                        | IAM execution roles                     |
| Webhook Auth          | Custom signature verification           | Same (signature verification)           |
| User Context Caching  | Redis (5min TTL)                        | Not needed (claims in JWT)              |

## Security Best Practices

- **JWT validation**: Always validate at API Gateway level
- **Least privilege**: Lambda IAM roles grant only required permissions
- **Secrets rotation**: Rotate Razorpay/WhatsApp secrets regularly via Secrets Manager
- **Audit logging**: Log all authorization decisions with user context
- **Rate limiting**: API Gateway throttling per user/IP
- **MFA**: Enforce for admin users
- **Token expiration**: Short-lived access tokens (1 hour), refresh tokens for renewal
