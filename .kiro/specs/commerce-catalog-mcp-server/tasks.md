# Implementation Plan: Commerce Catalog MCP Server

## Overview

This plan implements a Model Context Protocol (MCP) server that provides read-only access to product catalog data from the VyaparGyan commerce platform. The server exposes 6 catalog tools for querying products, categories, stock levels, and product media stored in DynamoDB. Built with TypeScript and the MCP SDK, it follows the established pattern from commerce-ops-mcp.

## Tasks

- [x] 1. Set up project structure and core infrastructure
  - Create directory structure: `tools/mcp/commerce-catalog/src/`
  - Initialize package.json with dependencies (@modelcontextprotocol/sdk, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, zod)
  - Configure tsconfig.json for ES2022 modules with strict type checking
  - Set up build script to compile to `dist/index.js`
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [ ] 2. Implement environment validation and configuration
  - [x] 2.1 Create environment validation module (`src/env.ts`)
    - Define Zod schema for AWS_REGION (literal "ap-south-1"), DYNAMODB_TABLE_NAME (literal "CommerceCore-dev"), AWS_PROFILE (literal "kiro-mcp"), and optional S3_MEDIA_BUCKET
    - Implement loadEnv() function that validates process.env and returns typed configuration
    - Throw descriptive error if validation fails
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 2.2 Write property test for environment validation
    - **Property 1: Environment Validation Enforces Required Values**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6**
    - Generate random environment configurations and verify only valid configs are accepted
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 3. Implement shared utilities layer
  - [x] 3.1 Create AWS client management module (`src/shared/aws-clients.ts`)
    - Implement singleton pattern for DynamoDBDocumentClient
    - Create getDynamoClient(region) function that returns cached client instance
    - Configure client with marshalling options for clean data handling
    - _Requirements: 1.7_

  - [x] 3.2 Create response formatter module (`src/shared/response-formatter.ts`)
    - Define SuccessResponse<T> and ErrorResponse TypeScript interfaces
    - Implement successResponse<T>(data: T) function that wraps data with success flag and ISO 8601 timestamp
    - Implement errorResponse(code, message, details?) function that creates structured error response
    - _Requirements: 2.4, 3.6, 4.6, 5.4, 6.9, 7.4_

  - [ ]* 3.3 Write property test for response structure invariant
    - **Property 7: Success Response Structure Invariant**
    - **Validates: Requirements 2.4, 3.6, 4.6, 5.4, 6.9, 7.4**
    - Generate random data and verify all success responses have correct structure with valid ISO 8601 timestamps
    - _Requirements: 2.4, 3.6, 4.6, 5.4, 6.9, 7.4_

  - [ ]* 3.4 Write property test for response timestamp validity
    - **Property 15: Response Timestamp Validity**
    - **Validates: Requirements 2.4, 3.6, 4.6, 5.4**
    - Verify all response timestamps are valid ISO 8601 strings within 1 second of current time
    - _Requirements: 2.4, 3.6, 4.6, 5.4_

  - [x] 3.5 Create error handler module (`src/shared/error-handler.ts`)
    - Define MCPError class with code and details properties
    - Implement handleAWSError(error) function that maps AWS SDK errors to MCP error codes
    - Map ResourceNotFoundException → NOT_FOUND, ValidationException → VALIDATION_ERROR, AccessDeniedException → ACCESS_DENIED
    - Implement logError(context, error) function that logs to stderr with structured context
    - Redact sensitive information (AWS credentials, session tokens, internal paths)
    - _Requirements: 2.6, 3.10, 4.10, 5.6, 6.12, 7.7, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ]* 3.6 Write property test for AWS error mapping completeness
    - **Property 13: AWS Error Mapping Completeness**
    - **Validates: Requirements 2.6, 3.10, 4.10, 5.6, 6.12, 7.7, 10.7**
    - Generate various AWS error types and verify correct MCP error code mapping
    - _Requirements: 2.6, 3.10, 4.10, 5.6, 6.12, 7.7, 10.7_

  - [ ]* 3.7 Write property test for error logging context completeness
    - **Property 14: Error Logging Context Completeness**
    - **Validates: Requirements 10.5, 10.6**
    - Verify all errors are logged with tool name and error message, and responses don't contain sensitive data
    - _Requirements: 10.5, 10.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement product retrieval tool
  - [x] 5.1 Create get_product tool (`src/tools/get-product.ts`)
    - Define Zod schema for productId parameter (required string, min length 1)
    - Implement getProduct(args, env) function that validates input and queries DynamoDB
    - Use GetCommand with PK=`PRODUCT#{productId}`, SK=`PRODUCT`
    - Return product data including seller_id, category_id, name, description, price, stock_quantity, reserved_stock, status, timestamps
    - Calculate and include available_stock (stock_quantity - reserved_stock)
    - Handle not found case with NOT_FOUND error
    - Handle AWS errors with appropriate error codes
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 5.2 Write property test for parameter validation
    - **Property 3: Parameter Validation Rejects Invalid Inputs**
    - **Validates: Requirements 2.2, 10.1**
    - Generate invalid inputs (missing fields, wrong types, empty strings) and verify VALIDATION_ERROR responses
    - _Requirements: 2.2, 10.1_

  - [ ]* 5.3 Write property test for DynamoDB key construction
    - **Property 5: DynamoDB Key Construction Correctness**
    - **Validates: Requirements 2.3**
    - Generate random product IDs and verify correct PK/SK format
    - _Requirements: 2.3_

  - [ ]* 5.4 Write property test for not found error consistency
    - **Property 10: Not Found Error Consistency**
    - **Validates: Requirements 2.5**
    - Query with non-existent IDs and verify NOT_FOUND error responses
    - _Requirements: 2.5_

