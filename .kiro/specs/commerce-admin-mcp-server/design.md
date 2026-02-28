# Design Document: Commerce Admin MCP Server

## Overview

The commerce-admin-mcp-server is a Model Context Protocol (MCP) server that provides read-only access to administrative data from the VyaparGyan commerce platform. It exposes a set of tools that enable AI assistants like Kiro to query seller approvals, disputes, audit logs, and payment records stored in DynamoDB.

**Server Metadata:**
- Name: `commerce-admin-mcp`
- Version: `1.0.0`
- Protocol: MCP SDK (stdio transport)
- Runtime: Node.js 20+
- Language: TypeScript (compiled to JavaScript)

This MCP server follows the MCP SDK architecture pattern established by commerce-ops-mcp and commerce-catalog-mcp, using stdio transport for communication with Kiro. It implements a tool-based interface where each tool corresponds to a specific administrative data retrieval operation. The server is built with TypeScript, compiled to JavaScript, and executed via Node.js.

**Primary Use Cases:**
- Reviewing pending seller approval requests for verification
- Investigating seller profiles and verification documents
- Monitoring open disputes for admin review and resolution
- Retrieving detailed dispute information and resolution history
- Tracking audit trails for compliance and investigation
- Monitoring recent payment transactions and investigating payment issues
- Supporting platform moderation and administrative tasks

**Non-Goals (v1 Scope):**

This server is explicitly read-only. The following capabilities are out of scope for v1:
- No seller approval or rejection operations
- No dispute status updates or resolution actions
- No audit log creation or modification
- No payment refunds or transaction modifications
- No seller profile updates or document uploads
- No presigned URL generation for S3 document access
- No write operations of any kind

These restrictions ensure the MCP server remains safe for AI assistant usage without risk of unintended data modifications.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Kiro AI                              │
│                    (MCP Client)                              │
└────────────────────────┬────────────────────────────────────┘
                         │ stdio transport
                         │ (JSON-RPC)
┌────────────────────────▼────────────────────────────────────┐
│            Commerce Admin MCP Server                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Server (server.ts)                                  │   │
│  │  - Tool registration                                 │   │
│  │  - Request routing                                   │   │
│  │  - Error handling                                    │   │
│  └──────────────┬───────────────────────────────────────┘   │
│                 │                                            │
│  ┌──────────────▼───────────────────────────────────────┐   │
│  │  Tools Layer                                         │   │
│  │  - list_pending_seller_approvals                     │   │
│  │  - get_seller_profile                                │   │
│  │  - list_open_disputes                                │   │
│  │  - get_dispute                                       │   │
│  │  - get_audit_timeline                                │   │
│  │  - list_recent_payments                              │   │
│  └──────────────┬───────────────────────────────────────┘   │
│                 │                                            │
│  ┌──────────────▼───────────────────────────────────────┐   │
│  │  Shared Utilities                                    │   │
│  │  - AWS client management (singleton pattern)        │   │
│  │  - Response formatting (success/error)              │   │
│  │  - Error handling (AWS error mapping)               │   │
│  └──────────────┬───────────────────────────────────────┘   │
└─────────────────┼────────────────────────────────────────────┘
                  │
                  │ AWS SDK v3
                  │
┌─────────────────▼────────────────────────────────────────────┐
│                      AWS Services                             │
│  ┌──────────────────────┐  ┌──────────────────────────────┐  │
│  │  DynamoDB            │  │  S3 (metadata only)          │  │
│  │  CommerceCore-dev    │  │  Document references         │  │
│  └──────────────────────┘  └──────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### MCP Protocol Flow

1. **Initialization**: Kiro launches the server via `node ./tools/mcp/commerce-admin/dist/index.js`
2. **Connection**: Server establishes stdio transport and registers available tools
3. **Tool Discovery**: Kiro queries available tools via `ListToolsRequest`
4. **Tool Invocation**: Kiro calls tools via `CallToolRequest` with validated parameters
5. **Response**: Server returns structured JSON response (success or error)

### Startup Behavior

The server follows a lazy initialization pattern for AWS resources:

1. **Environment Validation**: Validate environment variables at startup (fail fast if invalid)
2. **Server Initialization**: Initialize MCP server metadata and tool registry
3. **No Immediate AWS Calls**: Do not attempt AWS connectivity at startup
4. **Lazy AWS Access**: AWS clients are initialized on first tool invocation
5. **Fail Fast on Config**: Terminate only on invalid configuration, not on temporary AWS connectivity issues

This approach enables smooth local development and testing without requiring immediate AWS access.

### Environment Configuration

The server uses Zod for environment validation with the following variables:

- `AWS_REGION`: AWS region (required, must be "ap-south-1")
- `DYNAMODB_TABLE_NAME`: DynamoDB table name (required, must be "CommerceCore-dev")
- `AWS_PROFILE`: AWS credentials profile (required, must be "kiro-mcp")
- `S3_DOC_BUCKET`: S3 bucket for seller documents (optional, validated as non-empty string if provided)

Environment validation occurs at startup. If validation fails, the server terminates with a descriptive error message.

### Security Model

**Read-Only Access:**
All tools provide read-only access to administrative data. No mutations are permitted.

**Required IAM Permissions:**

