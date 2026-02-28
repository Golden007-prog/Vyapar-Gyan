# Design Document: Commerce Ops MCP Server

## Overview

The commerce-ops-mcp-server is a Model Context Protocol (MCP) server that provides read-only access to operational data from the VyaparGyan commerce platform. It exposes a set of tools that enable AI assistants like Kiro to query orders, payments, inventory, WhatsApp sessions, and logs stored in DynamoDB and CloudWatch Logs.

**Server Metadata:**
- Name: `commerce-ops-mcp`
- Version: `0.1.0`
- Protocol: MCP SDK (stdio transport)
- Runtime: Node.js 20+
- Language: TypeScript (compiled to JavaScript)

This MCP server follows the MCP SDK architecture pattern, using stdio transport for communication with Kiro. It implements a tool-based interface where each tool corresponds to a specific data retrieval operation. The server is built with TypeScript, compiled to JavaScript, and executed via Node.js.

**Primary Use Cases:**
- Debugging order and payment issues by retrieving detailed transaction data
- Monitoring inventory levels and tracking stock changes
- Investigating WhatsApp conversation context for customer support
- Searching platform logs for troubleshooting and incident response
- Supporting operational queries during development and production support

**Non-Goals (v1 Scope):**

This server is explicitly read-only. The following capabilities are out of scope for v1:
- No state-changing operations (no mutations)
- No order cancellation or modification
- No payment replay or refund initiation
- No seller approval or rejection
- No inventory updates or stock adjustments
- No signed URL generation for media
- No webhook replay or retry tooling
- No data deletion or archival operations

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
│              Commerce Ops MCP Server                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Server (server.ts)                                  │   │
│  │  - Tool registration                                 │   │
│  │  - Request routing                                   │   │
│  │  - Error handling                                    │   │
│  └──────────────┬───────────────────────────────────────┘   │
│                 │                                            │
│  ┌──────────────▼───────────────────────────────────────┐   │
│  │  Tools Layer                                         │   │
│  │  - get_order                                         │   │
│  │  - get_order_timeline                                │   │
│  │  - get_payment                                       │   │
│  │  - get_inventory                                     │   │
│  │  - get_whatsapp_session                              │   │
│  │  - search_logs                                       │   │
│  │  - list_seller_orders                                │   │
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
│  │  DynamoDB            │  │  CloudWatch Logs             │  │
│  │  CommerceCore-dev    │  │  /aws/commerce/*             │  │
│  └──────────────────────┘  └──────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### MCP Protocol Flow

1. **Initialization**: Kiro launches the server via `node ./tools/mcp/commerce-ops/dist/index.js`
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

- `AWS_REGION`: AWS region (default: "ap-south-1")
- `AWS_PROFILE`: AWS credentials profile (optional, defaults to "kiro-mcp" in Kiro config)
- `APP_ENV`: Application environment (default: "dev")
- `DDB_TABLE_NAME`: DynamoDB table name (default: "CommerceCore-dev")
- `LOG_GROUP_PREFIX`: CloudWatch log group prefix (default: "/aws/commerce")
- `MCP_MOCK_MODE`: Optional mock mode for local development (default: false)

Environment validation occurs at startup. If validation fails, the server terminates with a descriptive error message.

**Mock Mode (Optional):**
When `MCP_MOCK_MODE=true`, tools return fixture data instead of calling AWS services. This is useful for local debugging and development before full AWS setup is available.

### Security Model

**Read-Only Access:**
All tools provide read-only access to operational data. No mutations are permitted.

**Required IAM Permissions:**

DynamoDB:
- `dynamodb:GetItem` - Retrieve individual items
- `dynamodb:Query` - Query items by partition key
- `dynamodb:BatchGetItem` - Batch retrieve items (optional, for optimization)
- `dynamodb:DescribeTable` - Verify table existence (optional)

CloudWatch Logs:
- `logs:DescribeLogGroups` - List available log groups
- `logs:FilterLogEvents` - Search log events with filter patterns
- `logs:StartQuery` - Optional, for Logs Insights (not required for v1)
- `logs:GetQueryResults` - Optional, for Logs Insights (not required for v1)

**No Write Permissions Required:**
The server does not require any write, update, or delete permissions on DynamoDB or CloudWatch Logs.

**Data Redaction:**
All error messages and logs must redact sensitive information:
- AWS credentials and session tokens
- Internal file paths and system details
- Customer-sensitive message bodies (where applicable)
- Full secrets or API keys

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
- `name`: Tool identifier (e.g., "get_order")
- `description`: Human-readable description for AI assistant
- `inputSchema`: JSON Schema defining required and optional parameters

**Request Routing:**
The CallToolRequest handler uses a switch statement to route requests to the appropriate tool function based on the tool name.

**Logging Rules:**
- All internal logs go to stderr (never stdout, which is reserved for MCP protocol)
- Never print JSON tool responses to stderr
- Include in logs: tool name, request ID (if available), duration, success/failure
- Redact: AWS credentials, session tokens, full secrets, customer-sensitive message bodies

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
    const client = getAwsClient(env.AWS_REGION);
    
    // 3. Execute AWS operation
    const result = await client.send(command);
    
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

1. **get_order**: Retrieves order details by order ID
   - Input: `orderId` (string, required)
   - DynamoDB: GetCommand with PK=`ORDER#{orderId}`, SK=`ORDER`
   - Returns: Order details including status, customer, seller, amount, timestamps
   - Example Input: `{ "orderId": "ord_abc123" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "orderId": "ord_abc123",
         "status": "PENDING_PAYMENT",
         "customerId": "cust_456",
         "sellerId": "seller_789",
         "totalAmount": 1250,
         "currency": "INR",
         "createdAt": "2026-02-28T12:00:00Z",
         "updatedAt": "2026-02-28T12:00:00Z",
         "metadata": {}
       },
       "timestamp": "2026-02-28T12:01:00Z"
     }
     ```

2. **get_order_timeline**: Retrieves complete order timeline with related data
   - Input: `orderId` (string, required)
   - DynamoDB: Multiple queries for order, items, payments, audit logs
   - Returns: Comprehensive order timeline with all related entities
   - Limits: Max 200 related items total (items + payments + audit logs combined)
   - Truncation: Response includes `truncated: true` if limits exceeded
   - Example Input: `{ "orderId": "ord_abc123" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "order": { "orderId": "ord_abc123", "status": "COMPLETED", ... },
         "items": [{ "itemId": "item_1", "productId": "prod_1", "quantity": 2, ... }],
         "payments": [{ "paymentId": "pay_1", "amount": 1250, "status": "SUCCESS", ... }],
         "auditLogs": [{ "timestamp": "2026-02-28T12:00:00Z", "action": "ORDER_CREATED", ... }],
         "truncated": false
       },
       "timestamp": "2026-02-28T12:01:00Z"
     }
     ```

3. **get_payment**: Retrieves payment details for an order
   - Input: `orderId` (string, required)
   - DynamoDB: QueryCommand with PK=`ORDER#{orderId}`, SK begins_with `PAYMENT#`
   - Returns: Array of payment records with transaction details
   - Limits: Max 50 payments per order
   - Example Input: `{ "orderId": "ord_abc123" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "orderId": "ord_abc123",
         "payments": [
           {
             "paymentId": "pay_xyz789",
             "orderId": "ord_abc123",
             "amount": 1250,
             "currency": "INR",
             "status": "SUCCESS",
             "method": "UPI",
             "provider": "razorpay",
             "transactionId": "txn_123",
             "createdAt": "2026-02-28T12:00:00Z",
             "updatedAt": "2026-02-28T12:01:00Z"
           }
         ],
         "count": 1,
         "truncated": false
       },
       "timestamp": "2026-02-28T12:02:00Z"
     }
     ```

4. **get_inventory**: Retrieves product inventory and recent logs
   - Input: `productId` (string, required)
   - DynamoDB: GetCommand for product + QueryCommand for inventory logs
   - Returns: Current stock, reserved stock, available stock, recent inventory changes
   - Limits: Max 50 recent inventory logs
   - Example Input: `{ "productId": "prod_123" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "productId": "prod_123",
         "currentStock": 100,
         "reservedStock": 15,
         "availableStock": 85,
         "recentLogs": [
           {
             "timestamp": "2026-02-28T11:00:00Z",
             "type": "STOCK_ADDED",
             "quantity": 50,
             "reason": "RESTOCK",
             "reference": "po_456"
           }
         ],
         "truncated": false
       },
       "timestamp": "2026-02-28T12:03:00Z"
     }
     ```

5. **get_whatsapp_session**: Retrieves WhatsApp session by phone or session ID
   - Input: `phone` (string, optional) OR `sessionId` (string, optional)
   - DynamoDB: GetCommand (if sessionId) or QueryCommand via GSI1 (if phone)
   - Returns: Session state, conversation context, recent messages
   - Limits: Max 50 recent messages
   - Example Input: `{ "phone": "919876543210" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "session": {
           "sessionId": "sess_abc123",
           "phone": "919876543210",
           "status": "ACTIVE",
           "currentStep": "BROWSING_CATALOG",
           "context": { "lastProductViewed": "prod_123" },
           "createdAt": "2026-02-28T10:00:00Z",
           "updatedAt": "2026-02-28T12:00:00Z"
         },
         "recentMessages": [
           {
             "messageId": "msg_1",
             "direction": "INBOUND",
             "content": "Show me products",
             "timestamp": "2026-02-28T12:00:00Z"
           }
         ],
         "truncated": false
       },
       "timestamp": "2026-02-28T12:04:00Z"
     }
     ```

6. **search_logs**: Searches CloudWatch logs with filter pattern
   - Input: `query` (string, required), `logGroupPrefix` (optional), `startTime` (optional), `endTime` (optional)
   - CloudWatch: FilterLogEventsCommand with time range and pattern
   - Returns: Matching log entries (max 100) sorted by timestamp descending
   - Default Time Range: Last 1 hour if startTime/endTime not specified
   - Strategy: Use DescribeLogGroups to find matching groups, then FilterLogEvents on first N groups
   - Limits: Max 100 log entries, searches first 5 matching log groups
   - Example Input: `{ "query": "ERROR", "startTime": "2026-02-28T11:00:00Z" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "query": "ERROR",
         "logGroupPrefix": "/aws/commerce",
         "timeRange": {
           "start": "2026-02-28T11:00:00Z",
           "end": "2026-02-28T12:00:00Z"
         },
         "events": [
           {
             "timestamp": "2026-02-28T11:30:00Z",
             "message": "ERROR: Payment processing failed",
             "logStreamName": "api-server/2026/02/28"
           }
         ],
         "count": 1,
         "truncated": false
       },
       "timestamp": "2026-02-28T12:05:00Z"
     }
     ```

7. **list_seller_orders**: Lists orders for a specific seller
   - Input: `sellerId` (string, required), `status` (optional), `limit` (optional, max 100)
   - DynamoDB: QueryCommand via GSI for seller orders
   - Returns: Array of orders matching criteria
   - Limits: Default 20, max 100 orders
   - Example Input: `{ "sellerId": "seller_789", "status": "PENDING_PAYMENT", "limit": 20 }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "sellerId": "seller_789",
         "orders": [
           {
             "orderId": "ord_abc123",
             "status": "PENDING_PAYMENT",
             "totalAmount": 1250,
             "createdAt": "2026-02-28T12:00:00Z"
           }
         ],
         "count": 1,
         "hasMore": false
       },
       "timestamp": "2026-02-28T12:06:00Z"
     }
     ```

**Operational Limits Summary:**
- `get_order_timeline`: Max 200 related items
- `get_payment`: Max 50 payments
- `get_inventory`: Max 50 inventory logs
- `get_whatsapp_session`: Max 50 recent messages
- `list_seller_orders`: Default 20, max 100 orders
- `search_logs`: Max 100 log entries, searches first 5 log groups

All tools include `truncated` or `hasMore` fields in responses when limits are reached.

### 3. Core Runtime (`src/shared/*.ts`)

**AWS Clients (`aws-clients.ts`):**
- Implements singleton pattern for AWS client instances
- `getDynamoClient(region)`: Returns DynamoDBDocumentClient with marshalling options
- `getLogsClient(region)`: Returns CloudWatchLogsClient
- Clients are cached to avoid repeated initialization

**Response Formatter (`response-formatter.ts`):**
- Defines standard response interfaces: `SuccessResponse<T>` and `ErrorResponse`
- `successResponse<T>(data: T)`: Wraps data in success response with timestamp
- `errorResponse(code, message, details?)`: Creates error response with structured error object
- `partialSuccessResponse<T>(data: T, warnings: Warning[])`: Creates success response with warnings for partial failures

**Partial Success Model:**
Some tools fetch data from multiple sources and may encounter partial failures. The response formatter supports a warnings array:

```typescript
{
  "success": true,
  "data": { /* successfully retrieved data */ },
  "warnings": [
    {
      "code": "PARTIAL_DATA",
      "message": "Audit items could not be loaded",
      "details": { "reason": "AccessDenied" }
    }
  ],
  "timestamp": "2026-02-28T12:00:00Z"
}
```

This allows tools like `get_order_timeline` to return order data even if audit logs or disputes fail to load.

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

### 5. Entry Point (`src/index.ts`)

**Responsibilities:**
- Shebang for direct execution: `#!/usr/bin/env node`
- Initialize StdioServerTransport
- Connect server to transport
- Log startup message to stderr
- Handle fatal errors and exit with code 1

