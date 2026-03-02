# Phase 2: Automated Stock Ingestion - Implementation Complete

## Overview

Phase 2 implements automated inventory ingestion for sellers through CSV uploads and Khata book image OCR. Sellers can now bulk-upload their inventory by uploading files to S3, which triggers automated processing and product creation in DynamoDB.

## Components Implemented

### 1. Gemini Adapter (`services/api/src/adapters/gemini-adapter.ts`)

**Purpose**: Provides OCR capabilities for extracting structured product data from handwritten Khata book images.

**Key Features**:
- Integrates with Google Gemini Vision API (gemini-1.5-flash model)
- Extracts product name, quantity, and price from handwritten ledgers
- Returns structured JSON array with validated product data
- Handles various image formats (JPEG, PNG, WebP)
- Robust error handling and logging

**API**:
```typescript
interface KhataBookProduct {
  name: string;
  quantity: number;
  price: number;
}

async parseKhataBookImage(
  imageBuffer: Buffer,
  mimeType: string
): Promise<KhataBookProduct[]>
```

**Prompt Engineering**:
- Instructs Gemini to extract tabular data in strict JSON format
- Handles transliteration from Hindi/regional languages to English
- Validates extracted data (skips invalid entries)
- Defaults quantity to 1 if not specified

### 2. Inventory Upload Handler (`services/api/src/handlers/seller/inventory-upload-handler.ts`)

**Purpose**: S3-triggered Lambda function that processes inventory uploads and creates products in DynamoDB.

**Trigger**: S3 ObjectCreated events on documents bucket with filters:
- Prefix: `sellers/`
- Suffixes: `.csv`, `.jpg`, `.jpeg`, `.png`, `.webp`

**Expected S3 Key Format**: `sellers/{sellerId}/inventory/{filename}`

**Processing Flow**:
1. Extract sellerId from S3 object key
2. Download file from S3
3. Parse file based on extension:
   - CSV: Parse using csv-parse library
   - Image: Extract using Gemini OCR
4. Validate extracted product data
5. Batch write products to DynamoDB (25 items per batch)

**CSV Format**:
```csv
name,quantity,price,description,categoryId
Basmati Rice,10,500,Premium quality rice,cat-grains
Toor Dal,5,150,Yellow lentils,cat-pulses
```

**DynamoDB Schema**:
```typescript
{
  PK: "PRODUCT#{productId}",
  SK: "METADATA",
  id: "prod-{timestamp}-{random}",
  sellerId: "{sellerId}",
  categoryId: "{categoryId}" || "uncategorized",
  name: "{product name}",
  description: "{description}" || "",
  price: {price},
  originalPrice: {price},
  discountedPrice: null,
  isDeadStock: false,
  stockQuantity: {quantity},
  stockAddedDate: "{ISO timestamp}",
  imageUrls: [],
  isActive: true,
  createdAt: "{ISO timestamp}",
  updatedAt: "{ISO timestamp}"
}
```

**Error Handling**:
- Logs errors but continues processing other records
- Skips invalid CSV rows with warnings
- Validates numeric fields (quantity, price)
- Handles Gemini API failures gracefully

### 3. Infrastructure Updates (`infra/cdk/lib/stacks/storage-stack.ts`)

**Changes**:
- Added `table` parameter to StorageStackProps
- Created `inventoryUploadFunction` Lambda with:
  - Runtime: Node.js 20 on ARM64
  - Memory: 1024 MB (for Gemini API calls)
  - Timeout: 60 seconds (for image processing)
  - Environment variables: TABLE_NAME, PRODUCT_IMAGES_BUCKET, DOCUMENTS_BUCKET
- Granted permissions:
  - DynamoDB: WriteData on main table
  - S3: Read on documents bucket
- Added S3 event sources:
  - CSV files: `sellers/**/*.csv`
  - Images: `sellers/**/*.{jpg,jpeg,png,webp}`

**CDK App Updates** (`infra/cdk/bin/app.ts`):
- StorageStack now depends on DatabaseStack
- Passes `table` reference to StorageStack

## Configuration

### Environment Variables (Lambda)

The inventory upload function requires:
- `ENVIRONMENT`: Deployment environment (dev/staging/prod)
- `TABLE_NAME`: DynamoDB table name
- `PRODUCT_IMAGES_BUCKET`: S3 bucket for product images
- `DOCUMENTS_BUCKET`: S3 bucket for documents and uploads
- `LOG_LEVEL`: Logging level (default: info)

### AWS Secrets Manager

Gemini API key must be stored in Secrets Manager:
- Secret path: `/{environment}/gemini/api-key`
- Retrieved by config.ts during Lambda initialization

## Dependencies Added

### services/api/package.json
- `@google/generative-ai`: ^0.21.0 - Google Gemini SDK
- `csv-parse`: ^5.5.6 - CSV parsing library

## Usage

### For Sellers (via Web Dashboard)

1. Navigate to inventory upload section
2. Upload CSV file or Khata book image
3. File is uploaded to S3 with key: `sellers/{sellerId}/inventory/{filename}`
4. Lambda processes file automatically
5. Products appear in seller's catalog within seconds

### CSV Upload Example