DynamoDB:
- `dynamodb:GetItem` - Retrieve individual items (seller profiles, disputes)
- `dynamodb:Query` - Query items by partition key (pending approvals, open disputes, audit logs, payments)
- `dynamodb:DescribeTable` - Verify table existence (optional)

S3 (Optional):
- No S3 permissions required for v1 (document metadata only, no presigned URLs)

**No Write Permissions Required:**
The server does not require any write, update, or delete permissions on DynamoDB or S3.

**Data Redaction:**
All error messages and logs must redact sensitive information:
- AWS credentials and session tokens
- Internal file paths and system details
- Full secrets or API keys
- Sensitive seller information (partial redaction in logs)

## Components and Interfaces

### 1. Server Component (`src/server.ts`)

The main server component initializes the MCP server and registers request handlers.

**Responsibilities:**
- Load and validate environment configuration
- Initialize MCP Server instance with name and version
- Register `ListToolsRequestSchema` handler to expose available tools
- Register `CallToolRequestSchema` handler to route tool invocations
- Handle top-level errors and format error responses
- Log all tool invocations with context (tool name, duration, success/failure)

**Tool Registration Schema:**
Each tool is registered with:
- `name`: Tool identifier (e.g., "list_pending_seller_approvals")
- `description`: Human-readable description for AI assistant
- `inputSchema`: JSON Schema defining required and optional parameters

**Request Routing:**
The CallToolRequest handler uses a switch statement to route requests to the appropriate tool function based on the tool name.

**Logging Rules:**
- All internal logs go to stderr (never stdout, which is reserved for MCP protocol)
- Never print JSON tool responses to stderr
- Include in logs: tool name, request ID (if available), duration, success/failure
- Redact: AWS credentials, session tokens, full secrets, sensitive seller data

### 2. Tools Layer (`src/tools/*.ts`)

Each tool is implemented as a separate module with a consistent pattern:

**Tool Module Structure:**
```typescript
// Parameter validation schema
export const toolNameSchema = z.object({
  param1: z.string().min(1, "param1 is required"),
  param2: z.string().optional(),
});

// Tool implementation
export async function toolName(args: unknown, env: Env) {
  try {
    // 1. Validate input parameters
    const { param1, param2 } = toolNameSchema.parse(args);
    
    // 2. Get AWS client
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // 3. Execute AWS operation
    const result = await dynamo.send(command);
    
    // 4. Transform and return success response
    return successResponse(transformedData);
  } catch (error) {
    // 5. Handle errors with appropriate error codes
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("tool_name", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
```

**Available Tools:**

1. **list_pending_seller_approvals**: Lists sellers awaiting verification
   - Input: `limit` (number, optional, default 20, max 100)
   - DynamoDB: QueryCommand for Approval_Record items with pending review status
   - Returns: Array of seller summaries with seller_id, business_name, owner_name, contact_phone, contact_email, verification_status, created_at, review_state
   - Sorting: Results sorted by created_at ascending (oldest first to prioritize)
   - Pagination: Includes `hasMore` indicator if more results exist
   - Example Input: `{ "limit": 20 }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "approvals": [
           {
             "sellerId": "seller_123",
             "businessName": "Local Grocery Store",
             "ownerName": "Rajesh Kumar",
             "contactPhone": "+919876543210",
             "contactEmail": "rajesh@example.com",
             "verificationStatus": "PENDING",
             "reviewState": "AWAITING_REVIEW",
             "createdAt": "2026-02-20T10:00:00Z"
           }
         ],
         "count": 1,
         "hasMore": false
       },
       "timestamp": "2026-02-28T12:00:00Z"
     }
     ```

2. **get_seller_profile**: Retrieves detailed seller information
   - Input: `sellerId` (string, required)
   - DynamoDB: GetCommand with PK=`SELLER#{sellerId}`, SK=`PROFILE`
   - Returns: Seller data including seller_id, business_name, business_type, owner_name, contact_phone, contact_email, verification_status, document_keys, created_at, updated_at, approved_at
   - Document Keys: Includes S3 document references without presigned URLs
   - Example Input: `{ "sellerId": "seller_123" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "sellerId": "seller_123",
         "businessName": "Local Grocery Store",
         "businessType": "RETAIL",
         "ownerName": "Rajesh Kumar",
         "contactPhone": "+919876543210",
         "contactEmail": "rajesh@example.com",
         "verificationStatus": "PENDING",
         "documentKeys": [
           "sellers/seller_123/gst_certificate.pdf",
           "sellers/seller_123/pan_card.pdf"
         ],
         "createdAt": "2026-02-20T10:00:00Z",
         "updatedAt": "2026-02-20T10:00:00Z",
         "approvedAt": null
       },
       "timestamp": "2026-02-28T12:01:00Z"
     }
     ```

3. **list_open_disputes**: Lists open disputes for admin review
   - Input: `limit` (number, optional, default 20, max 100)
   - DynamoDB: QueryCommand for Dispute_Record items with open status
   - Returns: Array of dispute summaries with dispute_id, order_id, seller_id, customer_id, status, reason, created_at, last_updated_at
   - Sorting: Results sorted by created_at ascending (oldest first to prioritize)
   - Pagination: Includes `hasMore` indicator if more results exist
   - Example Input: `{ "limit": 20 }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "disputes": [
           {
             "disputeId": "dispute_456",
             "orderId": "order_789",
             "sellerId": "seller_123",
             "customerId": "customer_321",
             "status": "OPEN",
             "reason": "PRODUCT_NOT_RECEIVED",
             "createdAt": "2026-02-25T14:30:00Z",
             "lastUpdatedAt": "2026-02-25T14:30:00Z"
           }
         ],
         "count": 1,
         "hasMore": false
       },
       "timestamp": "2026-02-28T12:02:00Z"
     }
     ```

