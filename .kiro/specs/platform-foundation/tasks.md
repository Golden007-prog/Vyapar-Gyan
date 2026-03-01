# Implementation Plan: Platform Foundation

## Overview

This plan implements the AWS serverless foundation for VyaparGyan, migrating from the legacy FastAPI/Supabase stack to a modern AWS-native architecture. The implementation follows a mono-repo structure with CDK infrastructure, Lambda backend services, and comprehensive testing.

The approach prioritizes incremental development with early validation through checkpoints. Core infrastructure is established first, followed by shared utilities, then domain-specific handlers and services, with testing integrated throughout.

## Tasks

- [ ] 1. Repository setup and project scaffolding
  - [x] 1.1 Initialize mono-repo with pnpm workspaces
    - Create root `package.json` with workspace configuration
    - Create `pnpm-workspace.yaml` defining workspace packages
    - Set up `.gitignore` for Node.js, TypeScript, AWS, and IDE files
    - Create root `README.md` with project overview and setup instructions
    - _Requirements: Repository structure, package manager setup_

  - [x] 1.2 Set up TypeScript configuration
    - Create root `tsconfig.json` with base TypeScript configuration
    - Create workspace-specific `tsconfig.json` files extending base config
    - Configure path aliases for clean imports
    - Set up strict type checking and modern ES target
    - _Requirements: TypeScript configuration_

  - [x] 1.3 Create workspace directory structure
    - Create `infra/cdk/` directory for infrastructure code
    - Create `services/api/` directory for Lambda backend
    - Create `apps/web/` directory for future web applications
    - Create `packages/shared/` directory for shared code
    - _Requirements: Repository structure_

- [ ] 2. CDK infrastructure foundation
  - [x] 2.1 Initialize CDK application
    - Set up `infra/cdk/package.json` with CDK dependencies
    - Create `infra/cdk/bin/app.ts` as CDK entry point
    - Create `infra/cdk/cdk.json` with CDK configuration
    - Configure CDK context for environment-specific settings
    - _Requirements: 2.1, 2.2, 6.1_

  - [x] 2.2 Create environment configuration system
    - Create `infra/cdk/lib/config/environment.ts` with config types
    - Create `infra/cdk/lib/config/dev.ts` with dev environment config
    - Create `infra/cdk/lib/config/staging.ts` with staging config
    - Create `infra/cdk/lib/config/prod.ts` with production config
    - _Requirements: 2.5, 2.6, 6.3_

  - [ ]* 2.3 Write property test for environment isolation
    - **Property 1: Environment Isolation Through Naming**
    - **Validates: Requirements 2.5, 2.6**

  - [ ]* 2.4 Write property test for stack parameterization
    - **Property 4: Stack Parameterization**
    - **Validates: Requirements 6.3**

- [ ] 3. Database infrastructure (DynamoDB)
  - [x] 3.1 Create DatabaseStack with single-table design
    - Create `infra/cdk/lib/stacks/database-stack.ts`
    - Define DynamoDB table with PK/SK and three GSIs
    - Configure billing mode (on-demand for dev/staging, provisioned for prod)
    - Set up point-in-time recovery (disabled for dev, enabled for prod)
    - Configure table encryption with AWS managed keys
    - Add environment-specific naming with tags
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 3.2 Write unit tests for DatabaseStack
    - Test table creation with correct configuration
    - Test GSI configuration
    - Test environment-specific settings (billing, PITR)
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ]* 3.3 Write property test for environment-specific naming
    - **Property 1: Environment Isolation Through Naming**
    - **Validates: Requirements 2.5, 2.6**

- [ ] 4. Storage infrastructure (S3)
  - [x] 4.1 Create StorageStack with S3 buckets
    - Create `infra/cdk/lib/stacks/storage-stack.ts`
    - Create product images bucket with lifecycle policies
    - Create documents bucket with versioning enabled
    - Create logs bucket with lifecycle policies
    - Configure bucket encryption with AWS managed keys
    - Block public access by default
    - Add environment-specific naming with tags
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 11.1, 11.2_

  - [ ]* 4.2 Write unit tests for StorageStack
    - Test bucket creation with correct configuration
    - Test public access block settings
    - Test encryption configuration
    - _Requirements: 4.1, 11.2_

  - [ ]* 4.3 Write property test for S3 public access block
    - **Property 15: S3 Bucket Public Access Block**
    - **Validates: Requirements 11.2**

