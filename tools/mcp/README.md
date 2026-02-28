# Commerce Platform MCP Servers

Three local MCP servers for the AWS commerce platform:

1. **commerce-ops-mcp** - Operations, debugging, and runtime lookup
2. **commerce-catalog-mcp** - Product catalog, categories, and inventory
3. **commerce-admin-mcp** - Admin moderation, review, and lookup

## Quick Start

### Install All Servers

```bash
cd tools/mcp
chmod +x install-all.sh
./install-all.sh
```

Or install individually:

```bash
# Commerce Ops
cd tools/mcp/commerce-ops
npm install
npm run build

# Commerce Catalog
cd tools/mcp/commerce-catalog
npm install
npm run build

# Commerce Admin
cd tools/mcp/commerce-admin
npm install
npm run build
```

## Configuration

The servers are configured in `.kiro/settings/mcp.json` and `powers/commerce-platform/mcp.json`.

### Environment Variables

All servers use these common variables:
- `AWS_REGION` - AWS region (default: ap-south-1)
- `AWS_PROFILE` - AWS profile for credentials (default: kiro-mcp)
- `APP_ENV` - Application environment (default: dev)
- `DDB_TABLE_NAME` - DynamoDB table name (default: CommerceCore-dev)

Additional variables:
- `LOG_GROUP_PREFIX` - CloudWatch log group prefix (commerce-ops only)
- `S3_MEDIA_BUCKET` - S3 bucket for media (commerce-catalog only)

## AWS Setup

### Configure AWS Profile

```bash
aws configure --profile kiro-mcp
```

Provide:
- AWS Access Key ID
- AWS Secret Access Key
- Default region: ap-south-1
- Output format: json

### Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:ap-south-1:*:table/CommerceCore-dev",
        "arn:aws:dynamodb:ap-south-1:*:table/CommerceCore-dev/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:FilterLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-south-1:*:log-group:/aws/commerce*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::commerce-media-dev",
        "arn:aws:s3:::commerce-media-dev/*"
      ]
    }
  ]
}
```

## DynamoDB Schema Assumptions

All servers assume a single-table design with:

### Primary Keys
- `PK` - Partition key
- `SK` - Sort key

### Global Secondary Indexes
- `GSI1` - GSI1PK, GSI1SK
- `GSI2` - GSI2PK, GSI2SK
- `GSI3` - GSI3PK, GSI3SK

### Entity Patterns

See individual server READMEs for detailed access patterns:
- [commerce-ops-mcp/README.md](./commerce-ops/README.md)
- [commerce-catalog-mcp/README.md](./commerce-catalog/README.md)
- [commerce-admin-mcp/README.md](./commerce-admin/README.md)

## Tools Summary

### commerce-ops-mcp (7 tools)
- get_order
- get_order_timeline
- get_payment
- get_inventory
- get_whatsapp_session
- search_logs
- list_seller_orders

### commerce-catalog-mcp (6 tools)
- get_product
- list_products_by_seller
- list_products_by_category
- get_category
- list_low_stock_products
- get_product_media

### commerce-admin-mcp (6 tools)
- list_pending_seller_approvals
- get_seller_profile
- list_open_disputes
- get_dispute
- get_audit_timeline
- list_recent_payments

## Auto-Approved Tools

All read-only tools are auto-approved by default. No write/mutation tools are included in v1.

## Development

Each server supports:
- `npm run build` - Build TypeScript to JavaScript
- `npm run dev` - Watch mode for development
- `npm start` - Run the server
- `npm run typecheck` - Type checking without build

## Troubleshooting

### Server won't start
- Check that Node.js 20+ is installed
- Verify AWS credentials are configured
- Check environment variables in mcp.json

### AWS errors
- Verify AWS_PROFILE is correct
- Check IAM permissions
- Verify DynamoDB table exists
- Check AWS region matches

### Tool not found
- Rebuild the server: `npm run build`
- Restart Kiro to reload MCP servers
- Check server logs in Kiro MCP panel