```csv
name,quantity,price,description,categoryId
Silk Saree Red,5,2500,Beautiful red silk saree,cat-sarees
Cotton Kurta,10,800,Comfortable cotton kurta,cat-clothing
Brass Lamp,3,1200,Traditional brass diya,cat-home
```

### Khata Book Image Upload

- Sellers photograph their handwritten ledger
- Upload image (JPEG/PNG/WebP)
- Gemini extracts product data automatically
- Products created with extracted information

## Testing

### Manual Testing

1. **CSV Upload**:
```bash
aws s3 cp test-inventory.csv s3://vyapargyan-dev-documents/sellers/seller-123/inventory/test.csv --profile kiro-mcp
```

2. **Image Upload**:
```bash
aws s3 cp khata-book.jpg s3://vyapargyan-dev-documents/sellers/seller-123/inventory/khata.jpg --profile kiro-mcp
```

3. **Check CloudWatch Logs**:
```bash
aws logs tail /aws/lambda/vyapargyan-dev-inventory-upload --follow --profile kiro-mcp
```

4. **Verify DynamoDB**:
```bash
aws dynamodb query \
  --table-name vyapargyan-dev-main \
  --index-name SellerStockIndex \
  --key-condition-expression "sellerId = :sid" \
  --expression-attribute-values '{":sid":{"S":"seller-123"}}' \
  --profile kiro-mcp
```

### Integration Testing

Create test files in `services/api/test/integration/inventory-upload.test.ts`:
- Test CSV parsing with valid/invalid data
- Test Gemini OCR with sample images
- Test DynamoDB batch writes
- Test error handling and retries

## Deployment

### Prerequisites

1. Install dependencies:
```bash
cd services/api
pnpm install
```

2. Build TypeScript:
```bash
pnpm build
```

3. Ensure Gemini API key is in Secrets Manager:
```bash
aws secretsmanager create-secret \
  --name /dev/gemini/api-key \
  --secret-string "YOUR_GEMINI_API_KEY" \
  --profile kiro-mcp
```

### Deploy Infrastructure

```bash
cd infra/cdk
pnpm install
pnpm cdk deploy --all --context env=dev
```

### Verify Deployment

1. Check Lambda function exists:
```bash
aws lambda get-function --function-name vyapargyan-dev-inventory-upload --profile kiro-mcp
```

2. Check S3 event notifications:
```bash
aws s3api get-bucket-notification-configuration \
  --bucket vyapargyan-dev-documents \
  --profile kiro-mcp
```

3. Test with sample upload (see Manual Testing above)

## Monitoring

### CloudWatch Metrics

- **Lambda Invocations**: Number of files processed
- **Lambda Duration**: Processing time per file
- **Lambda Errors**: Failed processing attempts
- **Lambda Throttles**: Rate limiting issues

### CloudWatch Logs

Log groups:
- `/aws/lambda/vyapargyan-dev-inventory-upload`

Key log messages:
- "Processing inventory upload" - File received
- "Extracted products from file" - Parsing complete
- "Saved product batch to DynamoDB" - Batch write success
- "Successfully processed inventory upload" - End-to-end success
- "Failed to process inventory upload" - Error occurred

### Alarms (Recommended)

Create CloudWatch alarms for:
- Lambda errors > 5 in 5 minutes
- Lambda duration > 50 seconds (approaching timeout)
- DynamoDB write throttling

## Future Enhancements

### Phase 2.1: Enhanced OCR
- Support for multi-page Khata books
- Automatic language detection
- Confidence scores for extracted data
- Manual review workflow for low-confidence extractions

### Phase 2.2: Validation & Enrichment
- Category auto-detection from product names
- Price validation against market data
- Duplicate product detection
- Image generation for products without images

### Phase 2.3: Bulk Operations
- Update existing products via CSV
- Delete products via CSV
- Export current inventory to CSV
- Scheduled inventory sync

## Security Considerations

- S3 bucket access restricted to authenticated sellers
- Lambda execution role follows least privilege
- Gemini API key stored in Secrets Manager
- Input validation on all extracted data
- Rate limiting on Gemini API calls

## Cost Optimization

- ARM64 architecture for 20% cost savings
- Batch writes to DynamoDB (25 items per request)
- Efficient S3 event filtering (prefix/suffix)
- Gemini Flash model (cheaper than Pro)
- CloudWatch log retention policies

## Troubleshooting

### Issue: Lambda timeout
**Solution**: Increase timeout or reduce batch size

### Issue: Gemini API rate limit
**Solution**: Implement exponential backoff and retry logic

### Issue: Invalid CSV format
**Solution**: Provide CSV template and validation in UI

### Issue: Poor OCR accuracy
**Solution**: Improve image quality guidelines for sellers

### Issue: DynamoDB throttling
**Solution**: Enable auto-scaling or use on-demand billing

## Documentation Links

- [Gemini API Documentation](https://ai.google.dev/docs)
- [AWS Lambda S3 Triggers](https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html)
- [DynamoDB Batch Operations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/batch-operations.html)
- [CSV Parse Library](https://csv.js.org/parse/)

---

**Status**: ✅ Implementation Complete - Ready for Deployment

**Next Phase**: Phase 3 - Proactive AI Insights (Dead Stock Detection & Market Trend Analysis)
