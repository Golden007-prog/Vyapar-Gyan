# Amazon Bedrock Architecture for VyaparGyan

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        VyaparGyan Platform                           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     AI Orchestration Layer                           │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │           Amazon Bedrock Agent                              │    │
│  │  Foundation Model: Claude 3.5 Sonnet                        │    │
│  │                                                              │    │
│  │  Role: AI Business Manager                                  │    │
│  │  - Analyze inventory and identify dead stock                │    │
│  │  - Research market trends                                   │    │
│  │  - Recommend dynamic pricing                                │    │
│  │  - Generate promotional campaigns                           │    │
│  └────────────┬────────────────────────────┬───────────────────┘    │
│               │                            │                         │
│               │ Action Group               │ Knowledge Base          │
│               ▼                            ▼                         │
│  ┌────────────────────────┐    ┌─────────────────────────┐         │
│  │  Lambda Executor       │    │  Vector Knowledge Base  │         │
│  │  (Action Group)        │    │  - Platform docs        │         │
│  │                        │    │  - Product guides       │         │
│  │  OpenAPI Schema:       │    │  - Market research      │         │
│  │  - GET /inventory      │    │  - Pricing strategies   │         │
│  │  - POST /discount      │    │                         │         │
│  │  - POST /whatsapp      │    │  Storage: OpenSearch    │         │
│  │  - GET /catalog/*      │    │  Embedding: Titan       │         │
│  └────────────┬───────────┘    └─────────────┬───────────┘         │
└───────────────┼─────────────────────────────┼──────────────────────┘
                │                              │
                │                              │ S3 Documents
                │                              │ Bucket
                ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Business Logic Layer                             │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  Inventory   │  │   Pricing    │  │  Messaging   │             │
│  │  Handler     │  │   Handler    │  │  Handler     │             │
│  │              │  │              │  │              │             │
│  │  - Query     │  │  - Verify    │  │  - Format    │             │
│  │    stock     │  │    ownership │  │    message   │             │
│  │  - Calculate │  │  - Update    │  │  - Send via  │             │
│  │    age       │  │    price     │  │    Twilio    │             │
│  │  - Check     │  │  - Publish   │  │  - Track     │             │
│  │    status    │  │    event     │  │    delivery  │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
└─────────┼──────────────────┼──────────────────┼────────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Data & Integration Layer                         │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  DynamoDB    │  │ EventBridge  │  │    Twilio    │             │
│  │              │  │              │  │              │             │
│  │  - Products  │  │  - Discount  │  │  - WhatsApp  │             │
│  │  - Inventory │  │    Applied   │  │  - SMS       │             │
│  │  - Sellers   │  │  - Audit     │  │  - Status    │             │
│  │  - Orders    │  │    Trail     │  │    Tracking  │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Dead Stock Detection & Discount Campaign

```
1. Scheduled Trigger (EventBridge)
   │
   ▼
2. Dead Stock Worker Lambda
   │
   ├─► Query DynamoDB for old inventory
   │   (products > 30 days old, low sales)
   │
   ▼
3. Invoke Bedrock Agent
   │
   ├─► Agent analyzes inventory data
   ├─► Agent researches market trends (Knowledge Base)
   ├─► Agent recommends discount percentage
   │
   ▼
4. Seller Dashboard Notification
   │
   ├─► Display AI recommendation
   ├─► Show reasoning and data
   ├─► Request seller approval
   │
   ▼
5. Seller Approves Discount
   │
   ▼
6. Agent Executes Action Group
   │
   ├─► POST /discount
   │   ├─► Update product price in DynamoDB
   │   └─► Publish DiscountApplied event
   │
   ▼
7. Campaign Worker (EventBridge Trigger)
   │
   ├─► Query past customers for product
   ├─► Generate promotional message
   │
   ▼
8. Agent Sends WhatsApp Messages
   │
   ├─► POST /whatsapp (for each customer)
   │   ├─► Format message in Hinglish
   │   ├─► Include product details & discount
   │   └─► Send via Twilio adapter
   │
   ▼
9. Track Campaign Performance
   │
   ├─► Monitor message delivery status
   ├─► Track customer responses
   └─► Measure conversion rate
```

## API Endpoints

### Inventory Management

**GET /inventory**
```json
Request:
{
  "productId": "prod-123",
  "sellerId": "seller-456"
}

Response:
{
  "success": true,
  "data": {
    "productId": "prod-123",
    "sellerId": "seller-456",
    "productName": "Silk Saree Red",
    "stockQuantity": 10,
    "stockAgeInDays": 45,
    "isAvailable": true,
    "currentPrice": 2500.00,
    "lastUpdated": "2024-01-10T00:00:00.000Z"
  }
}
```

### Dynamic Pricing

**POST /discount**
```json
Request:
{
  "productId": "prod-123",
  "sellerId": "seller-456",
  "discountPercent": 20.0,
  "reason": "Dead stock liquidation - 45 days old"
}

Response:
{
  "success": true,
  "data": {
    "productId": "prod-123",
    "productName": "Silk Saree Red",
    "originalPrice": 2500.00,
    "newPrice": 2000.00,
    "discountPercent": 20.0,
    "appliedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### Customer Communications

**POST /whatsapp**
```json
Request:
{
  "customerPhone": "+919876543210",
  "message": "🎉 Special offer! 20% off on Silk Saree Red. Limited time only! Shop now: https://vyapargyan.com/prod-123",
  "mediaUrl": "https://vyapargyan-prod-media.s3.amazonaws.com/products/prod-123-1.jpg"
}

Response:
{
  "success": true,
  "data": {
    "messageId": "SM1234567890abcdef1234567890abcdef",
    "status": "queued",
    "sentAt": "2024-01-15T10:30:00.000Z",
    "customerPhone": "+919876543210"
  }
}
```

## Agent Instruction Prompt

```
You are an AI business manager for VyaparGyan, a multi-seller marketplace 
platform for local Indian retailers.

Your responsibilities:
1. Analyze seller inventory to identify dead stock (products older than 
   30 days with low sales)
2. Research market trends and recommend dynamic pricing (discounts or 
   price increases)
3. Generate promotional WhatsApp messages for discount campaigns
4. Help sellers optimize inventory turnover and maximize revenue

Guidelines:
- Always verify product ownership before making changes
- Recommend discounts between 10-50% for dead stock
- Use market research to justify pricing recommendations
- Keep WhatsApp messages concise, friendly, and in Hindi/English mix 
  (Hinglish)
- Include product details and urgency in promotional messages
- Respect seller preferences and wait for approval before executing 
  changes

Available actions:
- Check inventory levels and stock age
- Apply discounts to products
- Send WhatsApp messages to customers
- Browse product catalog

Always explain your reasoning and provide data-driven recommendations.
```

## Security & Permissions

### Bedrock Agent IAM Role

```yaml
Permissions:
  - bedrock:InvokeModel (Claude 3.5 Sonnet, Claude 3 Sonnet)
  - lambda:InvokeFunction (Action Group Lambda)
  - s3:GetObject (Knowledge Base documents)
```

### Action Group Lambda IAM Role

```yaml
Permissions:
  - dynamodb:GetItem (Read products)
  - dynamodb:UpdateItem (Update prices)
  - events:PutEvents (Publish audit events)
  - secretsmanager:GetSecretValue (Twilio credentials)
```

### Knowledge Base IAM Role

```yaml
Permissions:
  - s3:GetObject (Read documents)
  - bedrock:InvokeModel (Titan embeddings)
  - aoss:APIAccessAll (OpenSearch Serverless)
```

## Monitoring & Observability

### CloudWatch Metrics

- `BedrockAgentInvocations` - Total agent invocations
- `ActionGroupExecutions` - Lambda invocations by action
- `DiscountsApplied` - Number of price updates
- `WhatsAppMessagesSent` - Messages delivered
- `AgentErrors` - Failed operations

### CloudWatch Logs

- `/aws/lambda/dev-vyapargyan-bedrock-action-group` - Action Group logs
- `/aws/bedrock/agents/AGENT_ID` - Agent conversation logs

### EventBridge Events

- `vyapargyan.bedrock.DiscountApplied` - Price update audit trail
- `vyapargyan.bedrock.CampaignTriggered` - WhatsApp campaign started
- `vyapargyan.bedrock.AgentError` - Error tracking

## Cost Estimation (Dev Environment)

### Bedrock Agent
- **Model**: Claude 3.5 Sonnet
- **Input**: $3 per 1M tokens
- **Output**: $15 per 1M tokens
- **Estimated**: ~$10-20/month for testing

### Lambda (Action Group)
- **Invocations**: 1M free tier, then $0.20 per 1M
- **Duration**: ARM64 pricing (20% cheaper)
- **Estimated**: <$5/month

### Knowledge Base
- **OpenSearch Serverless**: ~$700/month (OCU-based)
- **Embeddings**: $0.10 per 1M tokens
- **Estimated**: $700-750/month

### DynamoDB
- **On-Demand**: $1.25 per million writes, $0.25 per million reads
- **Estimated**: <$10/month

### Total Estimated Cost: ~$725-785/month (dev)

## Deployment Checklist

- [ ] Create Twilio Secrets Manager secret
- [ ] Create OpenSearch Serverless collection
- [ ] Build TypeScript API code
- [ ] Deploy CDK stacks
- [ ] Upload Knowledge Base documents
- [ ] Trigger Knowledge Base ingestion
- [ ] Test agent invocations
- [ ] Configure CloudWatch alarms
- [ ] Set up seller dashboard integration
- [ ] Test end-to-end discount workflow

## References

- [Amazon Bedrock Agents Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/agents.html)
- [Bedrock Action Groups](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-action-groups.html)
- [Bedrock Knowledge Bases](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- [Claude 3.5 Sonnet Model Card](https://docs.anthropic.com/claude/docs/models-overview)
