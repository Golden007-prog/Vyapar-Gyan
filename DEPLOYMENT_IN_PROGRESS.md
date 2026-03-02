# VyaparGyan - Phases 2 & 3 Deployment In Progress

## Deployment Status: 🚀 ACTIVE

**Started**: March 2, 2026 at 4:51 PM IST  
**Environment**: dev  
**Region**: ap-south-1 (Mumbai)  
**Account**: 856888988795

## Stacks Being Deployed

### ✅ 1. Database Stack (dev-vyapargyan-database)
**Status**: Complete (no changes)
- DynamoDB table: `dev-vyapargyan-main`
- Table ARN: `arn:aws:dynamodb:ap-south-1:856888988795:table/dev-vyapargyan-main`
- Streams enabled for change data capture

### ✅ 2. Auth Stack (dev-vyapargyan-auth)
**Status**: Complete (no changes)
- Cognito User Pool: `ap-south-1_jeKcCOzvw`
- API Service Client: `4upakr1thr49m6ghtadkm6rmpb`
- Web Admin Client: `50upimcsem8nudea04l4ntld2f`
- Web Seller Client: `7fo79pf9va180tvmagefefngcg`

### 🔄 3. Storage Stack (dev-vyapargyan-storage)
**Status**: Deploying - Phase 2 Components
- S3 Buckets: product-images, documents, logs
- **NEW**: Inventory Upload Lambda Function
- **NEW**: S3 Event Notifications for CSV and image uploads
- **NEW**: IAM roles and policies for Lambda execution

**Resources Being Created**:
- ✅ IAM Role: BucketNotificationsHandler
- ✅ IAM Role: InventoryUploadFunction/ServiceRole
- ✅ IAM Policy: BucketNotificationsHandler/DefaultPolicy
- ✅ IAM Policy: InventoryUploadFunction/DefaultPolicy
- 🔄 Lambda Function: BucketNotificationsHandler
- 🔄 Lambda Function: InventoryUploadFunction

### ⏳ 4. Events Stack (dev-vyapargyan-events)
**Status**: Queued - Phase 3 Components
- EventBridge event bus
- SQS queues for WhatsApp messages
- WhatsApp worker Lambda
- **NEW**: Trend Analyzer Lambda Function
- **NEW**: EventBridge Scheduled Rule (daily at 2:00 AM IST)

### ⏳ 5. API Stack (dev-vyapargyan-api)
**Status**: Queued
- API Gateway HTTP API
- WhatsApp webhook Lambda
- CORS configuration

## Phase 2: Automated Stock Ingestion

### Components Deployed

1. **Gemini Adapter** (`services/api/src/adapters/gemini-adapter.ts`)
   - Google Gemini Vision API integration
   - OCR for handwritten Khata books
   - Structured product data extraction

2. **Inventory Upload Handler** (`services/api/src/handlers/seller/inventory-upload-handler.ts`)
   - S3-triggered Lambda function
   - CSV parsing for bulk uploads
   - Image OCR processing
   - Batch writes to DynamoDB

3. **S3 Event Triggers**
   - Prefix: `sellers/{sellerId}/inventory/`
   - Suffixes: `.csv`, `.jpg`, `.jpeg`, `.png`, `.webp`
   - Automatic Lambda invocation

### Features Enabled

- ✅ Sellers can upload CSV files with product inventory
- ✅ Sellers can photograph handwritten Khata books
- ✅ Automatic OCR extraction using Gemini Vision
- ✅ Bulk product creation in DynamoDB
- ✅ Error handling and logging

## Phase 3: Proactive AI Insights

### Components Deployed

1. **Grok Adapter** (`services/api/src/adapters/grok-adapter.ts`)
   - xAI Grok API integration
   - Market trend analysis
   - Dynamic pricing recommendations
   - Fallback logic for API failures

2. **Trend Analyzer Worker** (`services/api/src/handlers/ai/trend-analyzer-worker.ts`)
   - Scheduled Lambda function
   - Queries aging inventory (60+ days)
   - Analyzes market trends via Grok
   - Generates seller insights
   - Batch processing with rate limiting

3. **EventBridge Scheduled Rule**
   - Schedule: Daily at 2:00 AM IST (20:30 UTC)
   - Target: Trend Analyzer Lambda
   - Automatic execution

### Features Enabled

- ✅ Daily analysis of aging inventory
- ✅ Market demand assessment
- ✅ Pricing recommendations (increase/decrease/maintain)
- ✅ Dead stock alerts
- ✅ Seller insights with actionable recommendations
- ✅ 7-day insight expiration

## Configuration

### Secrets Manager

Both API keys are configured:
- ✅ `/dev/gemini/api-key` - Google Gemini API
- ✅ `/dev/grok/api-key` - xAI Grok API

### Environment Variables

