# Phase 2: Automated Stock Ingestion - Deployment Checklist

## Pre-Deployment

### 1. Install Dependencies
```bash
cd services/api
pnpm install
```

### 2. Configure Gemini API Key

Create the secret in AWS Secrets Manager:
```bash
aws secretsmanager create-secret \
  --name /dev/gemini/api-key \
  --secret-string "YOUR_GEMINI_API_KEY_HERE" \
  --region us-east-1 \
  --profile kiro-mcp
```

For staging/prod:
```bash
aws secretsmanager create-secret \
  --name /staging/gemini/api-key \
  --secret-string "YOUR_GEMINI_API_KEY_HERE" \
  --region us-east-1 \
  --profile kiro-mcp

aws secretsmanager create-secret \
  --name /prod/gemini/api-key \
  --secret-string "YOUR_GEMINI_API_KEY_HERE" \
  --region us-east-1 \
  --profile kiro-mcp
```

### 3. Build TypeScript
```bash
cd services/api
pnpm build
```

Verify build output:
```bash
ls -la dist/handlers/seller/inventory-upload-handler.js
ls -la dist/adapters/gemini-adapter.js
```

## Deployment

### 1. Deploy Infrastructure
```bash
cd infra/cdk
pnpm install
pnpm cdk synth --context env=dev
pnpm cdk deploy --all --context env=dev
```

### 2. Verify Stack Outputs
```bash
aws cloudformation describe-stacks \
  --stack-name vyapargyan-dev-storage \
  --query 'Stacks[0].Outputs' \
  --profile kiro-mcp
```

Expected outputs:
- `InventoryUploadFunctionArn`
- `DocumentsBucketName`
- `ProductImagesBucketName`

### 3. Verify Lambda Function
```bash
aws lambda get-function \
  --function-name vyapargyan-dev-inventory-upload \
  --profile kiro-mcp
```

Check:
- Runtime: nodejs20.x
- Architecture: arm64
- Timeout: 60 seconds
- Memory: 1024 MB
- Environment variables set correctly

### 4. Verify S3 Event Notifications
```bash
aws s3api get-bucket-notification-configuration \
  --bucket vyapargyan-dev-documents \
  --profile kiro-mcp
```

Should show Lambda function configurations for:
- CSV files (suffix: .csv)
- Image files (suffixes: .jpg, .jpeg, .png, .webp)

## Post-Deployment Testing

### 1. Create Test CSV File

Create `test-inventory.csv`:
```csv
name,quantity,price,description,categoryId
Test Product 1,10,500,Test description,cat-test
Test Product 2,5,1000,Another test,cat-test
```

### 2. Upload Test CSV
```bash
aws s3 cp test-inventory.csv \
  s3://vyapargyan-dev-documents/sellers/test-seller-123/inventory/test.csv \
  --profile kiro-mcp
```

### 3. Monitor Lambda Execution
```bash
aws logs tail /aws/lambda/vyapargyan-dev-inventory-upload \
  --follow \
  --profile kiro-mcp
```

Expected log messages:
- "Processing inventory upload"
- "Extracted products from file"
- "Saved product batch to DynamoDB"
- "Successfully processed inventory upload"

### 4. Verify Products in DynamoDB
```bash
aws dynamodb scan \
  --table-name vyapargyan-dev-main \
  --filter-expression "begins_with(PK, :pk)" \
  --expression-attribute-values '{":pk":{"S":"PRODUCT#"}}' \
  --limit 10 \
  --profile kiro-mcp
```

### 5. Test Image Upload (Optional)

If you have a test Khata book image:
```bash
aws s3 cp khata-test.jpg \
  s3://vyapargyan-dev-documents/sellers/test-seller-123/inventory/khata.jpg \
  --profile kiro-mcp
```

Monitor logs and verify OCR extraction works.

## Rollback Plan

If issues occur:

### 1. Remove S3 Event Notifications
```bash
aws s3api put-bucket-notification-configuration \
  --bucket vyapargyan-dev-documents \
  --notification-configuration '{}' \
  --profile kiro-mcp
```

### 2. Delete Lambda Function
```bash
aws lambda delete-function \
  --function-name vyapargyan-dev-inventory-upload \
  --profile kiro-mcp
```

### 3. Rollback CDK Stack
```bash
cd infra/cdk
pnpm cdk destroy vyapargyan-dev-storage --context env=dev
```

## Monitoring Setup

### 1. Create CloudWatch Alarm for Errors
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name vyapargyan-dev-inventory-upload-errors \
  --alarm-description "Alert on inventory upload Lambda errors" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=FunctionName,Value=vyapargyan-dev-inventory-upload \
  --profile kiro-mcp
```

### 2. Create Dashboard (Optional)
```bash
aws cloudwatch put-dashboard \
  --dashboard-name vyapargyan-dev-inventory \
  --dashboard-body file://dashboard.json \
  --profile kiro-mcp
```

## Troubleshooting

### Lambda Not Triggering
- Check S3 event notification configuration
- Verify Lambda has permission to be invoked by S3
- Check S3 object key matches prefix/suffix filters

### Gemini API Errors
- Verify API key is correct in Secrets Manager
- Check API quota/rate limits
- Review CloudWatch logs for detailed error messages

### DynamoDB Write Errors
- Check Lambda execution role has write permissions
- Verify table name is correct
- Check for throttling in CloudWatch metrics

### CSV Parsing Errors
- Verify CSV format matches expected structure
- Check for special characters or encoding issues
- Review logs for specific parsing errors

## Success Criteria

✅ Lambda function deployed successfully  
✅ S3 event notifications configured  
✅ Test CSV upload creates products in DynamoDB  
✅ CloudWatch logs show successful processing  
✅ No errors in Lambda metrics  
✅ Gemini API integration working (if tested with image)

## Next Steps

After successful deployment:
1. Update seller dashboard UI to support file uploads
2. Add progress indicators for processing
3. Implement error notifications to sellers
4. Add bulk operation history/audit trail
5. Create seller documentation for CSV format

---

**Deployment Status**: Ready for deployment to dev environment