## Assumptions and Open Questions

This design makes specific assumptions about the DynamoDB table structure and AWS infrastructure. These assumptions must be validated during implementation.

**Confirmed Assumptions:**
- DynamoDB table name is `CommerceCore-dev` (configurable via environment)
- Table uses `PK` (partition key) and `SK` (sort key) for primary access
- CloudWatch log groups share a common prefix (default: `/aws/commerce`)
- AWS credentials are available via the `kiro-mcp` profile or default credential chain
- Node.js 20+ is available in the execution environment

**DynamoDB Key Conventions (v1 Design):**

Root entity items use simplified SK patterns:
- Order: `PK=ORDER#{orderId}`, `SK=ORDER`
- Product: `PK=PRODUCT#{productId}`, `SK=PRODUCT`
- WhatsApp Session: `PK=WHATSAPP_SESSION#{sessionId}`, `SK=SESSION`

Child/related items use descriptive SK prefixes:
- Payment: `PK=ORDER#{orderId}`, `SK=PAYMENT#{paymentId}`
- Order Item: `PK=ORDER#{orderId}`, `SK=ITEM#{itemId}`
- Audit Log: `PK=ORDER#{orderId}`, `SK=AUDIT#{timestamp}`
- Inventory Log: `PK=PRODUCT#{productId}`, `SK=INVENTORY_LOG#{timestamp}`
- WhatsApp Message: `PK=WHATSAPP_SESSION#{sessionId}`, `SK=MESSAGE#{messageId}`

