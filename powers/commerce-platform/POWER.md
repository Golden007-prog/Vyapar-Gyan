---
name: "commerce-platform"
displayName: "AWS Commerce Platform"
description: "WhatsApp-first multi-role commerce platform for Bharat/local sellers built on AWS serverless architecture with DynamoDB, Lambda, API Gateway, and EventBridge. Guides development of admin, seller, and customer workflows with MCP tooling integration."
keywords: ["commerce", "whatsapp", "seller", "admin", "customer", "aws", "lambda", "dynamodb", "cognito", "api-gateway", "eventbridge", "sqs", "payments", "kiro", "mcp", "serverless", "razorpay", "catalog", "orders"]
author: "Vyapar-Gyan Team"
---

# AWS Commerce Platform

## Overview

This power guides Kiro when building and maintaining a production-oriented WhatsApp-first commerce platform designed for Bharat and local sellers. The platform serves three distinct user roles:

- **Admin**: Platform operators who moderate sellers, manage categories, resolve disputes, and monitor platform health
- **Seller**: Local merchants who manage inventory, accept orders, and interact with customers
- **Customer**: End users who browse products, place orders via WhatsApp, and complete payments

The platform operates through multiple channels:
- **Web App**: Admin dashboard and seller management portal
- **WhatsApp**: Primary customer interaction channel for browsing, ordering, and support
- **Optional Web Catalog**: Public product browsing interface

This power is intended to guide Kiro when working on:
- AWS serverless architecture and infrastructure
- Backend services and business logic
- REST and WebSocket APIs
- DynamoDB access patterns and data modeling
- Lambda function handlers
- WhatsApp webhook flows and message orchestration
- Order lifecycle management
- Payment link generation and verification (Razorpay integration)
- Observability, logging, and monitoring
- IAM policies and security controls
- MCP tooling for development and operations
- AWS CDK infrastructure as code

## When to Use This Power

Activate this power when working on:

- **Seller onboarding**: Registration, document verification, approval workflows
- **Admin moderation**: Seller approval/rejection, dispute resolution, account suspension
- **Catalog and inventory**: Product CRUD, category management, stock tracking, pricing
- **WhatsApp messaging flows**: Webhook handling, session management, message routing, AI assistance
- **Order lifecycle**: Order creation, acceptance, fulfillment, cancellation, tracking
- **Payment integration**: Razorpay payment link generation, webhook verification, reconciliation
- **Analytics and dashboards**: Seller revenue reports, platform metrics, order analytics
- **AWS infrastructure**: CDK stacks, Lambda deployment, DynamoDB table design, EventBridge rules
- **Debugging and operations**: CloudWatch logs, error tracking, performance monitoring
- **Kiro MCP server integration**: Custom MCP tools for commerce operations, catalog management, admin tasks

## Core Stack

This project uses an AWS-native serverless architecture with the following core services:

- **Amazon Cognito**: User authentication and authorization with role-based groups
- **API Gateway HTTP API**: RESTful endpoints for admin and seller web applications
- **API Gateway WebSocket API**: Real-time notifications and bidirectional communication
- **AWS Lambda**: Serverless compute for all business logic and API handlers
- **DynamoDB**: Primary operational database for all runtime data
- **S3**: Object storage for product images, seller documents, and media files
- **EventBridge**: Event-driven orchestration for async workflows
- **SQS**: Message queuing for reliable async processing and decoupling
- **CloudWatch**: Centralized logging, metrics, alarms, and operational insights
- **Secrets Manager / SSM Parameter Store**: Secure credential and configuration management
- **AWS CDK**: Infrastructure as code for all AWS resources
- **Gemini**: AI features for transcription, extraction, multilingual support, and negotiation assistance

This power assumes an AWS-native serverless architecture throughout.

## Architecture Defaults

Kiro should follow these default architectural decisions when working on this project:

- **AWS serverless first**: Prefer Lambda, DynamoDB, EventBridge, SQS over containers or EC2
- **TypeScript by default**: Use TypeScript for Lambda functions and MCP servers unless there's a strong reason otherwise
- **DynamoDB as primary database**: Use DynamoDB for all operational runtime data
- **Access-pattern-first design**: Model DynamoDB tables based on query patterns, not relational normalization
- **Event-driven workflows**: Use EventBridge and SQS for async operations (notifications, analytics, audit trails)
- **Thin handlers**: Keep Lambda handlers minimal; move business logic into services/use-cases
- **Repository/adapter layers**: Abstract external integrations (DynamoDB, S3, EventBridge, SQS, Meta, Razorpay, Gemini) behind clean interfaces
- **API Gateway + Lambda**: Use API Gateway for all HTTP and WebSocket APIs
- **Cognito groups + JWT claims**: Use Cognito user pools with group-based authorization
- **Seller-scoped access**: Enforce strict data isolation between sellers
- **S3 for files only**: Use S3 exclusively for media, documents, and raw payloads
- **CloudWatch for observability**: Centralize logs, metrics, and alarms in CloudWatch
- **CDK for infrastructure**: Define all AWS resources using CDK (TypeScript)
- **MCP tools for DevOps**: Build custom MCP servers to assist with development and operations

## Role Model

### Admin

**Capabilities:**
- Approve or reject seller registration requests
- Manage product categories and taxonomy
- View platform-wide orders and payment transactions
- Resolve customer disputes and seller issues
- Suspend or ban seller accounts
- View platform analytics and business metrics
- Configure platform settings and policies

**Access Level:** Full platform visibility with moderation powers

### Seller

**Capabilities:**
- Manage business profile and verification documents
- Create, edit, and delete products in their catalog
- Manage stock levels and pricing
- Accept or reject incoming orders
- Receive WhatsApp notifications for new orders
- View seller dashboard with revenue and order metrics
- Communicate with customers through the platform

**Access Level:** Scoped to their own seller account and associated data

### Customer

**Capabilities:**
- Browse product catalog (via WhatsApp or optional web interface)
- Inquire about products via WhatsApp chat
- Place orders through conversational interface
- Receive Razorpay payment links
- Complete payments securely
- Track order status and delivery
- Receive order updates via WhatsApp

**Access Level:** Public catalog access; authenticated for order history

## WhatsApp-First Commerce Rules

When working on WhatsApp integration, follow these rules:

- **Validate all webhooks**: Every inbound Meta webhook request must be signature-verified
- **Acknowledge quickly**: Webhook handlers should respond with 200 OK within 5 seconds
- **Archive raw payloads**: Store original webhook payloads in S3 for debugging and audit
- **Deduplicate messages**: Use message IDs to prevent duplicate processing
- **Persist session state**: Store conversation context in DynamoDB for multi-turn interactions
- **Async outbound sends**: Queue outbound WhatsApp messages through SQS/EventBridge
- **AI assistance patterns**: Use Gemini for transcription, entity extraction, multilingual responses, and negotiation guidance
- **Graceful AI degradation**: System must remain functional even if AI services are unavailable
- **Rate limit awareness**: Respect Meta's rate limits and implement backoff strategies
- **Template message compliance**: Use approved WhatsApp Business templates for transactional messages

## Data and Backend Rules

When designing data models and backend logic:

- **DynamoDB single-table or minimal-table**: Prefer consolidated table design over many small tables
- **Avoid SQL thinking**: Don't model DynamoDB like a relational database
- **Core entities in DynamoDB**: Model orders, payments, sessions, messages, products, inventory, disputes, and audit records in DynamoDB
- **Conditional writes**: Use conditional expressions and transactions for order, payment, and inventory state changes
- **No scans in user paths**: Avoid table scans in customer-facing or seller-facing operations
- **Justify GSIs**: Only create Global Secondary Indexes when backed by concrete access patterns
- **Soft deletes**: Use status flags and archival patterns instead of hard deletes where appropriate
- **Partition key design**: Choose partition keys that distribute load evenly (avoid hot partitions)
- **Sort key patterns**: Leverage sort keys for range queries, filtering, and hierarchical data
- **Denormalization**: Duplicate data strategically to optimize read patterns
- **Batch operations**: Use BatchGetItem and BatchWriteItem for bulk operations

## Security and Operational Rules

Follow these security and operational practices:

- **Never hardcode secrets**: Use Secrets Manager or SSM Parameter Store for all credentials
- **Validate webhook signatures**: Verify Meta and Razorpay webhook signatures before processing
- **Structured logging**: Use JSON-formatted logs with consistent fields
- **Include request IDs**: Propagate correlation IDs through all service calls
- **IAM least privilege**: Grant minimal necessary permissions to Lambda execution roles
- **Read-only MCP tools by default**: Prefer safe, read-only MCP tools for development
- **Disable dangerous tools**: Keep write/replay/delete MCP tools disabled or require manual approval
- **Alarms and DLQs**: Configure CloudWatch alarms and Dead Letter Queues for operational resilience
- **Input validation**: Validate and sanitize all user inputs at API boundaries
- **Seller data isolation**: Enforce seller-scoped queries and prevent cross-seller data access
- **Audit trails**: Log all admin actions and sensitive operations to EventBridge
- **Error handling**: Implement graceful error handling with user-friendly messages

