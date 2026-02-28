# Requirements Document

## Introduction

The commerce-admin-mcp-server is a Model Context Protocol (MCP) server that provides read-only access to administrative data from the VyaparGyan commerce platform. It enables AI assistants like Kiro to query seller approvals, disputes, audit logs, and payment records stored in DynamoDB, facilitating platform moderation, compliance monitoring, and administrative support tasks.

## Glossary

- **MCP_Server**: The Model Context Protocol server implementation that exposes admin tools to AI assistants
- **DynamoDB_Client**: AWS SDK v3 DocumentClient for querying the CommerceCore-dev DynamoDB table
- **Tool**: An MCP-exposed function that AI assistants can invoke with validated parameters
- **Seller_Profile**: A DynamoDB item containing seller details including seller_id, business information, verification status, and contact details
- **Approval_Record**: A DynamoDB item representing a pending seller approval request with verification documents and review state
- **Dispute_Record**: A DynamoDB item containing dispute details including dispute_id, order_id, parties involved, status, and resolution history
- **Audit_Record**: A DynamoDB item containing audit trail entries for resource changes including resource_type, resource_id, action, actor, and timestamp
- **Payment_Record**: A DynamoDB item containing payment transaction details including payment_id, order_id, amount, status, and provider information
- **Environment_Validator**: Zod schema validator for required environment variables

## Requirements

### Requirement 1: MCP Server Initialization

**User Story:** As a Kiro AI assistant, I want the MCP server to initialize with proper configuration, so that I can reliably access commerce administrative data.

#### Acceptance Criteria

1. WHEN the MCP_Server starts, THE MCP_Server SHALL load environment variables from process.env
2. THE Environment_Validator SHALL validate that AWS_REGION is set to "ap-south-1"
3. THE Environment_Validator SHALL validate that DYNAMODB_TABLE_NAME is set to "CommerceCore-dev"
4. THE Environment_Validator SHALL validate that AWS_PROFILE is set to "kiro-mcp"
5. WHERE S3_DOC_BUCKET is provided, THE Environment_Validator SHALL validate it as a non-empty string
6. IF required environment variables are missing, THEN THE MCP_Server SHALL terminate with a descriptive error message
7. WHEN environment validation succeeds, THE MCP_Server SHALL initialize the DynamoDB_Client with the validated configuration
8. THE MCP_Server SHALL register all available admin tools with the MCP SDK
9. THE MCP_Server SHALL expose the server via stdio transport for Kiro integration

### Requirement 2: Pending Seller Approvals Listing Tool

**User Story:** As a Kiro AI assistant, I want to list pending seller approval requests, so that I can help admins review sellers awaiting verification.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "list_pending_seller_approvals"
2. THE list_pending_seller_approvals Tool SHALL accept an optional number parameter "limit" with a default value of 20
3. THE Tool SHALL validate that limit does not exceed 100
4. WHEN list_pending_seller_approvals is invoked, THE Tool SHALL query DynamoDB_Client for Approval_Record items with pending review status
5. THE Tool SHALL return seller summaries including seller_id, business_name, owner_name, contact_phone, contact_email, verification_status, created_at, and review_state
6. THE Tool SHALL sort results by created_at in ascending order to prioritize oldest pending approvals
7. WHERE the result set exceeds the limit, THE Tool SHALL include a hasMore indicator in the response
8. WHEN no pending approvals exist, THE Tool SHALL return an empty array with a message indicating no pending approvals were found
9. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
10. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 3: Seller Profile Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve detailed seller profile information, so that I can help admins review seller verification documents and business details.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_seller_profile"
2. THE get_seller_profile Tool SHALL accept a required string parameter "sellerId"
3. WHEN get_seller_profile is invoked with a valid sellerId, THE Tool SHALL query DynamoDB_Client using PK=SELLER#{sellerId} and SK=PROFILE
4. WHEN the Seller_Profile exists, THE Tool SHALL return seller data including seller_id, business_name, business_type, owner_name, contact_phone, contact_email, verification_status, document_keys, created_at, updated_at, and approved_at
5. WHERE document_keys are present, THE Tool SHALL include S3 document references without generating presigned URLs
6. WHEN the Seller_Profile does not exist, THE Tool SHALL return an error message indicating the seller was not found
7. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
8. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 4: Open Disputes Listing Tool