- [ ] 5. Authentication infrastructure (Cognito)
  - [x] 5.1 Create AuthStack with Cognito User Pools
    - Create `infra/cdk/lib/stacks/auth-stack.ts`
    - Create Cognito User Pool with email and phone attributes
    - Add custom attributes for role, userId, and status
    - Configure password policy and MFA settings
    - Create user groups (Admins, Sellers, Customers)
    - Create app clients for web-admin, web-seller, and api-service
    - Add environment-specific naming with tags
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 5.2 Write unit tests for AuthStack
    - Test User Pool creation with correct attributes
    - Test user groups configuration
    - Test app clients configuration
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ]* 5.3 Write property test for Cognito environment isolation
    - **Property 18: Cognito User Pool Environment Isolation**
    - **Validates: Requirements 13.1**

- [ ] 6. Checkpoint - Verify infrastructure stacks
  - Ensure all CDK stacks synthesize without errors
  - Run infrastructure unit tests
  - Ask the user if questions arise

- [ ] 7. Shared utilities and middleware
  - [x] 7.1 Create configuration loader utility
    - Create `services/api/src/utils/config.ts`
    - Implement config schema with Zod validation
    - Load configuration from environment variables and AWS services
    - Implement caching for configuration values
    - Add support for SSM Parameter Store and Secrets Manager
    - _Requirements: 9.1, 9.2, 9.3, 9.6, 9.7_

  - [x] 7.2 Create structured logging utility
    - Create `services/api/src/utils/logger.ts`
    - Implement JSON structured logging with Winston or Pino
    - Add request ID context propagation
    - Include timestamp, level, message, and context fields
    - _Requirements: 7.5, 8.1, 8.2, 8.3_

  - [~] 7.3 Create response formatter utilities
    - Create `services/api/src/utils/response.ts`
    - Implement success response formatter
    - Implement error response formatter with consistent structure
    - Add helper functions for common status codes
    - _Requirements: 7.3, 7.4_

  - [~] 7.4 Create custom error classes
    - Create `services/api/src/utils/errors.ts`
    - Define error hierarchy (ValidationError, UnauthorizedError, etc.)
    - Include error codes and HTTP status mappings
    - _Requirements: 7.4_

  - [ ]* 7.5 Write property test for structured logging
    - **Property 7: Structured Logging with Request IDs**
    - **Validates: Requirements 7.5, 8.1**

  - [ ]* 7.6 Write property test for request logging completeness
    - **Property 8: Request Logging Completeness**
    - **Validates: Requirements 8.2**

  - [ ]* 7.7 Write property test for error logging completeness
    - **Property 9: Error Logging Completeness**
    - **Validates: Requirements 8.3**

  - [ ]* 7.8 Write property test for configuration validation
    - **Property 14: Configuration Validation**
    - **Validates: Requirements 9.6, 9.7**