- [ ] 6. Implement seller product listing tool
  - [x] 6.1 Create list_products_by_seller tool (`src/tools/list-products-by-seller.ts`)
    - Define Zod schema for sellerId (required string) and limit (optional number, default 20, max 100)
    - Implement listProductsBySeller(args, env) function that validates input and queries DynamoDB
    - Query DynamoDB for products associated with sellerId using appropriate GSI
    - Return product summaries with product_id, name, price, stock_quantity, reserved_stock, available_stock, status, created_at
    - Sort results by created_at descending (newest first)
    - Include hasMore indicator if result set exceeds limit
    - Handle empty results with empty array and descriptive message
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [ ]* 6.2 Write property test for limit parameter validation
    - **Property 4: Limit Parameter Validation and Defaults**
    - **Validates: Requirements 3.3, 3.4**
    - Verify limit defaults to 20 when not provided and VALIDATION_ERROR when limit > 100
    - _Requirements: 3.3, 3.4_

  - [ ]* 6.3 Write property test for query construction
    - **Property 6: Query Construction for Seller and Category Filters**
    - **Validates: Requirements 3.5**
    - Generate random seller IDs and verify correct DynamoDB query construction
    - _Requirements: 3.5_

  - [ ]* 6.4 Write property test for result ordering
    - **Property 8: Result Ordering Correctness**
    - **Validates: Requirements 3.7**
    - Generate random result sets and verify sorting by created_at descending
    - _Requirements: 3.7_

  - [ ]* 6.5 Write property test for pagination metadata
    - **Property 9: Pagination Metadata Accuracy**
    - **Validates: Requirements 3.8**
    - Generate large result sets and verify hasMore indicator accuracy
    - _Requirements: 3.8_

- [ ] 7. Implement category product listing tool
  - [x] 7.1 Create list_products_by_category tool (`src/tools/list-products-by-category.ts`)
    - Define Zod schema for categoryId (required string) and limit (optional number, default 20, max 100)
    - Implement listProductsByCategory(args, env) function that validates input and queries DynamoDB
    - Query DynamoDB for products associated with categoryId using appropriate GSI
    - Return product summaries with product_id, seller_id, name, price, stock_quantity, status, created_at
    - Sort results by created_at descending (newest first)
    - Include hasMore indicator if result set exceeds limit
    - Handle empty results with empty array and descriptive message
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11_

  - [ ]* 7.2 Write unit tests for empty result handling
    - Test empty results return empty array with descriptive message
    - Test hasMore indicator when results exceed limit
    - _Requirements: 4.9_

