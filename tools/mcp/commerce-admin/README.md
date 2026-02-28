# Commerce Admin MCP Server

Model Context Protocol (MCP) server that provides read-only access to administrative data from the VyaparGyan commerce platform. It enables AI assistants like Kiro to query seller approvals, disputes, audit logs, and payment records stored in DynamoDB, facilitating platform moderation, compliance monitoring, and administrative support tasks.

## Features

- **Read-only access** - All tools are read-only; no mutation operations supported in v1
- **Six administrative tools** - Query seller approvals, disputes, audit logs, and payments
- **AWS integration** - Direct access to DynamoDB for administrative data
- **Type-safe** - Built with TypeScript with strict type checking
- **Error handling** - Comprehensive error mapping and validation
- **Pagination support** - Automatic handling of large result sets with limits

## Tools

### 1. list_pending_seller_approvals

List pending seller approval requests awaiting verification.

**Parameters:**
- `limit` (number, optional) - Max results (default 20, max 100)

**Example:**
```json
{
  "limit": 20
}
```

**Returns:**
- Array of pending seller approval requests
- Includes seller_id, business_name, owner_name, contact details, verification_status, review_state
- Sorted by created_at ascending (oldest first)
- Includes `hasMore` flag for pagination

**Example Response:**
```json
{
  "success": true,
  "data": {
    "sellers": [
      {
        "seller_id": "seller_789",
        "business_name": "Local Retail Store",
        "owner_name": "John Doe",
        "contact_phone": "919876543210",
        "contact_email": "john@example.com",
        "verification_status": "pending",
        "created_at": "2026-02-28T10:00:00Z",
        "review_state": "pending"
      }
    ],
    "count": 1,
    "hasMore": false
  },
  "timestamp": "2026-02-28T12:00:00Z"
}
```

### 2. get_seller_profile

Fetch detailed seller profile information including verification documents.

**Parameters:**
- `sellerId` (string, required) - The seller ID to fetch

**Example:**
```json
{
  "sellerId": "seller_789"
}
```

**Returns:**
- Complete seller profile with business details
- Verification status and document references
- S3 document keys (without presigned URLs)
- Timestamps for created, updated, and approved dates

**Example Response:**
```json
{
  "success": true,
  "data": {
    "seller_id": "seller_789",
    "business_name": "Local Retail Store",
    "business_type": "RETAIL",
    "owner_name": "John Doe",
    "contact_phone": "919876543210",
    "contact_email": "john@example.com",
    "verification_status": "approved",
    "document_keys": [
      "sellers/seller_789/business_license.pdf",
      "sellers/seller_789/id_proof.pdf"
    ],
    "created_at": "2026-02-28T10:00:00Z",
    "updated_at": "2026-02-28T11:00:00Z",
    "approved_at": "2026-02-28T11:30:00Z"
  },
  "timestamp": "2026-02-28T12:01:00Z"
}
```

### 3. list_open_disputes

List open disputes requiring admin attention.

**Parameters:**
- `limit` (number, optional) - Max results (default 20, max 100)

**Example:**
```json
{
  "limit": 20
}
```

**Returns:**
- Array of open disputes
- Includes dispute_id, order_id, seller_id, customer_id, status, reason
- Sorted by created_at ascending (oldest first)
- Includes `hasMore` flag for pagination

**Example Response:**
```json
{
  "success": true,
  "data": {
    "disputes": [
      {
        "dispute_id": "disp_abc123",
        "order_id": "ord_xyz789",
        "seller_id": "seller_789",
        "customer_id": "cust_456",
        "status": "open",
        "reason": "PRODUCT_NOT_RECEIVED",
        "created_at": "2026-02-28T09:00:00Z",
        "last_updated_at": "2026-02-28T09:30:00Z"
      }
    ],
    "count": 1,
    "hasMore": false
  },
  "timestamp": "2026-02-28T12:02:00Z"
}
```

### 4. get_dispute

Fetch detailed dispute information including resolution history.

**Parameters:**
- `orderId` (string, optional) - The order ID to fetch disputes for
- `disputeId` (string, optional) - The dispute ID to fetch directly
- At least one parameter must be provided

**Example:**
```json
{
  "disputeId": "disp_abc123"
}
```

