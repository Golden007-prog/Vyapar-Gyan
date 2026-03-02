# Phase 3: Proactive AI Insights - Implementation Complete

## Overview

Phase 3 implements the intelligent business manager core of VyaparGyan - a proactive AI system that analyzes seller inventory, identifies dead stock, researches market trends using Grok AI, and generates actionable pricing recommendations. This transforms VyaparGyan from a passive marketplace into an active business advisor.

## Components Implemented

### 1. Grok Adapter (`services/api/src/adapters/grok-adapter.ts`)

**Purpose**: Integrates with xAI Grok API for market trend research and dynamic pricing recommendations.

**Key Features**:
- Real-time market demand analysis for Indian retail products
- Competitive pricing landscape assessment
- Seasonal trend detection
- Dead stock risk evaluation based on stock age
- Actionable pricing recommendations (increase/maintain/decrease)
- Fallback logic when API is unavailable

**API**:
```typescript
interface MarketTrendAnalysis {
  category: string;
  productName: string;
  demandLevel: 'high' | 'medium' | 'low';
  priceRecommendation: 'increase' | 'maintain' | 'decrease';
  suggestedDiscountPercent?: number;
  suggestedPriceIncrease?: number;
  reasoning: string;
  marketInsights: string;
}

async analyzeMarketTrend(
  category: string,
  productName: string,
  currentPrice: number,
  stockAge: number
): Promise<MarketTrendAnalysis>
```

**Prompt Engineering**:
- Specialized for Indian retail market context
- Considers stock age as dead stock indicator
- Provides specific discount/increase percentages (10-30% for discounts, 5-15% for increases)
- Returns structured JSON for reliable parsing
- Low temperature (0.3) for consistent analysis

**Error Handling**:
- Conservative fallback analysis based on stock age
- Validates all response fields
- Caps discount/increase percentages to safe ranges
- Comprehensive logging for debugging

### 2. Trend Analyzer Worker (`services/api/src/handlers/ai/trend-analyzer-worker.ts`)

**Purpose**: Scheduled Lambda function that runs daily to analyze aging inventory and generate seller insights.

**Trigger**: EventBridge scheduled rule - Daily at 2:00 AM IST (20:30 UTC)

**Processing Flow**:
1. Calculate cutoff date (60 days ago)
2. Query DynamoDB for aging products (stock > 60 days old)
3. Process products in batches of 10
4. For each product:
   - Call Grok API for market trend analysis
   - Generate seller insight if action recommended
   - Save insight to DynamoDB
5. Add 2-second delay between batches (API rate limiting)

**Seller Insight Structure**:
```typescript
interface SellerInsight {
  id: string;
  sellerId: string;
  productId: string;
  insightType: 'pricing_recommendation' | 'dead_stock_alert' | 'market_trend';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  actionRecommended: string;
  suggestedDiscountPercent?: number;
  suggestedPriceIncrease?: number;
  marketInsights?: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
  expiresAt: string; // 7 days from creation
}
```

**DynamoDB Schema**:
```
PK: SELLER#{sellerId}
SK: INSIGHT#{insightId}
```

**Priority Logic**:
- High: Stock age > 90 days with decrease recommendation
- Medium: Stock age 60-90 days or price increase opportunity
- Low: Informational insights

**Batch Processing**:
- Processes up to 100 products per run
- 10 products per batch
- 2-second delay between batches
- Continues on individual product failures

### 3. Infrastructure Updates (`infra/cdk/lib/stacks/events-stack.ts`)

**Changes**:
- Added `trendAnalyzerFunction` Lambda:
  - Runtime: Node.js 20 on ARM64
  - Memory: 1024 MB
  - Timeout: 5 minutes (for batch processing)
  - Environment variables: TABLE_NAME, ENVIRONMENT, LOG_LEVEL
- Created EventBridge scheduled rule:
  - Schedule: Daily at 2:00 AM IST (cron: 30 20 * * ? *)
  - Target: Trend analyzer Lambda