## Kiro + MCP Integration

This repository uses Kiro with Model Context Protocol (MCP) integration for enhanced development and operations workflows.

**Configuration locations:**
- Workspace MCP config: `.kiro/settings/mcp.json`
- Project steering files: `.kiro/steering/`
- Power assets: `powers/commerce-platform/`

**Recommended custom MCP servers:**

### commerce-ops-mcp
**Responsibility:** Operations, debugging, and runtime data access
- Query orders by status, seller, or customer
- View payment transaction details and reconciliation status
- Inspect WhatsApp session state and message history
- Search CloudWatch logs by request ID or error pattern
- Debug webhook processing failures
- Monitor SQS queue depths and DLQ messages

### commerce-catalog-mcp
**Responsibility:** Product catalog and inventory management
- Search products by category, seller, or keyword
- View product details, pricing, and stock levels
- List categories and taxonomy structure
- Check inventory availability across sellers
- Access product image metadata from S3
- Generate catalog reports and analytics

### commerce-admin-mcp
**Responsibility:** Admin operations and moderation
- List pending seller approval requests
- View seller verification documents and status
- Search disputes by status or seller
- Access platform-wide analytics and metrics
- Query audit logs for admin actions
- Generate compliance and moderation reports

These MCP servers provide Kiro with direct access to platform data and operations, enabling faster debugging, better context awareness, and more accurate code generation.

## Expected Outputs from Kiro

When working with this power, Kiro should help generate:

- **Lambda handlers**: API route handlers, webhook processors, EventBridge consumers
- **Service/use-case classes**: Business logic for orders, payments, catalog, seller onboarding
- **DynamoDB repository code**: Data access layers with proper access patterns and error handling
- **API route definitions**: API Gateway route configurations and request/response schemas
- **Webhook handlers**: Meta and Razorpay webhook validation and processing logic
- **Payment verification logic**: Razorpay signature verification and payment status reconciliation
- **CDK stacks**: Infrastructure definitions for Lambda, DynamoDB, API Gateway, EventBridge, SQS
- **IAM policy suggestions**: Least-privilege policies for Lambda execution roles
- **Observability setup**: CloudWatch log groups, metric filters, alarms, and dashboards
- **Postman collections**: API testing collections for admin and seller endpoints
- **MCP server tools**: Custom MCP tool implementations for commerce operations
- **Steering docs**: Internal technical documentation and architectural decision records
- **Test suites**: Unit tests, integration tests, and property-based tests for critical paths

## What to Avoid

Kiro should avoid introducing these patterns unless explicitly requested:

- **Supabase as core platform**: This is an AWS-native project, not Supabase-based
- **PostgreSQL/Aurora as default**: DynamoDB is the primary operational database
- **LangGraph as mandatory orchestration**: Avoid complex AI orchestration frameworks unless justified
- **ECS/containers for core MVP**: Use Lambda for serverless compute
- **Overly complex microservices**: Keep service boundaries practical and maintainable
- **Unnecessary framework churn**: Stick to established patterns and avoid trendy but unproven frameworks
- **Vague AI patterns**: Only introduce AI features with clear operational value and fallback strategies
- **Relational database thinking**: Don't model DynamoDB like SQL tables
- **Premature optimization**: Focus on correctness and clarity before performance tuning
- **Generic boilerplate**: Generate project-specific, contextual code

## Working Style

This power biases toward:

- **Implementation-ready output**: Generate complete, runnable code with proper error handling
- **Clear architecture**: Favor explicit, understandable patterns over clever abstractions
- **Production-oriented design**: Consider error cases, monitoring, and operational concerns upfront
- **Cost-aware AWS choices**: Optimize for AWS serverless pricing models (pay-per-use)
- **Low operational complexity**: Minimize moving parts and operational burden
- **Modular code structure**: Organize code into clear layers (handlers, services, repositories, integrations)
- **Practical debugging workflows**: Include logging, tracing, and troubleshooting guidance
- **Incremental delivery**: Build features iteratively with clear milestones
- **Documentation as code**: Keep technical docs close to implementation
- **Test-driven confidence**: Write tests that validate business rules and edge cases

---

**This power integrates with custom MCP servers for enhanced Kiro capabilities in commerce operations, catalog management, and admin workflows.**
