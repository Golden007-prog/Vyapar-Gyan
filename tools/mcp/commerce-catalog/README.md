# Commerce Catalog MCP Server

A Model Context Protocol (MCP) server that provides read-only access to product catalog data from the VyaparGyan commerce platform. This server enables AI assistants like Kiro to query products, categories, stock levels, and product media stored in DynamoDB.

## Features

- **Read-only access** to catalog data (safe for AI assistant usage)
- **6 catalog tools** for comprehensive product and category queries
- **TypeScript implementation** with strict type checking
- **AWS DynamoDB integration** using AWS SDK v3
- **Zod validation** for environment and parameter validation
- **Structured error handling** with descriptive error messages

## Available Tools

### 1. get_product

Retrieves detailed product information by product ID.

**Parameters:**
- `productId` (string, required): The product ID to fetch

**Example Request:**
```json
{
  "productId": "prod_abc123"
}
```

**Example Response:**
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

### 2. list_products_by_seller

Lists all products for a specific seller with pagination support.

**Parameters:**
- `sellerId` (string, required): The seller ID
- `limit` (number, optional): Max results (default 20, max 100)

**Example Request:**
```json
{
  "sellerId": "seller_789",
  "limit": 20
}
```

**Example Response:**
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

### 3. list_products_by_category

Lists all products in a specific category with pagination support.

**Parameters:**
- `categoryId` (string, required): The category ID
- `limit` (number, optional): Max results (default 20, max 100)

**Example Request:**
```json
{
  "categoryId": "cat_456",
  "limit": 20
}
```

**Example Response:**
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

### 4. get_category

Retrieves category metadata by category ID.

**Parameters:**
- `categoryId` (string, required): The category ID to fetch

**Example Request:**
```json
{
  "categoryId": "cat_456"
}
```

**Example Response:**
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

### 5. list_low_stock_products

Lists products with low stock for a seller, useful for inventory monitoring.

**Parameters:**
- `sellerId` (string, required): The seller ID
- `threshold` (number, optional): Stock threshold (default 5)
- `limit` (number, optional): Max results (default 20, max 100)

**Example Request:**
```json
{
  "sellerId": "seller_789",
  "threshold": 10,
  "limit": 20
}
```

**Example Response:**
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

**Note:** Available stock is calculated as `stockQuantity - reservedStock`. Results are sorted by available stock ascending (lowest first).

### 6. get_product_media

Retrieves product media metadata including S3 keys.

**Parameters:**
- `productId` (string, required): The product ID to fetch media for

**Example Request:**
```json
{
  "productId": "prod_abc123"
}
```

**Example Response:**
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

**Note:** This tool returns S3 keys only, not signed URLs. Results are sorted by sort order ascending.

## Installation

### Prerequisites

- Node.js 20 or higher
- AWS credentials configured with profile `kiro-mcp`
- Access to DynamoDB table `CommerceCore-dev` in region `ap-south-1`

### Install Dependencies

```bash
cd tools/mcp/commerce-catalog
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
- `S3_MEDIA_BUCKET` (optional): S3 bucket name for product media

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

**Note:** No write permissions are required. This server is read-only.

## DynamoDB Table Schema

The server queries the `CommerceCore-dev` DynamoDB table using the following access patterns:

### Primary Key Structure

- **PK** (Partition Key): Entity type and ID (e.g., `PRODUCT#abc123`)
- **SK** (Sort Key): Entity type or related entity (e.g., `PRODUCT` or `MEDIA#001`)

### Entity Types

#### Product Entity
- **PK:** `PRODUCT#{productId}`
- **SK:** `PRODUCT`
- **Attributes:** productId, sellerId, categoryId, name, description, price, currency, stockQuantity, reservedStock, status, createdAt, updatedAt

#### Category Entity
- **PK:** `CATEGORY#{categoryId}`
- **SK:** `CATEGORY`
- **Attributes:** categoryId, name, slug, parentCategoryId, status, createdAt, updatedAt

#### Product Media Entity
- **PK:** `PRODUCT#{productId}`
- **SK:** `MEDIA#{mediaId}`
- **Attributes:** mediaId, productId, mediaType, s3Key, sortOrder, createdAt, updatedAt

### Global Secondary Indexes (GSI)

The server expects the following GSIs to exist:

1. **Seller Products GSI**: For querying products by seller
2. **Category Products GSI**: For querying products by category

**Note:** GSI names and key structures should match the implementation in the tool files.

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
    "commerce-catalog-mcp": {
      "command": "node",
      "args": ["./tools/mcp/commerce-catalog/dist/index.js"],
      "disabled": false,
      "env": {
        "AWS_REGION": "ap-south-1",
        "DYNAMODB_TABLE_NAME": "CommerceCore-dev",
        "AWS_PROFILE": "kiro-mcp",
        "S3_MEDIA_BUCKET": "your-bucket-name"
      },
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

All tools are marked as `alwaysAllow` since they are read-only and safe for automatic approval.

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
- **UNKNOWN_ERROR**: Unexpected error not matching known patterns

## Troubleshooting

### Environment Validation Errors

**Error:** `Environment validation failed: AWS_REGION: Expected "ap-south-1"`

**Solution:** Ensure the `AWS_REGION` environment variable is set to exactly `"ap-south-1"`.

**Error:** `Environment validation failed: AWS_PROFILE: Expected "kiro-mcp"`

**Solution:** Ensure the `AWS_PROFILE` environment variable is set to exactly `"kiro-mcp"`.

### AWS Credential Errors

**Error:** `ACCESS_DENIED: The security token included in the request is invalid`

**Solution:** 
1. Verify AWS credentials are configured: `aws configure --profile kiro-mcp`
2. Check credentials are valid: `aws sts get-caller-identity --profile kiro-mcp`
3. Ensure credentials haven't expired (if using temporary credentials)

**Error:** `ACCESS_DENIED: User is not authorized to perform: dynamodb:GetItem`

**Solution:** 
1. Verify IAM permissions include `dynamodb:GetItem` and `dynamodb:Query`
2. Check the resource ARN matches your DynamoDB table
3. Ensure the table name is `CommerceCore-dev` in region `ap-south-1`

### DynamoDB Table Errors

**Error:** `NOT_FOUND: Requested resource not found`

**Solution:**
1. Verify the DynamoDB table `CommerceCore-dev` exists in `ap-south-1`
2. Check the table has the expected primary key structure (PK, SK)
3. Verify required GSIs exist for seller and category queries

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

## Development

### Project Structure

```
tools/mcp/commerce-catalog/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP server initialization
│   ├── env.ts                # Environment validation
│   ├── tools/                # Tool implementations
│   │   ├── get-product.ts
│   │   ├── list-products-by-seller.ts
│   │   ├── list-products-by-category.ts
│   │   ├── get-category.ts
│   │   ├── list-low-stock-products.ts
│   │   └── get-product-media.ts
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

## License

This MCP server is part of the VyaparGyan commerce platform.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs in stderr for detailed error messages
3. Test AWS connectivity and permissions independently
4. Verify DynamoDB table structure matches expected schema