**Important Note:** If the production table uses different SK conventions (e.g., `SK=ORDER#{orderId}` instead of `SK=ORDER`), the implementation must adapt to the actual table structure. The design assumes the simplified pattern for cleaner queries and easier `begins_with` filtering.

**Open Questions Requiring Confirmation:**

1. **GSI Structure:**
   - What is the exact name of the GSI for seller order queries? (Assumed: GSI with seller-based partition key)
   - What is the exact name of GSI1 for WhatsApp phone lookup? (Assumed: GSI1 with `GSI1PK=PHONE#{phone}`)
   - Are there additional GSIs that should be leveraged?

2. **Field Names:**
   - Exact field names for product stock: `stock`, `currentStock`, or `quantity`?
   - Exact field names for reserved stock: `reservedStock`, `reserved`, or `lockedQuantity`?
   - Exact field names for audit logs: `action`, `eventType`, or `auditAction`?

3. **Entity Relationships:**
   - Are audit logs and payment records always colocated under the order partition?
   - Are disputes stored as separate items or embedded in order metadata?
   - Are order items stored as separate DynamoDB items or embedded in the order object?

4. **CloudWatch Logs:**
   - Are all application logs in a single log group or multiple groups by service?
   - What is the exact log group naming pattern?
   - Are logs structured JSON or plain text?

