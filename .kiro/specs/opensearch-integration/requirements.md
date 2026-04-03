# Requirements Document

## Introduction

VyaparGyan currently relies on DynamoDB table scans with in-memory text filtering for product search (`catalog-search-handler.ts`). This approach limits search to exact substring matches, cannot handle typos or fuzzy queries, and degrades as the product catalog grows. Phase 2 of the production roadmap replaces this with OpenSearch Serverless, providing full-text search with fuzzy matching, autocomplete, and automatic data synchronization from DynamoDB via a zero-ETL ingestion pipeline. The scope covers CDK infrastructure, backend Lambda handlers, API Gateway routes, and frontend search UI components.

## Glossary

- **Search_Collection**: An OpenSearch Serverless collection of type SEARCH that stores indexed product and seller documents and serves full-text queries.
- **OSIS_Pipeline**: An OpenSearch Ingestion Service pipeline that reads DynamoDB Streams and PITR export data and writes transformed documents to the Search_Collection.
- **Search_Lambda**: An AWS Lambda function that receives search and autocomplete HTTP requests, queries the Search_Collection, and returns formatted results.
- **Search_API**: The HTTP API Gateway route `GET /api/v1/search` that accepts query, filter, and pagination parameters and returns matching products.
- **Autocomplete_API**: The HTTP API Gateway route `GET /api/v1/autocomplete` that accepts a prefix string and returns product name suggestions.
- **SearchBar_Component**: A Next.js React component that renders a text input with debounced keystrokes, dispatches requests to the Autocomplete_API and Search_API, and displays results.
- **OpenSearch_Client**: A TypeScript adapter module that signs requests with AWS SigV4 and communicates with the Search_Collection endpoint.
- **Product_Index**: The OpenSearch index named `products` that stores searchable product documents with fields for productName, description, category, tags, price, stockQuantity, sellerId, and status.
- **Seller_Index**: The OpenSearch index named `sellers` that stores searchable seller profile documents with fields for storeName, description, categories, city, and status.
- **DynamoDB_Main_Table**: The existing single-table DynamoDB table (`vyapargyan-{env}-main`) that is the source of truth for all product and seller data.
- **PITR**: Point-in-Time Recovery, a DynamoDB feature that enables continuous backups and is required by the zero-ETL pipeline for initial data export.
- **Search_Stack**: A new AWS CDK stack that provisions the Search_Collection, OSIS_Pipeline, S3 export bucket, IAM roles, and Search_Lambda resources.

## Requirements

### Requirement 1: Enable DynamoDB PITR and Streams for Zero-ETL

**User Story:** As a platform operator, I want DynamoDB Point-in-Time Recovery and Streams enabled on the main table, so that the zero-ETL pipeline can perform an initial data export and receive ongoing change events.

#### Acceptance Criteria

1. THE Search_Stack SHALL enable Point-in-Time Recovery on the DynamoDB_Main_Table.
2. THE DynamoDB_Main_Table SHALL have DynamoDB Streams configured with NEW_AND_OLD_IMAGES stream view type.
3. THE Search_Stack SHALL create an S3 bucket for PITR export data with a lifecycle policy that deletes objects after 30 days.
4. WHEN PITR and Streams are enabled, THE DynamoDB_Main_Table SHALL continue to serve all existing read and write access patterns without degradation.
5. IF enabling PITR or Streams fails during CDK deployment, THEN THE Search_Stack SHALL surface the CloudFormation error without modifying unrelated table properties.

### Requirement 2: Provision OpenSearch Serverless Collection

**User Story:** As a platform operator, I want an OpenSearch Serverless search collection provisioned via CDK, so that product and seller data can be indexed and queried with full-text search capabilities.

#### Acceptance Criteria

1. THE Search_Stack SHALL create an OpenSearch Serverless collection of type SEARCH named `{resourcePrefix}-products`.
2. THE Search_Stack SHALL create an encryption policy for the Search_Collection using the AWS-owned encryption key.
3. THE Search_Stack SHALL create a network policy that allows access to the Search_Collection from the Search_Lambda execution role.
4. THE Search_Stack SHALL create a data access policy granting the Search_Lambda execution role read permissions (aoss:ReadDocument, aoss:DescribeIndex) on the Search_Collection.
5. THE Search_Stack SHALL create a data access policy granting the OSIS_Pipeline execution role write permissions (aoss:WriteDocument, aoss:CreateIndex, aoss:UpdateIndex) on the Search_Collection.
6. THE Search_Stack SHALL export the Search_Collection endpoint as a CloudFormation stack output.

### Requirement 3: Create OpenSearch Ingestion Pipeline

