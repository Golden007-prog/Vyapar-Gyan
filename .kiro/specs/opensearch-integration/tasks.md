# Implementation Plan: OpenSearch Integration

## Overview

Replace DynamoDB Scan-based product search with OpenSearch Serverless full-text search. Implementation proceeds bottom-up: CDK infrastructure → backend adapter/handlers → API routes → frontend components, with property-based tests validating correctness properties from the design document.

## Tasks

- [x] 1. Create SearchStack CDK infrastructure
  - [x] 1.1 Create `infra/cdk/lib/stacks/search-stack.ts` with SearchStack class
    - Define `SearchStackProps` extending `cdk.StackProps` accepting `config`, `table`, `httpApi`, `jwtAuthorizer`
    - Enable PITR on the DynamoDB main table (modify table props or use CfnTable escape hatch)
    - Verify DynamoDB Streams is already configured with `NEW_AND_OLD_IMAGES` (already set in `database-stack.ts`)
    - Create S3 export bucket with 30-day lifecycle expiration policy for PITR export data
    - Create OpenSearch Serverless `CfnCollection` of type SEARCH named `{resourcePrefix}-products`
    - Create `CfnEncryptionPolicy` using AWS-owned encryption key
    - Create `CfnNetworkPolicy` allowing access from Lambda execution roles
    - Create `CfnAccessPolicy` (read) granting Search Lambda role `aoss:ReadDocument`, `aoss:DescribeIndex`
    - Create `CfnAccessPolicy` (write) granting OSIS pipeline role `aoss:WriteDocument`, `aoss:CreateIndex`, `aoss:UpdateIndex`
    - Create IAM roles for OSIS pipeline (DynamoDB read, S3 read, OpenSearch write) and Lambda (OpenSearch read)
    - Create `CfnPipeline` with DynamoDB source plugin, route filters for products (`PK startsWith "SELLER#" AND SK startsWith "PRODUCT#"`) and sellers (`PK startsWith "SELLER#" AND SK == "PROFILE"`), OpenSearch sink, and dead-letter S3 path
    - Configure OSIS pipeline with min 1 OCU, max 4 OCU auto-scaling
    - Export collection endpoint as CloudFormation stack output
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 1.2 Register SearchStack in CDK app and export from stacks index
    - Add `SearchStack` to `infra/cdk/lib/stacks/index.ts` exports
    - Instantiate `SearchStack` in the CDK app entry point, passing `table` from DatabaseStack, `httpApi` and `jwtAuthorizer` from APIStack
    - _Requirements: 2.6_

- [x] 2. Implement OpenSearch client adapter
  - [x] 2.1 Create `services/api/src/adapters/opensearch-adapter.ts`
    - Install `@opensearch-project/opensearch` dependency
    - Implement `OpenSearchAdapter` class with SigV4 signing using `aoss` service name
    - Read endpoint from `OPENSEARCH_ENDPOINT` environment variable
    - Implement `search<T>(index, body)` method returning `SearchResult<T>` with `hits` and `total`
    - Implement `suggest(index, prefix, limit)` method returning `SuggestionResult` with `suggestions` array
    - Set 5-second request timeout; throw descriptive `OpenSearchTimeoutError` on timeout
    - Enable HTTP keep-alive for connection reuse across Lambda invocations
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 2.2 Write unit tests for OpenSearch adapter
    - Test SigV4 signer configuration with `aoss` service
    - Test timeout error handling throws `OpenSearchTimeoutError`
    - Test connection reuse (singleton client instance)
    - Test endpoint read from environment variable
    - _Requirements: 8.1, 8.2, 8.5, 8.6_