5. **Performance Expectations:**
   - What is the expected p99 latency for DynamoDB queries?
   - What is the expected p99 latency for CloudWatch log searches?
   - Are there any rate limiting concerns for the MCP server?

**Implementation Strategy:**
During implementation, the actual table structure should be inspected and the code adapted accordingly. If significant deviations exist, the design document should be updated to reflect the actual patterns.

## Data Models

### DynamoDB Table Schema

The server queries the `CommerceCore-dev` DynamoDB table with the following access patterns:

**Primary Key Structure:**
- `PK` (Partition Key): Entity type and ID (e.g., `ORDER#abc123`)
- `SK` (Sort Key): Entity type and ID or related entity (e.g., `ORDER#abc123` or `PAYMENT#xyz789`)

**Global Secondary Index (GSI1):**
- `GSI1PK`: Alternative partition key for queries (e.g., `PHONE#919876543210`)
- `GSI1SK`: Alternative sort key (e.g., `SESSION#timestamp`)

**Entity Types:**

1. **Order Entity**
   - PK: `ORDER#{orderId}`
   - SK: `ORDER#{orderId}`
   - Attributes: orderId, status, customerId, sellerId, totalAmount, currency, createdAt, updatedAt, metadata

2. **Payment Entity**
   - PK: `ORDER#{orderId}`
   - SK: `PAYMENT#{paymentId}`
   - Attributes: paymentId, orderId, amount, currency, status, method, provider, transactionId, createdAt, updatedAt