**User Story:** As a platform operator, I want a zero-ETL ingestion pipeline that automatically syncs product and seller records from DynamoDB to OpenSearch, so that the search index stays current without custom ETL code.

#### Acceptance Criteria

1. THE Search_Stack SHALL create an OSIS_Pipeline with a DynamoDB source plugin configured to read from the DynamoDB_Main_Table stream and PITR export.
2. THE OSIS_Pipeline SHALL route records where PK starts with `SELLER#` and SK starts with `PRODUCT#` to the Product_Index.
3. THE OSIS_Pipeline SHALL route records where PK starts with `SELLER#` and SK equals `PROFILE` to the Seller_Index.
4. THE OSIS_Pipeline SHALL discard all records that do not match product or seller PK/SK patterns.
5. THE OSIS_Pipeline SHALL be configured with minimum 1 OCU and maximum 4 OCU for auto-scaling.
6. WHEN a product record is created or updated in the DynamoDB_Main_Table, THE OSIS_Pipeline SHALL sync the change to the Product_Index within 60 seconds.
7. WHEN a seller profile record is created or updated in the DynamoDB_Main_Table, THE OSIS_Pipeline SHALL sync the change to the Seller_Index within 60 seconds.
8. IF the OSIS_Pipeline fails to process a record, THEN THE OSIS_Pipeline SHALL write the failed record to a dead-letter S3 path for later inspection.

### Requirement 4: Define OpenSearch Index Mappings

**User Story:** As a developer, I want well-defined index mappings for products and sellers, so that full-text search, keyword filtering, and numeric range queries work correctly.

#### Acceptance Criteria

1. THE Product_Index SHALL define `productName` as a text field with the standard analyzer and a `.keyword` sub-field of type keyword.
2. THE Product_Index SHALL define `description` as a text field with the standard analyzer.
3. THE Product_Index SHALL define `category`, `tags`, `sellerId`, and `status` as keyword fields.
4. THE Product_Index SHALL define `price` as a float field and `stockQuantity` as an integer field.
5. THE Product_Index SHALL define `createdAt` as a date field.
6. THE Seller_Index SHALL define `storeName` as a text field with a `.keyword` sub-field of type keyword.
7. THE Seller_Index SHALL define `description` as a text field, and `categories`, `city`, and `status` as keyword fields.

### Requirement 5: Full-Text Product Search

**User Story:** As a customer, I want to search for products using natural language queries with typo tolerance, so that I can find products even when I misspell words.

#### Acceptance Criteria

1. WHEN a GET request is sent to the Search_API with query parameter `q`, THE Search_Lambda SHALL execute a multi_match query across `productName` (boosted 3x), `description`, and `tags` (boosted 2x) fields in the Product_Index.
2. THE Search_Lambda SHALL apply fuzziness `AUTO` to the multi_match query to tolerate typographical errors.
3. THE Search_Lambda SHALL filter results to only include products with status `Active`.
4. WHEN the `category` query parameter is provided, THE Search_Lambda SHALL add a term filter on the `category` field.
5. WHEN the `seller` query parameter is provided, THE Search_Lambda SHALL add a term filter on the `sellerId` field.
6. THE Search_Lambda SHALL support pagination via `page` (default 1) and `size` (default 20, maximum 100) query parameters.
7. THE Search_Lambda SHALL return a JSON response containing `items` (array of product objects), `total` (total matching count), `page`, and `pageSize` fields.
8. WHEN no `q` parameter is provided, THE Search_Lambda SHALL return all active products ordered by relevance score.
9. IF the Search_Collection is unreachable, THEN THE Search_Lambda SHALL return HTTP 503 with an error message indicating search is temporarily unavailable.

### Requirement 6: Product Autocomplete

**User Story:** As a customer, I want to see product name suggestions as I type in the search bar, so that I can quickly find products without typing the full name.

#### Acceptance Criteria

1. WHEN a GET request is sent to the Autocomplete_API with query parameter `q` containing 2 or more characters, THE Search_Lambda SHALL execute a prefix query on the `productName.keyword` field in the Product_Index.
2. THE Search_Lambda SHALL limit autocomplete results to the value of the `limit` query parameter (default 5, maximum 10).
3. THE Search_Lambda SHALL filter autocomplete results to only include products with status `Active`.
4. THE Search_Lambda SHALL return a JSON response containing a `suggestions` array where each element has `name`, `category`, and `productId` fields.
5. WHEN the `q` parameter contains fewer than 2 characters, THE Search_Lambda SHALL return an empty `suggestions` array.
6. IF the Search_Collection is unreachable, THEN THE Search_Lambda SHALL return an empty `suggestions` array with HTTP 200.

### Requirement 7: API Gateway Search Routes with Authentication

