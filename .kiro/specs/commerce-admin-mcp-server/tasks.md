# Implementation Plan: Commerce Admin MCP Server

## Overview

This plan implements a Model Context Protocol (MCP) server that provides read-only access to administrative data from the VyaparGyan commerce platform. The server exposes 6 tools for querying seller approvals, disputes, audit logs, and payment records stored in DynamoDB. Built with TypeScript and the MCP SDK, it follows the established pattern from commerce-ops-mcp and commerce-catalog-mcp.

## Tasks

- [x] 1. Set up project structure and core infrastructure
  - Create directory structure: `tools/mcp/commerce-admin/src/`
  - Initialize package.json with dependencies (@modelcontextprotocol/sdk, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, zod)
  - Configure tsconfig.json for ES2022 modules with strict type checking
  - Set up build script to compile to `dist/index.js`
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [x] 2. Implement environment validation and configuration
  - [x] 2.1 Create environment validation module (`src/env.ts`)
    - Define Zod schema for AWS_REGION (literal "ap-south-1"), DYNAMODB_TABLE_NAME (literal "CommerceCore-dev"), AWS_PROFILE (literal "kiro-mcp"), and optional S3_DOC_BUCKET
    - Implement loadEnv() function that validates process.env and returns typed configuration
    - Throw descriptive error if validation fails
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 2.2 Write property test for environment validation
    - **Property 1: Environment Validation Enforces Required Values**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6**

- [x] 3. Implement shared utilities layer
  - [x] 3.1 Create AWS client management module (`src/shared/aws-clients.ts`)
    - Implement singleton pattern for DynamoDBDocumentClient
    - Create getDynamoClient(region) function that returns cached client instance
    - Configure client with marshalling options for clean data handling
    - _Requirements: 1.7_

  - [x] 3.2 Create response formatter module (`src/shared/response-formatter.ts`)
    - Define SuccessResponse<T> and ErrorResponse TypeScript interfaces
    - Implement successResponse<T>(data: T) function that wraps data with success flag and ISO 8601 timestamp
    - Implement errorResponse(code, message, details?) function that creates structured error response
    - _Requirements: 2.8, 3.8, 4.8, 5.9, 6.9, 7.11_

  - [ ]* 3.3 Write property test for response structure invariant
    - **Property 6: Success Response Structure Invariant**
    - **Validates: Requirements 2.8, 3.8, 4.8, 5.9, 6.9, 7.11**

  - [x] 3.4 Create error handler module (`src/shared/error-handler.ts`)
    - Define MCPError class with code and details properties
    - Implement handleAWSError(error) function that maps AWS SDK errors to MCP error codes
    - Map ResourceNotFoundException → NOT_FOUND, ValidationException → VALIDATION_ERROR, AccessDeniedException → ACCESS_DENIED
    - Implement logError(context, error) function that logs to stderr with structured context
    - Redact sensitive information (AWS credentials, session tokens, internal paths)
    - _Requirements: 2.9, 3.9, 4.9, 5.9, 6.9, 7.9, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [ ]* 3.5 Write property test for AWS error mapping completeness
    - **Property 7: AWS Error Mapping Completeness**
    - **Validates: Requirements 2.9, 3.9, 4.9, 5.9, 6.9, 7.9, 10.7**

  - [ ]* 3.6 Write property test for sensitive data redaction
    - **Property 8: Sensitive Data Redaction in Errors**
    - **Validates: Requirements 10.6**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement pending seller approvals listing tool
  - [x] 5.1 Create list_pending_seller_approvals tool (`src/tools/list-pending-seller-approvals.ts`)
    - Define Zod schema for limit parameter (optional number, default 20, max 100)
    - Implement listPendingSellerApprovals(args, env) function that validates input and queries DynamoDB
    - Query DynamoDB for Approval_Record items with pending review status
    - Return seller summaries with seller_id, business_name, owner_name, contact_phone, contact_email, verification_status, created_at, review_state
    - Sort results by created_at ascending (oldest first)
    - Include hasMore indicator if result set exceeds limit
    - Handle empty results with empty array and descriptive message
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

  - [ ]* 5.2 Write property test for limit parameter validation
    - **Property 2: Limit Parameter Validation and Defaults**
    - **Validates: Requirements 2.2, 2.3**

  - [ ]* 5.3 Write property test for result ordering
    - **Property 3: Result Ordering Correctness (Pending Approvals)**
    - **Validates: Requirements 2.6**

  - [ ]* 5.4 Write unit tests for empty result handling
    - Test empty results return empty array with descriptive message
    - Test hasMore indicator when results exceed limit
    - _Requirements: 2.7, 2.8_

