# Design Document: Commerce Catalog MCP Server

## Overview

The commerce-catalog-mcp-server is a Model Context Protocol (MCP) server that provides read-only access to product catalog data from the VyaparGyan commerce platform. It exposes a set of tools that enable AI assistants like Kiro to query products, categories, stock levels, and product media stored in DynamoDB.

**Server Metadata:**
- Name: `commerce-catalog-mcp`
- Version: `0.1.0`
- Protocol: MCP SDK (stdio transport)
- Runtime: Node.js 20+
- Language: TypeScript (compiled to JavaScript)

This MCP server follows the MCP SDK architecture pattern established by commerce-ops-mcp, using stdio transport for communication with Kiro. It implements a tool-based interface where each tool corresponds to a specific catalog data retrieval operation. The server is built with TypeScript, compiled to JavaScript, and executed via Node.js.

**Primary Use Cases:**
- Browsing product catalogs by seller or category
- Checking product details, pricing, and availability
- Monitoring inventory levels and identifying low stock products
- Retrieving product media metadata for image display
- Understanding category structure and hierarchy
- Supporting catalog management and inventory monitoring tasks

**Non-Goals (v1 Scope):**

This server is explicitly read-only. The following capabilities are out of scope for v1:
- No product creation, updates, or deletion
- No inventory adjustments or stock modifications
- No category creation or modification
- No media uploads or deletions
- No signed URL generation for S3 media access
- No price changes or product status updates
- No seller catalog management operations

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
│            Commerce Catalog MCP Server                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Server (server.ts)                                  │   │
│  │  - Tool registration                                 │   │
│  │  - Request routing                                   │   │
│  │  - Error handling                                    │   │
│  └──────────────┬───────────────────────────────────────┘   │
│                 │                                            │
│  ┌──────────────▼───────────────────────────────────────┐   │
│  │  Tools Layer                                         │   │
│  │  - get_product                                       │   │
│  │  - list_products_by_seller                           │   │
│  │  - list_products_by_category                         │   │
│  │  - get_category                                      │   │
│  │  - list_low_stock_products                           │   │
│  │  - get_product_media                                 │   │
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
│  │  CommerceCore-dev    │  │  Product media references    │  │
│  └──────────────────────┘  └──────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### MCP Protocol Flow

1. **Initialization**: Kiro launches the server via `node ./tools/mcp/commerce-catalog/dist/index.js`
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
- `S3_MEDIA_BUCKET`: S3 bucket for product media (optional, validated as non-empty string if provided)

Environment validation occurs at startup. If validation fails, the server terminates with a descriptive error message.

### Security Model

**Read-Only Access:**
All tools provide read-only access to catalog data. No mutations are permitted.

**Required IAM Permissions:**

DynamoDB:
- `dynamodb:GetItem` - Retrieve individual items (products, categories)
- `dynamodb:Query` - Query items by partition key (seller products, category products, product media)
- `dynamodb:DescribeTable` - Verify table existence (optional)

S3 (Optional):
- No S3 permissions required for v1 (media metadata only, no signed URLs)

**No Write Permissions Required:**
The server does not require any write, update, or delete permissions on DynamoDB or S3.

**Data Redaction:**
All error messages and logs must redact sensitive information:
- AWS credentials and session tokens
- Internal file paths and system details
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
- `name`: Tool identifier (e.g., "get_product")
- `description`: Human-readable description for AI assistant
- `inputSchema`: JSON Schema defining required and optional parameters

**Request Routing:**
The CallToolRequest handler uses a switch statement to route requests to the appropriate tool function based on the tool name.

**Logging Rules:**
- All internal logs go to stderr (never stdout, which is reserved for MCP protocol)
- Never print JSON tool responses to stderr
- Include in logs: tool name, request ID (if available), duration, success/failure
- Redact: AWS credentials, session tokens, full secrets

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