**User Story:** As a platform operator, I want search and autocomplete routes added to the existing API Gateway with JWT authentication, so that only authenticated users can access search functionality.

#### Acceptance Criteria

1. THE Search_Stack SHALL add a `GET /api/v1/search` route to the existing HTTP API with the Cognito JWT authorizer.
2. THE Search_Stack SHALL add a `GET /api/v1/autocomplete` route to the existing HTTP API with the Cognito JWT authorizer.
3. THE Search_API and Autocomplete_API SHALL be accessible by users with any Cognito role (admin, seller, customer).
4. WHEN a request without a valid JWT token is sent to the Search_API or Autocomplete_API, THE HTTP API SHALL return HTTP 401 Unauthorized.

### Requirement 8: OpenSearch Client Adapter

**User Story:** As a developer, I want a reusable OpenSearch client adapter that handles AWS SigV4 request signing, so that Lambda handlers can query the Search_Collection without duplicating authentication logic.

#### Acceptance Criteria

1. THE OpenSearch_Client SHALL sign all requests to the Search_Collection using AWS SigV4 with the `aoss` service name.
2. THE OpenSearch_Client SHALL read the Search_Collection endpoint from the `OPENSEARCH_ENDPOINT` environment variable.
3. THE OpenSearch_Client SHALL expose a `search` method that accepts an index name and query body and returns typed search results.
4. THE OpenSearch_Client SHALL expose a `suggest` method that accepts an index name and prefix string and returns typed suggestion results.
5. IF a request to the Search_Collection times out after 5 seconds, THEN THE OpenSearch_Client SHALL throw a descriptive timeout error.
6. THE OpenSearch_Client SHALL reuse HTTP connections across invocations within the same Lambda execution context.

### Requirement 9: Frontend Search Bar with Autocomplete

**User Story:** As a customer, I want a search bar with real-time autocomplete suggestions in the catalog page, so that I can discover products quickly.

#### Acceptance Criteria

1. THE SearchBar_Component SHALL render a text input with a search icon and a clear button.
2. WHEN the user types in the SearchBar_Component, THE SearchBar_Component SHALL debounce input by 300 milliseconds before dispatching a request to the Autocomplete_API.
3. WHEN the Autocomplete_API returns suggestions, THE SearchBar_Component SHALL display an autocomplete dropdown listing each suggestion with product name and category.
4. WHEN the user selects an autocomplete suggestion, THE SearchBar_Component SHALL navigate to the search results view filtered by the selected product name.
5. WHEN the user presses Enter or taps the search icon, THE SearchBar_Component SHALL dispatch a request to the Search_API with the current input value.
6. THE SearchBar_Component SHALL display a loading indicator while waiting for autocomplete or search responses.
7. THE SearchBar_Component SHALL be integrated into the customer catalog page (`apps/web/app/(customer)/catalog/page.tsx`) replacing the existing client-side search input.
8. THE SearchBar_Component SHALL be integrated into the seller inventory page (`apps/web/app/seller/inventory/page.tsx`) for seller-scoped product search.

### Requirement 10: Search Results Display

**User Story:** As a customer, I want search results displayed in a responsive grid with category filters, so that I can browse and narrow down results on any device.

#### Acceptance Criteria

1. WHEN the Search_API returns results, THE SearchBar_Component SHALL render product cards in a responsive grid (1 column on mobile, 2 on tablet, 3-4 on desktop).
2. THE search results view SHALL display category filter chips that, when selected, re-query the Search_API with the selected category.
3. WHEN no results match the query, THE search results view SHALL display an empty state with the message "No products found" and a suggestion to try different search terms.
4. THE search results view SHALL display a loading skeleton while the Search_API request is in progress.
5. THE search results view SHALL display the total result count and current page information.
6. WHEN the user scrolls to the bottom of results or clicks a "Load More" button, THE search results view SHALL request the next page from the Search_API.

### Requirement 11: Search Response Serialization Round-Trip

**User Story:** As a developer, I want search response serialization to be verifiably correct, so that product data is not corrupted when passing through the search pipeline.

#### Acceptance Criteria

1. FOR ALL valid Product objects written to the DynamoDB_Main_Table, indexing into the Product_Index and then querying via the Search_Lambda SHALL return a product object with equivalent `productId`, `productName`, `price`, `category`, and `sellerId` values (round-trip property).
2. FOR ALL valid search query strings, THE Search_Lambda SHALL return a JSON response that conforms to the SearchResponse schema containing `items`, `total`, `page`, and `pageSize` fields.
3. FOR ALL valid autocomplete prefix strings of 2 or more characters, THE Search_Lambda SHALL return a JSON response that conforms to the AutocompleteResponse schema containing a `suggestions` array.