3. **Product Entity**
   - PK: `PRODUCT#{productId}`
   - SK: `PRODUCT#{productId}`
   - Attributes: productId, stock, reservedStock, ...

4. **Inventory Log Entity**
   - PK: `PRODUCT#{productId}`
   - SK: `INVENTORY_LOG#{timestamp}`
   - Attributes: timestamp, type, quantity, reason, reference, createdAt

5. **WhatsApp Session Entity**
   - PK: `WHATSAPP_SESSION#{sessionId}`
   - SK: `WHATSAPP_SESSION#{sessionId}`
   - GSI1PK: `PHONE#{phone}`
   - GSI1SK: `SESSION#{timestamp}`
   - Attributes: sessionId, phone, status, currentStep, context, createdAt, updatedAt

6. **WhatsApp Message Entity**
   - PK: `WHATSAPP_SESSION#{sessionId}`
   - SK: `MESSAGE#{messageId}`
   - Attributes: messageId, direction, content, timestamp, createdAt

### CloudWatch Logs Structure

**Log Groups:**
- Prefix: `/aws/commerce` (configurable via `LOG_GROUP_PREFIX`)
- Log streams contain structured JSON logs with fields: timestamp, level, message, context

**Search Behavior:**
- Filter pattern matching on log message content
- Time range filtering (default: last 1 hour if not specified)
- Results limited to 100 entries
- Sorted by timestamp descending (most recent first)

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
   - CloudWatch log group not found
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

### Timeout Handling

- Tools should complete within documented time limits (5-10 seconds)
- AWS SDK has default timeouts; no custom timeout implementation needed
- Timeout errors mapped to `AWS_ERROR` with timeout indication

## Testing Strategy

### Unit Testing

Unit tests will verify specific tool behaviors and edge cases:

1. **Environment Validation Tests**
   - Valid environment configuration loads successfully
   - Missing required variables trigger descriptive errors
   - Default values applied correctly

2. **Tool Parameter Validation Tests**
   - Valid parameters pass validation
   - Missing required parameters return VALIDATION_ERROR
   - Invalid parameter types return VALIDATION_ERROR

3. **AWS Client Initialization Tests**
   - Clients initialize with correct region
   - Singleton pattern returns same instance
   - Marshalling options configured correctly

4. **Response Formatting Tests**
   - Success responses include data and timestamp
   - Error responses include code, message, and timestamp
   - Timestamps are valid ISO 8601 format

5. **Error Mapping Tests**
   - ResourceNotFoundException maps to NOT_FOUND
   - ValidationException maps to VALIDATION_ERROR
   - AccessDeniedException maps to ACCESS_DENIED
   - Unknown errors map to UNKNOWN_ERROR

6. **Tool-Specific Edge Cases**
   - get_order with non-existent order returns NOT_FOUND
   - get_whatsapp_session with neither phone nor sessionId returns VALIDATION_ERROR
   - search_logs with no results returns empty array
   - get_inventory with product having no logs returns empty logs array

### Property-Based Testing

Property-based tests will verify universal behaviors across all inputs using fast-check (JavaScript property testing library). Each test will run a minimum of 100 iterations.


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Environment Validation Round Trip

For any valid environment configuration object containing required fields (AWS_REGION, DDB_TABLE_NAME) and optional fields (AWS_PROFILE, APP_ENV, LOG_GROUP_PREFIX), the environment validator should successfully parse and return the configuration with defaults applied where values are missing, and the returned configuration should contain all required fields with valid values.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5**

