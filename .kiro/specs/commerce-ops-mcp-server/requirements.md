# Requirements Document

## Introduction

The commerce-ops-mcp-server is a Model Context Protocol (MCP) server that provides read-only access to operational data from the VyaparGyan commerce platform. It enables AI assistants like Kiro to query orders, payments, inventory, WhatsApp sessions, and logs stored in DynamoDB, facilitating debugging, monitoring, and operational support tasks.

## Glossary

- **MCP_Server**: The Model Context Protocol server implementation that exposes tools to AI assistants
- **DynamoDB_Client**: AWS SDK v3 client for querying the CommerceCore-dev DynamoDB table
- **Tool**: An MCP-exposed function that AI assistants can invoke with validated parameters
- **Order_Record**: A DynamoDB item containing order details including order_id, customer information, items, and status
- **Payment_Record**: A DynamoDB item containing payment details including order_id, payment gateway data, and transaction status
- **Inventory_Record**: A DynamoDB item containing product inventory levels including product_id and available quantity
- **WhatsApp_Session**: A DynamoDB item containing WhatsApp conversation state including session_id or phone number
- **Log_Entry**: A DynamoDB item containing structured log data with timestamp, level, and message
- **Environment_Validator**: Zod schema validator for required environment variables

## Requirements

### Requirement 1: MCP Server Initialization

**User Story:** As a Kiro AI assistant, I want the MCP server to initialize with proper configuration, so that I can reliably access commerce operational data.

#### Acceptance Criteria

1. WHEN the MCP_Server starts, THE MCP_Server SHALL load environment variables from process.env
2. THE Environment_Validator SHALL validate that AWS_REGION is set to "ap-south-1"
3. THE Environment_Validator SHALL validate that DYNAMODB_TABLE_NAME is set to "CommerceCore-dev"
4. THE Environment_Validator SHALL validate that AWS_PROFILE is set to "kiro-mcp"
5. IF required environment variables are missing, THEN THE MCP_Server SHALL terminate with a descriptive error message
6. WHEN environment validation succeeds, THE MCP_Server SHALL initialize the DynamoDB_Client with the validated configuration
7. THE MCP_Server SHALL register all available tools with the MCP SDK
8. THE MCP_Server SHALL expose the server via stdio transport for Kiro integration

### Requirement 2: Order Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve order details by order ID, so that I can help users debug order issues and check order status.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_order"
2. THE get_order Tool SHALL accept a required string parameter "orderId"
3. WHEN get_order is invoked with a valid orderId, THE Tool SHALL query DynamoDB_Client for the Order_Record with matching order_id
4. WHEN the Order_Record exists, THE Tool SHALL return the complete order data including customer information, items, status, and timestamps
5. WHEN the Order_Record does not exist, THE Tool SHALL return an error message indicating the order was not found
6. IF the DynamoDB query fails, THEN THE Tool SHALL return a descriptive error message with the failure reason
7. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 3: Payment Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve payment details by order ID, so that I can help users verify payment status and troubleshoot payment issues.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_payment"
2. THE get_payment Tool SHALL accept a required string parameter "orderId"
3. WHEN get_payment is invoked with a valid orderId, THE Tool SHALL query DynamoDB_Client for the Payment_Record associated with the order_id
4. WHEN the Payment_Record exists, THE Tool SHALL return payment data including gateway details, transaction status, amount, and timestamps
5. WHEN the Payment_Record does not exist, THE Tool SHALL return an error message indicating no payment was found for the order
6. IF the DynamoDB query fails, THEN THE Tool SHALL return a descriptive error message with the failure reason
7. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 4: Inventory Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve inventory levels by product ID, so that I can help users check stock availability and diagnose inventory issues.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_inventory"
2. THE get_inventory Tool SHALL accept a required string parameter "productId"
3. WHEN get_inventory is invoked with a valid productId, THE Tool SHALL query DynamoDB_Client for the Inventory_Record with matching product_id
4. WHEN the Inventory_Record exists, THE Tool SHALL return inventory data including available quantity, reserved quantity, and last updated timestamp
5. WHEN the Inventory_Record does not exist, THE Tool SHALL return an error message indicating the product was not found
6. IF the DynamoDB query fails, THEN THE Tool SHALL return a descriptive error message with the failure reason
7. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 5: WhatsApp Session Retrieval Tool

**User Story:** As a Kiro AI assistant, I want to retrieve WhatsApp session state by session ID or phone number, so that I can help users debug conversation issues and understand customer interaction context.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "get_whatsapp_session"
2. THE get_whatsapp_session Tool SHALL accept a required string parameter "identifier" that can be either a session_id or phone number
3. WHEN get_whatsapp_session is invoked with a session_id, THE Tool SHALL query DynamoDB_Client for the WhatsApp_Session with matching session_id
4. WHEN get_whatsapp_session is invoked with a phone number, THE Tool SHALL query DynamoDB_Client for the WhatsApp_Session with matching phone number
5. WHEN the WhatsApp_Session exists, THE Tool SHALL return session data including conversation state, last message timestamp, and customer context
6. WHEN the WhatsApp_Session does not exist, THE Tool SHALL return an error message indicating the session was not found
7. IF the DynamoDB query fails, THEN THE Tool SHALL return a descriptive error message with the failure reason
8. THE Tool SHALL complete queries within 5 seconds under normal conditions

