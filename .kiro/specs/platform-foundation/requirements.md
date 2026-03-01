# Platform Foundation Requirements

## Overview

This specification establishes the production-ready base infrastructure for VyaparGyan, an AWS serverless, WhatsApp-first, multi-role commerce platform serving three personas (Admin, Seller, Customer) through web applications and WhatsApp.

## Technology Stack

- **Cloud Provider**: AWS (serverless architecture)
- **Authentication**: Amazon Cognito
- **API**: API Gateway (HTTP + WebSocket)
- **Compute**: AWS Lambda (TypeScript/Node.js 20)
- **Database**: DynamoDB
- **Storage**: S3
- **Event Bus**: EventBridge
- **Queuing**: SQS
- **Monitoring**: CloudWatch
- **Secrets**: Secrets Manager / SSM Parameter Store
- **Infrastructure as Code**: AWS CDK

## Requirement 1: Repository Structure

**User Story**: As a developer, I want a well-organized mono-repo structure, so that I can efficiently navigate and maintain infrastructure, services, and applications.

### Acceptance Criteria

1. WHEN the repository is initialized THEN the system SHALL organize code into three top-level directories: `infra/cdk`, `services/api`, and `apps/web`
2. WHEN organizing infrastructure code THEN the system SHALL place all CDK stacks and constructs in `infra/cdk`
3. WHEN organizing backend services THEN the system SHALL place all Lambda functions and API code in `services/api`
4. WHEN organizing frontend applications THEN the system SHALL place all web applications in `apps/web`
5. WHEN managing shared code THEN the system SHALL provide a mechanism for sharing utilities across packages
6. WHEN managing dependencies THEN the system SHALL use a workspace-based package manager (npm workspaces, pnpm, or yarn workspaces)

## Requirement 2: Environment Strategy

**User Story**: As a DevOps engineer, I want clearly defined environments with proper isolation, so that I can safely develop, test, and deploy changes.

### Acceptance Criteria

1. WHEN deploying infrastructure THEN the system SHALL support three environments: dev, staging, and prod
2. WHEN deploying to dev THEN the system SHALL use cost-optimized configurations suitable for development
3. WHEN deploying to staging THEN the system SHALL mirror production configuration for realistic testing
4. WHEN deploying to prod THEN the system SHALL use production-grade configurations with appropriate scaling and redundancy
5. WHEN isolating environments THEN the system SHALL ensure complete resource isolation between dev, staging, and prod
6. WHEN naming resources THEN the system SHALL include the environment name in all AWS resource names and tags

## Requirement 3: Local Development Setup

**User Story**: As a developer, I want to run and test the application locally, so that I can develop features without deploying to AWS.

### Acceptance Criteria

1. WHEN setting up local development THEN the system SHALL provide clear documentation for installing dependencies
2. WHEN running locally THEN the system SHALL support local Lambda execution using tools like SAM Local or serverless-offline
3. WHEN testing locally THEN the system SHALL provide mock implementations or local alternatives for AWS services (DynamoDB Local, LocalStack)
4. WHEN managing local configuration THEN the system SHALL use environment files (.env) that are git-ignored
5. WHEN starting the development environment THEN the system SHALL provide scripts to start all necessary services
6. WHEN debugging THEN the system SHALL support attaching debuggers to locally running Lambda functions

## Requirement 4: AWS Account and Bootstrap Setup

**User Story**: As a platform administrator, I want proper AWS account setup and CDK bootstrapping, so that infrastructure can be deployed securely and reliably.

### Acceptance Criteria

1. WHEN setting up AWS accounts THEN the system SHALL document the required AWS account structure (single account or multi-account)
2. WHEN bootstrapping CDK THEN the system SHALL run `cdk bootstrap` for each environment in the target AWS account
3. WHEN bootstrapping THEN the system SHALL create necessary S3 buckets and IAM roles for CDK deployments
4. WHEN configuring accounts THEN the system SHALL document required AWS service quotas and limits
5. WHEN setting up billing THEN the system SHALL configure billing alerts and cost monitoring
6. WHEN managing access THEN the system SHALL document IAM user/role requirements for deployment

## Requirement 5: IAM Baseline

**User Story**: As a security engineer, I want a secure IAM baseline with least-privilege access, so that the platform operates securely.

### Acceptance Criteria

