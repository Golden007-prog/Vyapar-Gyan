# Commerce Ops MCP Server

Model Context Protocol (MCP) server that provides read-only access to operational data from the VyaparGyan commerce platform. It enables AI assistants like Kiro to query orders, payments, inventory, WhatsApp sessions, and logs stored in DynamoDB and CloudWatch Logs.

## Features

- **Read-only access** - All tools are read-only; no state-changing operations
- **Seven operational tools** - Query orders, payments, inventory, sessions, and logs
- **AWS integration** - Direct access to DynamoDB and CloudWatch Logs
- **Type-safe** - Built with TypeScript with strict type checking
- **Error handling** - Comprehensive error mapping and validation
- **Truncation support** - Automatic handling of large result sets with limits

## Tools

### 1. get_order

Fetch order details by order ID.

**Parameters:**
- `orderId` (string, required) - The order ID to fetch

**Example:**
```json
{
  "orderId": "ord_abc123"
}
```

**Returns:**
- Order details including status, customer, seller, amount, timestamps

### 2. get_order_timeline

Fetch complete order timeline including items, payments, and audit logs.

**Parameters:**
- `orderId` (string, required) - The order ID to fetch timeline for

**Example:**
```json
{
  "orderId": "ord_abc123"
}
```

**Returns:**
- Complete order timeline with all related entities
- Limit: Max 200 related items total
- Includes `truncated` flag when limits exceeded

### 3. get_payment

Fetch payment details for an order.

**Parameters:**
- `orderId` (string, required) - The order ID to fetch payments for

**Example:**
```json
{
  "orderId": "ord_abc123"
}
```

**Returns:**
- Array of payment records with transaction details
- Limit: Max 50 payments per order
- Includes `truncated` flag when limits exceeded

### 4. get_inventory

Fetch product inventory and recent inventory logs.

**Parameters:**
- `productId` (string, required) - The product ID to fetch inventory for

**Example:**
```json
{
  "productId": "prod_123"
}
```

**Returns:**
- Current stock, reserved stock, available stock
- Recent inventory changes (max 50 logs)
- Includes `truncated` flag when limits exceeded

### 5. get_whatsapp_session

Fetch WhatsApp session by phone or session ID.

**Parameters:**
- `phone` (string, optional) - Phone number to lookup session
- `sessionId` (string, optional) - Session ID to lookup directly
- At least one parameter must be provided

**Example:**
```json
{
  "phone": "919876543210"
}
```

**Returns:**
- Session state, conversation context
- Recent messages (max 50)
- Includes `truncated` flag when limits exceeded

### 6. search_logs

Search CloudWatch logs with filter pattern.

**Parameters:**
- `query` (string, required) - CloudWatch filter pattern
- `logGroupPrefix` (string, optional) - Log group prefix
- `startTime` (string, optional) - Start time ISO string
- `endTime` (string, optional) - End time ISO string

**Example:**
```json
{
  "query": "ERROR",
  "startTime": "2026-02-28T11:00:00Z"
}
```

**Returns:**
- Matching log entries (max 100) sorted by timestamp descending
- Default time range: Last 1 hour if not specified
- Searches first 5 matching log groups
- Includes `truncated` flag when limits exceeded

### 7. list_seller_orders

List orders for a specific seller.

**Parameters:**
- `sellerId` (string, required) - The seller ID
- `status` (string, optional) - Filter by order status
- `limit` (number, optional) - Max results (default 20, max 100)

**Example:**
```json
{
  "sellerId": "seller_789",
  "status": "PENDING_PAYMENT",
  "limit": 20
}
```

**Returns:**
- Array of orders matching criteria
- Includes `hasMore` flag for pagination

## Environment Variables

- `AWS_REGION` - AWS region (default: ap-south-1)
- `AWS_PROFILE` - AWS profile for credentials (optional, defaults to "kiro-mcp" in Kiro config)
- `APP_ENV` - Application environment (default: dev)
- `DDB_TABLE_NAME` - DynamoDB table name (default: CommerceCore-dev)
- `LOG_GROUP_PREFIX` - CloudWatch log group prefix (default: /aws/commerce)

## Installation

```bash
cd tools/mcp/commerce-ops
npm install
npm run build
```

## AWS Configuration

### Required IAM Permissions

**DynamoDB:**
- `dynamodb:GetItem` - Retrieve individual items
- `dynamodb:Query` - Query items by partition key
- `dynamodb:BatchGetItem` - Batch retrieve items (optional)

**CloudWatch Logs:**
- `logs:DescribeLogGroups` - List available log groups
- `logs:FilterLogEvents` - Search log events with filter patterns

### AWS Credentials

Configure AWS credentials using one of these methods:

1. **AWS Profile** (recommended for local development):
```bash
aws configure --profile kiro-mcp
```

2. **Environment variables**:
```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=ap-south-1
```

3. **IAM role** (for EC2/ECS deployments)

## Kiro Configuration