- [x] 3. Implement Search Lambda handler
  - [x] 3.1 Create Zod schemas in `services/api/src/shared/schemas.ts` (or co-located)
    - Add `SearchQuerySchema` with `q` (optional string), `category` (optional string), `seller` (optional string), `page` (coerce int, min 1, default 1), `size` (coerce int, min 1, max 100, default 20)
    - Add `AutocompleteQuerySchema` with `q` (string, min 1), `limit` (coerce int, min 1, max 10, default 5)
    - Add `SearchResponseSchema` and `AutocompleteResponseSchema` Zod schemas for response validation
    - _Requirements: 5.6, 5.7, 6.2, 6.4, 11.2, 11.3_

  - [x] 3.2 Create `services/api/src/handlers/catalog/search-handler.ts`
    - Implement query builder: `multi_match` on `productName^3`, `description`, `tags^2` with `fuzziness: "AUTO"`
    - Add `term` filter for `status: "Active"`
    - Add conditional `term` filters for `category` and `sellerId` when provided
    - When no `q` provided, use `match_all` ordered by relevance
    - Compute pagination: `from = (page - 1) * size`
    - Format response as `{ items, total, page, pageSize }`
    - Return HTTP 503 with descriptive error when OpenSearch is unreachable
    - Return HTTP 400 for invalid query parameters
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [x] 3.3 Write property test: Search query construction correctness
    - **Property 1: Search query construction correctness**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
    - Use `fast-check` with `fc.configureGlobal({ numRuns: 100 })`
    - Generate random `{q, category, seller}` tuples
    - Extract the query builder function and verify constructed query body contains `multi_match` with correct fields/boosts/fuzziness, `term` filter for `status: "Active"`, and conditional filters

  - [x] 3.4 Write property test: Pagination calculation correctness
    - **Property 2: Pagination calculation correctness**
    - **Validates: Requirements 5.6**
    - Use `fast-check` with minimum 100 iterations
    - Generate random `{page, size}` pairs where page ≥ 1 and size ∈ [1, 100]
    - Verify `from = (page - 1) * size` and `size` clamped to [1, 100] with default 20

  - [x] 3.5 Write property test: Search response schema conformance
    - **Property 7: Search response schema conformance**
    - **Validates: Requirements 5.7, 11.2**
    - Use `fast-check` with minimum 100 iterations
    - Generate random query strings and mock OpenSearch hit arrays (0 or more hits)
    - Format through the response formatter and validate output against `SearchResponseSchema` Zod schema

- [x] 4. Implement Autocomplete Lambda handler
  - [x] 4.1 Create `services/api/src/handlers/catalog/autocomplete-handler.ts`
    - Implement prefix query on `productName.keyword` with `term` filter for `status: "Active"`
    - Clamp `limit` to [1, 10] with default 5
    - Return empty `suggestions` array when `q` has fewer than 2 characters (without querying OpenSearch)
    - Format response as `{ suggestions: [{ name, category, productId }] }`
    - On OpenSearch unreachable: return HTTP 200 with empty `suggestions` array (graceful degradation)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 4.2 Write property test: Autocomplete query construction correctness
    - **Property 3: Autocomplete query construction correctness**
    - **Validates: Requirements 6.1, 6.3**
    - Use `fast-check` with minimum 100 iterations
    - Generate random strings of length ≥ 2
    - Verify constructed query contains `prefix` on `productName.keyword` and `term` filter for `status: "Active"`

  - [x] 4.3 Write property test: Autocomplete limit clamping
    - **Property 4: Autocomplete limit clamping**
    - **Validates: Requirements 6.2**
    - Use `fast-check` with minimum 100 iterations
    - Generate random integers, verify effective limit clamped to [1, 10] with default 5

  - [x] 4.4 Write property test: Short prefix returns empty suggestions
    - **Property 5: Short prefix returns empty suggestions**
    - **Validates: Requirements 6.5**
    - Use `fast-check` with minimum 100 iterations
    - Generate random strings of length 0 or 1
    - Verify handler returns empty `suggestions` array without calling OpenSearch

  - [x] 4.5 Write property test: Autocomplete response schema conformance
    - **Property 8: Autocomplete response schema conformance**
    - **Validates: Requirements 6.4, 11.3**
    - Use `fast-check` with minimum 100 iterations
    - Generate random prefixes (length ≥ 2) and mock OpenSearch hit arrays
    - Format through the response formatter and validate output against `AutocompleteResponseSchema` Zod schema