- [ ] 8. Implement category retrieval tool
  - [x] 8.1 Create get_category tool (`src/tools/get-category.ts`)
    - Define Zod schema for categoryId parameter (required string, min length 1)
    - Implement getCategory(args, env) function that validates input and queries DynamoDB
    - Use GetCommand with PK=`CATEGORY#{categoryId}`, SK=`CATEGORY`
    - Return category data including category_id, name, slug, parent_category_id, status, timestamps
    - Handle not found case with NOT_FOUND error
    - Handle AWS errors with appropriate error codes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement low stock product listing tool
  - [x] 10.1 Create list_low_stock_products tool (`src/tools/list-low-stock-products.ts`)
    - Define Zod schema for sellerId (required string), threshold (optional number, default 5), limit (optional number, default 20, max 100)
    - Implement listLowStockProducts(args, env) function that validates input and queries DynamoDB
    - Query DynamoDB for seller products
    - Calculate available_stock = stock_quantity - reserved_stock for each product
    - Filter client-side to include only products where available_stock < threshold
    - Return product summaries with product_id, name, stock_quantity, reserved_stock, available_stock, status
    - Sort results by available_stock ascending (lowest first)
    - Handle empty results with empty array and descriptive message
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13_

  - [ ]* 10.2 Write property test for available stock calculation
    - **Property 11: Available Stock Calculation Correctness**
    - **Validates: Requirements 6.8**
    - Generate random stock values and verify available_stock = stock_quantity - reserved_stock
    - _Requirements: 6.8_

  - [ ]* 10.3 Write property test for low stock filtering
    - **Property 12: Low Stock Filtering Correctness**
    - **Validates: Requirements 6.7**
    - Generate random products and thresholds, verify only products with available_stock < threshold are returned
    - _Requirements: 6.7_

- [ ] 11. Implement product media retrieval tool
  - [x] 11.1 Create get_product_media tool (`src/tools/get-product-media.ts`)
    - Define Zod schema for productId parameter (required string, min length 1)
    - Implement getProductMedia(args, env) function that validates input and queries DynamoDB
    - Use QueryCommand with PK=`PRODUCT#{productId}`, SK begins_with `MEDIA#`
    - Return media metadata array with media_id, media_type, s3_key, sort_order, timestamps
    - Sort results by sort_order ascending
    - Handle empty results with empty array and descriptive message
    - Handle AWS errors with appropriate error codes
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [ ]* 11.2 Write unit tests for media sorting
    - Test results are sorted by sort_order ascending
    - Test empty media results return empty array
    - _Requirements: 7.5, 7.6_

- [ ] 12. Implement MCP server initialization and tool registration
  - [x] 12.1 Create server module (`src/server.ts`)
    - Load and validate environment configuration using loadEnv()
    - Initialize MCP Server instance with name "commerce-catalog-mcp" and version "0.1.0"
    - Register ListToolsRequestSchema handler that exposes all 6 catalog tools with descriptions and input schemas
    - Register CallToolRequestSchema handler that routes requests to appropriate tool functions
    - Handle top-level errors and format error responses
    - Log all tool invocations to stderr with tool name, duration, success/failure
    - Never log JSON responses to stderr (only to stdout via MCP protocol)
    - _Requirements: 1.1, 1.6, 1.7, 1.8, 1.9, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1_

  - [ ]* 12.2 Write property test for tool registry completeness
    - **Property 2: Tool Registry Completeness**
    - **Validates: Requirements 1.8, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1**
    - Verify all 6 expected tools are registered with handlers
    - _Requirements: 1.8, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1_

  - [x] 12.3 Create entry point (`src/index.ts`)
    - Add shebang for direct execution: `#!/usr/bin/env node`
    - Initialize StdioServerTransport
    - Connect server to transport
    - Log startup message to stderr
    - Handle fatal errors and exit with code 1
    - _Requirements: 1.9_

- [ ] 13. Configure MCP integration with Kiro
  - [x] 13.1 Update MCP configuration file (`.kiro/settings/mcp.json`)
    - Add "commerce-catalog-mcp" entry with command "node" and args ["./tools/mcp/commerce-catalog/dist/index.js"]
    - Set disabled to false
    - Configure environment variables: AWS_REGION, DYNAMODB_TABLE_NAME, AWS_PROFILE, S3_MEDIA_BUCKET
    - Mark all 6 catalog tools as alwaysAllow (read-only, safe for auto-approval)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ] 14. Create documentation
  - [x] 14.1 Create README.md in tools/mcp/commerce-catalog/
    - Document all 6 available tools with parameter descriptions and example usage
    - Document required environment variables and AWS configuration
    - Provide installation instructions (npm install, build steps)
    - Document how to test locally with MCP inspector
    - Document DynamoDB table schema assumptions (PK/SK patterns)
    - Include troubleshooting guidance for AWS credential errors and missing environment variables
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [x] 15. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to compile TypeScript
  - Run `npm run test` to execute all unit and property tests
  - Verify compiled output is executable via `node ./tools/mcp/commerce-catalog/dist/index.js`
  - Test server startup with valid environment configuration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties across all inputs
- Unit tests validate specific examples and edge cases
- The server follows the established pattern from commerce-ops-mcp for consistency
- TypeScript provides type safety and better developer experience
- All tools are read-only, ensuring safe AI assistant usage
- DynamoDB schema assumptions must be validated during implementation (GSI names, field names)