- [ ] 8. Middleware system
  - [~] 8.1 Create middleware framework
    - Create `services/api/src/middleware/index.ts` with middleware types
    - Implement middleware chain executor
    - Add support for async middleware functions
    - _Requirements: 7.1, 7.2_

  - [~] 8.2 Implement authentication middleware
    - Create `services/api/src/middleware/auth.ts`
    - Verify JWT tokens from Cognito
    - Extract user context from token claims
    - Add user to request context
    - _Requirements: 12.1, 12.2, 12.3_

  - [~] 8.3 Implement error handler middleware
    - Create `services/api/src/middleware/error-handler.ts`
    - Catch and format all errors consistently
    - Map error types to HTTP status codes
    - Log errors with full context
    - _Requirements: 7.4_

  - [~] 8.4 Implement request logger middleware
    - Create `services/api/src/middleware/logger.ts`
    - Log incoming requests with method, path, and headers
    - Log outgoing responses with status and duration
    - Include request ID in all logs
    - _Requirements: 8.2_

  - [~] 8.5 Implement validator middleware
    - Create `services/api/src/middleware/validator.ts`
    - Validate request body against Zod schemas
    - Return 400 errors for validation failures
    - _Requirements: 7.3_

  - [ ]* 8.6 Write property test for error handling consistency
    - **Property 6: Error Handling Consistency**
    - **Validates: Requirements 7.4**

  - [ ]* 8.7 Write unit tests for middleware
    - Test auth middleware with valid and invalid tokens
    - Test error handler with different error types
    - Test validator with valid and invalid inputs
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 9. Repository layer (DynamoDB access)
  - [~] 9.1 Create base repository class
    - Create `services/api/src/repositories/base-repository.ts`
    - Implement get, put, query, scan, and delete operations
    - Add error handling for DynamoDB errors
    - Include retry logic with exponential backoff
    - _Requirements: 3.6, 3.7_

  - [~] 9.2 Create user repository
    - Create `services/api/src/repositories/user-repository.ts`
    - Implement getUserById, getUserByEmail, listUsersByRole
    - Implement createUser, updateUser, deleteUser
    - Use GSI1 for role-based queries, GSI2 for email lookups
    - _Requirements: 3.6, 3.7_

  - [~] 9.3 Create product repository
    - Create `services/api/src/repositories/product-repository.ts`
    - Implement getProductById, listProductsBySeller, listProductsByCategory
    - Implement createProduct, updateProduct, deleteProduct
    - Use GSI1 for seller queries, GSI2 for category queries
    - _Requirements: 3.6, 3.7_

  - [~] 9.4 Create order repository
    - Create `services/api/src/repositories/order-repository.ts`
    - Implement getOrderById, listOrdersByCustomer, listOrdersBySeller
    - Implement createOrder, updateOrderStatus, getOrderItems
    - Use GSI1 for customer queries, GSI2 for seller queries
    - _Requirements: 3.6, 3.7_

  - [~] 9.5 Create session repository
    - Create `services/api/src/repositories/session-repository.ts`
    - Implement getSessionByPhone, createSession, updateSession
    - Configure TTL for automatic session expiration
    - _Requirements: 3.6, 3.7_

  - [ ]* 9.6 Write integration tests for repositories
    - Set up DynamoDB Local for testing
    - Test CRUD operations for each repository
    - Test GSI queries
    - Test error handling and retries
    - _Requirements: 3.6, 3.7_

- [ ] 10. Checkpoint - Verify shared utilities and repositories
  - Ensure all utilities and repositories compile without errors
  - Run unit tests for middleware and utilities
  - Ask the user if questions arise

- [ ] 11. Integration clients (external services)
  - [~] 11.1 Create WhatsApp client
    - Create `services/api/src/integrations/whatsapp-client.ts`
    - Implement sendMessage, sendTemplate, uploadMedia methods
    - Add retry logic with exponential backoff
    - Implement circuit breaker pattern
    - Handle rate limiting (429 errors)
    - _Requirements: 14.1, 14.2, 14.3_

  - [~] 11.2 Create Razorpay client
    - Create `services/api/src/integrations/razorpay-client.ts`
    - Implement createOrder, verifyPayment, refundPayment methods
    - Add webhook signature verification
    - Handle API errors and retries
    - _Requirements: 14.4, 14.5_

  - [~] 11.3 Create Gemini client
    - Create `services/api/src/integrations/gemini-client.ts`
    - Implement transcribeAudio, analyzeImage, translateText methods
    - Add retry logic for transient failures
    - Handle rate limiting
    - _Requirements: 14.6_

  - [ ]* 11.4 Write unit tests for integration clients
    - Mock external API responses
    - Test success and error scenarios
    - Test retry logic and circuit breaker
    - Test rate limiting handling
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [ ] 12. Service layer (business logic)
  - [~] 12.1 Create catalog service
    - Create `services/api/src/services/catalog-service.ts`
    - Implement getProduct, listProducts, searchProducts
    - Implement createProduct, updateProduct, deleteProduct
    - Add inventory management methods
    - Use product repository for data access
    - _Requirements: Business logic for catalog operations_

  - [~] 12.2 Create order service
    - Create `services/api/src/services/order-service.ts`
    - Implement createOrder, getOrder, updateOrderStatus
    - Implement listOrdersByCustomer, listOrdersBySeller
    - Add order validation and business rules
    - Use order repository for data access
    - Publish order events to EventBridge
    - _Requirements: Business logic for order operations_

  - [~] 12.3 Create WhatsApp service
    - Create `services/api/src/services/whatsapp-service.ts`
    - Implement message processing logic
    - Implement session state management
    - Add conversational flow handlers (browsing, cart, checkout)
    - Use session repository and WhatsApp client
    - _Requirements: Business logic for WhatsApp interactions_

  - [~] 12.4 Create payment service
    - Create `services/api/src/services/payment-service.ts`
    - Implement createPayment, verifyPayment, handleWebhook
    - Add payment status tracking
    - Use Razorpay client for payment operations
    - Publish payment events to EventBridge
    - _Requirements: Business logic for payment operations_

  - [ ]* 12.5 Write unit tests for services
    - Mock repository and client dependencies
    - Test business logic and validation rules
    - Test error handling
    - Test event publishing
    - _Requirements: Service layer business logic_