1. WHEN creating Lambda execution roles THEN the system SHALL grant only the minimum permissions required for each function
2. WHEN accessing DynamoDB THEN the system SHALL create table-specific IAM policies limiting access to required tables only
3. WHEN accessing S3 THEN the system SHALL create bucket-specific IAM policies with appropriate read/write permissions
4. WHEN accessing Secrets Manager THEN the system SHALL grant access only to specific secrets required by each service
5. WHEN creating service roles THEN the system SHALL use CDK constructs to generate IAM policies automatically where possible
6. WHEN auditing permissions THEN the system SHALL tag all IAM roles with service and environment information

## Requirement 6: CDK Application Setup

**User Story**: As a developer, I want a well-structured CDK application, so that infrastructure is maintainable and follows best practices.

### Acceptance Criteria

1. WHEN organizing CDK code THEN the system SHALL separate infrastructure into logical stacks (networking, database, api, auth, storage)
2. WHEN defining stacks THEN the system SHALL use CDK constructs to define reusable infrastructure patterns
3. WHEN parameterizing stacks THEN the system SHALL accept environment-specific configuration through context variables or parameters
4. WHEN managing stack dependencies THEN the system SHALL explicitly declare dependencies between stacks
5. WHEN synthesizing stacks THEN the system SHALL validate that all required parameters are provided
6. WHEN deploying stacks THEN the system SHALL support deploying individual stacks or all stacks together

## Requirement 7: Shared Backend Architecture

**User Story**: As a backend developer, I want a consistent Lambda architecture with shared utilities, so that I can build features efficiently.

### Acceptance Criteria

1. WHEN structuring Lambda functions THEN the system SHALL organize functions by domain (auth, catalog, orders, admin, whatsapp, payments)
2. WHEN handling requests THEN the system SHALL provide middleware for common concerns (logging, error handling, authentication, validation)
3. WHEN validating input THEN the system SHALL use a schema validation library (Zod, Joi, or similar)
4. WHEN handling errors THEN the system SHALL catch and format errors consistently across all Lambda functions
5. WHEN logging THEN the system SHALL use structured logging with request IDs for traceability
6. WHEN sharing code THEN the system SHALL provide a shared utilities package for common functions (DynamoDB helpers, S3 helpers, response formatters)
7. WHEN deploying functions THEN the system SHALL bundle dependencies efficiently to minimize cold start times

## Requirement 8: Logging and Error Strategy

**User Story**: As a DevOps engineer, I want comprehensive logging and error tracking, so that I can monitor and troubleshoot the platform effectively.

### Acceptance Criteria

1. WHEN logging from Lambda functions THEN the system SHALL write structured JSON logs to CloudWatch Logs
2. WHEN logging requests THEN the system SHALL include request ID, user ID, timestamp, and relevant context
3. WHEN errors occur THEN the system SHALL log error details including stack traces and request context
4. WHEN organizing logs THEN the system SHALL use consistent log group naming conventions per environment
5. WHEN retaining logs THEN the system SHALL configure appropriate retention periods (7 days for dev, 30 days for staging, 90+ days for prod)
6. WHEN monitoring errors THEN the system SHALL create CloudWatch alarms for critical error rates
7. WHEN tracking errors THEN the system SHALL optionally integrate with error tracking services (Sentry, Rollbar)

## Requirement 9: Configuration and Secrets Handling

**User Story**: As a developer, I want secure configuration and secrets management, so that sensitive data is protected and configuration is environment-specific.

### Acceptance Criteria

1. WHEN storing secrets THEN the system SHALL use AWS Secrets Manager for sensitive values (API keys, database credentials)
2. WHEN storing configuration THEN the system SHALL use SSM Parameter Store for non-sensitive configuration values
3. WHEN accessing secrets THEN the system SHALL load secrets at Lambda initialization and cache them appropriately
4. WHEN naming secrets THEN the system SHALL use a consistent naming convention including environment prefix
5. WHEN rotating secrets THEN the system SHALL support secret rotation without application downtime
6. WHEN validating configuration THEN the system SHALL validate all required configuration values at startup
7. WHEN deploying THEN the system SHALL fail fast if required secrets or configuration are missing

## Requirement 10: DynamoDB Table Baseline

**User Story**: As a backend developer, I want well-designed DynamoDB tables with proper access patterns, so that I can build scalable data access layers.

### Acceptance Criteria

1. WHEN designing tables THEN the system SHALL use single-table design principles where appropriate
2. WHEN creating tables THEN the system SHALL define primary keys (partition key and optional sort key) based on access patterns
3. WHEN querying data THEN the system SHALL create Global Secondary Indexes (GSIs) for additional access patterns
4. WHEN provisioning capacity THEN the system SHALL use on-demand billing for dev and staging, with options for provisioned capacity in prod
5. WHEN enabling features THEN the system SHALL enable point-in-time recovery for production tables
6. WHEN streaming changes THEN the system SHALL optionally enable DynamoDB Streams for event-driven architectures
7. WHEN accessing tables THEN the system SHALL provide a repository layer abstracting DynamoDB operations