- [x] 5. Checkpoint - Ensure backend compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add API Gateway routes and Lambda functions to SearchStack
  - [x] 6.1 Add Search and Autocomplete Lambda functions to SearchStack
    - Create Search Lambda function with `OPENSEARCH_ENDPOINT` and `TABLE_NAME` env vars
    - Create Autocomplete Lambda function with `OPENSEARCH_ENDPOINT` env var
    - Grant Lambda execution roles OpenSearch read permissions via the data access policy
    - _Requirements: 7.1, 7.2_

  - [x] 6.2 Add API Gateway routes with JWT auth
    - Add `GET /api/v1/search` route to existing `httpApi` with Cognito JWT authorizer
    - Add `GET /api/v1/autocomplete` route to existing `httpApi` with Cognito JWT authorizer
    - Both routes accessible by all Cognito roles (admin, seller, customer)
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 7. Implement product data round-trip transform functions
  - [x] 7.1 Create transform utilities for OpenSearch document ↔ SearchProductItem conversion
    - Implement `toOpenSearchDoc(product)` for indexing format
    - Implement `fromOpenSearchHit(hit)` for formatting search results to `SearchProductItem`
    - Ensure `productId`, `productName`, `price`, `category`, `sellerId` are preserved through round-trip
    - _Requirements: 11.1_

  - [x] 7.2 Write property test: Product data round-trip preservation
    - **Property 6: Product data round-trip preservation**
    - **Validates: Requirements 11.1**
    - Use `fast-check` with minimum 100 iterations
    - Generate random Product objects with `productId`, `productName`, `price`, `category`, `sellerId`
    - Transform to OpenSearch doc format and back to `SearchProductItem`
    - Verify all five fields are preserved

- [x] 8. Checkpoint - Ensure all backend code and infrastructure compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Create frontend search API client
  - [x] 9.1 Create `apps/web/lib/api-search.ts`
    - Implement `searchProducts({ q, category, seller, page, size })` returning `SearchResponse`
    - Implement `getAutocompleteSuggestions(q, limit)` returning `AutocompleteResponse`
    - Follow existing `api-catalog.ts` pattern with optional JWT auth and 5-second timeout
    - _Requirements: 5.7, 6.4, 9.5_

- [x] 10. Create frontend search components
  - [x] 10.1 Create `apps/web/components/search/SearchBar.tsx`
    - Render text input with search icon and clear button
    - Debounce input by 300ms before dispatching autocomplete request
    - Show loading indicator while waiting for responses
    - On Enter press or search icon tap, dispatch full search request
    - Accept `sellerScope` prop for seller inventory page filtering
    - _Requirements: 9.1, 9.2, 9.5, 9.6_

  - [x] 10.2 Create `apps/web/components/search/AutocompleteDropdown.tsx`
    - Display suggestions with product name and category
    - On suggestion select, navigate to search results filtered by selected product name
    - Show/hide based on `visible` prop and suggestion availability
    - _Requirements: 9.3, 9.4_

  - [x] 10.3 Create `apps/web/components/search/SearchResults.tsx`
    - Render product cards in responsive grid (1 col mobile, 2 tablet, 3-4 desktop)
    - Display total result count and current page info
    - Show loading skeleton while search request is in progress
    - Show empty state with "No products found" message and suggestion to try different terms
    - Implement "Load More" button or scroll-based pagination for next page
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.6_

  - [x] 10.4 Create `apps/web/components/search/CategoryFilters.tsx`
    - Render category filter chips
    - On chip select, re-query Search API with selected category
    - Support deselecting to clear category filter
    - _Requirements: 10.2_

- [x] 11. Integrate search into existing pages
  - [x] 11.1 Integrate SearchBar into customer catalog page
    - Replace existing client-side search input in `apps/web/app/(customer)/catalog/page.tsx` with SearchBar component
    - Wire SearchResults and CategoryFilters into the catalog page
    - Maintain fallback to existing DynamoDB-based browsing when search is unavailable (503 handling)
    - _Requirements: 9.7, 10.1, 10.2_

  - [x] 11.2 Integrate SearchBar into seller inventory page
    - Add SearchBar to `apps/web/app/seller/inventory/page.tsx` with `sellerScope` prop set to current seller ID
    - Wire search results to filter the inventory product list
    - _Requirements: 9.8_

- [x] 12. Final checkpoint - Ensure all code compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with minimum 100 iterations per property, covering all 8 correctness properties from the design
- The existing `catalog-search-handler.ts` (DynamoDB Scan) remains as a fallback — the new search routes are additive
- Checkpoints ensure incremental validation at backend-complete and full-integration milestones