### Property 2: Tool Registry Completeness

For any tool name in the set {get_order, get_order_timeline, get_payment, get_inventory, get_whatsapp_session, search_logs, list_seller_orders}, the server should have a registered handler that can process requests for that tool.

**Validates: Requirements 1.7, 2.1, 3.1, 4.1, 5.1, 6.1**

### Property 3: Parameter Validation Rejects Invalid Inputs

For any tool invocation with invalid parameters (missing required fields, wrong types, empty strings where non-empty required, or failing custom validation), the tool should return an error response with code "VALIDATION_ERROR" and details describing the specific validation failure.

**Validates: Requirements 2.2, 3.2, 4.2, 5.2, 6.2, 6.3, 6.4, 9.1**

### Property 4: DynamoDB Key Construction Correctness

For any valid entity ID and entity type pair (orderId/ORDER, productId/PRODUCT, sessionId/WHATSAPP_SESSION), the corresponding tool should construct a DynamoDB partition key with the format `{ENTITY_TYPE}#{entityId}`.

**Validates: Requirements 2.3, 3.3, 4.3, 5.3**

### Property 5: GSI Query Construction for Phone Lookup

For any valid phone number string, the get_whatsapp_session tool should construct a QueryCommand using GSI1 with GSI1PK set to `PHONE#{phone}` when the phone parameter is provided instead of sessionId.

**Validates: Requirements 5.4**

### Property 6: Success Response Structure Invariant

For any successful tool invocation that returns data, the response should have the structure `{ success: true, data: T, timestamp: string }` where timestamp is a valid ISO 8601 string and data contains the tool-specific payload.

**Validates: Requirements 2.4, 3.4, 4.4, 5.5**

### Property 7: Not Found Error Consistency

For any tool invocation where the requested entity does not exist in DynamoDB (tested by querying with a randomly generated non-existent ID), the tool should return an error response with code "NOT_FOUND" and a message indicating which entity type and ID was not found.

**Validates: Requirements 2.5, 3.5, 4.5, 5.6**

### Property 8: AWS Error Mapping Completeness

For any AWS SDK error encountered during tool execution, the error handler should map it to an appropriate MCP error code following these rules: ResourceNotFoundException → NOT_FOUND, ValidationException → VALIDATION_ERROR, AccessDeniedException → ACCESS_DENIED, TimeoutError → AWS_ERROR with timeout indication, and all other errors → AWS_ERROR or UNKNOWN_ERROR.

**Validates: Requirements 2.6, 3.6, 4.6, 5.7, 6.11, 9.2, 9.3, 9.4**

### Property 9: CloudWatch Time Range Filtering Correctness

For any search_logs invocation with startTime and/or endTime parameters (where both are valid ISO 8601 timestamps), all returned log entries should have timestamps within the specified range: if startTime is provided, all timestamps >= startTime; if endTime is provided, all timestamps <= endTime; if both provided, all timestamps in [startTime, endTime].

**Validates: Requirements 6.6, 6.7**

### Property 10: Log Results Ordering Invariant

For any search_logs invocation that returns multiple log entries, the entries should be sorted by timestamp in descending order (most recent first), meaning for any two consecutive entries at positions i and i+1, timestamp[i] >= timestamp[i+1].

**Validates: Requirements 6.8**

### Property 11: Log Results Limit Enforcement

For any search_logs invocation regardless of the number of matching log entries in CloudWatch, the number of returned log entries in the response should never exceed 100.

**Validates: Requirements 6.9**

### Property 12: Error Logging Context Completeness

For any error that occurs during tool execution, the error should be logged to stderr with structured context including at minimum the tool name and error message, and optionally including parameters (with sensitive data redacted).

**Validates: Requirements 9.5**

### Property 13: Sensitive Data Redaction in Errors

For any error response returned by any tool, the error message and details should not contain sensitive information including AWS credentials (access keys, secret keys, session tokens), internal file system paths, or customer-sensitive message bodies.

**Validates: Requirements 9.6**

### Property 14: Response Timestamp Validity

For any response (success or error) returned by any tool, the timestamp field should be a valid ISO 8601 formatted string (matching the pattern YYYY-MM-DDTHH:mm:ss.sssZ or with timezone offset) representing a time within 1 second of the current time.