## Requirement 11: S3 Bucket Baseline

**User Story**: As a developer, I want properly configured S3 buckets for file storage, so that I can securely store and serve user-uploaded content.

### Acceptance Criteria

1. WHEN creating buckets THEN the system SHALL create separate buckets for different purposes (product images, documents, logs)
2. WHEN securing buckets THEN the system SHALL block public access by default and use signed URLs for private content
3. WHEN organizing content THEN the system SHALL use key prefixes to organize files by environment and purpose
4. WHEN enabling features THEN the system SHALL enable versioning for critical buckets
5. WHEN managing lifecycle THEN the system SHALL configure lifecycle policies to transition old objects to cheaper storage classes
6. WHEN serving content THEN the system SHALL optionally configure CloudFront for content delivery
7. WHEN uploading files THEN the system SHALL provide pre-signed URLs for direct client uploads

## Requirement 12: API Gateway Baseline

**User Story**: As a backend developer, I want properly configured API Gateway endpoints, so that I can expose Lambda functions as HTTP and WebSocket APIs.

### Acceptance Criteria

1. WHEN creating HTTP APIs THEN the system SHALL use API Gateway HTTP API (v2) for REST endpoints
2. WHEN creating WebSocket APIs THEN the system SHALL use API Gateway WebSocket API for real-time communication
3. WHEN routing requests THEN the system SHALL configure routes mapping to appropriate Lambda functions
4. WHEN authenticating requests THEN the system SHALL integrate with Cognito authorizers for protected endpoints
5. WHEN handling CORS THEN the system SHALL configure CORS settings for web application access
6. WHEN throttling THEN the system SHALL configure appropriate throttling limits per environment
7. WHEN logging THEN the system SHALL enable access logging to CloudWatch
8. WHEN versioning THEN the system SHALL use stages (dev, staging, prod) for environment-specific deployments

## Requirement 13: Cognito Baseline

**User Story**: As a developer, I want Cognito user pools configured for authentication, so that I can implement secure user authentication and authorization.

### Acceptance Criteria

1. WHEN creating user pools THEN the system SHALL create separate user pools per environment
2. WHEN configuring authentication THEN the system SHALL support email and phone number as username options
3. WHEN managing passwords THEN the system SHALL enforce strong password policies
4. WHEN issuing tokens THEN the system SHALL configure appropriate token expiration times
5. WHEN adding user attributes THEN the system SHALL define custom attributes for user roles (admin, seller, customer)
6. WHEN creating app clients THEN the system SHALL create app clients for web and mobile applications
7. WHEN triggering workflows THEN the system SHALL optionally configure Lambda triggers for custom authentication flows

## Requirement 14: CI/CD Baseline

**User Story**: As a DevOps engineer, I want automated CI/CD pipelines, so that code changes are tested and deployed reliably.

### Acceptance Criteria

1. WHEN committing code THEN the system SHALL trigger automated builds and tests
2. WHEN running tests THEN the system SHALL execute unit tests, integration tests, and linting
3. WHEN deploying to dev THEN the system SHALL automatically deploy on merge to main/develop branch
4. WHEN deploying to staging THEN the system SHALL require manual approval or deploy on merge to staging branch
5. WHEN deploying to prod THEN the system SHALL require manual approval and deploy on merge to production branch
6. WHEN deploying infrastructure THEN the system SHALL use CDK deploy commands in the pipeline
7. WHEN deploying fails THEN the system SHALL notify the team and prevent promotion to higher environments
8. WHEN rolling back THEN the system SHALL support rolling back to previous deployments

## Requirement 15: Kiro Integration Baseline

**User Story**: As a developer using Kiro, I want MCP servers providing read-only access to platform data, so that I can query and analyze system state during development.

### Acceptance Criteria

1. WHEN querying operational data THEN the system SHALL provide an MCP server for orders, payments, inventory, WhatsApp sessions, and logs
2. WHEN querying catalog data THEN the system SHALL provide an MCP server for products, categories, stock levels, and media
3. WHEN querying admin data THEN the system SHALL provide an MCP server for seller approvals, disputes, audit logs, and analytics
4. WHEN accessing MCP servers THEN the system SHALL require AWS credentials with read-only DynamoDB permissions
5. WHEN installing MCP servers THEN the system SHALL provide installation scripts and documentation
6. WHEN querying data THEN the system SHALL return data in structured formats suitable for AI analysis