1. **get_product**: Retrieves product details by product ID
   - Input: `productId` (string, required)
   - DynamoDB: GetCommand with PK=`PRODUCT#{productId}`, SK=`PRODUCT`
   - Returns: Product details including seller_id, category_id, name, description, price, stock_quantity, reserved_stock, status, timestamps
   - Example Input: `{ "productId": "prod_abc123" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "productId": "prod_abc123",
         "sellerId": "seller_789",
         "categoryId": "cat_456",
         "name": "Premium Cotton T-Shirt",
         "description": "Comfortable cotton t-shirt",
         "price": 499,
         "currency": "INR",
         "stockQuantity": 100,
         "reservedStock": 15,
         "availableStock": 85,
         "status": "ACTIVE",
         "createdAt": "2026-02-28T10:00:00Z",
         "updatedAt": "2026-02-28T12:00:00Z"
       },
       "timestamp": "2026-02-28T12:01:00Z"
     }
     ```

2. **list_products_by_seller**: Lists all products for a specific seller
   - Input: `sellerId` (string, required), `limit` (number, optional, default 20, max 100)
   - DynamoDB: QueryCommand for products associated with sellerId
   - Returns: Array of product summaries with product_id, name, price, stock_quantity, reserved_stock, status, created_at
   - Sorting: Results sorted by created_at descending (newest first)
   - Pagination: Includes `hasMore` indicator if more results exist
   - Example Input: `{ "sellerId": "seller_789", "limit": 20 }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "sellerId": "seller_789",
         "products": [
           {
             "productId": "prod_abc123",
             "name": "Premium Cotton T-Shirt",
             "price": 499,
             "stockQuantity": 100,
             "reservedStock": 15,
             "availableStock": 85,
             "status": "ACTIVE",
             "createdAt": "2026-02-28T10:00:00Z"
           }
         ],
         "count": 1,
         "hasMore": false
       },
       "timestamp": "2026-02-28T12:02:00Z"
     }
     ```

3. **list_products_by_category**: Lists all products in a specific category
   - Input: `categoryId` (string, required), `limit` (number, optional, default 20, max 100)
   - DynamoDB: QueryCommand for products associated with categoryId
   - Returns: Array of product summaries with product_id, seller_id, name, price, stock_quantity, status, created_at
   - Sorting: Results sorted by created_at descending (newest first)
   - Pagination: Includes `hasMore` indicator if more results exist
   - Example Input: `{ "categoryId": "cat_456", "limit": 20 }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "categoryId": "cat_456",
         "products": [
           {
             "productId": "prod_abc123",
             "sellerId": "seller_789",
             "name": "Premium Cotton T-Shirt",
             "price": 499,
             "stockQuantity": 100,
             "status": "ACTIVE",
             "createdAt": "2026-02-28T10:00:00Z"
           }
         ],
         "count": 1,
         "hasMore": false
       },
       "timestamp": "2026-02-28T12:03:00Z"
     }
     ```

4. **get_category**: Retrieves category details by category ID
   - Input: `categoryId` (string, required)
   - DynamoDB: GetCommand with PK=`CATEGORY#{categoryId}`, SK=`CATEGORY`
   - Returns: Category data including category_id, name, slug, parent_category_id, status, timestamps
   - Example Input: `{ "categoryId": "cat_456" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "categoryId": "cat_456",
         "name": "Clothing",
         "slug": "clothing",
         "parentCategoryId": null,
         "status": "ACTIVE",
         "createdAt": "2026-01-15T08:00:00Z",
         "updatedAt": "2026-01-15T08:00:00Z"
       },
       "timestamp": "2026-02-28T12:04:00Z"
     }
     ```

5. **list_low_stock_products**: Lists products with low stock for a seller
   - Input: `sellerId` (string, required), `threshold` (number, optional, default 5), `limit` (number, optional, default 20, max 100)
   - DynamoDB: QueryCommand for seller products, filtered client-side for low stock
   - Calculation: available_stock = stock_quantity - reserved_stock
   - Filter: Returns only products where available_stock < threshold
   - Returns: Array of product summaries with product_id, name, stock_quantity, reserved_stock, available_stock, status
   - Sorting: Results sorted by available_stock ascending (lowest first)
   - Example Input: `{ "sellerId": "seller_789", "threshold": 10, "limit": 20 }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "sellerId": "seller_789",
         "threshold": 10,
         "products": [
           {
             "productId": "prod_xyz456",
             "name": "Limited Edition Sneakers",
             "stockQuantity": 8,
             "reservedStock": 3,
             "availableStock": 5,
             "status": "ACTIVE"
           }
         ],
         "count": 1
       },
       "timestamp": "2026-02-28T12:05:00Z"
     }
     ```