4. **get_dispute**: Retrieves detailed dispute information
   - Input: `orderId` (string, optional), `disputeId` (string, optional)
   - Validation: At least one of orderId or disputeId must be provided
   - DynamoDB: GetCommand or QueryCommand based on provided parameter
   - Returns: Dispute data including dispute_id, order_id, seller_id, customer_id, status, reason, description, status_history, linked_payment_id, created_at, updated_at, resolved_at
   - Example Input: `{ "disputeId": "dispute_456" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "disputeId": "dispute_456",
         "orderId": "order_789",
         "sellerId": "seller_123",
         "customerId": "customer_321",
         "status": "OPEN",
         "reason": "PRODUCT_NOT_RECEIVED",
         "description": "Customer claims product was not delivered",
         "statusHistory": [
           {
             "status": "OPEN",
             "timestamp": "2026-02-25T14:30:00Z",
             "actor": "customer_321"
           }
         ],
         "linkedPaymentId": "payment_999",
         "createdAt": "2026-02-25T14:30:00Z",
         "updatedAt": "2026-02-25T14:30:00Z",
         "resolvedAt": null
       },
       "timestamp": "2026-02-28T12:03:00Z"
     }
     ```

5. **get_audit_timeline**: Retrieves audit trail for resources
   - Input: `resourceType` (string, required), `resourceId` (string, required)
   - DynamoDB: QueryCommand with PK=`RESOURCE#{resourceType}#{resourceId}`, SK prefix=`AUDIT#`
   - Returns: Array of Audit_Record items with audit_id, resource_type, resource_id, action, actor_id, actor_type, changes, timestamp, metadata
   - Sorting: Results sorted by timestamp descending (most recent first)
   - Limit: Maximum 100 audit entries
   - Truncation: Includes `truncated` indicator if more than 100 entries exist
   - Example Input: `{ "resourceType": "SELLER", "resourceId": "seller_123" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "resourceType": "SELLER",
         "resourceId": "seller_123",
         "auditRecords": [
           {
             "auditId": "audit_001",
             "resourceType": "SELLER",
             "resourceId": "seller_123",
             "action": "PROFILE_UPDATED",
             "actorId": "admin_456",
             "actorType": "ADMIN",
             "changes": {
               "verificationStatus": {
                 "from": "PENDING",
                 "to": "APPROVED"
               }
             },
             "timestamp": "2026-02-28T10:00:00Z",
             "metadata": {}
           }
         ],
         "count": 1,
         "truncated": false
       },
       "timestamp": "2026-02-28T12:04:00Z"
     }
     ```

6. **list_recent_payments**: Lists recent payment transactions
   - Input: `status` (string, optional), `limit` (number, optional, default 20, max 100)
   - DynamoDB: QueryCommand for Payment_Record items, optionally filtered by status
   - Returns: Array of payment summaries with payment_id, order_id, amount, currency, status, provider, gateway_payment_id, created_at, updated_at
   - Sorting: Results sorted by created_at descending (most recent first)
   - Pagination: Includes `hasMore` indicator if more results exist
   - Example Input: `{ "status": "SUCCESS", "limit": 20 }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "payments": [
           {
             "paymentId": "payment_999",
             "orderId": "order_789",
             "amount": 1499,
             "currency": "INR",
             "status": "SUCCESS",
             "provider": "RAZORPAY",
             "gatewayPaymentId": "pay_abc123xyz",
             "createdAt": "2026-02-28T09:00:00Z",
             "updatedAt": "2026-02-28T09:01:00Z"
           }
         ],
         "count": 1,
         "hasMore": false
       },
       "timestamp": "2026-02-28T12:05:00Z"
     }
     ```

**Operational Limits Summary:**
- `list_pending_seller_approvals`: Default 20, max 100 approvals
- `list_open_disputes`: Default 20, max 100 disputes
- `list_recent_payments`: Default 20, max 100 payments
- `get_audit_timeline`: Maximum 100 audit entries
- All list tools include `hasMore` or `truncated` fields in responses

### 3. Core Runtime (`src/shared/*.ts`)

**AWS Clients (`aws-clients.ts`):**
- Implements singleton pattern for AWS client instances
- `getDynamoClient(region)`: Returns DynamoDBDocumentClient with marshalling options
- Clients are cached to avoid repeated initialization

**Response Formatter (`response-formatter.ts`):**
- Defines standard response interfaces: `SuccessResponse<T>` and `ErrorResponse`
- `successResponse<T>(data: T)`: Wraps data in success response with timestamp
- `errorResponse(code, message, details?)`: Creates error response with structured error object