- [ ] 13. Lambda handlers - Authentication
  - [~] 13.1 Create login handler
    - Create `services/api/src/handlers/auth/login.ts`
    - Validate email and password
    - Authenticate with Cognito
    - Return JWT tokens
    - Apply middleware chain (logger, error handler, validator)
    - _Requirements: 12.1, 12.2_

  - [~] 13.2 Create refresh token handler
    - Create `services/api/src/handlers/auth/refresh.ts`
    - Validate refresh token
    - Issue new access token
    - Apply middleware chain
    - _Requirements: 12.1, 12.2_

  - [~] 13.3 Create logout handler
    - Create `services/api/src/handlers/auth/logout.ts`
    - Invalidate tokens in Cognito
    - Apply middleware chain
    - _Requirements: 12.1, 12.2_

  - [ ]* 13.4 Write unit tests for auth handlers
    - Test successful authentication
    - Test invalid credentials
    - Test missing parameters
    - Test token refresh and logout
    - _Requirements: 12.1, 12.2_

- [ ] 14. Lambda handlers - Admin operations
  - [~] 14.1 Create approve seller handler
    - Create `services/api/src/handlers/admin/approve-seller.ts`
    - Validate admin role
    - Update seller status in user repository
    - Send notification to seller
    - Apply middleware chain (auth, logger, error handler)
    - _Requirements: Admin operations_

  - [~] 14.2 Create manage categories handler
    - Create `services/api/src/handlers/admin/manage-categories.ts`
    - Implement create, update, delete category operations
    - Validate admin role
    - Apply middleware chain
    - _Requirements: Admin operations_

  - [~] 14.3 Create resolve dispute handler
    - Create `services/api/src/handlers/admin/resolve-dispute.ts`
    - Implement dispute resolution logic
    - Update order status
    - Send notifications to involved parties
    - Apply middleware chain
    - _Requirements: Admin operations_

  - [ ]* 14.4 Write unit tests for admin handlers
    - Test admin authorization
    - Test seller approval workflow
    - Test category management
    - Test dispute resolution
    - _Requirements: Admin operations_

- [ ] 15. Lambda handlers - Seller operations
  - [~] 15.1 Create product management handlers
    - Create `services/api/src/handlers/seller/create-product.ts`
    - Create `services/api/src/handlers/seller/update-inventory.ts`
    - Validate seller role and ownership
    - Use catalog service for business logic
    - Apply middleware chain
    - _Requirements: Seller operations_

  - [~] 15.2 Create order listing handler
    - Create `services/api/src/handlers/seller/list-orders.ts`
    - List orders for authenticated seller
    - Support pagination and filtering
    - Use order service for business logic
    - Apply middleware chain
    - _Requirements: Seller operations_

  - [ ]* 15.3 Write unit tests for seller handlers
    - Test seller authorization
    - Test product creation and updates
    - Test inventory management
    - Test order listing
    - _Requirements: Seller operations_

- [ ] 16. Lambda handlers - Catalog and orders
  - [~] 16.1 Create catalog browsing handlers
    - Create `services/api/src/handlers/catalog/browse-products.ts`
    - Create `services/api/src/handlers/catalog/search-products.ts`
    - Support pagination and filtering
    - Use catalog service for business logic
    - Apply middleware chain (no auth required for browsing)
    - _Requirements: Catalog operations_

  - [~] 16.2 Create order management handlers
    - Create `services/api/src/handlers/orders/create-order.ts`
    - Create `services/api/src/handlers/orders/get-order.ts`
    - Create `services/api/src/handlers/orders/update-status.ts`
    - Validate customer/seller authorization
    - Use order service for business logic
    - Apply middleware chain
    - _Requirements: Order operations_

  - [ ]* 16.3 Write unit tests for catalog and order handlers
    - Test product browsing and search
    - Test order creation and retrieval
    - Test order status updates
    - Test authorization rules
    - _Requirements: Catalog and order operations_