6. **get_product_media**: Retrieves product media metadata by product ID
   - Input: `productId` (string, required)
   - DynamoDB: QueryCommand with PK=`PRODUCT#{productId}`, SK begins_with `MEDIA#`
   - Returns: Array of media metadata with media_id, media_type, S3_key, sort_order, timestamps
   - Sorting: Results sorted by sort_order ascending
   - Note: Returns S3 keys only, not signed URLs (v1 limitation)
   - Example Input: `{ "productId": "prod_abc123" }`
   - Example Output:
     ```json
     {
       "success": true,
       "data": {
         "productId": "prod_abc123",
         "media": [
           {
             "mediaId": "media_001",
             "mediaType": "IMAGE",
             "s3Key": "products/prod_abc123/image1.jpg",
             "sortOrder": 1,
             "createdAt": "2026-02-28T10:00:00Z",
             "updatedAt": "2026-02-28T10:00:00Z"
           }
         ],
         "count": 1
       },
       "timestamp": "2026-02-28T12:06:00Z"
     }
     ```

**Operational Limits Summary:**
- `list_products_by_seller`: Default 20, max 100 products
- `list_products_by_category`: Default 20, max 100 products
- `list_low_stock_products`: Default 20, max 100 products
- All list tools include `hasMore` or `count` fields in responses

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
  S3_MEDIA_BUCKET: z.string().min(1).optional(),
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
- `PK` (Partition Key): Entity type and ID (e.g., `PRODUCT#abc123`)
- `SK` (Sort Key): Entity type or related entity (e.g., `PRODUCT` or `MEDIA#001`)

**Entity Types:**

1. **Product Entity**
   - PK: `PRODUCT#{productId}`
   - SK: `PRODUCT`
   - Attributes: productId, sellerId, categoryId, name, description, price, currency, stockQuantity, reservedStock, status, createdAt, updatedAt

2. **Category Entity**
   - PK: `CATEGORY#{categoryId}`
   - SK: `CATEGORY`
   - Attributes: categoryId, name, slug, parentCategoryId, status, createdAt, updatedAt

3. **Product Media Entity**
   - PK: `PRODUCT#{productId}`
   - SK: `MEDIA#{mediaId}`
   - Attributes: mediaId, productId, mediaType, s3Key, sortOrder, createdAt, updatedAt

**Access Patterns:**

1. **Get Product by ID**: GetCommand with PK=`PRODUCT#{productId}`, SK=`PRODUCT`
2. **List Products by Seller**: QueryCommand with GSI (seller-based partition key)
3. **List Products by Category**: QueryCommand with GSI (category-based partition key)
4. **Get Category by ID**: GetCommand with PK=`CATEGORY#{categoryId}`, SK=`CATEGORY`
5. **Get Product Media**: QueryCommand with PK=`PRODUCT#{productId}`, SK begins_with `MEDIA#`

**Assumptions:**
- GSI exists for seller-based product queries (GSI name TBD during implementation)
- GSI exists for category-based product queries (GSI name TBD during implementation)
- Product media items are colocated under the product partition key
- Available stock is calculated as: stockQuantity - reservedStock

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

### Timeout Handling

- Tools should complete within 5 seconds under normal conditions
- AWS SDK has default timeouts; no custom timeout implementation needed
- Timeout errors mapped to `AWS_ERROR` with timeout indication


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Environment Validation Enforces Required Values

For any environment configuration object, the environment validator should accept it if and only if AWS_REGION equals "ap-south-1", DYNAMODB_TABLE_NAME equals "CommerceCore-dev", and AWS_PROFILE equals "kiro-mcp", and if S3_MEDIA_BUCKET is provided it must be a non-empty string.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6**

### Property 2: Tool Registry Completeness

For any tool name in the set {get_product, list_products_by_seller, list_products_by_category, get_category, list_low_stock_products, get_product_media}, the server should have a registered handler that can process requests for that tool.