**Error Handler (`error-handler.ts`):**
- `MCPError`: Custom error class with code and details
- `handleAWSError(error)`: Maps AWS SDK errors to MCP error codes
  - `ResourceNotFoundException` → `NOT_FOUND`
  - `ValidationException` → `VALIDATION_ERROR`
  - `AccessDeniedException` → `ACCESS_DENIED`
  - Other errors → `AWS_ERROR` or `UNKNOWN_ERROR`
- `logError(context, error)`: Logs errors to stderr with context

### 4. Environment Module (`src/env.ts`)

**Responsibilities:**
- Define Zod schema for environment variables
- Export `Env` type for type-safe environment access
- `loadEnv()`: Validates process.env and returns typed configuration
- Throws descriptive error if validation fails

**Environment Schema:**
```typescript
const envSchema = z.object({
  AWS_REGION: z.literal("ap-south-1"),
  DYNAMODB_TABLE_NAME: z.literal("CommerceCore-dev"),
  AWS_PROFILE: z.literal("kiro-mcp"),
  S3_DOC_BUCKET: z.string().min(1).optional(),
});
```

### 5. Entry Point (`src/index.ts`)

**Responsibilities:**
- Shebang for direct execution: `#!/usr/bin/env node`
- Initialize StdioServerTransport
- Connect server to transport
- Log startup message to stderr
- Handle fatal errors and exit with code 1

## Data Models

### DynamoDB Table Schema

The server queries the `CommerceCore-dev` DynamoDB table with the following access patterns:

**Primary Key Structure:**
- `PK` (Partition Key): Entity type and ID (e.g., `SELLER#seller_123`)
- `SK` (Sort Key): Entity type or related entity (e.g., `PROFILE` or `AUDIT#timestamp`)

**Entity Types:**

1. **Seller Profile Entity**
   - PK: `SELLER#{sellerId}`
   - SK: `PROFILE`
   - Attributes: sellerId, businessName, businessType, ownerName, contactPhone, contactEmail, verificationStatus, documentKeys, createdAt, updatedAt, approvedAt

2. **Approval Record Entity**
   - PK: `APPROVAL#{status}` (e.g., `APPROVAL#PENDING`)
   - SK: `SELLER#{sellerId}#{timestamp}`
   - Attributes: sellerId, businessName, ownerName, contactPhone, contactEmail, verificationStatus, reviewState, createdAt

3. **Dispute Record Entity**
   - PK: `DISPUTE#{status}` (e.g., `DISPUTE#OPEN`)
   - SK: `DISPUTE#{disputeId}#{timestamp}`
   - Attributes: disputeId, orderId, sellerId, customerId, status, reason, description, statusHistory, linkedPaymentId, createdAt, updatedAt, resolvedAt

4. **Audit Record Entity**
   - PK: `RESOURCE#{resourceType}#{resourceId}`
   - SK: `AUDIT#{timestamp}`
   - Attributes: auditId, resourceType, resourceId, action, actorId, actorType, changes, timestamp, metadata

5. **Payment Record Entity**
   - PK: `PAYMENT#{status}` (e.g., `PAYMENT#SUCCESS`) or `PAYMENT#ALL`
   - SK: `PAYMENT#{paymentId}#{timestamp}`
   - Attributes: paymentId, orderId, amount, currency, status, provider, gatewayPaymentId, createdAt, updatedAt

**Access Patterns:**

1. **List Pending Seller Approvals**: QueryCommand with PK=`APPROVAL#PENDING`, sorted by SK (timestamp)
2. **Get Seller Profile**: GetCommand with PK=`SELLER#{sellerId}`, SK=`PROFILE`
3. **List Open Disputes**: QueryCommand with PK=`DISPUTE#OPEN`, sorted by SK (timestamp)
4. **Get Dispute by ID**: QueryCommand or GetCommand based on available indexes
5. **Get Audit Timeline**: QueryCommand with PK=`RESOURCE#{resourceType}#{resourceId}`, SK begins_with `AUDIT#`
6. **List Recent Payments**: QueryCommand with PK=`PAYMENT#{status}` or `PAYMENT#ALL`, sorted by SK (timestamp)

**Assumptions:**
- Approval records are indexed by status for efficient pending queries
- Dispute records are indexed by status for efficient open queries
- Audit records are colocated under resource partition key
- Payment records are indexed by status for efficient filtering
- Timestamps are included in sort keys for chronological ordering

### Response Models

**Success Response:**
```typescript
{
  success: true,
  data: T,  // Tool-specific data
  timestamp: string  // ISO 8601 timestamp
}
```

**Error Response:**
```typescript
{
  success: false,
  error: {
    code: string,  // Error code (e.g., "NOT_FOUND", "VALIDATION_ERROR")
    message: string,  // Human-readable error message
    details?: unknown  // Optional additional error context
  },
  timestamp: string  // ISO 8601 timestamp
}
```

## Error Handling

### Error Categories

1. **Validation Errors** (`VALIDATION_ERROR`)
   - Triggered by Zod schema validation failures
   - Includes detailed validation error messages
   - Returned before any AWS operations

2. **Not Found Errors** (`NOT_FOUND`)
   - Entity does not exist in DynamoDB
   - Mapped from AWS `ResourceNotFoundException`

3. **Access Denied Errors** (`ACCESS_DENIED`)
   - AWS credentials invalid or missing
   - Insufficient IAM permissions
   - Mapped from AWS `AccessDeniedException`

