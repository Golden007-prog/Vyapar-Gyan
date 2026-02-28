# Implementation Plan: Commerce Ops MCP Server

## Overview

This plan implements a Model Context Protocol (MCP) server that provides read-only access to VyaparGyan operational data stored in DynamoDB and CloudWatch Logs. The server exposes seven tools for querying orders, payments, inventory, WhatsApp sessions, and logs. Implementation follows a layered architecture with TypeScript, compiled to JavaScript, and executed via Node.js.

The implementation is already partially complete. This task list focuses on completing missing functionality, adding comprehensive testing, and ensuring production readiness.

## Tasks

- [x] 1. Verify and complete project setup
  - Review package.json dependencies and ensure all required packages are installed
  - Verify tsconfig.json configuration for strict type checking and correct output path
  - Ensure build script compiles to tools/mcp/commerce-ops/dist/index.js
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 2. Complete core infrastructure components
  - [x] 2.1 Implement environment validation module (src/env.ts)
    - Create Zod schema for environment variables (AWS_REGION, DDB_TABLE_NAME, AWS_PROFILE, APP_ENV, LOG_GROUP_PREFIX, MCP_MOCK_MODE)
    - Implement loadEnv() function with validation and default values
    - Export typed Env interface
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  
  - [ ]* 2.2 Write property test for environment validation
    - **Property 1: Environment Validation Round Trip**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
  
  - [x] 2.3 Implement AWS client management (src/shared/aws-clients.ts)
    - Create singleton getDynamoClient(region) function
    - Create singleton getLogsClient(region) function
    - Configure DynamoDBDocumentClient with marshalling options
    - _Requirements: 1.6_
  
  - [x] 2.4 Implement response formatter (src/shared/response-formatter.ts)
    - Define SuccessResponse<T> and ErrorResponse interfaces
    - Implement successResponse<T>(data: T) function
    - Implement errorResponse(code, message, details?) function
    - Implement partialSuccessResponse<T>(data: T, warnings: Warning[]) function
    - _Requirements: 2.4, 3.4, 4.4, 5.5_
  
  - [ ]* 2.5 Write property test for response structure invariant
    - **Property 6: Success Response Structure Invariant**
    - **Validates: Requirements 2.4, 3.4, 4.4, 5.5**
  
  - [ ]* 2.6 Write property test for response timestamp validity
    - **Property 14: Response Timestamp Validity**
    - **Validates: Requirements 2.4, 3.4, 4.4, 5.5**
  
  - [x] 2.7 Implement error handler (src/shared/error-handler.ts)
    - Define MCPError class with code and details
    - Implement handleAWSError(error) function with error mapping
    - Implement logError(context, error) function
    - Map ResourceNotFoundException → NOT_FOUND
    - Map ValidationException → VALIDATION_ERROR
    - Map AccessDeniedException → ACCESS_DENIED
    - Map other errors → AWS_ERROR or UNKNOWN_ERROR
    - _Requirements: 2.6, 3.6, 4.6, 5.7, 6.11, 9.2, 9.3, 9.4, 9.5, 9.6_
  
  - [ ]* 2.8 Write property test for AWS error mapping
    - **Property 8: AWS Error Mapping Completeness**
    - **Validates: Requirements 2.6, 3.6, 4.6, 5.7, 6.11, 9.2, 9.3, 9.4**
  
  - [ ]* 2.9 Write property test for sensitive data redaction
    - **Property 13: Sensitive Data Redaction in Errors**
    - **Validates: Requirements 9.6**

- [x] 3. Implement MCP server initialization
  - [x] 3.1 Complete server.ts with tool registration
    - Initialize MCP Server with name "commerce-ops-mcp" and version "0.1.0"
    - Register ListToolsRequestSchema handler
    - Register CallToolRequestSchema handler with routing logic
    - Implement request routing switch statement for all seven tools
    - Add structured logging for tool invocations (tool name, duration, success/failure)
    - Ensure all logs go to stderr, never stdout
    - _Requirements: 1.7, 1.8_
  
  - [ ]* 3.2 Write property test for tool registry completeness
    - **Property 2: Tool Registry Completeness**
    - **Validates: Requirements 1.7**
  
  - [x] 3.3 Complete index.ts entry point
    - Add shebang for direct execution
    - Initialize StdioServerTransport
    - Connect server to transport
    - Log startup message to stderr
    - Handle fatal errors and exit with code 1
    - _Requirements: 1.8, 7.4_