- [x] 6. Implement seller profile retrieval tool
  - [x] 6.1 Create get_seller_profile tool (`src/tools/get-seller-profile.ts`)
    - Define Zod schema for sellerId parameter (required string, min length 1)
    - Implement getSellerProfile(args, env) function that validates input and queries DynamoDB
    - Use GetCommand with PK=`SELLER#{sellerId}`, SK=`PROFILE`
    - Return seller data including seller_id, business_name, business_type, owner_name, contact_phone, contact_email, verification_status, document_keys, created_at, updated_at, approved_at
    - Include S3 document references without generating presigned URLs
    - Handle not found case with NOT_FOUND error
    - Handle AWS errors with appropriate error codes
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [ ]* 6.2 Write property test for parameter validation
    - **Property 4: Parameter Validation Rejects Invalid Inputs**
    - **Validates: Requirements 3.2, 10.1**

  - [ ]* 6.3 Write property test for DynamoDB key construction
    - **Property 5: DynamoDB Key Construction Correctness (Seller Profile)**
    - **Validates: Requirements 3.3**

- [x] 7. Implement open disputes listing tool
  - [x] 7.1 Create list_open_disputes tool (`src/tools/list-open-disputes.ts`)
    - Define Zod schema for limit parameter (optional number, default 20, max 100)
    - Implement listOpenDisputes(args, env) function that validates input and queries DynamoDB
    - Query DynamoDB for Dispute_Record items with open status
    - Return dispute summaries with dispute_id, order_id, seller_id, customer_id, status, reason, created_at, last_updated_at
    - Sort results by created_at ascending (oldest first)
    - Include hasMore indicator if result set exceeds limit
    - Handle empty results with empty array and descriptive message
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

  - [ ]* 7.2 Write property test for result ordering
    - **Property 9: Result Ordering Correctness (Open Disputes)**
    - **Validates: Requirements 4.6**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement dispute details retrieval tool
  - [x] 9.1 Create get_dispute tool (`src/tools/get-dispute.ts`)
    - Define Zod schema for orderId (optional string) and disputeId (optional string) parameters
    - Validate that at least one of orderId or disputeId is provided
    - Implement getDispute(args, env) function that validates input and queries DynamoDB
    - When disputeId provided: use GetCommand or QueryCommand to find dispute by dispute_id
    - When orderId provided: use QueryCommand to find disputes associated with order_id
    - Return dispute data including dispute_id, order_id, seller_id, customer_id, status, reason, description, status_history, linked_payment_id, created_at, updated_at, resolved_at
    - Handle not found case with NOT_FOUND error
    - Handle AWS errors with appropriate error codes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [ ]* 9.2 Write property test for parameter validation
    - **Property 10: Parameter Validation Requires At Least One Identifier**
    - **Validates: Requirements 5.4**

  - [ ]* 9.3 Write unit tests for query routing
    - Test disputeId case uses correct query pattern
    - Test orderId case uses correct query pattern
    - Test neither parameter returns VALIDATION_ERROR
    - _Requirements: 5.5, 5.6_

- [x] 10. Implement audit timeline retrieval tool
  - [x] 10.1 Create get_audit_timeline tool (`src/tools/get-audit-timeline.ts`)
    - Define Zod schema for resourceType (required string) and resourceId (required string) parameters
    - Implement getAuditTimeline(args, env) function that validates input and queries DynamoDB
    - Use QueryCommand with PK=`RESOURCE#{resourceType}#{resourceId}`, SK begins_with `AUDIT#`
    - Return Audit_Record items including audit_id, resource_type, resource_id, action, actor_id, actor_type, changes, timestamp, metadata
    - Sort results by timestamp descending (most recent first)
    - Limit results to maximum 100 audit entries
    - Include truncated indicator if result set exceeds 100 entries
    - Handle empty results with empty array and descriptive message
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_

  - [ ]* 10.2 Write property test for result ordering
    - **Property 11: Result Ordering Correctness (Audit Timeline)**
    - **Validates: Requirements 6.6**

  - [ ]* 10.3 Write property test for limit enforcement
    - **Property 12: Audit Timeline Limit Enforcement**
    - **Validates: Requirements 6.7, 6.8**

