# Commerce Catalog MCP Server

MCP server for product catalog, categories, and inventory visibility.

## Tools

- `get_product` - Fetch product details by product ID
- `list_products_by_seller` - List products for a specific seller
- `list_products_by_category` - List products in a specific category
- `get_category` - Fetch category metadata by category ID
- `list_low_stock_products` - List products below stock threshold for a seller
- `get_product_media` - Fetch product media metadata and S3 keys

## Environment Variables

- `AWS_REGION` - AWS region (default: ap-south-1)
- `AWS_PROFILE` - AWS profile for credentials (optional)
- `APP_ENV` - Application environment (default: dev)
- `DDB_TABLE_NAME` - DynamoDB table name (default: CommerceCore-dev)
- `S3_MEDIA_BUCKET` - S3 bucket for media (optional)

## Installation

```bash
cd tools/mcp/commerce-catalog
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
    "commerce-catalog-mcp": {
      "command": "node",
      "args": ["./tools/mcp/commerce-catalog/dist/index.js"],
      "env": {
        "AWS_REGION": "ap-south-1",
        "AWS_PROFILE": "kiro-mcp",
        "APP_ENV": "dev",
        "DDB_TABLE_NAME": "CommerceCore-dev",
        "S3_MEDIA_BUCKET": "commerce-media-dev"
      },
      "disabled": false,
      "autoApprove": [
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

## DynamoDB Access Patterns

### Products
- PK: `PRODUCT#{productId}`, SK: `PRODUCT#{productId}` - Product root item
- GSI1: GSI1PK: `SELLER#{sellerId}`, GSI1SK: `PRODUCT#{productId}` - Products by seller
- GSI2: GSI2PK: `CATEGORY#{categoryId}`, GSI2SK: `PRODUCT#{productId}` - Products by category

### Categories
- PK: `CATEGORY#{categoryId}`, SK: `CATEGORY#{categoryId}` - Category root item
