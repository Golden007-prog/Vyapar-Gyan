# Requirements Document

## Introduction

The commerce-catalog-mcp-server is a Model Context Protocol (MCP) server that provides read-only access to product catalog data from the VyaparGyan commerce platform. It enables AI assistants like Kiro to query products, categories, stock levels, and product media stored in DynamoDB, facilitating catalog management, inventory monitoring, and product support tasks.

## Glossary

- **MCP_Server**: The Model Context Protocol server implementation that exposes catalog tools to AI assistants
- **DynamoDB_Client**: AWS SDK v3 DocumentClient for querying the CommerceCore-dev DynamoDB table
- **Tool**: An MCP-exposed function that AI assistants can invoke with validated parameters
- **Product_Record**: A DynamoDB item containing product details including product_id, seller_id, category_id, name, price, stock, and status
- **Category_Record**: A DynamoDB item containing category metadata including category_id, name, slug, parent_category_id, and status
- **Product_Media_Record**: A DynamoDB item containing product media metadata including media_id, product_id, media_type, S3_key, and sort_order
- **Environment_Validator**: Zod schema validator for required environment variables
- **Stock_Threshold**: A numeric value representing the minimum acceptable stock level for low stock alerts

## Requirements

### Requirement 1: MCP Server Initialization

**User Story:** As a Kiro AI assistant, I want the MCP server to initialize with proper configuration, so that I can reliably access commerce catalog data.

#### Acceptance Criteria

1. WHEN the MCP_Server starts, THE MCP_Server SHALL load environment variables from process.env
2. THE Environment_Validator SHALL validate that AWS_REGION is set to "ap-south-1"
3. THE Environment_Validator SHALL validate that DYNAMODB_TABLE_NAME is set to "CommerceCore-dev"
4. THE Environment_Validator SHALL validate that AWS_PROFILE is set to "kiro-mcp"
5. WHERE S3_MEDIA_BUCKET is provided, THE Environment_Validator SHALL validate it as a non-empty string
6. IF required environment variables are missing, THEN THE MCP_Server SHALL terminate with a descriptive error message
7. WHEN environment validation succeeds, THE MCP_Server SHALL initialize the DynamoDB_Client with the validated configuration
8. THE MCP_Server SHALL register all available catalog tools with the MCP SDK
9. THE MCP_Server SHALL expose the server via stdio transport for Kiro integration

### Requirement 2: Product Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve product details by product ID, so that I can help users check product information, pricing, and availability.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_product"
2. THE get_product Tool SHALL accept a required string parameter "productId"
3. WHEN get_product is invoked with a valid productId, THE Tool SHALL query DynamoDB_Client using PK=PRODUCT#{productId} and SK=PRODUCT
4. WHEN the Product_Record exists, THE Tool SHALL return product data including seller_id, category_id, name, description, price, stock_quantity, reserved_stock, status, and timestamps
5. WHEN the Product_Record does not exist, THE Tool SHALL return an error message indicating the product was not found
6. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
7. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 3: Seller Product Listing Tool

**User Story:** As a Kiro AI assistant, I want to list all products for a specific seller, so that I can help users review a seller's catalog and inventory.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "list_products_by_seller"
2. THE list_products_by_seller Tool SHALL accept a required string parameter "sellerId"
3. THE list_products_by_seller Tool SHALL accept an optional number parameter "limit" with a default value of 20
4. THE Tool SHALL validate that limit does not exceed 100
5. WHEN list_products_by_seller is invoked, THE Tool SHALL query DynamoDB_Client for Product_Record items associated with the sellerId
6. THE Tool SHALL return product summaries including product_id, name, price, stock_quantity, reserved_stock, status, and created_at
7. THE Tool SHALL sort results by created_at in descending order
8. WHERE the result set exceeds the limit, THE Tool SHALL include a hasMore indicator in the response
9. WHEN no products exist for the seller, THE Tool SHALL return an empty array with a message indicating no products were found
10. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
11. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 4: Category Product Listing Tool

**User Story:** As a Kiro AI assistant, I want to list all products in a specific category, so that I can help users browse products by category.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "list_products_by_category"
2. THE list_products_by_category Tool SHALL accept a required string parameter "categoryId"
3. THE list_products_by_category Tool SHALL accept an optional number parameter "limit" with a default value of 20
4. THE Tool SHALL validate that limit does not exceed 100
5. WHEN list_products_by_category is invoked, THE Tool SHALL query DynamoDB_Client for Product_Record items associated with the categoryId
6. THE Tool SHALL return product summaries including product_id, seller_id, name, price, stock_quantity, status, and created_at
7. THE Tool SHALL sort results by created_at in descending order
8. WHERE the result set exceeds the limit, THE Tool SHALL include a hasMore indicator in the response
9. WHEN no products exist for the category, THE Tool SHALL return an empty array with a message indicating no products were found
10. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
11. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 5: Category Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve category details by category ID, so that I can help users understand category structure and metadata.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_category"
2. THE get_category Tool SHALL accept a required string parameter "categoryId"
3. WHEN get_category is invoked with a valid categoryId, THE Tool SHALL query DynamoDB_Client using PK=CATEGORY#{categoryId} and SK=CATEGORY
4. WHEN the Category_Record exists, THE Tool SHALL return category data including category_id, name, slug, parent_category_id, status, and timestamps
5. WHEN the Category_Record does not exist, THE Tool SHALL return an error message indicating the category was not found
6. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
7. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 6: Low Stock Product Listing Tool

