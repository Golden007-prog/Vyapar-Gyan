# Product Requirements Document: VyaparGyan

## Executive Summary

VyaparGyan (व्यापार ज्ञान) is a Hierarchical Multi-Agent System (HMAS) that serves as the "Brain" for Indian retailers, bridging the critical gap between market intelligence and autonomous sales execution. The platform orchestrates two specialized AI agents: TrendSetu (Analyst Agent) continuously monitors social media to predict demand velocity, while SubhLabh (Negotiator Agent) conducts real-time voice-based negotiations with customers. The central Orchestrator dynamically adjusts pricing strategies and negotiation personalities based on trend intelligence, transforming traditional retail from blind sourcing and static pricing to predictive sourcing and autonomous selling.

## User Personas

### Primary Persona: The Shopkeeper (The Commander)
- **Profile**: Small to medium retail business owners in India
- **Pain Points**: Inventory decisions based on intuition, manual price negotiations, inability to capitalize on viral trends
- **Goals**: Maximize profit margins, reduce dead stock, automate customer interactions while maintaining control
- **Technical Comfort**: Basic smartphone usage, prefers voice-based interfaces over complex dashboards

### Secondary Persona: The Customer (The User)  
- **Profile**: Indian consumers seeking personalized shopping experiences with negotiation flexibility
- **Pain Points**: Static pricing, impersonal shopping experiences, complex checkout processes
- **Goals**: Fair pricing through negotiation, quick product discovery, seamless payment
- **Technical Comfort**: WhatsApp proficiency, voice note communication preference

## Functional Requirements

### The Analyst Agent (TrendSetu)

#### Core Capabilities
- **Video Content Processing**: Ingest social media video feeds from Instagram Reels, YouTube Shorts, and regional platforms
- **Frame-to-Text Analysis**: Extract visual elements, text overlays, and contextual information from video frames using Gemini 1.5 Pro Vision
- **Trend Velocity Calculation**: Generate hype scores (0.0-1.0) based on engagement metrics, hashtag frequency, and content virality patterns
- **Product Category Mapping**: Automatically categorize trending items into retail-relevant categories (Fashion, Electronics, Home Goods)

#### Technical Requirements
- **Processing Schedule**: Batch processing every 4 hours with emergency real-time triggers for viral content
- **Data Sources**: Instagram Graph API, YouTube Data API, Twitter API v2
- **Output Format**: Structured trend reports with confidence scores and recommended price adjustments
- **Storage**: Vector embeddings in Qdrant for semantic trend matching

### The Negotiator Agent (SubhLabh)

#### Core Capabilities
- **Voice Interface**: Real-time Speech-to-Text (Deepgram Nova-2) and Text-to-Speech (ElevenLabs) with Hindi/English code-switching
- **Dynamic Personality Switching**: Adjust negotiation style based on trend data (Aggressive, Balanced, Clearance modes)
- **Context-Aware Responses**: Reference trend data in negotiations ("This style is trending in Mumbai right now")
- **Inventory Integration**: Real-time stock checking and reservation during negotiations

#### Technical Requirements
- **Latency Target**: <500ms for voice response (STT -> LLM -> TTS pipeline)
- **Conversation Memory**: Maintain context across multi-turn negotiations using conversation state
- **Fallback Mechanisms**: Text-based negotiation via WhatsApp when voice fails
- **Payment Integration**: Generate UPI payment links upon deal closure

### The Orchestrator (Core Brain)

#### Core Capabilities
- **State Management**: Maintain shared context between Analyst and Negotiator agents using LangGraph state machines
- **Dynamic Pricing Engine**: Calculate floor prices and ask prices based on trend velocity and inventory levels
- **Strategy Assignment**: Determine negotiation personality and constraints for each product category
- **Cross-Agent Communication**: Facilitate data flow between asynchronous trend analysis and real-time negotiations

#### Technical Requirements
- **Decision Logic**: Rule-based engine with configurable business logic
- **State Persistence**: PostgreSQL for transactional data, Redis for session state
- **API Gateway**: RESTful APIs for tenant configuration and monitoring
- **Monitoring**: Real-time agent health monitoring and performance metrics

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
- **Voice Latency**: End-to-end voice response <500ms (STT + LLM inference + TTS)
- **Trend Processing**: Complete social media analysis cycle within 4-hour batch window
- **Concurrent Users**: Support 1000+ simultaneous voice negotiations per tenant
- **API Response Time**: REST API responses <200ms for 95th percentile

### Scalability Requirements
- **Horizontal Scaling**: Microservices architecture supporting independent agent scaling
- **Database Sharding**: Tenant-based data partitioning for multi-tenancy
- **Async Processing**: Queue-based architecture for trend analysis workloads
- **CDN Integration**: Global content delivery for voice and image assets

### Reliability Requirements
- **System Uptime**: 99.9% availability during business hours (9 AM - 9 PM IST)
- **Data Consistency**: ACID compliance for financial transactions and inventory updates
- **Fault Tolerance**: Graceful degradation when individual agents fail
- **Backup Strategy**: Real-time replication with <1 hour RPO

### Security Requirements
- **Data Encryption**: End-to-end encryption for voice conversations and payment data
- **Authentication**: Multi-factor authentication for tenant admin access
- **PCI Compliance**: Secure payment processing with tokenization
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
- **Orchestration Framework**: LangGraph for multi-agent state management
- **Large Language Models**: GPT-4o for complex reasoning, Llama 3 for edge inference
- **Computer Vision**: Gemini 1.5 Pro Vision for video content analysis
- **Voice Processing**: Deepgram Nova-2 (STT), ElevenLabs (TTS)
- **Databases**: PostgreSQL (transactional), Qdrant (vector search), Redis (session state)
- **Infrastructure**: Kubernetes for container orchestration, AWS/GCP for cloud services

### Integration Requirements
- **Social Media APIs**: Instagram Graph API, YouTube Data API, Twitter API v2
- **Payment Gateways**: UPI integration via Razorpay/PayU
- **Communication Channels**: WhatsApp Business API, WebRTC for voice calls
- **Monitoring**: Prometheus/Grafana for metrics, ELK stack for logging

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

### Phase 1: Core Agent Framework (Months 1-2)
- Implement LangGraph orchestration layer
- Build basic Analyst Agent with Instagram API integration
- Develop Negotiator Agent with text-based WhatsApp interface
- Create tenant onboarding and product catalog management

### Phase 2: Voice Integration (Months 3-4)
- Integrate Deepgram STT and ElevenLabs TTS
- Implement real-time voice negotiation pipeline
- Add Hindi/English code-switching capabilities
- Optimize for <500ms response latency

### Phase 3: Advanced Intelligence (Months 5-6)
- Enhance trend detection with multi-platform analysis
- Implement dynamic personality switching
- Add computer vision for inventory verification
- Deploy advanced pricing algorithms

### Phase 4: Scale & Optimize (Months 7-8)
- Multi-tenant architecture with database sharding
- Performance optimization and load testing
- Advanced analytics and reporting dashboard
- Beta testing with select retail partners

This requirements document serves as the foundation for implementing VyaparGyan's multi-agent retail intelligence platform, ensuring all stakeholders understand the technical complexity and business value of the autonomous retail ecosystem.