Add to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "commerce-ops-mcp": {
      "command": "node",
      "args": ["./tools/mcp/commerce-ops/dist/index.js"],
      "env": {
        "AWS_REGION": "ap-south-1",
        "AWS_PROFILE": "kiro-mcp",
        "APP_ENV": "dev",
        "DDB_TABLE_NAME": "CommerceCore-dev",
        "LOG_GROUP_PREFIX": "/aws/commerce"
      },
      "disabled": false,
      "autoApprove": [
        "get_order",
        "get_order_timeline",
        "get_payment",
        "get_inventory",
        "get_whatsapp_session",
        "list_seller_orders"
      ]
    }
  }
}
```

## DynamoDB Table Schema

The server queries the `CommerceCore-dev` DynamoDB table with the following access patterns:

### Primary Key Structure
- `PK` (Partition Key): Entity type and ID (e.g., `ORDER#abc123`)
- `SK` (Sort Key): Entity type or related entity (e.g., `ORDER`, `PAYMENT#xyz789`)

### Entity Access Patterns

**Orders:**
- PK: `ORDER#{orderId}`, SK: `ORDER` - Order root item
- PK: `ORDER#{orderId}`, SK: `ITEM#{itemId}` - Order items
- PK: `ORDER#{orderId}`, SK: `PAYMENT#{paymentId}` - Payment items
- PK: `ORDER#{orderId}`, SK: `AUDIT#{timestamp}` - Audit logs

**Products:**
- PK: `PRODUCT#{productId}`, SK: `PRODUCT` - Product root item
- PK: `PRODUCT#{productId}`, SK: `INVENTORY_LOG#{timestamp}` - Inventory logs

**WhatsApp Sessions:**
- PK: `WHATSAPP_SESSION#{sessionId}`, SK: `SESSION` - Session root
- PK: `WHATSAPP_SESSION#{sessionId}`, SK: `MESSAGE#{messageId}` - Messages
- GSI1: GSI1PK: `PHONE#{phone}` - Lookup by phone number

**Seller Orders:**
- GSI2: GSI2PK: `SELLER#{sellerId}`, GSI2SK: `STATUS#{status}#{timestamp}` - Seller orders by status

## Testing Locally

### Using MCP Inspector

```bash
# Install MCP Inspector
npm install -g @modelcontextprotocol/inspector

# Run the inspector
mcp-inspector node ./tools/mcp/commerce-ops/dist/index.js
```

### Manual Testing

```bash
# Build the project
npm run build

# Run the server
npm start

# The server will listen on stdio for MCP protocol messages
```

## Troubleshooting

### Common Issues

**1. AWS Credentials Error**
```
Error: Access denied to AWS resource
```
**Solution:** Verify AWS credentials are configured correctly:
```bash
aws sts get-caller-identity --profile kiro-mcp
```

**2. DynamoDB Table Not Found**
```
Error: Resource not found
```
**Solution:** Verify the table name and region are correct in environment variables.

**3. CloudWatch Logs Access Denied**
```
Error: Access denied
```
**Solution:** Ensure IAM permissions include `logs:DescribeLogGroups` and `logs:FilterLogEvents`.

**4. TypeScript Compilation Errors**
```bash
# Clean build
rm -rf dist/
npm run build
```

**5. Module Resolution Errors**
- Ensure all imports use `.js` extensions (required for ES modules)
- Check `tsconfig.json` has `"module": "Node16"` and `"moduleResolution": "Node16"`

### Debug Logging

The server logs to stderr (stdout is reserved for MCP protocol). Check stderr for:
- Tool invocation logs
- Error messages with context
- AWS SDK errors

## Development

### Project Structure

```
tools/mcp/commerce-ops/
├── src/
│   ├── env.ts                    # Environment validation
│   ├── index.ts                  # Entry point
│   ├── server.ts                 # MCP server setup
│   ├── shared/
│   │   ├── aws-clients.ts        # AWS client singletons
│   │   ├── error-handler.ts      # Error mapping
│   │   └── response-formatter.ts # Response formatting
│   └── tools/
│       ├── get-order.ts
│       ├── get-order-timeline.ts
│       ├── get-payment.ts
│       ├── get-inventory.ts
│       ├── get-whatsapp-session.ts
│       ├── search-logs.ts
│       └── list-seller-orders.ts
├── dist/                         # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md
```

### Build Commands

```bash
# Install dependencies
npm install

# Build (compile TypeScript)
npm run build

# Watch mode (auto-rebuild on changes)
npm run dev

# Type check without building
npm run typecheck

# Run the server
npm start
```

### Adding New Tools

1. Create a new file in `src/tools/`
2. Define Zod schema for parameters
3. Implement tool function with error handling
4. Register tool in `src/server.ts`
5. Update this README with tool documentation

## Security Considerations

- **Read-only operations** - No mutations allowed
- **Data redaction** - Sensitive data (credentials, internal paths) redacted from errors
- **IAM permissions** - Principle of least privilege (read-only DynamoDB and CloudWatch)
- **No customer data exposure** - Message bodies and sensitive fields are not exposed in logs

## License

Internal use only - VyaparGyan commerce platform.