**User Story:** As a Kiro AI assistant, I want to list products with low stock for a seller, so that I can help users identify inventory that needs restocking.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "list_low_stock_products"
2. THE list_low_stock_products Tool SHALL accept a required string parameter "sellerId"
3. THE list_low_stock_products Tool SHALL accept an optional number parameter "threshold" with a default value of 5
4. THE list_low_stock_products Tool SHALL accept an optional number parameter "limit" with a default value of 20
5. THE Tool SHALL validate that limit does not exceed 100
6. WHEN list_low_stock_products is invoked, THE Tool SHALL query DynamoDB_Client for Product_Record items associated with the sellerId
7. THE Tool SHALL filter results to include only products where available_stock is less than the threshold
8. THE Tool SHALL calculate available_stock as stock_quantity minus reserved_stock
9. THE Tool SHALL return product summaries including product_id, name, stock_quantity, reserved_stock, available_stock, and status
10. THE Tool SHALL sort results by available_stock in ascending order
11. WHEN no low stock products exist, THE Tool SHALL return an empty array with a message indicating no low stock products were found
12. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
13. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 7: Product Media Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve product media metadata by product ID, so that I can help users view product images and media information.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_product_media"
2. THE get_product_media Tool SHALL accept a required string parameter "productId"
3. WHEN get_product_media is invoked, THE Tool SHALL query DynamoDB_Client for Product_Media_Record items associated with the productId
4. WHEN Product_Media_Record items exist, THE Tool SHALL return media metadata including media_id, media_type, S3_key, sort_order, and timestamps
5. THE Tool SHALL sort results by sort_order in ascending order
6. WHEN no media exists for the product, THE Tool SHALL return an empty array with a message indicating no media was found
7. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
8. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 8: TypeScript Build Configuration

**User Story:** As a developer, I want the MCP server to build to a single JavaScript file, so that Kiro can launch it with a simple node command.

#### Acceptance Criteria

1. THE MCP_Server project SHALL use TypeScript with strict type checking enabled
2. THE MCP_Server project SHALL configure tsconfig.json to output compiled JavaScript to tools/mcp/commerce-catalog/dist/index.js
3. WHEN the build command is executed, THE TypeScript compiler SHALL compile all source files from tools/mcp/commerce-catalog/src/
4. THE compiled output SHALL be executable via "node ./tools/mcp/commerce-catalog/dist/index.js"
5. THE package.json SHALL define a "build" script that invokes the TypeScript compiler
6. THE package.json SHALL define dependencies for @modelcontextprotocol/sdk, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, and zod
7. THE package.json SHALL specify Node.js version 20 as the required engine
8. THE package.json SHALL set type to "module" for ES module support

### Requirement 9: MCP Configuration Integration

**User Story:** As a Kiro user, I want the commerce-catalog-mcp server to be configured in Kiro's MCP settings, so that Kiro can automatically discover and use the server.

#### Acceptance Criteria

1. THE .kiro/settings/mcp.json file SHALL contain a configuration entry for "commerce-catalog-mcp"
2. THE commerce-catalog-mcp configuration SHALL specify the command "node" with argument "./tools/mcp/commerce-catalog/dist/index.js"
3. THE commerce-catalog-mcp configuration SHALL be enabled by default
4. THE commerce-catalog-mcp configuration SHALL include environment variables for AWS_REGION, DYNAMODB_TABLE_NAME, AWS_PROFILE, and S3_MEDIA_BUCKET
5. WHERE read-only catalog tools are safe for auto-approval, THE commerce-catalog-mcp configuration SHALL mark eligible tools as autoApprove
6. WHEN Kiro loads MCP settings, THE Kiro client SHALL be able to connect to the commerce-catalog-mcp server using the configured command

### Requirement 10: Error Handling and Validation

**User Story:** As a Kiro AI assistant, I want clear error messages when tool invocations fail, so that I can provide helpful feedback to users.

#### Acceptance Criteria

1. WHEN a Tool receives invalid parameters, THE Tool SHALL return a validation error message describing the parameter requirements
2. WHEN a DynamoDB query times out, THE Tool SHALL return an error message indicating a timeout occurred
3. WHEN AWS credentials are invalid or missing, THE Tool SHALL return an error message indicating authentication failure
4. WHEN a DynamoDB table does not exist, THE Tool SHALL return an error message indicating the table was not found
5. THE MCP_Server SHALL log all errors to stderr with structured context including tool name, parameters, and error details
6. THE MCP_Server SHALL return user-friendly error messages to the MCP client without exposing sensitive data such as AWS credentials or internal system paths
7. THE Tool SHALL handle DynamoDB exceptions gracefully and return appropriate error messages for common failure scenarios

### Requirement 11: Documentation

**User Story:** As a developer, I want comprehensive documentation for the MCP server, so that I can understand how to install, configure, and use it.

#### Acceptance Criteria

1. THE MCP_Server project SHALL include a README.md file in tools/mcp/commerce-catalog/
2. THE README.md SHALL document all available tools with parameter descriptions and example usage
3. THE README.md SHALL document required environment variables and AWS configuration
4. THE README.md SHALL provide installation instructions including npm install and build steps
5. THE README.md SHALL document how to test the server locally with the MCP inspector
6. THE README.md SHALL document the DynamoDB table schema assumptions for each tool including PK/SK patterns
7. THE README.md SHALL include troubleshooting guidance for common issues such as AWS credential errors and missing environment variables