**Validates: Requirements 2.4, 3.4, 4.4, 5.5**


### Property-Based Testing Configuration

The project will use **fast-check** as the property-based testing library for JavaScript/TypeScript. Fast-check is the standard PBT library for the JavaScript ecosystem and integrates well with Jest or Vitest.

**Configuration Requirements:**
- Each property test must run a minimum of 100 iterations
- Each test must include a comment tag referencing the design property
- Tag format: `// Feature: commerce-ops-mcp-server, Property {number}: {property_text}`

**Example Property Test Structure:**
```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('Environment Validation', () => {
  // Feature: commerce-ops-mcp-server, Property 1: Environment Validation Round Trip
  it('should accept valid configurations and apply defaults correctly', () => {
    fc.assert(
      fc.property(
        fc.record({
          AWS_REGION: fc.constantFrom('ap-south-1', 'us-east-1', 'eu-west-1'),
          DDB_TABLE_NAME: fc.string({ minLength: 1 }),
          AWS_PROFILE: fc.option(fc.string({ minLength: 1 })),
          APP_ENV: fc.option(fc.constantFrom('dev', 'staging', 'prod')),
          LOG_GROUP_PREFIX: fc.option(fc.string({ minLength: 1 })),
        }),
        (config) => {
          const result = envSchema.safeParse(config);
          expect(result.success).toBe(true);
          if (result.success) {
            // Verify required fields are present
            expect(result.data.AWS_REGION).toBeDefined();
            expect(result.data.DDB_TABLE_NAME).toBeDefined();
            // Verify defaults are applied for optional fields
            expect(result.data.APP_ENV).toBeDefined();
            expect(result.data.LOG_GROUP_PREFIX).toBeDefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Testing Approach:**

1. **Unit Tests** - Focus on specific examples and edge cases:
   - Environment validation with specific valid/invalid configurations
   - Tool registration includes all expected tools
   - Response formatting with specific data structures
   - Error mapping for specific AWS error types
   - Empty result handling for search_logs
   - WhatsApp session lookup with neither phone nor sessionId
   - MCP configuration file contains required fields
   - Server initialization and stdio transport setup
   - Specific timeout and authentication error scenarios

2. **Property-Based Tests** - Verify universal properties across all inputs:
   - Property 1: Environment validation round trip with randomly generated valid/invalid configs
   - Property 2: Tool registry completeness with all expected tool names
   - Property 3: Parameter validation with randomly generated invalid inputs across all tools
   - Property 4: DynamoDB key construction with randomly generated entity IDs
   - Property 5: GSI query construction with randomly generated phone numbers
   - Property 6: Success response structure invariant with randomly generated data
   - Property 7: Not found error consistency with randomly generated non-existent IDs
   - Property 8: AWS error mapping completeness with various AWS error types
   - Property 9: CloudWatch time range filtering with randomly generated timestamps
   - Property 10: Log results ordering invariant with randomly generated log sets
   - Property 11: Log results limit enforcement with randomly generated large result sets
   - Property 12: Error logging context completeness with randomly generated errors
   - Property 13: Sensitive data redaction with randomly generated errors containing sensitive data
   - Property 14: Response timestamp validity with randomly generated responses

3. **Integration Tests** - Test with actual AWS services (optional, requires AWS setup):
   - End-to-end tool invocation with real DynamoDB
   - CloudWatch Logs search with real log groups
   - AWS credential handling with real AWS SDK

**Test Organization:**
```
tools/mcp/commerce-ops/
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
│   │   │   ├── key-construction.property.test.ts
│   │   │   ├── response-structure.property.test.ts
│   │   │   ├── error-handling.property.test.ts
│   │   │   ├── log-search.property.test.ts
│   │   │   └── sensitive-data-redaction.property.test.ts
│   │   └── integration/
│   │       ├── get-order.integration.test.ts
│   │       ├── get-payment.integration.test.ts
│   │       ├── search-logs.integration.test.ts
│   │       └── server-startup.integration.test.ts
```

**Mocking Strategy:**
- Mock AWS SDK clients for unit and property tests
- Use `aws-sdk-client-mock` library for consistent mocking
- Mock DynamoDB responses with realistic data structures
- Mock CloudWatch Logs responses with realistic log entries
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

