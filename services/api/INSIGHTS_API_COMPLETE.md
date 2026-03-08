# Insights API Implementation - COMPLETE

## Summary

Successfully implemented the backend API endpoints for the AI Insights feature, completing Phase 5 of the VyaparGyan platform.

## Lambda Handlers Created

### 1. Get Insights (`get-insights.ts`)

**Purpose**: Fetch AI-generated insights for a seller from DynamoDB

**Endpoint**: `GET /api/insights`

**Query Parameters**:
- `status`: Filter by status (default: "PENDING", supports comma-separated: "PENDING,APPROVED")
- `pageSize`: Number of results (default: 20, max: 100)

**Authorization**: Extracts seller ID from JWT token claims (`custom:userId` or `sub`)

**DynamoDB Query**:
```typescript
PK = SELLER#{sellerId}
SK begins_with INSIGHT#
```

**Response**:
```json
{
  "insights": [
    {
      "id": "insight-123",
      "sellerId": "seller-456",
      "productId": "prod-789",
      "insightType": "dead_stock_alert",
      "priority": "high",
      "title": "Dead Stock Alert: Silk Saree Red",
      "description": "Your Silk Saree Red has been in stock for 75 days...",
      "actionRecommended": "Apply 20% discount to liquidate inventory",
      "suggestedDiscountPercent": 20,
      "marketInsights": "Market analysis shows...",
      "status": "pending",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "expiresAt": "2024-01-22T10:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

### 2. Approve Insight (`approve-insight.ts`)

**Purpose**: Approve an insight and trigger automated WhatsApp campaign

**Endpoint**: `PUT /api/insights/{insightId}/approve`

**Path Parameters**:
- `insightId`: The ID of the insight to approve

**Authorization**: Verifies seller owns the insight

**DynamoDB Operations**:
1. **GetItem**: Verify insight exists and belongs to seller
2. **UpdateItem**: Change status from `pending` to `approved`

**Conditional Update**:
```typescript
ConditionExpression: status = 'pending'
// Prevents double-approval
```

**IMPORTANT**: This update triggers the DynamoDB Stream, which invokes the `campaign-worker` Lambda (Phase 4) to automatically send WhatsApp discount notifications to past customers.

**Response**:
```json
{
  "success": true,
  "insight": {
    "id": "insight-123",
    "status": "approved",
    "approvedAt": "2024-01-15T11:00:00.000Z",
    ...
  },
  "message": "Insight approved successfully. Campaign will be executed shortly."
}
```

### 3. Reject Insight (`reject-insight.ts`)

**Purpose**: Reject an insight (no campaign will be triggered)

**Endpoint**: `PUT /api/insights/{insightId}/reject`

**Path Parameters**:
- `insightId`: The ID of the insight to reject

**Authorization**: Verifies seller owns the insight

**DynamoDB Operation**:
- **UpdateItem**: Change status from `pending` to `rejected`

**Response**:
```json
{
  "success": true,
  "message": "Insight rejected successfully"
}
```

## API Stack Updates

Updated `infra/cdk/lib/stacks/api-stack.ts` to include:

### New Lambda Functions

1. **GetInsightsFunction**
   - Handler: `handlers/seller/get-insights.handler`
   - Memory: 256 MB
   - Timeout: 10 seconds
   - Permissions: DynamoDB Read

2. **ApproveInsightFunction**
   - Handler: `handlers/seller/approve-insight.handler`
   - Memory: 256 MB
   - Timeout: 10 seconds
   - Permissions: DynamoDB Read/Write

3. **RejectInsightFunction**
   - Handler: `handlers/seller/reject-insight.handler`
   - Memory: 256 MB
   - Timeout: 10 seconds
   - Permissions: DynamoDB Read/Write

### New API Routes

```typescript
GET    /api/insights                      → GetInsightsFunction
PUT    /api/insights/{insightId}/approve  → ApproveInsightFunction
PUT    /api/insights/{insightId}/reject   → RejectInsightFunction
```

### CORS Configuration

All routes support:
- Origins: `http://localhost:3000` (dev), `https://seller.vyapargyan.com` (prod)
- Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
- Headers: Content-Type, Authorization, X-Request-ID

## Data Flow

### Insight Creation (Phase 3)
```
1. EventBridge scheduled rule (daily 2:00 AM)
   ↓
2. trend-analyzer-worker Lambda
   ↓
3. Query aging inventory (products > 60 days old)
   ↓
4. Analyze market trends (Grok API)
   ↓
5. Generate insights
   ↓
6. Save to DynamoDB:
   PK: SELLER#{sellerId}
   SK: INSIGHT#{insightId}
   status: 'pending'
```

### Insight Approval (Phase 5)
```
1. Seller views insights in Next.js dashboard
   ↓
2. GET /api/insights (fetch pending insights)
   ↓
3. Seller clicks "Approve" button
   ↓
4. PUT /api/insights/{id}/approve
   ↓
5. Lambda updates DynamoDB (status: 'approved')
   ↓
6. DynamoDB Stream triggers campaign-worker (Phase 4)
   ↓
7. campaign-worker sends WhatsApp notifications
```

## DynamoDB Schema

### Insight Item Structure

```typescript
{
  PK: "SELLER#seller-456",
  SK: "INSIGHT#insight-123",
  id: "insight-123",
  sellerId: "seller-456",
  productId: "prod-789",
  insightType: "dead_stock_alert" | "pricing_recommendation" | "market_trend",
  priority: "high" | "medium" | "low",
  title: "Dead Stock Alert: Silk Saree Red",
  description: "Your Silk Saree Red has been in stock for 75 days...",
  actionRecommended: "Apply 20% discount to liquidate inventory",
  suggestedDiscountPercent: 20,
  suggestedPriceIncrease: null,
  marketInsights: "Market analysis shows declining demand...",
  status: "pending" | "approved" | "rejected" | "applied",
  createdAt: "2024-01-15T10:00:00.000Z",
  expiresAt: "2024-01-22T10:00:00.000Z",
  approvedAt: "2024-01-15T11:00:00.000Z", // Set when approved
  rejectedAt: null,
  updatedAt: "2024-01-15T11:00:00.000Z"
}
```

