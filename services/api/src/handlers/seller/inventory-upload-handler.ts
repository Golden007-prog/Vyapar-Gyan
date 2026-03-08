import { S3Event, S3Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { GeminiAdapter } from '../../adapters/gemini-adapter';

const s3Client = new S3Client({});
const dynamoDBClient = new DynamoDBClient({});

/**
 * Product data to be saved to DynamoDB
 */
interface ProductData {
  name: string;
  quantity: number;
  price: number;
  description?: string | undefined;
  categoryId?: string | undefined;
}

/**
 * Inventory Upload Handler
 * 
 * Triggered by S3 uploads to the documents bucket.
 * Processes CSV files and Khata book images to create products in DynamoDB.
 * 
 * Expected S3 key format: sellers/{sellerId}/inventory/{filename}
 */
export const handler: S3Handler = async (event: S3Event) => {
  const config = await getConfig();

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    logger.info('Processing inventory upload', { bucket, key });

    try {
      // Extract sellerId from S3 key
      const sellerId = extractSellerIdFromKey(key);
      if (!sellerId) {
        logger.error('Invalid S3 key format: cannot extract sellerId', { key });
        continue;
      }

      // Download file from S3
      const fileBuffer = await downloadFile(bucket, key);
      const fileExtension = key.split('.').pop()?.toLowerCase() || '';

      // Parse file based on type
      let products: ProductData[];
      if (fileExtension === 'csv') {
        products = await parseCSV(fileBuffer);
      } else if (['jpg', 'jpeg', 'png', 'webp'].includes(fileExtension || '')) {
        products = await parseKhataBookImage(fileBuffer, fileExtension);
      } else {
        logger.error('Unsupported file type', { key, fileExtension });
        continue;
      }

      logger.info('Extracted products from file', {
        key,
        productCount: products.length,
      });

      // Save products to DynamoDB
      await saveProducts(sellerId, products, config.tableName);

      logger.info('Successfully processed inventory upload', {
        key,
        sellerId,
        productCount: products.length,
      });
    } catch (error) {
      logger.error('Failed to process inventory upload', {
        bucket,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - continue processing other records
    }
  }
};

/**
 * Extract sellerId from S3 key
 * Expected format: sellers/{sellerId}/inventory/{filename}
 */
function extractSellerIdFromKey(key: string): string | null | undefined {
  const match = key.match(/^sellers\/([^/]+)\/inventory\//);
  return match ? match[1] : null;
}

/**
 * Download file from S3
 */
async function downloadFile(bucket: string, key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('Empty response body from S3');
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Parse CSV file and extract product data using Gemini-powered smart mapping
 * Falls back to deterministic header matching if Gemini is unavailable
 */
async function parseCSV(fileBuffer: Buffer): Promise<ProductData[]> {
  try {
    const csvContent = fileBuffer.toString('utf-8');
    const lines = csvContent.split('\n');
    
    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header row and one data row');
    }

    const headerLine = lines[0];
    if (!headerLine) {
      throw new Error('CSV file has no header row');
    }
    const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    
    // Collect sample rows for AI analysis
    const sampleRows: string[][] = [];
    for (let i = 1; i < Math.min(4, lines.length); i++) {
      const line = lines[i]?.trim();
      if (line) sampleRows.push(line.split(',').map(v => v.trim().replace(/^"|"$/g, '')));
    }

    // Try Gemini-powered smart mapping first
    let nameIdx = -1;
    let priceIdx = -1;
    let qtyIdx = -1;
    let categoryIdx = -1;
    let brandIdx = -1;

    try {
      const gemini = new GeminiAdapter();
      const mapping = await gemini.mapCsvColumns(headers, sampleRows);
      
      logger.info('Using Gemini CSV mapping', { mapping, confidence: mapping.confidence });
      
      if (mapping.name !== null) nameIdx = mapping.name;
      if (mapping.price !== null) priceIdx = mapping.price;
      if (mapping.quantity !== null) qtyIdx = mapping.quantity;
      if (mapping.category !== null) categoryIdx = mapping.category;
      if (mapping.brand !== null) brandIdx = mapping.brand;
    } catch (aiError) {
      logger.warn('Gemini CSV mapping failed, using deterministic fallback', {
        error: aiError instanceof Error ? aiError.message : String(aiError),
      });
    }

    // Deterministic fallback if AI didn't map required fields
    if (nameIdx === -1 || priceIdx === -1) {
      const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
      
      if (nameIdx === -1) {
        nameIdx = normalizedHeaders.findIndex(h => ['name', 'product', 'product_name', 'item', 'item_name', 'title', 'description'].includes(h));
      }
      if (priceIdx === -1) {
        priceIdx = normalizedHeaders.findIndex(h => ['price', 'mrp', 'rate', 'cost', 'amount', 'selling_price'].includes(h));
      }
      if (qtyIdx === -1) {
        qtyIdx = normalizedHeaders.findIndex(h => ['qty', 'quantity', 'stock', 'stock_quantity', 'units', 'count', 'inventory'].includes(h));
      }
      if (categoryIdx === -1) {
        categoryIdx = normalizedHeaders.findIndex(h => ['category', 'cat', 'type', 'department'].includes(h));
      }
    }

    // Parse data rows using resolved mapping
    const products: ProductData[] = [];
    for (let i = 1; i < lines.length; i++) {
      const currentLine = lines[i]?.trim();
      if (!currentLine) continue;
      
      const values = currentLine.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      
      const name = nameIdx >= 0 ? values[nameIdx] : undefined;
      const priceStr = priceIdx >= 0 ? values[priceIdx] : undefined;
      const qtyStr = qtyIdx >= 0 ? values[qtyIdx] : '0';
      const category = categoryIdx >= 0 ? values[categoryIdx] : undefined;
      const brand = brandIdx >= 0 ? values[brandIdx] : undefined;

      if (!name) {
        logger.warn('Skipping CSV row: missing name', { row: i + 1 });
        continue;
      }

      const price = parseFloat(priceStr || '0');
      const quantity = parseInt(qtyStr || '0', 10);

      if (isNaN(price) || price <= 0) {
        logger.warn('Skipping CSV row: invalid price', { row: i + 1, name });
        continue;
      }

      products.push({
        name: brand ? `${brand} ${name.trim()}` : name.trim(),
        quantity: isNaN(quantity) || quantity <= 0 ? 1 : quantity,
        price,
        description: undefined,
        categoryId: category?.trim() || undefined,
      });
    }

    return products;
  } catch (error) {
    logger.error('Failed to parse CSV', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('CSV parsing failed');
  }
}

/**
 * Parse Khata book image using Gemini OCR
 */
async function parseKhataBookImage(
  fileBuffer: Buffer,
  fileExtension: string
): Promise<ProductData[]> {
  const geminiAdapter = new GeminiAdapter();

  // Map file extension to MIME type
  const mimeTypeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };

  const mimeType = mimeTypeMap[fileExtension] || 'image/jpeg';

  // Extract products using Gemini Vision
  const khataProducts = await geminiAdapter.parseKhataBookImage(fileBuffer, mimeType);

  // Transform to ProductData format
  return khataProducts.map(product => ({
    name: product.name,
    quantity: product.quantity,
    price: product.price,
  }));
}

/**
 * Save products to DynamoDB in batches
 */
async function saveProducts(
  sellerId: string,
  products: ProductData[],
  tableName: string
): Promise<void> {
  const now = new Date().toISOString();
  const batchSize = 25; // DynamoDB BatchWriteItem limit

  // Process in batches
  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);

    const putRequests = batch.map(product => {
      const productId = `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      return {
        PutRequest: {
          Item: marshall({
            PK: `PRODUCT#${productId}`,
            SK: 'METADATA',
            id: productId,
            sellerId,
            categoryId: product.categoryId || 'uncategorized',
            name: product.name,
            description: product.description || '',
            price: product.price,
            originalPrice: product.price,
            discountedPrice: null,
            isDeadStock: false,
            stockQuantity: product.quantity,
            stockAddedDate: now,
            imageUrls: [],
            isActive: true,
            createdAt: now,
            updatedAt: now,
          }),
        },
      };
    });

    const command = new BatchWriteItemCommand({
      RequestItems: {
        [tableName]: putRequests,
      },
    });

    await dynamoDBClient.send(command);

    logger.info('Saved product batch to DynamoDB', {
      sellerId,
      batchNumber: Math.floor(i / batchSize) + 1,
      batchSize: batch.length,
    });
  }
}