4. **AWS Errors** (`AWS_ERROR`)
   - General AWS SDK errors
   - Includes original AWS error name in details

5. **Unknown Errors** (`UNKNOWN_ERROR`)
   - Unexpected errors not matching known patterns
   - Includes error object in details for debugging

### Error Handling Flow

```
Tool Invocation
    ↓
Parameter Validation (Zod)
    ↓ [validation fails]
    └→ Return VALIDATION_ERROR
    ↓ [validation succeeds]
AWS Operation
    ↓ [AWS error]
    └→ handleAWSError() → Map to MCP error code
    ↓ [success]
Transform Data
    ↓
Return Success Response
```

### Error Logging

- All errors logged to stderr via `logError(context, error)`
- Context includes tool name for traceability
- Error messages sanitized to avoid exposing sensitive data (credentials, internal paths)
- Seller information partially redacted in logs (e.g., phone numbers masked)

### Timeout Handling

- Tools should complete within 5 seconds under normal conditions
- AWS SDK has default timeouts; no custom timeout implementation needed
- Timeout errors mapped to `AWS_ERROR` with timeout indication




## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Environment Validation Enforces Required Values

For any environment configuration object, the environment validator should accept it if and only if AWS_REGION equals "ap-south-1", DYNAMODB_TABLE_NAME equals "CommerceCore-dev", and AWS_PROFILE equals "kiro-mcp", and if S3_DOC_BUCKET is provided it must be a non-empty string, and if any required variable is missing the validator should fail with a descriptive error message.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6**

### Property 2: Tool Registry Completeness

For any tool name in the set {list_pending_seller_approvals, get_seller_profile, list_open_disputes, get_dispute, get_audit_timeline, list_recent_payments}, the server should have a registered handler that can process requests for that tool.

**Validates: Requirements 1.8, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1**

### Property 3: Parameter Validation Rejects Invalid Inputs

For any tool invocation with invalid parameters (missing required fields, wrong types, empty strings where non-empty required), the tool should return an error response with code "VALIDATION_ERROR" and details describing the specific validation failure.

**Validates: Requirements 3.2, 5.4, 6.2, 6.3, 10.1**

### Property 4: Limit Parameter Validation and Defaults

For any list tool (list_pending_seller_approvals, list_open_disputes, list_recent_payments), when the limit parameter is not provided, it should default to 20, and when limit is provided with a value greater than 100, the tool should return a VALIDATION_ERROR.

**Validates: Requirements 2.2, 2.3, 4.2, 4.3, 7.3, 7.4**

### Property 5: DynamoDB Key Construction Correctness