- [x] 11. Implement recent payments listing tool
  - [x] 11.1 Create list_recent_payments tool (`src/tools/list-recent-payments.ts`)
    - Define Zod schema for status (optional string) and limit (optional number, default 20, max 100) parameters
    - Implement listRecentPayments(args, env) function that validates input and queries DynamoDB
    - When status not provided: query all Payment_Record items
    - When status provided: filter Payment_Record items by matching status
    - Return payment summaries with payment_id, order_id, amount, currency, status, provider, gateway_payment_id, created_at, updated_at
    - Sort results by created_at descending (most recent first)
    - Include hasMore indicator if result set exceeds limit
    - Handle empty results with empty array and descriptive message
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12_

  - [ ]* 11.2 Write property test for status filtering
    - **Property 13: Payment Status Filtering Correctness**
    - **Validates: Requirements 7.6, 7.7**

  - [ ]* 11.3 Write property test for result ordering
    - **Property 14: Result Ordering Correctness (Recent Payments)**
    - **Validates: Requirements 7.8**

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement MCP server initialization and tool registration
  - [x] 13.1 Create server module (`src/server.ts`)
    - Load and validate environment configuration using loadEnv()
    - Initialize MCP Server instance with name "commerce-admin-mcp" and version "0.1.0"
    - Register ListToolsRequestSchema handler that exposes all 6 admin tools with descriptions and input schemas
    - Register CallToolRequestSchema handler that routes requests to appropriate tool functions
    - Handle top-level errors and format error responses
    - Log all tool invocations to stderr with tool name, duration, success/failure
    - Never log JSON responses to stderr (only to stdout via MCP protocol)
    - _Requirements: 1.1, 1.6, 1.7, 1.8, 1.9, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1_

  - [ ]* 13.2 Write property test for tool registry completeness
    - **Property 15: Tool Registry Completeness**
    - **Validates: Requirements 1.8, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1**

  - [x] 13.3 Create entry point (`src/index.ts`)
    - Add shebang for direct execution: `#!/usr/bin/env node`
    - Initialize StdioServerTransport
    - Connect server to transport
    - Log startup message to stderr
    - Handle fatal errors and exit with code 1
    - _Requirements: 1.9_

- [x] 14. Configure MCP integration with Kiro
  - [x] 14.1 Update MCP configuration file (`.kiro/settings/mcp.json`)
    - Add "commerce-admin-mcp" entry with command "node" and args ["./tools/mcp/commerce-admin/dist/index.js"]
    - Set disabled to false
    - Configure environment variables: AWS_REGION, DYNAMODB_TABLE_NAME, AWS_PROFILE, S3_DOC_BUCKET
    - Mark read-only admin tools as alwaysAllow where appropriate for safe auto-approval
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 15. Create documentation
  - [x] 15.1 Create README.md in tools/mcp/commerce-admin/
    - Document all 6 available tools with parameter descriptions and example usage
    - Document required environment variables and AWS configuration
    - Provide installation instructions (npm install, build steps)
    - Document how to test locally with MCP inspector
    - Document DynamoDB table schema assumptions (PK/SK patterns)
    - Include troubleshooting guidance for AWS credential errors and missing environment variables
    - Clarify that all tools are read-only and no mutation operations are supported in v1
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

- [x] 16. Final checkpoint - Ensure all tests pass and build succeeds
  - Run `npm run build` to compile TypeScript
  - Run `npm run test` to execute all unit and property tests
  - Verify compiled output is executable via `node ./tools/mcp/commerce-admin/dist/index.js`
  - Test server startup with valid environment configuration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties across all inputs
- Unit tests validate specific examples and edge cases
- The server follows the established pattern from commerce-ops-mcp and commerce-catalog-mcp for consistency
- TypeScript provides type safety and better developer experience
- All tools are read-only, ensuring safe AI assistant usage
- DynamoDB schema assumptions must be validated during implementation (PK/SK patterns, GSI names, field names)