**Validates: Requirements 1.8, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1**

### Property 3: Parameter Validation Rejects Invalid Inputs

For any tool invocation with invalid parameters (missing required fields, wrong types, empty strings where non-empty required), the tool should return an error response with code "VALIDATION_ERROR" and details describing the specific validation failure.

**Validates: Requirements 2.2, 3.2, 4.2, 5.2, 6.2, 7.2, 10.1**

### Property 4: Limit Parameter Validation and Defaults

For any list tool (list_products_by_seller, list_products_by_category, list_low_stock_products), when the limit parameter is not provided, it should default to 20, and when limit is provided with a value greater than 100, the tool should return a VALIDATION_ERROR.

**Validates: Requirements 3.3, 3.4, 4.3, 4.4, 6.4, 6.5**

### Property 5: DynamoDB Key Construction Correctness

For any valid entity ID and entity type pair (productId/PRODUCT, categoryId/CATEGORY), the corresponding tool should construct a DynamoDB partition key with the format `{ENTITY_TYPE}#{entityId}` and sort key matching the entity type.

**Validates: Requirements 2.3, 5.3**

### Property 6: Query Construction for Seller and Category Filters

For any valid sellerId or categoryId, the corresponding list tool (list_products_by_seller or list_products_by_category) should query DynamoDB and return only products associated with that seller or category.

**Validates: Requirements 3.5, 4.5, 6.6**

### Property 7: Success Response Structure Invariant

For any successful tool invocation that returns data, the response should have the structure `{ success: true, data: T, timestamp: string }` where timestamp is a valid ISO 8601 string and data contains all required fields for that tool's response type.

**Validates: Requirements 2.4, 3.6, 4.6, 5.4, 6.9, 7.4**

### Property 8: Result Ordering Correctness

For any list tool invocation that returns multiple items, the results should be sorted according to the tool's specification: list_products_by_seller and list_products_by_category sort by created_at descending, list_low_stock_products sorts by available_stock ascending, and get_product_media sorts by sort_order ascending.

**Validates: Requirements 3.7, 4.7, 6.10, 7.5**

### Property 9: Pagination Metadata Accuracy

For any list tool invocation (list_products_by_seller or list_products_by_category) where the total number of matching items exceeds the limit, the response should include a hasMore indicator set to true.

**Validates: Requirements 3.8, 4.8**

### Property 10: Not Found Error Consistency

For any tool invocation where the requested entity does not exist in DynamoDB (tested by querying with a non-existent ID), the tool should return an error response with code "NOT_FOUND" and a message indicating which entity type and ID was not found.

**Validates: Requirements 2.5, 5.5**

### Property 11: Available Stock Calculation Correctness

For any product returned by list_low_stock_products, the available_stock field should equal stock_quantity minus reserved_stock.

**Validates: Requirements 6.8**

### Property 12: Low Stock Filtering Correctness

For any list_low_stock_products invocation with a threshold value, all returned products should have available_stock less than the threshold, and no products with available_stock greater than or equal to the threshold should be included.

**Validates: Requirements 6.7**

### Property 13: AWS Error Mapping Completeness

For any AWS SDK error encountered during tool execution, the error handler should map it to an appropriate MCP error code following these rules: ResourceNotFoundException → NOT_FOUND, ValidationException → VALIDATION_ERROR, AccessDeniedException → ACCESS_DENIED, and all other errors → AWS_ERROR or UNKNOWN_ERROR.

**Validates: Requirements 2.6, 3.10, 4.10, 5.6, 6.12, 7.7, 10.7**

### Property 14: Error Logging Context Completeness

For any error that occurs during tool execution, the error should be logged to stderr with structured context including at minimum the tool name and error message, and the error response returned to the client should not contain sensitive information including AWS credentials, internal file system paths, or session tokens.

**Validates: Requirements 10.5, 10.6**

### Property 15: Response Timestamp Validity

For any response (success or error) returned by any tool, the timestamp field should be a valid ISO 8601 formatted string representing a time within 1 second of the current time.

**Validates: Requirements 2.4, 3.6, 4.6, 5.4**