For any valid entity ID and entity type pair (sellerId/SELLER/PROFILE, resourceType/resourceId/RESOURCE), the corresponding tool should construct a DynamoDB partition key with the correct format (SELLER#{sellerId} or RESOURCE#{resourceType}#{resourceId}) and appropriate sort key.

**Validates: Requirements 3.3, 6.4**

### Property 6: Success Response Structure Invariant

For any successful tool invocation that returns data, the response should have the structure { success: true, data: T, timestamp: string } where timestamp is a valid ISO 8601 string and data contains all required fields for that tool's response type (seller summaries include seller_id, business_name, owner_name, contact_phone, contact_email, verification_status, created_at, review_state; seller profiles include seller_id, business_name, business_type, owner_name, contact_phone, contact_email, verification_status, document_keys, created_at, updated_at, approved_at; dispute summaries include dispute_id, order_id, seller_id, customer_id, status, reason, created_at, last_updated_at; dispute details include dispute_id, order_id, seller_id, customer_id, status, reason, description, status_history, linked_payment_id, created_at, updated_at, resolved_at; audit records include audit_id, resource_type, resource_id, action, actor_id, actor_type, changes, timestamp, metadata; payment summaries include payment_id, order_id, amount, currency, status, provider, gateway_payment_id, created_at, updated_at).

**Validates: Requirements 2.5, 3.4, 4.5, 5.7, 6.5, 7.7**

### Property 7: Result Ordering Correctness for Ascending Sorts

For any list tool invocation that returns multiple items where results should be sorted in ascending order (list_pending_seller_approvals and list_open_disputes sort by created_at ascending), the results should be ordered such that each item's sort field is less than or equal to the next item's sort field.

**Validates: Requirements 2.6, 4.6**

### Property 8: Result Ordering Correctness for Descending Sorts

For any list tool invocation that returns multiple items where results should be sorted in descending order (get_audit_timeline sorts by timestamp descending, list_recent_payments sorts by created_at descending), the results should be ordered such that each item's sort field is greater than or equal to the next item's sort field.

**Validates: Requirements 6.6, 7.8**

### Property 9: Pagination Metadata Accuracy

For any list tool invocation (list_pending_seller_approvals, list_open_disputes, list_recent_payments) where the total number of matching items exceeds the limit, the response should include a hasMore indicator set to true.

**Validates: Requirements 2.7, 4.7, 7.9**

### Property 10: Audit Timeline Truncation Metadata

For any get_audit_timeline invocation where the total number of audit records exceeds 100, the response should include a truncated indicator set to true and return at most 100 audit entries.

**Validates: Requirements 6.7, 6.8**

### Property 11: Not Found Error Consistency

For any tool invocation where the requested entity does not exist in DynamoDB (tested by querying with a non-existent ID), the tool should return an error response with code "NOT_FOUND" and a message indicating which entity type and ID was not found.

**Validates: Requirements 3.6, 5.8**

### Property 12: Payment Status Filtering Correctness

For any list_recent_payments invocation with a status parameter, all returned payments should have a status field matching the specified status value.

**Validates: Requirements 7.6**

### Property 13: Document Keys Inclusion Without Modification

For any get_seller_profile invocation that returns a seller with document_keys, the response should include the S3 document references as-is without generating presigned URLs or modifying the keys.

**Validates: Requirements 3.5**

### Property 14: AWS Error Mapping Completeness

For any AWS SDK error encountered during tool execution, the error handler should map it to an appropriate MCP error code following these rules: ResourceNotFoundException → NOT_FOUND, ValidationException → VALIDATION_ERROR, AccessDeniedException → ACCESS_DENIED, and all other errors → AWS_ERROR or UNKNOWN_ERROR.

**Validates: Requirements 2.9, 3.7, 4.9, 5.9, 6.10, 7.11, 10.7**

### Property 15: Error Logging Context Completeness and Sanitization

For any error that occurs during tool execution, the error should be logged to stderr with structured context including at minimum the tool name and error message, and the error response returned to the client should not contain sensitive information including AWS credentials, internal file system paths, session tokens, or raw stack traces.

**Validates: Requirements 10.5, 10.6, 10.8**

### Property 16: Response Timestamp Validity

For any response (success or error) returned by any tool, the timestamp field should be a valid ISO 8601 formatted string representing a time within 1 second of the current time.

**Validates: Requirements 2.5, 3.4, 4.5, 5.7, 6.5, 7.7**

## Testing Strategy

### Dual Testing Approach

The commerce-admin-mcp-server will use both unit testing and property-based testing to ensure comprehensive coverage:

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all inputs
- Both are complementary and necessary for comprehensive coverage

Unit tests are helpful for specific examples and edge cases, but we should avoid writing too many unit tests since property-based tests handle covering lots of inputs. Unit tests should focus on:
- Specific examples that demonstrate correct behavior
- Integration points between components
- Edge cases and error conditions

Property tests should focus on:
- Universal properties that hold for all inputs
- Comprehensive input coverage through randomization

### Property-Based Testing Configuration

The project will use **fast-check** as the property-based testing library for JavaScript/TypeScript. Fast-check is the standard PBT library for the JavaScript ecosystem and integrates well with Jest or Vitest.

**Configuration Requirements:**
- Each property test must run a minimum of 100 iterations
- Each test must include a comment tag referencing the design property
- Tag format: `// Feature: commerce-admin-mcp-server, Property {number}: {property_text}`

**Example Property Test Structure:**
```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('Environment Validation', () => {
  // Feature: commerce-admin-mcp-server, Property 1: Environment Validation Enforces Required Values
  it('should accept only configurations with required values', () => {
    fc.assert(
      fc.property(
        fc.record({
          AWS_REGION: fc.string(),
          DYNAMODB_TABLE_NAME: fc.string(),
          AWS_PROFILE: fc.string(),
          S3_DOC_BUCKET: fc.option(fc.string()),
        }),
        (config) => {
          const result = envSchema.safeParse(config);
          const shouldPass = 
            config.AWS_REGION === 'ap-south-1' &&
            config.DYNAMODB_TABLE_NAME === 'CommerceCore-dev' &&
            config.AWS_PROFILE === 'kiro-mcp' &&
            (!config.S3_DOC_BUCKET || config.S3_DOC_BUCKET.length > 0);
          
          expect(result.success).toBe(shouldPass);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Testing Approach

1. **Unit Tests** - Focus on specific examples and edge cases:
   - Environment validation with specific valid/invalid configurations
   - Tool registration includes all expected tools
   - Response formatting with specific data structures
   - Error mapping for specific AWS error types
   - Empty result handling for list tools (no pending approvals, no open disputes, no payments, no audit records)
   - Specific timeout and authentication error scenarios
   - Compiled output is executable via node command
   - MCP configuration file contains required fields and correct structure
   - Server initialization and stdio transport setup

2. **Property-Based Tests** - Verify universal properties across all inputs:
   - Property 1: Environment validation with randomly generated configs
   - Property 2: Tool registry completeness with all expected tool names
   - Property 3: Parameter validation with randomly generated invalid inputs across all tools
   - Property 4: Limit parameter validation and defaults with random limit values
   - Property 5: DynamoDB key construction with randomly generated entity IDs
   - Property 6: Success response structure invariant with randomly generated data
   - Property 7: Result ordering correctness for ascending sorts with randomly generated result sets
   - Property 8: Result ordering correctness for descending sorts with randomly generated result sets
   - Property 9: Pagination metadata with randomly generated large result sets
   - Property 10: Audit timeline truncation with randomly generated audit records
   - Property 11: Not found error consistency with randomly generated non-existent IDs
   - Property 12: Payment status filtering with randomly generated payments and status values
   - Property 13: Document keys inclusion without modification with randomly generated document keys
   - Property 14: AWS error mapping completeness with various AWS error types
   - Property 15: Error logging context completeness and sanitization with randomly generated errors
   - Property 16: Response timestamp validity with randomly generated responses

3. **Integration Tests** - Test with actual AWS services (optional, requires AWS setup):
   - End-to-end tool invocation with real DynamoDB
   - AWS credential handling with real AWS SDK
   - Full server startup and tool execution

**Test Organization:**
```
tools/mcp/commerce-admin/
├── src/
│   ├── __tests__/
│   │   ├── unit/
│   │   │   ├── env.test.ts
│   │   │   ├── response-formatter.test.ts
│   │   │   ├── error-handler.test.ts
│   │   │   ├── aws-clients.test.ts
│   │   │   └── tool-specific-edge-cases.test.ts
│   │   ├── property/
│   │   │   ├── env-validation.property.test.ts
│   │   │   ├── tool-registry.property.test.ts
│   │   │   ├── parameter-validation.property.test.ts
│   │   │   ├── limit-validation.property.test.ts
│   │   │   ├── key-construction.property.test.ts
│   │   │   ├── response-structure.property.test.ts
│   │   │   ├── result-ordering.property.test.ts
│   │   │   ├── pagination-metadata.property.test.ts
│   │   │   ├── status-filtering.property.test.ts
│   │   │   ├── error-handling.property.test.ts
│   │   │   └── sensitive-data-redaction.property.test.ts
│   │   └── integration/
│   │       ├── list-pending-seller-approvals.integration.test.ts
│   │       ├── get-seller-profile.integration.test.ts
│   │       ├── list-open-disputes.integration.test.ts
│   │       ├── get-dispute.integration.test.ts
│   │       ├── get-audit-timeline.integration.test.ts
│   │       ├── list-recent-payments.integration.test.ts
│   │       └── server-startup.integration.test.ts
```

**Mocking Strategy:**
- Mock AWS SDK clients for unit and property tests
- Use `aws-sdk-client-mock` library for consistent mocking
- Mock DynamoDB responses with realistic data structures
- Integration tests use real AWS services (optional, for CI/CD)

**Test Coverage Goals:**
- Unit tests: Cover specific examples and edge cases
- Property tests: Cover universal behaviors across all inputs
- Integration tests: Verify end-to-end functionality with real services
- Combined coverage: Aim for 80%+ code coverage with emphasis on critical paths

**Continuous Integration:**
- Run unit and property tests on every commit
- Run integration tests on pull requests (if AWS credentials available)
- Fail build if any property test fails
- Report test coverage metrics

## Build and Deployment Configuration

### TypeScript Configuration

The project uses TypeScript with strict type checking for type safety and better developer experience.

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

**Key Configuration Choices:**
- `target: ES2022`: Modern JavaScript features for Node.js 20+
- `module: ES2022`: ES modules for better tree-shaking and modern import/export
- `strict: true`: Enable all strict type checking options
- `outDir: ./dist`: Compiled output directory
- `rootDir: ./src`: Source files directory

### Package Configuration

**package.json:**
```json
{
  "name": "commerce-admin-mcp",
  "version": "1.0.0",
  "description": "MCP server for commerce administrative data access",
  "type": "module",
  "main": "dist/index.js",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.5.0",
    "@aws-sdk/client-dynamodb": "^3.700.0",
    "@aws-sdk/lib-dynamodb": "^3.700.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3",
    "vitest": "^1.0.0",
    "fast-check": "^3.15.0",
    "aws-sdk-client-mock": "^3.0.0",
    "@vitest/coverage-v8": "^1.0.0"
  }
}
```

**Key Dependencies:**
- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`: AWS DynamoDB access
- `zod`: Runtime type validation and schema definition
- `vitest`: Fast unit test runner with native TypeScript support
- `fast-check`: Property-based testing library
- `aws-sdk-client-mock`: Mock AWS SDK clients for testing

