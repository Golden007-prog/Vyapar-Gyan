# Product Requirements Document: VyaparGyan

## Executive Summary

VyaparGyan is an AI copilot for Bharat retailers that predicts demand, adjusts pricing, and negotiates with customers automatically.

The platform combines two powerful capabilities: (1) An Analyst Agent that watches social media to predict what will sell, and (2) a Negotiator Agent that talks to customers via voice to close deals. The central Orchestrator connects these agents, ensuring that pricing strategy reflects real-time market demand.

**The Problem We Solve**: Small retailers lose money in two ways—they buy the wrong inventory (dead stock) and sell at the wrong prices (lost margins). VyaparGyan fixes both by bringing market intelligence directly into sales execution.

**The Result**: Retailers increase profit margins by 15-20% on trending items while reducing dead stock by 30%, all without hiring additional staff.

**Zero-Cost Architecture**: Built entirely on serverless AWS infrastructure (Lambda, API Gateway, Bedrock) with Gemini Tier 1 API, VyaparGyan runs at zero cost during idle periods. Retailers only pay when transactions occur—making enterprise-grade AI accessible to even the smallest shops in Bharat. The entire prototype operates well within the $100 AWS Hackathon credit limit.

## Demo Flow

Here's VyaparGyan in action:

1. **Retailer uploads product image**: Shopkeeper photographs a shelf of sarees, uses voice to catalog: "10 Green Banarasi Sarees, cost ₹500 each"
2. **AI detects trend**: System scans Instagram Reels and YouTube Shorts, detects "Green Sarees" with 400% engagement spike
3. **System adjusts strategy**: Floor price automatically raised from ₹850 to ₹1050, negotiation mode set to "AGGRESSIVE"
4. **Customer negotiates via WhatsApp voice**: Customer sends voice note asking about green sarees
5. **AI responds with context**: "This Green Banarasi is ₹1200. It's trending in Mumbai right now"
6. **Dynamic negotiation**: Customer offers ₹900, AI holds firm at ₹1050 citing market demand
7. **Deal closes**: Customer agrees, pays via UPI link generated in chat
8. **Profit increases**: Retailer earns ₹550 profit instead of ₹350 (57% margin increase)

## Why This Matters

Small retailers in India are the backbone of the economy, but they compete with one hand tied behind their backs:

**The Challenge**: Big e-commerce companies use data science teams and dynamic pricing algorithms. Small retailers rely on gut feeling and static price tags.

**The Opportunity**: VyaparGyan democratizes AI for retail. A boutique owner in Jaipur gets the same market intelligence and pricing optimization as a large chain—all through a simple mobile app and WhatsApp interface.

**Real-World Impact**:
- **For Retailers**: 15-20% margin uplift, 30% less dead stock, 24/7 autonomous sales
- **For Customers**: Natural voice-based shopping, fair negotiated prices, seamless UPI checkout
- **For India**: Empowering 60+ million small retailers with AI technology

This isn't just a chatbot—it's an AI operating system for retail that levels the playing field.

## User Personas

### Primary Persona: The Shopkeeper (The Commander)
- **Profile**: Small to medium retail business owners across India—boutique owners, textile merchants, electronics shops
- **Pain Points**: 
  - Buying inventory based on intuition, missing viral trends
  - Manual price negotiations taking up valuable time
  - Unable to track what's trending in real-time
  - Losing margins by discounting too quickly
- **Goals**: Maximize profit margins, reduce dead stock, automate customer interactions while staying in control
- **Technical Comfort**: Comfortable with smartphones and WhatsApp, prefers voice over typing

### Secondary Persona: The Customer (The User)  
- **Profile**: Indian consumers who value personalized service and negotiation flexibility
- **Pain Points**: 
  - Static e-commerce pricing with no room to negotiate
  - Impersonal shopping experiences
  - Complex checkout processes requiring multiple apps
- **Goals**: Get fair prices through natural conversation, quick product discovery, seamless payment
- **Technical Comfort**: WhatsApp power users, comfortable with voice notes and UPI payments

## Functional Requirements

### The Analyst Agent (TrendSetu) - The Market Watcher

This agent is your 24/7 market research team, constantly scanning social media to find what's about to blow up.