- [ ] 17. Lambda handlers - WhatsApp and payments
  - [~] 17.1 Create WhatsApp webhook handler
    - Create `services/api/src/handlers/whatsapp/webhook.ts`
    - Verify webhook signature
    - Parse incoming messages
    - Use WhatsApp service for message processing
    - Apply middleware chain
    - _Requirements: 14.1, 14.2_

  - [~] 17.2 Create payment webhook handler
    - Create `services/api/src/handlers/payments/webhook.ts`
    - Verify Razorpay webhook signature
    - Process payment status updates
    - Use payment service for business logic
    - Apply middleware chain
    - _Requirements: 14.4, 14.5_

  - [ ]* 17.3 Write unit tests for webhook handlers
    - Test webhook signature verification
    - Test message processing
    - Test payment status updates
    - Test invalid signatures
    - _Requirements: 14.1, 14.2, 14.4, 14.5_

- [ ] 18. Checkpoint - Verify Lambda handlers
  - Ensure all handlers compile without errors
  - Run unit tests for all handlers
  - Ask the user if questions arise

- [ ] 19. API Gateway and Lambda integration (ApiStack)
  - [~] 19.1 Create reusable Lambda construct
    - Create `infra/cdk/lib/constructs/lambda-function.ts`
    - Configure Node.js 20 runtime and TypeScript bundling
    - Set up environment variables and IAM permissions
    - Configure CloudWatch log groups with retention
    - Add environment-specific naming and tags
    - _Requirements: 1.1, 1.2, 1.3, 8.4, 8.5_

  - [~] 19.2 Create ApiStack with HTTP API
    - Create `infra/cdk/lib/stacks/api-stack.ts`
    - Create HTTP API Gateway with CORS configuration
    - Create Cognito authorizer for protected routes
    - Define all API routes and Lambda integrations
    - Configure route-specific authorization
    - Add environment-specific naming and tags
    - _Requirements: 1.4, 1.5, 12.4, 12.5_

  - [~] 19.3 Create WebSocket API
    - Add WebSocket API to ApiStack
    - Create connect, disconnect, and message handlers
    - Configure WebSocket routes and integrations
    - _Requirements: 1.6, 1.7_

  - [ ]* 19.4 Write property test for protected route authorization
    - **Property 17: Protected Route Authorization**
    - **Validates: Requirements 12.4**

  - [ ]* 19.5 Write property test for log group naming
    - **Property 10: Log Group Naming Convention**
    - **Validates: Requirements 8.4**

  - [ ]* 19.6 Write property test for log retention
    - **Property 11: Environment-Specific Log Retention**
    - **Validates: Requirements 8.5**

  - [ ]* 19.7 Write unit tests for ApiStack
    - Test API Gateway creation
    - Test Lambda function configuration
    - Test route definitions
    - Test authorizer configuration
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [ ] 20. Events infrastructure (EventBridge and SQS)
  - [~] 20.1 Create EventsStack
    - Create `infra/cdk/lib/stacks/events-stack.ts`
    - Create EventBridge event bus
    - Create SQS queues (order processing, notifications)
    - Create Dead Letter Queues (DLQs) for each queue
    - Configure event rules to route events to queues
    - Create worker Lambda functions for queue processing
    - Add environment-specific naming and tags
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 20.2 Write unit tests for EventsStack
    - Test event bus creation
    - Test queue configuration
    - Test DLQ configuration
    - Test event rules
    - _Requirements: 10.1, 10.2, 10.3_

- [ ] 21. Monitoring infrastructure (CloudWatch)
  - [~] 21.1 Create MonitoringStack
    - Create `infra/cdk/lib/stacks/monitoring-stack.ts`
    - Create CloudWatch alarms for Lambda errors and throttling
    - Create alarms for DynamoDB throttling
    - Create alarms for SQS DLQ messages
    - Create alarms for API Gateway 5xx errors
    - Create CloudWatch dashboard with key metrics
    - Add environment-specific naming and tags
    - _Requirements: 8.6, 8.7, 8.8_

  - [ ]* 21.2 Write unit tests for MonitoringStack
    - Test alarm creation
    - Test alarm thresholds
    - Test dashboard configuration
    - _Requirements: 8.6, 8.7_

