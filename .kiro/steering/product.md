# Product Overview

VyaparGyan is an AI-powered multi-seller marketplace aggregator for local Indian retailers. It enables sellers to manage products and orders via web dashboard while customers browse and purchase through omnichannel messaging (WhatsApp and web chat). The platform acts as an intelligent business manager, providing proactive AI insights for inventory optimization, dynamic pricing, and automated marketing campaigns.

## Core Personas

- **Admin**: Platform operators who moderate sellers, manage categories, resolve disputes, and monitor marketplace health
- **Seller**: Local retailers managing products, inventory, and fulfilling orders with AI-powered business insights
- **Customer**: End users browsing and ordering via WhatsApp or web chat interface

## Key Features

- Seller onboarding with document verification and admin approval
- Product catalog management with image uploads and inventory tracking
- **Omnichannel Messaging**: Customers and sellers communicate via custom Next.js web app chat AND WhatsApp (powered by Twilio)
- **Automated Stock Ingestion**: Sellers upload CSVs or photos of handwritten Khata books, parsed via OCR using Gemini Vision
- **Proactive AI Insights**: System analyzes seller inventory, identifies dead stock, researches market trends (via Grok/Gemini), and suggests dynamic pricing (discounts or price hikes)
- **Automated Conversions**: When sellers approve dead-stock discounts, system automatically sends promotional WhatsApp notifications to past customers to liquidate inventory
- **AI-Managed Analytics**: Dashboard for sellers showing previous billing, monthly revenue, stock age, and performance metrics
- Order lifecycle management with commission-based payment splitting (Razorpay Route)
- Admin controls for moderation, analytics, and dispute resolution
- AI assistance for catalog extraction, voice transcription, multilingual support, and market trend analysis

## Architecture

- **Backend**: AWS Lambda functions with TypeScript/Node.js 20
- **API Layer**: Amazon API Gateway HTTP API with JWT authorization
- **Authentication**: Amazon Cognito User Pools with role-based groups
- **Data Storage**: DynamoDB for operational data (single-table design with multi-seller partition strategy, tracking stock age and monthly revenue)
- **File Storage**: S3 for media uploads, documents, raw payloads, and Khata book images
- **Async Processing**: EventBridge and SQS for event-driven workflows and scheduled AI workers
- **Customer Channel**: Twilio API for omnichannel messaging (WhatsApp, SMS, and in-app chat routing)
- **Payments**: Razorpay Route (Transfers) for automated commission splitting and direct seller payouts. Inventory is deducted only upon successful payment, not during cart phase.
- **AI Orchestration**: Amazon Bedrock for dead-stock detection and discount campaign generation
- **AI Analysis**: Google Gemini and xAI Grok for market trend research, OCR, voice transcription, and multilingual support
- **Web Interface**: Next.js application for Admin and Seller dashboards with integrated chat
- **Observability**: CloudWatch Logs, Metrics, and Alarms
- **Infrastructure**: AWS CDK for infrastructure as code
- **Developer Tools**: Kiro IDE with MCP servers for platform data access

## Design Philosophy

- VyaparGyan acts as an intelligent aggregator taking a commission, with AI serving as a proactive business manager for sellers
- Serverless-first architecture for operational simplicity and low idle cost
- Event-driven design where it adds value (async workflows, audit trails, AI-triggered campaigns)
- Role-based authorization through Cognito groups and Lambda application logic
- Multi-seller DynamoDB design with efficient partition strategies for marketplace scale
- Omnichannel commerce experience optimized for Bharat sellers and customers
- AI features are proactive and assistive - suggesting actions that sellers approve before execution
- Automated marketing campaigns drive inventory liquidation and revenue optimization
- Commission-based revenue model with transparent payment splitting via Razorpay Route
- Production-oriented observability with structured logging and request tracing
- Infrastructure as code for reproducible deployments across environments
- Clear separation of concerns between handlers, business logic, adapters, and AI workers