#### Core Capabilities
- **Video Content Processing**: Continuously monitors YouTube Shorts via the official YouTube Data API v3 to identify trending content
- **Frame-to-Text Analysis**: Uses Gemini 1.5 Pro Vision to analyze video thumbnails and extract visual elements, product categories, and trend signals
- **Trend Velocity Calculation**: Generates "hype scores" (0.0-1.0) based on engagement metrics, view velocity, and viral growth patterns from YouTube analytics
- **Product Category Mapping**: Automatically matches trending items to your inventory categories (Fashion, Electronics, Home Goods, etc.)

#### Technical Requirements
- **Processing Schedule**: AWS Lambda cron trigger (EventBridge) every 4 hours + emergency real-time triggers for viral content
- **Data Sources**: YouTube Data API v3 (official API, no scraping—hackathon-safe for live demos)
- **Output Format**: Structured trend reports with confidence scores and recommended price adjustments
- **Storage**: Supabase PostgreSQL (free tier) for trend data with vector embeddings for semantic matching (e.g., "Velvet Lehenga" matches "Velvet Suit")

### The Negotiator Agent (SubhLabh) - The Smart Salesperson

This agent handles customer conversations like an experienced salesperson who knows exactly when to hold firm and when to offer deals.

#### Core Capabilities
- **Voice Interface**: Receives audio messages via Meta WhatsApp Cloud API, transcribes using Gemini 1.5 Pro/Flash native multimodal capabilities (no separate STT service needed)
- **Dynamic Personality Switching**: Adjusts negotiation style based on trend data—aggressive on hot items, generous on clearance
- **Context-Aware Responses**: References trend data naturally: "Ma'am, I can't lower the price—this style is trending in Mumbai right now"
- **Inventory Integration**: Real-time stock checking and reservation during negotiations to prevent overselling

#### Technical Requirements
- **Latency Target**: <2s for complete voice response (WhatsApp webhook → Lambda → Gemini transcription → Bedrock reasoning → response)
- **Conversation Memory**: Maintains context across multi-turn negotiations using conversation state stored in Supabase
- **Fallback Mechanisms**: Seamless handling of both voice notes and text messages via WhatsApp
- **Payment Integration**: Generates UPI payment links instantly upon deal closure

### The Orchestrator (Core Brain) - The Strategic Commander

This is the "brain" that connects everything—taking insights from the Analyst and instructing the Negotiator on how to behave.

#### Core Capabilities
- **State Management**: Maintains shared context between Analyst and Negotiator agents using LangGraph state machines powered by Amazon Bedrock
- **Dynamic Pricing Engine**: Calculates floor prices and starting prices based on trend velocity, inventory levels, and shopkeeper constraints
- **Strategy Assignment**: Determines negotiation personality for each product (Aggressive, Balanced, Clearance, No-Discount modes)
- **Cross-Agent Communication**: Facilitates data flow between slow batch processing (trends) and fast real-time interactions (negotiations)

#### Technical Requirements
- **Decision Logic**: Rule-based engine powered by Amazon Bedrock (Claude 3.5 Sonnet or Llama 3) with configurable business logic (e.g., "IF trend_score > 0.8 AND stock < 10 THEN mode = AGGRESSIVE")
- **State Persistence**: Supabase PostgreSQL (free tier) for transactional data, with in-memory caching for session state
- **API Gateway**: AWS API Gateway for webhook endpoints and tenant configuration
- **Monitoring**: AWS CloudWatch for real-time agent health monitoring with alerts for anomalies (e.g., "AI selling below cost")

## User Stories

### Story 1: Viral Trend Capitalization
**As a** shopkeeper selling fashion items,  
**I want** the system to automatically detect when my inventory items match viral social media trends,  
**So that** I can increase prices dynamically and maximize profit margins without manual market research.

**Acceptance Criteria:**
- Analyst Agent detects "Green Banarasi Sarees" trending on Instagram with hype score >0.8
- Orchestrator updates floor price for matching inventory items by 15-25%
- Shopkeeper receives mobile notification with trend evidence and price adjustment
- Negotiator Agent refuses discounts below new floor price during customer interactions

### Story 2: Autonomous Voice Negotiation
**As a** customer interested in purchasing a saree,  
**I want** to negotiate prices naturally through voice conversation,  
**So that** I can get fair pricing without visiting the physical store or dealing with static e-commerce prices.

**Acceptance Criteria:**
- Customer initiates conversation via WhatsApp voice note or QR code scan
- Negotiator Agent responds within 500ms with product images and initial pricing
- Agent adjusts negotiation strategy based on real-time trend data and inventory levels
- Conversation concludes with agreed price and UPI payment link generation