**Returns:**
- Complete dispute details with resolution history
- Status history tracking all state changes
- Linked payment information if applicable

**Example Response:**
```json
{
  "success": true,
  "data": {
    "dispute_id": "disp_abc123",
    "order_id": "ord_xyz789",
    "seller_id": "seller_789",
    "customer_id": "cust_456",
    "status": "open",
    "reason": "PRODUCT_NOT_RECEIVED",
    "description": "Customer claims product was not delivered",
    "status_history": [
      {
        "status": "open",
        "timestamp": "2026-02-28T09:00:00Z",
        "actor": "customer"
      }
    ],
    "linked_payment_id": "pay_123",
    "created_at": "2026-02-28T09:00:00Z",
    "updated_at": "2026-02-28T09:30:00Z",
    "resolved_at": null
  },
  "timestamp": "2026-02-28T12:03:00Z"
}
```

### 5. get_audit_timeline

Fetch audit timeline for a specific resource to track changes.

**Parameters:**
- `resourceType` (string, required) - The resource type (e.g., SELLER, ORDER, PRODUCT)
- `resourceId` (string, required) - The resource ID to fetch audit history for

**Example:**
```json
{
  "resourceType": "SELLER",
  "resourceId": "seller_789"
}
```

**Returns:**
- Array of audit records (max 100 entries)
- Sorted by timestamp descending (most recent first)
- Includes action, actor, changes, and metadata
- Includes `truncated` flag when result set exceeds 100 entries

**Example Response:**
```json
{
  "success": true,
  "data": {
    "resource_type": "SELLER",
    "resource_id": "seller_789",
    "audit_records": [
      {
        "audit_id": "audit_001",
        "resource_type": "SELLER",
        "resource_id": "seller_789",
        "action": "APPROVED",
        "actor_id": "admin_123",
        "actor_type": "ADMIN",
        "changes": {
          "verification_status": {
            "from": "pending",
            "to": "approved"
          }
        },
        "timestamp": "2026-02-28T11:30:00Z",
        "metadata": {
          "reason": "All documents verified"
        }
      }
    ],
    "count": 1,
    "truncated": false
  },
  "timestamp": "2026-02-28T12:04:00Z"
}
```

### 6. list_recent_payments

List recent payment transactions with optional status filtering.

**Parameters:**
- `status` (string, optional) - Filter by payment status (e.g., SUCCESS, PENDING, FAILED)
- `limit` (number, optional) - Max results (default 20, max 100)

**Example:**
```json
{
  "status": "SUCCESS",
  "limit": 20
}
```

**Returns:**
- Array of payment records
- Sorted by created_at descending (most recent first)
- Includes payment_id, order_id, amount, currency, status, provider
- Includes `hasMore` flag for pagination

**Example Response:**
```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "payment_id": "pay_123",
        "order_id": "ord_xyz789",
        "amount": 1499,
        "currency": "INR",
        "status": "SUCCESS",
        "provider": "razorpay",
        "gateway_payment_id": "rzp_abc123",
        "created_at": "2026-02-28T10:00:00Z",
        "updated_at": "2026-02-28T10:05:00Z"
      }
    ],
    "count": 1,
    "hasMore": false
  },
  "timestamp": "2026-02-28T12:05:00Z"
}
```

## Installation

### Prerequisites

- Node.js 20 or higher
- AWS credentials configured with profile `kiro-mcp`
- Access to DynamoDB table `CommerceCore-dev` in region `ap-south-1`

### Install Dependencies

```bash
cd tools/mcp/commerce-admin
npm install
```

### Build the Server

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

## Configuration

### Required Environment Variables

The server requires the following environment variables:

- `AWS_REGION`: Must be `"ap-south-1"`
- `DYNAMODB_TABLE_NAME`: Must be `"CommerceCore-dev"`
- `AWS_PROFILE`: Must be `"kiro-mcp"`
- `S3_DOC_BUCKET` (optional): S3 bucket name for seller verification documents

### AWS Credentials

Configure AWS credentials using the AWS CLI:

```bash
aws configure --profile kiro-mcp
```

You'll need to provide:
- AWS Access Key ID
- AWS Secret Access Key
- Default region: `ap-south-1`

