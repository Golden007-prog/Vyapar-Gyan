# Commerce Admin MCP Server

MCP server for admin moderation, review, and lookup.

## Tools

- `list_pending_seller_approvals` - List sellers pending approval
- `get_seller_profile` - Fetch seller profile with verification status
- `list_open_disputes` - List open disputes
- `get_dispute` - Fetch dispute details with order context
- `get_audit_timeline` - Fetch audit timeline for a resource
- `list_recent_payments` - List recent payments with optional status filter

## Environment Variables

- `AWS_REGION` - AWS region (default: ap-south-1)
- `AWS_PROFILE` - AWS profile for credentials (optional)
- `APP_ENV` - Application environment (default: dev)
- `DDB_TABLE_NAME` - DynamoDB table name (default: CommerceCore-dev)

## Installation

```bash
cd tools/mcp/commerce-admin
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
    "commerce-admin-mcp": {
      "command": "node",
      "args": ["./tools/mcp/commerce-admin/dist/index.js"],
      "env": {
        "AWS_REGION": "ap-south-1",
        "AWS_PROFILE": "kiro-mcp",
        "APP_ENV": "dev",
        "DDB_TABLE_NAME": "CommerceCore-dev"
      },
      "disabled": false,
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

## DynamoDB Access Patterns

### Sellers
- PK: `SELLER#{sellerId}`, SK: `SELLER#{sellerId}` - Seller root item
- GSI3: GSI3PK: `WORKFLOW#SELLER_APPROVAL`, GSI3SK: `STATUS#pending#{timestamp}` - Pending approvals

### Disputes
- PK: `DISPUTE#{disputeId}`, SK: `DISPUTE#{disputeId}` - Dispute root item
- PK: `ORDER#{orderId}`, SK: `DISPUTE#{disputeId}` - Disputes by order
- GSI3: GSI3PK: `WORKFLOW#DISPUTE`, GSI3SK: `STATUS#open#{timestamp}` - Open disputes

### Payments
- GSI3: GSI3PK: `WORKFLOW#PAYMENT`, GSI3SK: `STATUS#{status}#{timestamp}` - Payments by status

### Audit Logs
- PK: `{RESOURCE_TYPE}#{resourceId}`, SK: `AUDIT#{timestamp}` - Audit logs for any resource