### Story 3: Intelligent Inventory Strategy
**As a** shopkeeper with slow-moving inventory,  
**I want** the system to automatically switch to clearance mode for non-trending items,  
**So that** I can reduce dead stock while maintaining margins on high-demand products.

**Acceptance Criteria:**
- Analyst Agent identifies products with declining trend scores (<0.3) and high inventory (>30 days stock)
- Orchestrator switches strategy to "CLEARANCE" mode with generous discount allowances
- Negotiator Agent proactively offers discounts and bundle deals for affected items
- System tracks clearance success rate and adjusts strategy parameters

## Non-Functional Requirements

### Performance Requirements
- **Voice Latency**: End-to-end voice response <2s (WhatsApp webhook → Lambda → Gemini transcription → Bedrock reasoning → response)
- **Trend Processing**: Complete YouTube Shorts analysis cycle within 4-hour batch window using Lambda cron triggers
- **Concurrent Users**: Support 100+ simultaneous negotiations per tenant using serverless Lambda auto-scaling
- **API Response Time**: API Gateway responses <500ms for 95th percentile

### Scalability Requirements
- **Serverless Auto-scaling**: AWS Lambda automatically scales from 0 to 1000+ concurrent executions based on demand
- **Database Scaling**: Supabase PostgreSQL free tier (500MB) for prototype, with upgrade path to paid tiers
- **Zero-Cost Idle**: No charges when system is idle—perfect for small retailers with intermittent traffic
- **Event-Driven Architecture**: All components triggered by events (WhatsApp messages, cron schedules), ensuring pay-per-use pricing

### Reliability Requirements
- **System Uptime**: 99.9% availability leveraging AWS Lambda's built-in redundancy across multiple availability zones
- **Data Consistency**: ACID compliance for financial transactions via Supabase PostgreSQL
- **Fault Tolerance**: Graceful degradation when individual agents fail, with automatic Lambda retries
- **Backup Strategy**: Supabase automated daily backups with point-in-time recovery