### Project Structure

```
tools/mcp/commerce-admin/
├── src/
│   ├── index.ts                 # Entry point
│   ├── server.ts                # MCP server setup
│   ├── env.ts                   # Environment validation
│   ├── tools/
│   │   ├── list-pending-seller-approvals.ts
│   │   ├── get-seller-profile.ts
│   │   ├── list-open-disputes.ts
│   │   ├── get-dispute.ts
│   │   ├── get-audit-timeline.ts
│   │   └── list-recent-payments.ts
│   ├── shared/
│   │   ├── aws-clients.ts       # AWS client singletons
│   │   ├── response-formatter.ts
│   │   └── error-handler.ts
│   └── __tests__/               # Test files (see Testing Strategy)
├── dist/                        # Compiled JavaScript (generated)
│   └── index.js
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

### Build Process

1. **Development**: `npm run dev` - Watch mode with automatic recompilation
2. **Production Build**: `npm run build` - Compile TypeScript to JavaScript
3. **Type Checking**: `npm run typecheck` - Verify types without emitting files
4. **Execution**: `node ./tools/mcp/commerce-admin/dist/index.js`

### MCP Configuration

The server is registered in `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "commerce-admin-mcp": {
      "command": "node",
      "args": ["./tools/mcp/commerce-admin/dist/index.js"],
      "env": {
        "AWS_REGION": "ap-south-1",
        "DYNAMODB_TABLE_NAME": "CommerceCore-dev",
        "AWS_PROFILE": "kiro-mcp",
        "S3_DOC_BUCKET": "vyapargyan-docs-dev"
      },
      "disabled": false,
      "alwaysAllow": [
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

**Configuration Notes:**
- All admin tools are marked as `alwaysAllow` since they are read-only and safe for auto-approval
- Environment variables are provided directly in the configuration
- AWS credentials are loaded from the `kiro-mcp` profile (not in config for security)

## Assumptions and Open Questions

This design makes specific assumptions about the DynamoDB table structure and AWS infrastructure. These assumptions must be validated during implementation.

**Confirmed Assumptions:**
- DynamoDB table name is `CommerceCore-dev` (configurable via environment)
- Table uses `PK` (partition key) and `SK` (sort key) for primary access
- AWS credentials are available via the `kiro-mcp` profile or default credential chain
- Node.js 20+ is available in the execution environment
- S3 bucket for seller documents exists but presigned URLs are not required for v1

**DynamoDB Key Conventions (v1 Design):**

Administrative entities use status-based partitioning for efficient querying:
- Pending Approvals: `PK=APPROVAL#PENDING`, `SK=SELLER#{sellerId}#{timestamp}`
- Open Disputes: `PK=DISPUTE#OPEN`, `SK=DISPUTE#{disputeId}#{timestamp}`
- Payments by Status: `PK=PAYMENT#{status}`, `SK=PAYMENT#{paymentId}#{timestamp}`
- All Payments: `PK=PAYMENT#ALL`, `SK=PAYMENT#{paymentId}#{timestamp}`

Root entity items use simplified SK patterns:
- Seller Profile: `PK=SELLER#{sellerId}`, `SK=PROFILE`

Audit records use resource-based partitioning:
- Audit Timeline: `PK=RESOURCE#{resourceType}#{resourceId}`, `SK=AUDIT#{timestamp}`

**Important Note:** If the production table uses different key conventions, the implementation must adapt to the actual table structure. The design assumes these patterns for efficient admin queries.

**Open Questions Requiring Confirmation:**

1. **Approval Record Structure:**
   - Are approval records stored separately from seller profiles?
   - Is there a GSI or status-based partition key for pending approvals?
   - What is the exact structure of the review_state field?
   - Are approval records updated in place or are new records created?

2. **Dispute Record Structure:**
   - Are disputes indexed by status for efficient open dispute queries?
   - Is there a GSI for querying disputes by order_id?
   - What is the exact structure of the status_history field?
   - Are disputes linked to payments via a foreign key?

3. **Audit Record Structure:**
   - Are audit records colocated under resource partition keys?
   - What is the exact format of the changes field (JSON diff, full object, etc.)?
   - Are there different audit record types for different actions?
   - Is there a maximum retention period for audit records?

4. **Payment Record Structure:**
   - Are payments indexed by status for efficient filtering?
   - Is there a separate index for all payments regardless of status?
   - What payment statuses exist (SUCCESS, FAILED, PENDING, REFUNDED, etc.)?
   - Are payment records updated in place or are new records created for status changes?

5. **Field Names:**
   - Exact field names for seller verification: `verificationStatus`, `verification_status`, or `status`?
   - Exact field names for dispute reason: `reason`, `dispute_reason`, or `reason_code`?
   - Exact field names for audit actor: `actorId`, `actor_id`, or `userId`?
   - Exact field names for payment gateway ID: `gatewayPaymentId`, `gateway_payment_id`, or `externalId`?

6. **Data Constraints:**
   - What is the maximum number of pending approvals at any time?
   - What is the maximum number of open disputes at any time?
   - What is the maximum number of audit records per resource?
   - What is the maximum number of payments to return?

7. **Performance Expectations:**
   - What is the expected p99 latency for DynamoDB queries?
   - Are there any rate limiting concerns for the MCP server?
   - Should we implement caching for frequently accessed data?

**Implementation Strategy:**
During implementation, the actual table structure should be inspected using the AWS Console or CLI. The code should be adapted to match the actual patterns. If significant deviations exist, this design document should be updated to reflect the actual implementation.

**Validation Steps:**
1. Inspect DynamoDB table schema using AWS Console
2. Query sample data to understand actual key patterns
3. Identify available GSIs and their key structures
4. Verify field names match assumptions
5. Update implementation to match actual schema
6. Document any deviations in implementation notes

## Summary

The commerce-admin-mcp-server provides read-only access to administrative data from the VyaparGyan platform. It follows the established MCP server pattern from commerce-ops-mcp and commerce-catalog-mcp, using TypeScript, AWS SDK v3, and the MCP SDK for stdio transport.

**Key Design Decisions:**
- Read-only operations only (no mutations)
- Lazy AWS client initialization for better startup performance
- Consistent error handling and response formatting
- Property-based testing for comprehensive coverage
- Strict environment validation with required values
- Status-based partitioning for efficient admin queries (pending approvals, open disputes)
- Resource-based partitioning for audit timelines
- No presigned URL generation for S3 documents (v1 limitation)

**Next Steps:**
1. Validate DynamoDB schema assumptions
2. Implement core server and tool infrastructure
3. Implement individual tools following the established pattern
4. Write unit and property-based tests
5. Create README documentation
6. Test with MCP inspector locally
7. Integrate with Kiro and validate end-to-end functionality