**User Story:** As a Kiro AI assistant, I want to list open disputes, so that I can help admins monitor and prioritize dispute resolution.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "list_open_disputes"
2. THE list_open_disputes Tool SHALL accept an optional number parameter "limit" with a default value of 20
3. THE Tool SHALL validate that limit does not exceed 100
4. WHEN list_open_disputes is invoked, THE Tool SHALL query DynamoDB_Client for Dispute_Record items with open status
5. THE Tool SHALL return dispute summaries including dispute_id, order_id, seller_id, customer_id, status, reason, created_at, and last_updated_at
6. THE Tool SHALL sort results by created_at in ascending order to prioritize oldest open disputes
7. WHERE the result set exceeds the limit, THE Tool SHALL include a hasMore indicator in the response
8. WHEN no open disputes exist, THE Tool SHALL return an empty array with a message indicating no open disputes were found
9. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
10. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 5: Dispute Details Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve detailed dispute information, so that I can help admins understand dispute context and resolution history.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_dispute"
2. THE get_dispute Tool SHALL accept an optional string parameter "orderId"
3. THE get_dispute Tool SHALL accept an optional string parameter "disputeId"
4. THE Tool SHALL validate that at least one of orderId or disputeId is provided
5. WHEN get_dispute is invoked with a disputeId, THE Tool SHALL query DynamoDB_Client for the Dispute_Record with matching dispute_id
6. WHEN get_dispute is invoked with an orderId, THE Tool SHALL query DynamoDB_Client for Dispute_Record items associated with the order_id
7. WHEN the Dispute_Record exists, THE Tool SHALL return dispute data including dispute_id, order_id, seller_id, customer_id, status, reason, description, status_history, linked_payment_id, created_at, updated_at, and resolved_at
8. WHEN the Dispute_Record does not exist, THE Tool SHALL return an error message indicating the dispute was not found
9. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
10. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 6: Audit Timeline Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve audit timeline for a specific resource, so that I can help admins track changes and investigate compliance issues.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_audit_timeline"
2. THE get_audit_timeline Tool SHALL accept a required string parameter "resourceType"
3. THE get_audit_timeline Tool SHALL accept a required string parameter "resourceId"
4. WHEN get_audit_timeline is invoked, THE Tool SHALL query DynamoDB_Client using PK=RESOURCE#{resourceType}#{resourceId} and SK prefix=AUDIT#
5. THE Tool SHALL return Audit_Record items including audit_id, resource_type, resource_id, action, actor_id, actor_type, changes, timestamp, and metadata
6. THE Tool SHALL sort results by timestamp in descending order to show most recent changes first
7. THE Tool SHALL limit results to a maximum of 100 audit entries
8. WHERE the result set exceeds 100 entries, THE Tool SHALL include a truncated indicator in the response
9. WHEN no audit records exist for the resource, THE Tool SHALL return an empty array with a message indicating no audit history was found
10. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
11. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 7: Recent Payments Listing Tool

**User Story:** As a Kiro AI assistant, I want to list recent payment transactions with optional status filtering, so that I can help admins monitor payment activity and investigate payment issues.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "list_recent_payments"
2. THE list_recent_payments Tool SHALL accept an optional string parameter "status" for filtering by payment status
3. THE list_recent_payments Tool SHALL accept an optional number parameter "limit" with a default value of 20
4. THE Tool SHALL validate that limit does not exceed 100
5. WHEN list_recent_payments is invoked without status, THE Tool SHALL query DynamoDB_Client for all Payment_Record items
6. WHEN list_recent_payments is invoked with status, THE Tool SHALL filter Payment_Record items matching the specified status
7. THE Tool SHALL return payment summaries including payment_id, order_id, amount, currency, status, provider, gateway_payment_id, created_at, and updated_at
8. THE Tool SHALL sort results by created_at in descending order to show most recent payments first
9. WHERE the result set exceeds the limit, THE Tool SHALL include a hasMore indicator in the response
10. WHEN no payments match the criteria, THE Tool SHALL return an empty array with a message indicating no payments were found
11. IF the DynamoDB query fails, THEN THE Tool SHALL log the error to stderr and return a descriptive error message
12. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 8: TypeScript Build Configuration

**User Story:** As a developer, I want the MCP server to build to a single JavaScript file, so that Kiro can launch it with a simple node command.

#### Acceptance Criteria

1. THE MCP_Server project SHALL use TypeScript with strict type checking enabled
2. THE MCP_Server project SHALL configure tsconfig.json to output compiled JavaScript to tools/mcp/commerce-admin/dist/index.js
3. WHEN the build command is executed, THE TypeScript compiler SHALL compile all source files from tools/mcp/commerce-admin/src/
4. THE compiled output SHALL be executable via "node ./tools/mcp/commerce-admin/dist/index.js"
5. THE package.json SHALL define a "build" script that invokes the TypeScript compiler
6. THE package.json SHALL define dependencies for @modelcontextprotocol/sdk, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, and zod
7. THE package.json SHALL specify Node.js version 20 as the required engine
8. THE package.json SHALL set type to "module" for ES module support

### Requirement 9: MCP Configuration Integration

**User Story:** As a Kiro user, I want the commerce-admin-mcp server to be configured in Kiro's MCP settings, so that Kiro can automatically discover and use the server.

#### Acceptance Criteria

1. THE .kiro/settings/mcp.json file SHALL contain a configuration entry for "commerce-admin-mcp"
2. THE commerce-admin-mcp configuration SHALL specify the command "node" with argument "./tools/mcp/commerce-admin/dist/index.js"
3. THE commerce-admin-mcp configuration SHALL be enabled by default
4. THE commerce-admin-mcp configuration SHALL include environment variables for AWS_REGION, DYNAMODB_TABLE_NAME, AWS_PROFILE, and S3_DOC_BUCKET
5. WHERE read-only admin tools are safe for auto-approval, THE commerce-admin-mcp configuration SHALL mark eligible tools as autoApprove
6. WHEN Kiro loads MCP settings, THE Kiro client SHALL be able to connect to the commerce-admin-mcp server using the configured command

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
8. THE Tool SHALL not expose raw stack traces to the MCP client

### Requirement 11: Documentation

**User Story:** As a developer, I want comprehensive documentation for the MCP server, so that I can understand how to install, configure, and use it.

#### Acceptance Criteria

1. THE MCP_Server project SHALL include a README.md file in tools/mcp/commerce-admin/
2. THE README.md SHALL document all available tools with parameter descriptions and example usage
3. THE README.md SHALL document required environment variables and AWS configuration
4. THE README.md SHALL provide installation instructions including npm install and build steps
5. THE README.md SHALL document how to test the server locally with the MCP inspector
6. THE README.md SHALL document the DynamoDB table schema assumptions for each tool including PK/SK patterns
7. THE README.md SHALL include troubleshooting guidance for common issues such as AWS credential errors and missing environment variables
8. THE README.md SHALL clarify that all tools are read-only and no mutation operations are supported in v1