- Granted permissions:
  - DynamoDB: ReadWriteData on main table

**Configuration Updates** (`services/api/src/utils/config.ts`):
- Added `grokApiKey` to config schema
- Loads from Secrets Manager: `/{environment}/grok/api-key`

## Business Logic

### Dead Stock Detection

Products are flagged as potential dead stock when:
- Stock age > 60 days AND
- Stock quantity > 0 AND
- Product is active

### Pricing Recommendations

**Decrease (Discount)**:
- Triggered when: Stock age > 60 days AND demand is low/medium
- Discount range: 10-30%
- Higher discounts for older stock (90+ days)

**Increase**:
- Triggered when: Demand is high AND stock is relatively fresh
- Increase range: 5-15%
- Based on market demand signals

**Maintain**:
- Stock is fresh (< 60 days)
- Market conditions are stable
- No immediate action needed

### Insight Lifecycle

1. **Generated**: Worker creates insight with status 'pending'
2. **Displayed**: Seller sees insight in dashboard
3. **Approved**: Seller accepts recommendation
4. **Applied**: System applies pricing change
5. **Expired**: Insight expires after 7 days if not acted upon

## Usage

### For Sellers (via Dashboard)

1. Log into seller dashboard
2. Navigate to "AI Insights" section
3. View pending recommendations sorted by priority
4. Review market analysis and reasoning
5. Approve or reject recommendations
6. System automatically applies approved changes

### Manual Trigger (Testing)

Invoke Lambda directly:
```bash
aws lambda invoke \
  --function-name vyapargyan-dev-trend-analyzer \
  --payload '{}' \
  response.json \
  --profile kiro-mcp
```

### Check CloudWatch Logs

```bash
aws logs tail /aws/lambda/vyapargyan-dev-trend-analyzer \
  --follow \
  --profile kiro-mcp
```

### Query Insights in DynamoDB

```bash
aws dynamodb query \
  --table-name vyapargyan-dev-main \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"SELLER#seller-123"},":sk":{"S":"INSIGHT#"}}' \
  --profile kiro-mcp
```

## Configuration

### Environment Variables (Lambda)

- `ENVIRONMENT`: Deployment environment (dev/staging/prod)
- `TABLE_NAME`: DynamoDB table name
- `LOG_LEVEL`: Logging level (default: info)

### AWS Secrets Manager

Grok API key must be stored:
- Secret path: `/{environment}/grok/api-key`
- Retrieved by config.ts during Lambda initialization

### EventBridge Schedule

- Cron expression: `cron(30 20 * * ? *)`
- Timezone: UTC (converts to 2:00 AM IST)
- Frequency: Daily
- Can be modified in events-stack.ts

## Monitoring

### CloudWatch Metrics

- **Lambda Invocations**: Daily execution count
- **Lambda Duration**: Processing time (should be < 5 minutes)
- **Lambda Errors**: Failed executions
- **Custom Metrics** (future):
  - Products analyzed per run
  - Insights generated per run
  - API call success rate

### CloudWatch Logs

Log groups:
- `/aws/lambda/vyapargyan-dev-trend-analyzer`

Key log messages:
- "Trend analyzer worker started" - Execution begins
- "Querying aging inventory" - Database query
- "Found aging products" - Products to analyze
- "Processing batch" - Batch processing progress
- "Generated seller insight" - Insight created
- "Trend analyzer worker completed" - Success summary

### Alarms (Recommended)

Create CloudWatch alarms for:
- Lambda errors > 1 in 24 hours
- Lambda duration > 4 minutes (approaching timeout)
- No invocations in 25 hours (schedule failure)

## Cost Optimization

### Lambda Costs
- ARM64 architecture: 20% cheaper than x86
- 1024 MB memory: Balanced for API calls
- 5-minute timeout: Sufficient for batch processing
- Daily execution: ~$0.01/day

### Grok API Costs
- ~10 products per day average
- ~$0.001 per API call
- ~$0.30/month for typical usage