### Required IAM Permissions

The AWS credentials must have the following DynamoDB permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:DescribeTable"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-south-1:*:table/CommerceCore-dev",
        "arn:aws:dynamodb:ap-south-1:*:table/CommerceCore-dev/index/*"
      ]
    }
  ]
}
```

**Note:** No write permissions are required. This server is read-only and does not support mutation operations in v1.

## DynamoDB Table Schema

The server queries the `CommerceCore-dev` DynamoDB table using the following access patterns:

### Primary Key Structure

- **PK** (Partition Key): Entity type and ID (e.g., `SELLER#seller_789`)
- **SK** (Sort Key): Entity type or related entity (e.g., `PROFILE` or `AUDIT#timestamp`)

### Entity Access Patterns

**Seller Approvals:**
- GSI3: GSI3PK: `WORKFLOW#SELLER_APPROVAL`, GSI3SK: `STATUS#pending#{created_at}` - Pending approvals

**Seller Profile:**
- PK: `SELLER#{sellerId}`, SK: `PROFILE` - Seller profile data

**Disputes:**
- GSI for open disputes (implementation-specific)
- PK: `DISPUTE#{disputeId}`, SK: `DISPUTE` - Dispute details
- Query by order_id for order-related disputes

**Audit Records:**
- PK: `RESOURCE#{resourceType}#{resourceId}`, SK: `AUDIT#{timestamp}` - Audit trail entries

**Payments:**
- GSI for recent payments with optional status filtering
- PK: `PAYMENT#{paymentId}`, SK: `PAYMENT` - Payment details

### Global Secondary Indexes (GSI)

The server expects the following GSIs to exist:

1. **GSI3**: For workflow and admin access patterns (seller approvals)
2. **Additional GSIs**: For disputes and payments queries (implementation-specific)

## Usage

### Running the Server

```bash
node dist/index.js
```

The server uses stdio transport for MCP communication.

### Testing with MCP Inspector

You can test the server locally using the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

This opens a web interface where you can:
1. View all available tools
2. Test tool invocations with custom parameters
3. Inspect request/response payloads
4. Debug error messages

### Integration with Kiro

The server is configured in `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "commerce-admin-mcp": {
      "command": "node",
      "args": ["./tools/mcp/commerce-admin/dist/index.js"],
      "disabled": false,
      "env": {
        "AWS_REGION": "ap-south-1",
        "DYNAMODB_TABLE_NAME": "CommerceCore-dev",
        "AWS_PROFILE": "kiro-mcp",
        "S3_DOC_BUCKET": "your-bucket-name"
      },
      "autoApprove": [
        "list_pending_seller_approvals",
        "get_seller_profile",
        "list_open_disputes",
        "get_dispute",
        "get_audit_timeline",
        "list_recent_payments"
      ]
    }
  }
}
```

All tools are marked as `autoApprove` since they are read-only and safe for automatic approval.

## Error Handling

### Error Response Format

