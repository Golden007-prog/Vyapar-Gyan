# Product Overview

VyaparGyan is an AI-powered commerce platform for local Indian retailers. It enables sellers to manage products and orders via web dashboard while customers browse and purchase through WhatsApp.

## Core Personas

- **Admin**: Platform operators who moderate sellers, manage categories, resolve disputes
- **Seller**: Local retailers managing products, inventory, and fulfilling orders
- **Customer**: End users browsing and ordering primarily via WhatsApp

## Key Features

- Seller onboarding with document verification and admin approval
- Product catalog management with image uploads and inventory tracking
- WhatsApp-based customer commerce (browsing, ordering, payment)
- Order lifecycle management with payment integration (Razorpay)
- Admin controls for moderation, analytics, and dispute resolution
- AI assistance for catalog extraction, voice transcription, and multilingual support

## Architecture

- **Backend**: AWS Lambda functions with TypeScript/Node.js 20
- **API Layer**: Amazon API Gateway HTTP API with JWT authorization
- **Authentication**: Amazon Cognito User Pools with role-based groups
- **Data Storage**: DynamoDB for operational data (single-table design)
- **File Storage**: S3 for media uploads, documents, and raw payloads
- **Async Processing**: EventBridge and SQS for event-driven workflows
- **Customer Channel**: WhatsApp Cloud API for conversational commerce
- **Payments**: Razorpay integration with webhook handling
- **AI**: Google Gemini for voice transcription, image analysis, multilingual support
- **Web Interface**: Next.js application for Admin and Seller dashboards
- **Observability**: CloudWatch Logs, Metrics, and Alarms
- **Infrastructure**: AWS CDK for infrastructure as code
- **Developer Tools**: Kiro IDE with MCP servers for platform data access

## Design Philosophy

- Serverless-first architecture for operational simplicity and low idle cost
- Event-driven design where it adds value (async workflows, audit trails)
- Role-based authorization through Cognito groups and Lambda application logic
- Single-table DynamoDB design for efficient data access patterns
- WhatsApp-first commerce experience optimized for Bharat sellers and customers
- AI features are assistive, bounded, and optional - not autonomous decision-makers
- Production-oriented observability with structured logging and request tracing
- Infrastructure as code for reproducible deployments across environments
- Clear separation of concerns between handlers, business logic, and adapters