Lambda functions configured with:
- `ENVIRONMENT`: dev
- `TABLE_NAME`: dev-vyapargyan-main
- `PRODUCT_IMAGES_BUCKET`: dev-vyapargyan-product-images
- `DOCUMENTS_BUCKET`: dev-vyapargyan-documents
- `LOG_LEVEL`: info

## Monitoring Deployment

### Check Stack Status
```bash
aws cloudformation describe-stacks \
  --stack-name dev-vyapargyan-storage \
  --profile kiro-mcp \
  --region ap-south-1
```

### Watch CloudFormation Events
```bash
aws cloudformation describe-stack-events \
  --stack-name dev-vyapargyan-storage \
  --max-items 20 \
  --profile kiro-mcp \
  --region ap-south-1
```

### List All Stacks
```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --profile kiro-mcp \
  --region ap-south-1
```

## Post-Deployment Testing

### Phase 2: Test Inventory Upload

1. **Create test CSV**:
```csv
name,quantity,price,description,categoryId
Test Product 1,10,500,Test description,cat-test
Test Product 2,5,1000,Another test,cat-test
```

2. **Upload to S3**:
```bash
aws s3 cp test-inventory.csv \
  s3://dev-vyapargyan-documents/sellers/test-seller-123/inventory/test.csv \
  --profile kiro-mcp \
  --region ap-south-1
```

3. **Monitor Lambda logs**:
```bash
aws logs tail /aws/lambda/dev-vyapargyan-inventory-upload \
  --follow \
  --profile kiro-mcp \
  --region ap-south-1
```

### Phase 3: Test Trend Analyzer

1. **Invoke manually**:
```bash
aws lambda invoke \
  --function-name dev-vyapargyan-trend-analyzer \
  --payload '{}' \
  response.json \
  --profile kiro-mcp \
  --region ap-south-1
```

2. **Check logs**:
```bash
aws logs tail /aws/lambda/dev-vyapargyan-trend-analyzer \
  --follow \
  --profile kiro-mcp \
  --region ap-south-1
```

3. **Query insights**:
```bash
aws dynamodb scan \
  --table-name dev-vyapargyan-main \
  --filter-expression "begins_with(SK, :sk)" \
  --expression-attribute-values '{":sk":{"S":"INSIGHT#"}}' \
  --profile kiro-mcp \
  --region ap-south-1
```

## Expected Completion Time

- Storage Stack: ~5-7 minutes (Lambda creation)
- Events Stack: ~3-5 minutes (Lambda + EventBridge rule)
- API Stack: ~2-3 minutes (no changes expected)

**Total**: ~10-15 minutes

## Success Criteria

### Phase 2
- ✅ Inventory upload Lambda deployed
- ✅ S3 event notifications configured
- ✅ Test CSV upload creates products
- ✅ Test image upload triggers OCR

### Phase 3
- ✅ Trend analyzer Lambda deployed
- ✅ EventBridge scheduled rule created
- ✅ Manual invocation succeeds
- ✅ Insights generated in DynamoDB

## Next Steps After Deployment

1. **Verify all Lambda functions**:
   ```bash
   aws lambda list-functions \
     --query 'Functions[?starts_with(FunctionName, `dev-vyapargyan`)].FunctionName' \
     --profile kiro-mcp \
     --region ap-south-1
   ```

2. **Test Phase 2 with sample uploads**

3. **Test Phase 3 with manual invocation**

4. **Monitor CloudWatch logs for errors**

5. **Verify EventBridge schedule is active**:
   ```bash
   aws events list-rules \
     --name-prefix dev-vyapargyan \
     --profile kiro-mcp \
     --region ap-south-1
   ```

6. **Begin Phase 4 development**: Automated Conversion Campaigns

## Rollback Plan

If deployment fails:

```bash
# Rollback storage stack
aws cloudformation cancel-update-stack \
  --stack-name dev-vyapargyan-storage \
  --profile kiro-mcp \
  --region ap-south-1

# Or delete and redeploy
cd infra/cdk
pnpm cdk destroy dev-vyapargyan-storage --context env=dev
pnpm cdk deploy dev-vyapargyan-storage --context env=dev
```

## Documentation

- ✅ `PHASE_2_STOCK_INGESTION_COMPLETE.md` - Phase 2 implementation details
- ✅ `PHASE_2_DEPLOYMENT_CHECKLIST.md` - Phase 2 deployment guide
- ✅ `PHASE_3_AI_INSIGHTS_COMPLETE.md` - Phase 3 implementation details
- ✅ This file - Deployment status and monitoring

---

**Deployment initiated by**: Kiro AI Assistant  
**Deployment command**: `pnpm cdk deploy --all --context env=dev --require-approval never`  
**Working directory**: `infra/cdk`

**Monitor deployment**: Check terminal output or CloudFormation console