All errors follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  },
  "timestamp": "2026-02-28T12:00:00Z"
}
```

### Error Codes

- **VALIDATION_ERROR**: Invalid input parameters (missing required fields, wrong types, etc.)
- **NOT_FOUND**: Requested entity does not exist in DynamoDB
- **ACCESS_DENIED**: AWS credentials invalid or insufficient IAM permissions
- **AWS_ERROR**: General AWS SDK error (includes original error name in details)
- **TOOL_ERROR**: Unexpected error during tool execution

## Troubleshooting

### Environment Validation Errors

**Error:** `Environment validation failed: AWS_REGION: Expected "ap-south-1"`

**Solution:** Ensure the `AWS_REGION` environment variable is set to exactly `"ap-south-1"`.

**Error:** `Environment validation failed: AWS_PROFILE: Expected "kiro-mcp"`

**Solution:** Ensure the `AWS_PROFILE` environment variable is set to exactly `"kiro-mcp"`.

**Error:** `Environment validation failed: DYNAMODB_TABLE_NAME: Expected "CommerceCore-dev"`

**Solution:** Ensure the `DYNAMODB_TABLE_NAME` environment variable is set to exactly `"CommerceCore-dev"`.

### AWS Credential Errors

**Error:** `ACCESS_DENIED: The security token included in the request is invalid`

**Solution:** 
1. Verify AWS credentials are configured: `aws configure --profile kiro-mcp`
2. Check credentials are valid: `aws sts get-caller-identity --profile kiro-mcp`
3. Ensure credentials haven't expired (if using temporary credentials)

**Error:** `ACCESS_DENIED: User is not authorized to perform: dynamodb:Query`

**Solution:** 
1. Verify IAM permissions include `dynamodb:GetItem` and `dynamodb:Query`
2. Check the resource ARN matches your DynamoDB table
3. Ensure the table name is `CommerceCore-dev` in region `ap-south-1`
4. Verify GSI permissions are included in the IAM policy

### DynamoDB Table Errors

**Error:** `NOT_FOUND: Requested resource not found`

**Solution:**
1. Verify the DynamoDB table `CommerceCore-dev` exists in `ap-south-1`
2. Check the table has the expected primary key structure (PK, SK)
3. Verify required GSIs exist (GSI3 for seller approvals, etc.)
4. Ensure the entity exists in the table (e.g., seller_id, dispute_id)

### Build Errors

**Error:** `Cannot find module '@modelcontextprotocol/sdk'`

**Solution:** Run `npm install` to install dependencies.

**Error:** TypeScript compilation errors

**Solution:** 
1. Ensure Node.js version is 20 or higher: `node --version`
2. Run `npm run typecheck` to see detailed type errors
3. Check `tsconfig.json` is properly configured

### Runtime Errors

**Error:** Server starts but tools don't respond

**Solution:**
1. Check server logs in stderr for error messages
2. Verify environment variables are set correctly
3. Test AWS connectivity: `aws dynamodb describe-table --table-name CommerceCore-dev --profile kiro-mcp`

**Error:** `VALIDATION_ERROR: Invalid input`

**Solution:**
1. Check the tool's input schema in the error details
2. Ensure all required parameters are provided
3. Verify parameter types match the schema (string, number, etc.)
4. For `get_dispute`, ensure at least one of `orderId` or `disputeId` is provided

**Error:** `No pending seller approvals found` or similar empty result messages

**Solution:**
1. This is not an error - it indicates no matching records exist
2. Verify the data exists in DynamoDB using AWS Console or CLI
3. Check GSI configuration matches the expected access patterns

## Development

### Project Structure

```
tools/mcp/commerce-admin/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP server initialization
│   ├── env.ts                # Environment validation
│   ├── tools/                # Tool implementations
│   │   ├── list-pending-seller-approvals.ts
│   │   ├── get-seller-profile.ts
│   │   ├── list-open-disputes.ts
│   │   ├── get-dispute.ts
│   │   ├── get-audit-timeline.ts
│   │   └── list-recent-payments.ts
│   └── shared/               # Shared utilities
│       ├── aws-clients.ts    # AWS client management
│       ├── response-formatter.ts
│       └── error-handler.ts
├── dist/                     # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── README.md
```

### Available Scripts

- `npm run build`: Compile TypeScript to JavaScript
- `npm run dev`: Watch mode for development
- `npm start`: Run the compiled server
- `npm run typecheck`: Type check without emitting files
- `npm test`: Run tests
- `npm run test:watch`: Run tests in watch mode
- `npm run test:coverage`: Run tests with coverage report

### Adding New Tools

To add a new tool:

1. Create a new file in `src/tools/` (e.g., `my-tool.ts`)
2. Define a Zod schema for parameter validation
3. Implement the tool function following the established pattern
4. Register the tool in `src/server.ts` (ListToolsRequest and CallToolRequest handlers)
5. Update this README with the new tool documentation

## Security Considerations

- **Read-only operations** - No mutations allowed in v1
- **Data redaction** - Sensitive data (credentials, internal paths) redacted from errors
- **IAM permissions** - Principle of least privilege (read-only DynamoDB)
- **No presigned URLs** - Document keys returned without generating presigned URLs
- **Audit logging** - All tool invocations logged to stderr with context

## License

Internal use only - VyaparGyan commerce platform.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs in stderr for detailed error messages
3. Test AWS connectivity and permissions independently
4. Verify DynamoDB table structure matches expected schema
5. Ensure all required GSIs are configured correctly
