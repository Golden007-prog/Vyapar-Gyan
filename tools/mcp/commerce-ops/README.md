# Commerce Ops MCP Server

MCP server for commerce operations, debugging, and runtime lookup.

## Tools

- `get_order` - Fetch order details by order ID
- `get_order_timeline` - Fetch complete order timeline including items, payments, audit logs, and disputes
- `get_payment` - Fetch payment details for an order
- `get_inventory` - Fetch product inventory and recent inventory logs
- `get_whatsapp_session` - Fetch WhatsApp session by phone or session ID
- `search_logs` - Search CloudWatch logs with filter pattern
- `list_seller_orders` - List orders for a specific seller

## Environment Variables

- `AWS_REGION` - AWS region (default: ap-south-1)
- `AWS_PROFILE` - AWS profile for credentials (optional)
- `APP_ENV` - Application environment (default: dev)
- `DDB_TABLE_NAME` - DynamoDB table name (default: CommerceCore-dev)
- `LOG_GROUP_PREFIX` - CloudWatch log group prefix (default: /aws/commerce)

## Installation

```bash
cd tools/mcp/commerce-ops
npm install
```

## Build

```bash
npm run build
```

## Run

```bash
npm start
```

## Development

```bash
npm run dev
```

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

## DynamoDB Access Patterns

### Orders
- PK: `ORDER#{orderId}`, SK: `ORDER#{orderId}` - Order root item
- PK: `ORDER#{orderId}`, SK: `PAYMENT#{paymentId}` - Payment items
- PK: `ORDER#{orderId}`, SK: `AUDIT#{timestamp}` - Audit logs
- PK: `ORDER#{orderId}`, SK: `DISPUTE#{disputeId}` - Disputes

### Products
- PK: `PRODUCT#{productId}`, SK: `PRODUCT#{productId}` - Product root item
- PK: `PRODUCT#{productId}`, SK: `INVENTORY_LOG#{timestamp}` - Inventory logs

### WhatsApp Sessions
- PK: `WHATSAPP_SESSION#{sessionId}`, SK: `WHATSAPP_SESSION#{sessionId}` - Session root
- PK: `WHATSAPP_SESSION#{sessionId}`, SK: `MESSAGE#{messageId}` - Messages
- GSI1: GSI1PK: `PHONE#{phone}`, GSI1SK: `SESSION#{timestamp}` - Lookup by phone

### Seller Orders
- GSI2: GSI2PK: `SELLER#{sellerId}`, GSI2SK: `STATUS#{status}#{timestamp}` - Seller orders by status