### DynamoDB Costs
- Read: 100 products = 100 RCU
- Write: 10 insights = 10 WCU
- On-demand pricing: ~$0.01/day

**Total estimated cost**: ~$10-15/month for Phase 3

## Testing

### Unit Testing

Create tests in `services/api/src/handlers/ai/__tests__/`:
- Test Grok adapter with mock responses
- Test insight generation logic
- Test batch processing
- Test error handling

### Integration Testing

1. **Create test products**:
```bash
# Add products with old stock dates to DynamoDB
```

2. **Invoke worker manually**:
```bash
aws lambda invoke \
  --function-name vyapargyan-dev-trend-analyzer \
  --payload '{}' \
  response.json \
  --profile kiro-mcp
```

3. **Verify insights created**:
```bash
# Query DynamoDB for INSIGHT# items
```

4. **Check Grok API calls**:
```bash
# Review CloudWatch logs for API responses
```

## Future Enhancements

### Phase 3.1: Enhanced Analysis
- Multi-product trend analysis (category-level insights)
- Competitor pricing data integration
- Seasonal demand forecasting
- Customer sentiment analysis from reviews

### Phase 3.2: Automated Actions
- Auto-apply low-risk recommendations
- A/B testing for pricing strategies
- Dynamic pricing based on real-time demand
- Inventory reorder suggestions

### Phase 3.3: Advanced Insights
- Customer segment analysis
- Product bundling recommendations
- Cross-sell and upsell opportunities
- Churn prediction for products

### Phase 3.4: Seller Analytics Dashboard
- Revenue impact tracking
- Recommendation acceptance rate
- ROI from applied insights
- Market trend visualizations

## Security Considerations

- Grok API key stored in Secrets Manager
- Lambda execution role follows least privilege
- Insights visible only to respective sellers
- No PII sent to Grok API
- Rate limiting on API calls

## Troubleshooting

### Issue: No insights generated
**Solution**: Check if products exist with stock age > 60 days

### Issue: Grok API timeout
**Solution**: Increase Lambda timeout or reduce batch size

### Issue: Invalid JSON from Grok
**Solution**: Review prompt engineering, check API response format

### Issue: Lambda timeout
**Solution**: Reduce products per run or increase timeout

### Issue: High API costs
**Solution**: Implement caching, reduce analysis frequency

## Documentation Links

- [xAI Grok API Documentation](https://docs.x.ai/)
- [EventBridge Scheduled Rules](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html)
- [Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)

## Integration with Phase 4

Phase 3 generates insights that Phase 4 will act upon:
- Phase 3: Identifies dead stock and suggests discounts
- Phase 4: Sends WhatsApp campaigns to customers when seller approves
- Phase 3: Tracks which insights are applied
- Phase 4: Measures conversion rates from campaigns

## Success Metrics

- **Insight Generation Rate**: 5-10 insights per day per 100 products
- **Insight Acceptance Rate**: Target 30-40% of recommendations approved
- **Revenue Impact**: 10-15% increase in dead stock liquidation
- **API Reliability**: 95%+ successful Grok API calls
- **Processing Time**: < 3 minutes for 100 products

---

**Status**: ✅ Implementation Complete - Deploying to AWS

**Next Phase**: Phase 4 - Automated Conversion Campaigns (WhatsApp discount notifications)

## Deployment Status

Phase 2 (Stock Ingestion) and Phase 3 (AI Insights) are currently deploying to AWS dev environment. The deployment includes:

1. ✅ Gemini adapter for OCR
2. ✅ Inventory upload handler with S3 triggers
3. ✅ Grok adapter for market analysis
4. ✅ Trend analyzer worker with daily schedule
5. ✅ EventBridge scheduled rule (2:00 AM IST daily)
6. ✅ All necessary IAM permissions and CloudWatch logging

Monitor deployment progress with:
```bash
aws cloudformation describe-stacks \
  --stack-name vyapargyan-dev-events \
  --profile kiro-mcp
```