## Testing Strategy

### Dual Testing Approach

The commerce-catalog-mcp-server will use both unit testing and property-based testing to ensure comprehensive coverage:

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
- Tag format: `// Feature: commerce-catalog-mcp-server, Property {number}: {property_text}`

**Example Property Test Structure:**
```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

describe('Environment Validation', () => {
  // Feature: commerce-catalog-mcp-server, Property 1: Environment Validation Enforces Required Values
  it('should accept only configurations with required values', () => {
    fc.assert(
      fc.property(
        fc.record({
          AWS_REGION: fc.string(),
          DYNAMODB_TABLE_NAME: fc.string(),
          AWS_PROFILE: fc.string(),
          S3_MEDIA_BUCKET: fc.option(fc.string()),
        }),
        (config) => {
          const result = envSchema.safeParse(config);
          const shouldPass = 
            config.AWS_REGION === 'ap-south-1' &&
            config.DYNAMODB_TABLE_NAME === 'CommerceCore-dev' &&
            config.AWS_PROFILE === 'kiro-mcp' &&
            (!config.S3_MEDIA_BUCKET || config.S3_MEDIA_BUCKET.length > 0);
          
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
   - Empty result handling for list tools (no products for seller/category)
   - Product media with no media items
   - Low stock products with no low stock items
   - MCP configuration file contains required fields
   - Server initialization and stdio transport setup
   - Specific timeout and authentication error scenarios
   - Compiled output is executable via node command

2. **Property-Based Tests** - Verify universal properties across all inputs:
   - Property 1: Environment validation with randomly generated configs
   - Property 2: Tool registry completeness with all expected tool names
   - Property 3: Parameter validation with randomly generated invalid inputs across all tools
   - Property 4: Limit parameter validation and defaults with random limit values
   - Property 5: DynamoDB key construction with randomly generated entity IDs
   - Property 6: Query construction with randomly generated seller/category IDs
   - Property 7: Success response structure invariant with randomly generated data
   - Property 8: Result ordering correctness with randomly generated result sets
   - Property 9: Pagination metadata with randomly generated large result sets
   - Property 10: Not found error consistency with randomly generated non-existent IDs
   - Property 11: Available stock calculation with randomly generated stock values
   - Property 12: Low stock filtering with randomly generated products and thresholds
   - Property 13: AWS error mapping completeness with various AWS error types
   - Property 14: Error logging context completeness with randomly generated errors
   - Property 15: Response timestamp validity with randomly generated responses

3. **Integration Tests** - Test with actual AWS services (optional, requires AWS setup):
   - End-to-end tool invocation with real DynamoDB
   - AWS credential handling with real AWS SDK
   - Full server startup and tool execution

**Test Organization:**
```
tools/mcp/commerce-catalog/
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
│   │   │   ├── stock-calculation.property.test.ts
│   │   │   ├── error-handling.property.test.ts
│   │   │   └── sensitive-data-redaction.property.test.ts
│   │   └── integration/
│   │       ├── get-product.integration.test.ts
│   │       ├── list-products.integration.test.ts
│   │       ├── get-category.integration.test.ts
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
  "name": "commerce-catalog-mcp",
  "version": "0.1.0",
  "description": "MCP server for commerce catalog data access",
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
tools/mcp/commerce-catalog/
├── src/
│   ├── index.ts                 # Entry point
│   ├── server.ts                # MCP server setup
│   ├── env.ts                   # Environment validation
│   ├── tools/
│   │   ├── get-product.ts
│   │   ├── list-products-by-seller.ts
│   │   ├── list-products-by-category.ts
│   │   ├── get-category.ts
│   │   ├── list-low-stock-products.ts
│   │   └── get-product-media.ts
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
4. **Execution**: `node ./tools/mcp/commerce-catalog/dist/index.js`

### MCP Configuration