- [x] 4. Implement tool: get_order
  - [x] 4.1 Create src/tools/get-order.ts
    - Define getOrderSchema with orderId parameter validation
    - Implement getOrder(args, env) function
    - Construct DynamoDB GetCommand with PK=ORDER#{orderId}, SK=ORDER
    - Transform DynamoDB response to order data structure
    - Handle not found case with NOT_FOUND error
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  
  - [ ]* 4.2 Write unit tests for get_order edge cases
    - Test with non-existent order ID returns NOT_FOUND
    - Test with empty orderId returns VALIDATION_ERROR
    - Test successful order retrieval with complete data
  
  - [ ]* 4.3 Write property test for parameter validation
    - **Property 3: Parameter Validation Rejects Invalid Inputs (get_order)**
    - **Validates: Requirements 2.2, 9.1**
  
  - [ ]* 4.4 Write property test for DynamoDB key construction
    - **Property 4: DynamoDB Key Construction Correctness (ORDER)**
    - **Validates: Requirements 2.3**

- [x] 5. Implement tool: get_order_timeline
  - [x] 5.1 Create src/tools/get-order-timeline.ts
    - Define getOrderTimelineSchema with orderId parameter validation
    - Implement getOrderTimeline(args, env) function
    - Query order, items, payments, and audit logs (multiple DynamoDB queries)
    - Implement limit enforcement (max 200 related items total)
    - Handle partial failures with partialSuccessResponse and warnings
    - Include truncated flag when limits exceeded
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  
  - [ ]* 5.2 Write unit tests for get_order_timeline
    - Test with order having multiple items, payments, and audit logs
    - Test truncation behavior when limits exceeded
    - Test partial failure handling with warnings

- [x] 6. Implement tool: get_payment
  - [x] 6.1 Create src/tools/get-payment.ts
    - Define getPaymentSchema with orderId parameter validation
    - Implement getPayment(args, env) function
    - Construct DynamoDB QueryCommand with PK=ORDER#{orderId}, SK begins_with PAYMENT#
    - Implement limit enforcement (max 50 payments)
    - Include truncated flag when limits exceeded
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  
  - [ ]* 6.2 Write unit tests for get_payment
    - Test with order having no payments
    - Test with order having multiple payments
    - Test truncation behavior when limit exceeded

- [x] 7. Implement tool: get_inventory
  - [x] 7.1 Create src/tools/get-inventory.ts
    - Define getInventorySchema with productId parameter validation
    - Implement getInventory(args, env) function
    - Query product entity and inventory logs (multiple DynamoDB queries)
    - Calculate availableStock = currentStock - reservedStock
    - Implement limit enforcement (max 50 inventory logs)
    - Include truncated flag when limits exceeded
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
  
  - [ ]* 7.2 Write unit tests for get_inventory
    - Test with product having no inventory logs
    - Test stock calculation (available = current - reserved)
    - Test truncation behavior when limit exceeded

- [x] 8. Implement tool: get_whatsapp_session
  - [x] 8.1 Create src/tools/get-whatsapp-session.ts
    - Define getWhatsAppSessionSchema with phone and sessionId parameters (at least one required)
    - Implement getWhatsAppSession(args, env) function
    - Handle sessionId case: GetCommand with PK=WHATSAPP_SESSION#{sessionId}, SK=SESSION
    - Handle phone case: QueryCommand via GSI1 with GSI1PK=PHONE#{phone}
    - Query recent messages (max 50)
    - Include truncated flag when limits exceeded
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
  
  - [ ]* 8.2 Write unit tests for get_whatsapp_session
    - Test with neither phone nor sessionId returns VALIDATION_ERROR
    - Test with sessionId performs GetCommand
    - Test with phone performs GSI1 QueryCommand
    - Test message truncation behavior
  
  - [ ]* 8.3 Write property test for GSI query construction
    - **Property 5: GSI Query Construction for Phone Lookup**
    - **Validates: Requirements 5.4**