- [ ] 22. Secrets and configuration management
  - [~] 22.1 Create secrets in Secrets Manager
    - Create CDK code to provision secrets (placeholders)
    - Add WhatsApp API token secret
    - Add Razorpay key secret
    - Add Gemini API key secret
    - Configure environment-specific secret names
    - _Requirements: 9.1, 9.4_

  - [~] 22.2 Create parameters in SSM Parameter Store
    - Create CDK code to provision parameters
    - Add non-sensitive configuration parameters
    - Configure environment-specific parameter names
    - _Requirements: 9.2, 9.4_

  - [ ]* 22.3 Write property test for secrets storage separation
    - **Property 12: Secrets Storage Separation**
    - **Validates: Requirements 9.1, 9.2**

  - [ ]* 22.4 Write property test for secret naming convention
    - **Property 13: Secret Naming Convention**
    - **Validates: Requirements 9.4**

- [ ] 23. IAM permissions and security
  - [~] 23.1 Configure Lambda IAM roles
    - Add DynamoDB permissions (least privilege, specific table ARNs)
    - Add S3 permissions (least privilege, specific bucket ARNs)
    - Add Secrets Manager permissions (specific secret ARNs)
    - Add EventBridge permissions (specific event bus ARN)
    - Add SQS permissions (specific queue ARNs)
    - Add CloudWatch Logs permissions
    - Add service and environment tags to all roles
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 23.2 Write property test for IAM least privilege
    - **Property 2: IAM Least Privilege**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [ ]* 23.3 Write property test for IAM role tagging
    - **Property 3: IAM Role Tagging**
    - **Validates: Requirements 5.6**

- [ ] 24. Checkpoint - Verify complete infrastructure
  - Synthesize all CDK stacks
  - Run all infrastructure unit tests
  - Run all property tests
  - Ask the user if questions arise

- [ ] 25. Testing setup and configuration
  - [~] 25.1 Set up Jest for unit testing
    - Create `services/api/jest.config.js`
    - Configure TypeScript support with ts-jest
    - Set up test coverage reporting
    - Create test utilities and mocks
    - _Requirements: Testing infrastructure_

  - [~] 25.2 Set up fast-check for property-based testing
    - Install fast-check dependency
    - Create property test utilities
    - Configure minimum 100 iterations per property
    - Create generators for common data types
    - _Requirements: Property-based testing_

  - [~] 25.3 Set up integration testing environment
    - Create Docker Compose file for DynamoDB Local
    - Create integration test setup scripts
    - Configure test database initialization
    - _Requirements: Integration testing_

  - [ ]* 25.4 Write example property tests
    - Create example property tests for key properties
    - Verify property test framework is working
    - Document property test patterns
    - _Requirements: Property-based testing_

- [ ] 26. Shared contracts and types
  - [~] 26.1 Create shared TypeScript types
    - Create `packages/shared/contracts/domain/` types
    - Define User, Product, Order, Payment types
    - Create API request and response types
    - Create event types for EventBridge
    - _Requirements: Shared types across services_

  - [~] 26.2 Create shared utilities
    - Create `packages/shared/utils/` with common utilities
    - Add validation helpers
    - Add date/time utilities
    - Add formatting utilities
    - _Requirements: Shared utilities_

- [ ] 27. Documentation and deployment
  - [~] 27.1 Create deployment documentation
    - Document CDK deployment process
    - Create deployment scripts for each environment
    - Document environment variable requirements
    - Create troubleshooting guide
    - _Requirements: Deployment documentation_

  - [~] 27.2 Create local development guide
    - Document local development setup
    - Create scripts for running services locally
    - Document testing procedures
    - Create debugging guide
    - _Requirements: Development documentation_

  - [~] 27.3 Create environment variable examples
    - Create `.env.example` files for each service
    - Document all required and optional variables
    - Provide example values
    - _Requirements: Configuration documentation_

  - [~] 27.4 Update root README
    - Add project overview and architecture diagram
    - Add quick start guide
    - Add links to detailed documentation
    - Add contribution guidelines
    - _Requirements: Project documentation_

- [ ] 28. Final checkpoint and validation
  - Deploy to dev environment
  - Run smoke tests against deployed infrastructure
  - Verify all services are operational
  - Ensure all tests pass
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements or design sections for traceability
- Checkpoints ensure incremental validation and early error detection
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples, edge cases, and integration points
- The implementation follows a bottom-up approach: infrastructure → utilities → repositories → services → handlers
- All code uses TypeScript for type safety and consistency with CDK infrastructure
- The mono-repo structure enables code sharing and consistent tooling across all services