### Security Requirements
- **Data Encryption**: End-to-end encryption for WhatsApp conversations (Meta's native encryption) and payment data
- **Authentication**: AWS IAM for service-to-service authentication, JWT tokens for tenant access
- **PCI Compliance**: Secure payment processing with tokenization via UPI payment gateways
- **Privacy**: GDPR-compliant data handling with customer consent management
## Success Metrics

### Business Impact Metrics
- **Margin Uplift**: Average increase in profit margins due to dynamic pricing (Target: 15-20%)
- **Dead Stock Reduction**: Decrease in inventory aging beyond 60 days (Target: 30% reduction)
- **Sales Velocity**: Increase in items sold per day through autonomous negotiations (Target: 25% increase)
- **Customer Satisfaction**: Net Promoter Score for voice negotiation experience (Target: >70)

### Technical Performance Metrics
- **Trend Accuracy**: Precision of trend predictions leading to successful price increases (Target: >80%)
- **Negotiation Success Rate**: Percentage of voice conversations resulting in completed sales (Target: >60%)
- **System Reliability**: Uptime and error rates across all agent components (Target: <1% error rate)
- **Response Latency**: Voice interaction response times and API performance (Target: <500ms)

### Operational Metrics
- **Agent Coordination**: Successful data handoffs between Analyst and Negotiator agents (Target: >95%)
- **Tenant Adoption**: Monthly active tenants and feature utilization rates
- **Scalability**: System performance under increasing load and tenant growth
- **Cost Efficiency**: Infrastructure costs per transaction and per tenant

## Technical Architecture Overview

### Technology Stack
- **Orchestration Framework**: LangGraph for multi-agent state management, powered by Amazon Bedrock
- **Large Language Models**: Amazon Bedrock (Claude 3.5 Sonnet or Llama 3) for complex reasoning and orchestration
- **Computer Vision**: Gemini 1.5 Pro Vision for video thumbnail analysis and trend detection
- **Voice Processing**: Gemini 1.5 Pro/Flash for native multimodal Speech-to-Text transcription
- **Databases**: Supabase PostgreSQL (free tier) for transactional data and trend storage
- **Infrastructure**: AWS Lambda (serverless compute), AWS API Gateway (webhooks), AWS EventBridge (cron triggers), AWS CloudWatch (monitoring)
- **Messaging**: Meta WhatsApp Cloud API for customer communication

### Integration Requirements
- **Social Media APIs**: YouTube Data API v3 (official API for trending Shorts)
- **Payment Gateways**: UPI integration via Razorpay/PayU
- **Communication Channels**: Meta WhatsApp Cloud API for voice notes and text messages
- **Monitoring**: AWS CloudWatch for metrics, logs, and alerts

## Data Architecture

### Core Entities

#### Tenants & Users
```sql
-- Shopkeepers (Business Owners)
tenants: {
  id, business_name, owner_phone, business_category, created_at
}

-- Customers (End Users)
customers: {
  id, phone_number, trust_score, last_active
}
```

#### Inventory & Pricing
```sql
-- Products with AI-driven pricing
products: {
  id, tenant_id, name, category, stock_quantity,
  cost_price, base_ask_price, min_margin_percent,
  dynamic_floor_price, dynamic_ask_price,
  current_strategy, is_trending, updated_at
}
```

#### Market Intelligence
```sql
-- Trend data from Analyst Agent
market_trends: {
  id, hashtag_keyword, hype_velocity_score,
  platform_source, suggested_price_hike_percent,
  detected_at
}

-- Product-Trend relationships
product_trend_mapping: {
  id, product_id, trend_id, relevance_score
}
```

#### Negotiation Sessions
```sql
-- Real-time negotiation state
negotiation_sessions: {
  id, tenant_id, customer_id, product_id,
  status, chat_transcript, current_offer_price,
  customer_sentiment_score, final_agreed_price,
  is_successful
}
```

## Implementation Phases

### Phase 1: Core Agent Framework (Day 1-2)
- Implement LangGraph orchestration layer powered by Amazon Bedrock
- Build basic Analyst Agent with YouTube Data API v3 integration
- Develop Negotiator Agent with text-based WhatsApp interface via Meta Cloud API
- Create tenant onboarding and product catalog management using Supabase

### Phase 2: Voice Integration (Day 3-4)
- Integrate Gemini 1.5 Pro/Flash for native multimodal voice transcription
- Implement real-time voice negotiation pipeline via WhatsApp voice notes
- Add Hindi/English code-switching capabilities through Gemini's multilingual support
- Optimize for <2s response latency using Lambda performance tuning

### Phase 3: Advanced Intelligence (Day 5-6)
- Enhance trend detection with YouTube Shorts analytics and engagement metrics
- Implement dynamic personality switching in Amazon Bedrock reasoning
- Add computer vision for inventory verification using Gemini Vision
- Deploy advanced pricing algorithms with A/B testing

### Phase 4: Scale & Optimize (Day 7-8)
- Multi-tenant architecture with Supabase row-level security
- Performance optimization and load testing on AWS Lambda
- Advanced analytics dashboard using AWS QuickSight
- Beta testing with select retail partners

**Cost Efficiency**: The entire prototype runs on AWS Free Tier + $100 hackathon credits, with Gemini Tier 1 API providing generous free quotas. Production costs scale linearly with usage—retailers only pay when customers interact with the system.

This requirements document serves as the foundation for implementing VyaparGyan's multi-agent retail intelligence platform, ensuring all stakeholders understand the technical complexity and business value of the autonomous retail ecosystem.


## Future Vision

VyaparGyan is designed to evolve from a pricing copilot into a complete AI operating system for retail:

### ONDC Integration
Connect to India's Open Network for Digital Commerce, enabling retailers to manage pricing strategy across multiple platforms from one central AI brain. Sell on Amazon, Flipkart, and your own store—VyaparGyan optimizes pricing everywhere.

### Voice Commerce Expansion
Beyond WhatsApp: phone calls, smart speakers, in-store voice kiosks. Customers can negotiate naturally in any channel, and the AI maintains context across all touchpoints.

### Multilingual Support
Current: Hindi/English code-switching  
Next: Tamil, Telugu, Bengali, Marathi, Gujarati, and more  
Goal: Every retailer in India gets AI assistance in their native language

### Complete Retail Intelligence Platform
- **Predictive Sourcing**: AI recommends what inventory to buy before trends peak
- **Automated Reordering**: Dynamic inventory management based on trend velocity
- **Customer Intelligence**: Build profiles, predict preferences, personalize offers
- **Financial Integration**: Automated accounting, tax filing, working capital optimization

**The Vision**: Transform India's 60+ million small retailers into data-driven, AI-powered businesses that compete on intelligence, not just capital. VyaparGyan becomes the "brain" that every retailer needs to thrive in the digital economy.