- [x] 9. Implement tool: search_logs
  - [x] 9.1 Create src/tools/search-logs.ts
    - Define searchLogsSchema with query, logGroupPrefix, startTime, endTime parameters
    - Implement searchLogs(args, env) function
    - Use DescribeLogGroups to find matching log groups
    - Use FilterLogEventsCommand with time range and filter pattern
    - Default time range to last 1 hour if not specified
    - Implement limit enforcement (max 100 log entries, first 5 log groups)
    - Sort results by timestamp descending
    - Include truncated flag when limits exceeded
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12_
  
  - [ ]* 9.2 Write unit tests for search_logs
    - Test with no results returns empty array
    - Test default time range (last 1 hour)
    - Test truncation behavior when limit exceeded
  
  - [ ]* 9.3 Write property test for time range filtering
    - **Property 9: CloudWatch Time Range Filtering Correctness**
    - **Validates: Requirements 6.6, 6.7**
  
  - [ ]* 9.4 Write property test for log results ordering
    - **Property 10: Log Results Ordering Invariant**
    - **Validates: Requirements 6.8**
  
  - [ ]* 9.5 Write property test for log results limit enforcement
    - **Property 11: Log Results Limit Enforcement**
    - **Validates: Requirements 6.9**

- [x] 10. Implement tool: list_seller_orders
  - [x] 10.1 Create src/tools/list-seller-orders.ts
    - Define listSellerOrdersSchema with sellerId, status, limit parameters
    - Implement listSellerOrders(args, env) function
    - Construct DynamoDB QueryCommand via GSI for seller orders
    - Filter by status if provided
    - Implement limit enforcement (default 20, max 100)
    - Include hasMore flag for pagination
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  
  - [ ]* 10.2 Write unit tests for list_seller_orders
    - Test with seller having no orders
    - Test status filtering
    - Test limit enforcement and hasMore flag

- [x] 11. Checkpoint - Ensure all tools are implemented and basic tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update MCP configuration
  - [x] 12.1 Verify .kiro/settings/mcp.json configuration
    - Ensure commerce-ops-mcp entry exists
    - Verify command is "node" with argument "./tools/mcp/commerce-ops/dist/index.js"
    - Verify enabled is true
    - Verify environment variables are set (AWS_REGION, DYNAMODB_TABLE_NAME, AWS_PROFILE)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 13. Create comprehensive documentation
  - [x] 13.1 Create README.md in tools/mcp/commerce-ops/
    - Document all seven tools with parameter descriptions and example usage
    - Document required environment variables and AWS configuration
    - Provide installation instructions (npm install, build steps)
    - Document how to test locally with MCP inspector
    - Document DynamoDB table schema assumptions
    - Include troubleshooting guidance for common issues
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [ ] 14. Add comprehensive test suite
  - [ ] 14.1 Set up testing infrastructure
    - Install fast-check, vitest, and aws-sdk-client-mock
    - Configure vitest.config.ts for test execution
    - Create test directory structure (unit, property, integration)
  
  - [ ]* 14.2 Write remaining property tests
    - **Property 7: Not Found Error Consistency**
    - **Property 12: Error Logging Context Completeness**
    - Test all properties with minimum 100 iterations
    - Add property tags in comments for traceability
  
  - [ ]* 14.3 Write unit tests for edge cases
    - Environment validation with missing required variables
    - Tool registration includes all expected tools
    - Response formatting with specific data structures
    - Error mapping for specific AWS error types
    - Empty result handling for all tools
    - Timeout and authentication error scenarios
  
  - [ ]* 14.4 Write integration tests (optional, requires AWS setup)
    - End-to-end tool invocation with real DynamoDB
    - CloudWatch Logs search with real log groups
    - AWS credential handling with real AWS SDK
    - Server startup and stdio transport

- [x] 15. Final checkpoint - Ensure all tests pass and documentation is complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties with minimum 100 iterations
- Unit tests validate specific examples and edge cases
- Integration tests are optional and require AWS credentials
- The implementation already exists partially; focus on completing missing functionality and testing
- All tools must be read-only; no state-changing operations permitted
- All logs must go to stderr, never stdout (reserved for MCP protocol)
- Error messages must redact sensitive data (credentials, internal paths, customer message bodies)