### Access Pattern

**Query insights for a seller**:
```typescript
KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)'
ExpressionAttributeValues: {
  ':pk': 'SELLER#seller-456',
  ':sk': 'INSIGHT#'
}
ScanIndexForward: false  // Most recent first
```

## Authentication

### Current Implementation (MVP)

For MVP, authentication uses header-based approach:
- Extract seller ID from `x-user-id` header
- Or from JWT claims: `custom:userId` or `sub`

### Production Implementation (TODO)

Add Cognito JWT Authorizer to API Gateway:

```typescript
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';

const authorizer = new HttpJwtAuthorizer('JwtAuthorizer', 
  `https://cognito-idp.${config.region}.amazonaws.com/${userPool.userPoolId}`,
  {
    jwtAudience: [userPoolClient.userPoolClientId],
  }
);

this.httpApi.addRoutes({
  path: '/api/insights',
  methods: [HttpMethod.GET],
  integration: getInsightsIntegration,
  authorizer: authorizer,  // Add this
});
```

## Deployment

### Build and Deploy

```bash
# Navigate to API service
cd services/api

# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Navigate to CDK
cd ../../infra/cdk

# Install CDK dependencies
pnpm install

# Deploy API stack
pnpm cdk deploy APIStack --context env=dev

# Or deploy all stacks
pnpm cdk deploy --all --context env=dev
```

### Verify Deployment

```bash
# Get API endpoint
aws cloudformation describe-stacks \
  --stack-name vyapargyan-dev-APIStack \
  --query 'Stacks[0].Outputs[?OutputKey==`HttpApiUrl`].OutputValue' \
  --output text

# Test get insights endpoint
curl -X GET \
  "https://your-api-id.execute-api.ap-south-1.amazonaws.com/api/insights?status=pending" \
  -H "x-user-id: seller-456"

# Test approve insight
curl -X PUT \
  "https://your-api-id.execute-api.ap-south-1.amazonaws.com/api/insights/insight-123/approve" \
  -H "x-user-id: seller-456"
```

## Testing

### Unit Tests (TODO)

Create test files:
- `services/api/src/handlers/seller/__tests__/get-insights.test.ts`
- `services/api/src/handlers/seller/__tests__/approve-insight.test.ts`
- `services/api/src/handlers/seller/__tests__/reject-insight.test.ts`

### Integration Tests

1. **Create test insight**:
   ```bash
   aws dynamodb put-item \
     --table-name vyapargyan-dev-main \
     --item file://test-insight.json
   ```

2. **Test GET endpoint**:
   ```bash
   curl "https://api-url/api/insights?status=pending" \
     -H "x-user-id: test-seller-id"
   ```

3. **Test APPROVE endpoint**:
   ```bash
   curl -X PUT "https://api-url/api/insights/test-insight-id/approve" \
     -H "x-user-id: test-seller-id"
   ```

4. **Verify DynamoDB Stream triggered campaign-worker**:
   ```bash
   aws logs tail /aws/lambda/vyapargyan-dev-campaign-worker --follow
   ```

## Error Handling

### Common Errors

**401 Unauthorized**:
- Missing or invalid seller ID in token
- Solution: Ensure JWT token contains `custom:userId` or `sub`

**404 Not Found**:
- Insight doesn't exist or doesn't belong to seller
- Solution: Verify insight ID and seller ownership

**400 Bad Request**:
- Insight already processed (not pending)
- Solution: Check insight status before approval

**500 Internal Server Error**:
- DynamoDB operation failed
- Solution: Check CloudWatch logs for details

### CloudWatch Logs

```bash
# View get-insights logs
aws logs tail /aws/lambda/vyapargyan-dev-get-insights --follow

# View approve-insight logs
aws logs tail /aws/lambda/vyapargyan-dev-approve-insight --follow

# View reject-insight logs
aws logs tail /aws/lambda/vyapargyan-dev-reject-insight --follow
```

## Security Considerations

### Current (MVP)

- Header-based authentication (`x-user-id`)
- Seller ownership verification in Lambda
- Conditional updates prevent race conditions

### Production Recommendations

1. **Add Cognito JWT Authorizer** to API Gateway
2. **Enable API Gateway access logging**
3. **Add request throttling** (rate limiting)
4. **Enable AWS WAF** for DDoS protection
5. **Encrypt sensitive data** in DynamoDB
6. **Add audit logging** for all approval actions

## Monitoring

### CloudWatch Metrics

- Lambda invocations
- Lambda errors
- Lambda duration
- API Gateway 4xx/5xx errors
- DynamoDB read/write capacity

### Alarms (TODO)

```typescript
// Add to API Stack
new cloudwatch.Alarm(this, 'GetInsightsErrors', {
  metric: getInsightsFunction.metricErrors(),
  threshold: 10,
  evaluationPeriods: 1,
  alarmDescription: 'Get insights function errors',
});
```

## Phase 5 Status: COMPLETE ✅

All backend API endpoints for the Insights feature are implemented and ready for deployment. The Next.js dashboard can now:

1. ✅ Fetch pending insights from the backend
2. ✅ Display insights with full details
3. ✅ Approve insights (triggers WhatsApp campaigns)
4. ✅ Reject insights (no action taken)

Next step: Deploy the API stack and test end-to-end integration with the Next.js dashboard.