### Requirement 6: Log Search Tool

**User Story:** As a Kiro AI assistant, I want to search platform logs by query string and time range, so that I can help users troubleshoot issues and investigate system behavior.

#### Acceptance Criteria

1. THE MCP_Server SHALL expose a tool named "search_logs"
2. THE search_logs Tool SHALL accept a required string parameter "query" for text matching
3. THE search_logs Tool SHALL accept an optional string parameter "startTime" in ISO 8601 format
4. THE search_logs Tool SHALL accept an optional string parameter "endTime" in ISO 8601 format
5. WHEN search_logs is invoked with only a query, THE Tool SHALL search all Log_Entry items containing the query text
6. WHEN search_logs is invoked with startTime, THE Tool SHALL filter Log_Entry items with timestamps greater than or equal to startTime
7. WHEN search_logs is invoked with endTime, THE Tool SHALL filter Log_Entry items with timestamps less than or equal to endTime
8. THE Tool SHALL return matching Log_Entry items sorted by timestamp in descending order
9. THE Tool SHALL limit results to a maximum of 100 log entries
10. WHEN no logs match the search criteria, THE Tool SHALL return an empty result set with a message indicating no logs were found
11. IF the DynamoDB query fails, THEN THE Tool SHALL return a descriptive error message with the failure reason
12. THE Tool SHALL complete searches within 10 seconds under normal conditions

### Requirement 7: TypeScript Build Configuration

**User Story:** As a developer, I want the MCP server to build to a single JavaScript file, so that Kiro can launch it with a simple node command.

#### Acceptance Criteria

1. THE MCP_Server project SHALL use TypeScript with strict type checking enabled
2. THE MCP_Server project SHALL configure tsconfig.json to output compiled JavaScript to tools/mcp/commerce-ops/dist/index.js
3. WHEN the build command is executed, THE TypeScript compiler SHALL compile all source files from tools/mcp/commerce-ops/src/
4. THE compiled output SHALL be executable via "node ./tools/mcp/commerce-ops/dist/index.js"
5. THE package.json SHALL define a "build" script that invokes the TypeScript compiler
6. THE package.json SHALL define dependencies for @modelcontextprotocol/sdk, @aws-sdk/client-dynamodb, @aws-sdk/lib-dynamodb, and zod
7. THE package.json SHALL specify Node.js version 20 as the required engine

### Requirement 8: MCP Configuration Integration

**User Story:** As a Kiro user, I want the commerce-ops-mcp server to be configured in Kiro's MCP settings, so that Kiro can automatically discover and use the server.

#### Acceptance Criteria

1. THE .kiro/settings/mcp.json file SHALL contain a configuration entry for "commerce-ops-mcp"
2. THE commerce-ops-mcp configuration SHALL specify the command "node" with argument "./tools/mcp/commerce-ops/dist/index.js"
3. THE commerce-ops-mcp configuration SHALL be enabled by default
4. THE commerce-ops-mcp configuration SHALL include environment variables for AWS_REGION, DYNAMODB_TABLE_NAME, and AWS_PROFILE
5. WHEN Kiro loads MCP settings, THE Kiro client SHALL be able to connect to the commerce-ops-mcp server using the configured command

### Requirement 9: Error Handling and Validation

**User Story:** As a Kiro AI assistant, I want clear error messages when tool invocations fail, so that I can provide helpful feedback to users.

#### Acceptance Criteria

1. WHEN a Tool receives invalid parameters, THE Tool SHALL return a validation error message describing the parameter requirements
2. WHEN a DynamoDB query times out, THE Tool SHALL return an error message indicating a timeout occurred
3. WHEN AWS credentials are invalid or missing, THE Tool SHALL return an error message indicating authentication failure
4. WHEN a DynamoDB table does not exist, THE Tool SHALL return an error message indicating the table was not found
5. THE MCP_Server SHALL log all errors with structured context including tool name, parameters, and error details
6. THE MCP_Server SHALL not expose sensitive data such as AWS credentials or internal system paths in error messages

### Requirement 10: Documentation

**User Story:** As a developer, I want comprehensive documentation for the MCP server, so that I can understand how to install, configure, and use it.

#### Acceptance Criteria

1. THE MCP_Server project SHALL include a README.md file in tools/mcp/commerce-ops/
2. THE README.md SHALL document all available tools with parameter descriptions and example usage
3. THE README.md SHALL document required environment variables and AWS configuration
4. THE README.md SHALL provide installation instructions including npm install and build steps
5. THE README.md SHALL document how to test the server locally with the MCP inspector
6. THE README.md SHALL document the DynamoDB table schema assumptions for each tool
7. THE README.md SHALL include troubleshooting guidance for common issues such as AWS credential errors