The server is registered in `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "commerce-catalog-mcp": {
      "command": "node",
      "args": ["./tools/mcp/commerce-catalog/dist/index.js"],
      "env": {
        "AWS_REGION": "ap-south-1",
        "DYNAMODB_TABLE_NAME": "CommerceCore-dev",
        "AWS_PROFILE": "kiro-mcp",
        "S3_MEDIA_BUCKET": "vyapargyan-media-dev"
      },
      "disabled": false,
      "alwaysAllow": [
        "get_product",
        "list_products_by_seller",
        "list_products_by_category",
        "get_category",
        "list_low_stock_products",
        "get_product_media"
      ]
    }
  }
}
```

**Configuration Notes:**
- All catalog tools are marked as `alwaysAllow` since they are read-only and safe for auto-approval
- Environment variables are provided directly in the configuration
- AWS credentials are loaded from the `kiro-mcp` profile (not in config for security)

## Assumptions and Open Questions

This design makes specific assumptions about the DynamoDB table structure and AWS infrastructure. These assumptions must be validated during implementation.

**Confirmed Assumptions:**
- DynamoDB table name is `CommerceCore-dev` (configurable via environment)
- Table uses `PK` (partition key) and `SK` (sort key) for primary access
- AWS credentials are available via the `kiro-mcp` profile or default credential chain
- Node.js 20+ is available in the execution environment
- S3 bucket for media exists but signed URLs are not required for v1

**DynamoDB Key Conventions (v1 Design):**

Root entity items use simplified SK patterns:
- Product: `PK=PRODUCT#{productId}`, `SK=PRODUCT`
- Category: `PK=CATEGORY#{categoryId}`, `SK=CATEGORY`

Child/related items use descriptive SK prefixes:
- Product Media: `PK=PRODUCT#{productId}`, `SK=MEDIA#{mediaId}`

**Important Note:** If the production table uses different SK conventions (e.g., `SK=PRODUCT#{productId}` instead of `SK=PRODUCT`), the implementation must adapt to the actual table structure. The design assumes the simplified pattern for cleaner queries and easier `begins_with` filtering.

**Open Questions Requiring Confirmation:**

1. **GSI Structure:**
   - What is the exact name of the GSI for seller product queries? (Assumed: GSI with `sellerId` as partition key)
   - What is the exact name of the GSI for category product queries? (Assumed: GSI with `categoryId` as partition key)
   - What are the exact GSI key names (GSI1PK/GSI1SK, GSI2PK/GSI2SK, or custom names)?
   - Are there sort keys on the GSIs that enable efficient querying?

2. **Field Names:**
   - Exact field names for product stock: `stock`, `stockQuantity`, `currentStock`, or `quantity`?
   - Exact field names for reserved stock: `reservedStock`, `reserved`, or `lockedQuantity`?
   - Exact field names for category parent: `parentCategoryId`, `parent_category_id`, or `parentId`?
   - Exact field names for media S3 key: `s3Key`, `s3_key`, `key`, or `url`?

3. **Entity Relationships:**
   - Are product media items always colocated under the product partition key?
   - Are products indexed by both seller and category in separate GSIs?
   - Is there a status field on products and categories (ACTIVE, INACTIVE, DELETED)?
   - Are soft deletes used, or are items physically removed?

4. **Data Constraints:**
   - What is the maximum number of products per seller (affects pagination)?
   - What is the maximum number of products per category (affects pagination)?
   - What is the maximum number of media items per product?
   - Are there any data size limits we should be aware of?

5. **Performance Expectations:**
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

The commerce-catalog-mcp-server provides read-only access to product catalog data from the VyaparGyan platform. It follows the established MCP server pattern from commerce-ops-mcp, using TypeScript, AWS SDK v3, and the MCP SDK for stdio transport.

**Key Design Decisions:**
- Read-only operations only (no mutations)
- Lazy AWS client initialization for better startup performance
- Consistent error handling and response formatting
- Property-based testing for comprehensive coverage
- Strict environment validation with required values
- Client-side filtering for low stock products (simpler than GSI)
- No signed URL generation for S3 media (v1 limitation)

**Next Steps:**
1. Validate DynamoDB schema assumptions
2. Implement core server and tool infrastructure
3. Implement individual tools following the established pattern
4. Write unit and property-based tests
5. Create README documentation
6. Test with MCP inspector locally
7. Integrate with Kiro and validate end-to-end functionality
