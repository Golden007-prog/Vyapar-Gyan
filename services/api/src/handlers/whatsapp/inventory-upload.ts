/**
 * WhatsApp Inventory Upload Handler
 *
 * Processes file attachments (CSV/Excel/Khata photos) sent by sellers via WhatsApp.
 * Extracts inventory items, displays them for confirmation, and commits to DynamoDB.
 *
 * Pure functions exported for property-based testing:
 *   - detectMediaType
 *   - formatInventoryList
 *   - parseInventoryEditCommand
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { GeminiAdapter, type KhataBookProduct } from '../../adapters/gemini-adapter';
import { whatsappSender } from '../../services/whatsapp-sender';
import { putUpload, updateUploadStatus, type UploadRecord } from '../../adapters/dynamodb-adapter';
import { processCsv, processKhataImage } from '../../services/inventory-processing-service';

const s3Client = new S3Client({});
const dynamoDBClient = new DynamoDBClient({});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MediaCategory = 'csv' | 'excel' | 'image' | 'unknown';

export interface InventoryItem {
  name: string;
  price: number;
  quantity: number;
  category?: string;
  rowIndex?: number;
}

export interface ParsedEditCommand {
  itemIndex: number; // 1-based
  field: 'price' | 'quantity' | 'name';
  value: string | number;
}

export interface InventoryUploadContext {
  sellerId: string;
  phoneNumber: string;
  mediaUrl: string;
  mediaContentType: string;
  requestId: string;
}

// ---------------------------------------------------------------------------
// Pure Functions (exported for property testing)
// ---------------------------------------------------------------------------

/**
 * Detect media type category from Twilio MediaContentType0 header.
 *
 * Mapping:
 *   text/csv, application/csv → csv
 *   application/vnd.ms-excel, *spreadsheetml.sheet* → excel
 *   image/jpeg, image/png, image/webp → image
 *   everything else → unknown
 *
 * Requirement 11.1
 */
export function detectMediaType(contentType: string): MediaCategory {
  const ct = contentType.trim().toLowerCase();

  // CSV
  if (ct === 'text/csv' || ct === 'application/csv') {
    return 'csv';
  }

  // Excel
  if (
    ct === 'application/vnd.ms-excel' ||
    ct.includes('spreadsheetml.sheet') ||
    ct === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'excel';
  }

  // Image
  if (ct === 'image/jpeg' || ct === 'image/png' || ct === 'image/webp') {
    return 'image';
  }

  return 'unknown';
}

/**
 * Format extracted inventory items as a numbered WhatsApp message.
 *
 * For any non-empty items list, the message contains a sequentially numbered
 * entry for each item with name, price, and quantity.
 *
 * Requirement 11.4
 */
export function formatInventoryList(items: InventoryItem[]): string {
  if (items.length === 0) {
    return 'No items were extracted from your file.';
  }

  let msg = `📦 *Extracted Inventory (${items.length} items)*\n\n`;

  items.forEach((item, i) => {
    msg += `*${i + 1}.* ${item.name}\n`;
    msg += `   💰 Price: ₹${item.price}\n`;
    msg += `   📦 Qty: ${item.quantity}\n`;
    if (item.category) {
      msg += `   🏷️ Category: ${item.category}\n`;
    }
    msg += '\n';
  });

  msg += '✅ Reply "looks good" to confirm and save.\n';
  msg += '✏️ Reply "change item N price to X" or "update item N quantity to X" to edit.\n';
  msg += '❌ Reply "cancel" to discard.';

  return msg;
}

/**
 * Parse an inventory edit command from seller's WhatsApp reply.
 *
 * Accepted patterns:
 *   "change item N price to X"
 *   "update item N price to X"
 *   "change item N quantity to X"
 *   "update item N quantity to X"
 *   "change item N name to X"
 *   "update item N name to X"
 *
 * Returns null if the input doesn't match any pattern.
 *
 * Requirement 11.6
 */
export function parseInventoryEditCommand(text: string): ParsedEditCommand | null {
  const t = text.trim().toLowerCase();

  // Pattern: (change|update) item N (price|quantity|name) to VALUE
  const match = t.match(
    /^(?:change|update)\s+item\s+(\d+)\s+(price|quantity|qty|name)\s+to\s+(.+)$/,
  );

  if (!match) return null;

  const itemIndex = parseInt(match[1]!, 10);
  if (itemIndex < 1 || isNaN(itemIndex)) return null;

  const rawField = match[2]!;
  const rawValue = match[3]!.trim();

  if (!rawValue) return null;

  // Normalize field name
  let field: 'price' | 'quantity' | 'name';
  if (rawField === 'price') {
    field = 'price';
  } else if (rawField === 'quantity' || rawField === 'qty') {
    field = 'quantity';
  } else {
    field = 'name';
  }

  // Parse numeric value for price/quantity
  if (field === 'price' || field === 'quantity') {
    const numValue = parseFloat(rawValue);
    if (isNaN(numValue) || numValue < 0) return null;
    return { itemIndex, field, value: numValue };
  }

  // Name is a string value
  return { itemIndex, field, value: rawValue };
}

// ---------------------------------------------------------------------------
// Inventory Upload Handler (orchestration)
// ---------------------------------------------------------------------------

/**
 * Handle a media attachment from a seller for inventory upload.
 *
 * Flow:
 * 1. Send progress message
 * 2. Download media from Twilio
 * 3. Upload to S3
 * 4. Route by type: CSV → mapCsvColumns, Image → parseKhataBookImage
 * 5. Send extracted items as numbered list
 * 6. Return pending items for session storage
 *
 * Requirements: 11.1–11.8
 */
export async function handleInventoryUpload(
  context: InventoryUploadContext,
): Promise<InventoryItem[]> {
  const { sellerId, phoneNumber, mediaUrl, mediaContentType, requestId } = context;

  const mediaType = detectMediaType(mediaContentType);

  logger.info('Inventory upload started', {
    requestId,
    sellerId,
    mediaContentType,
    mediaType,
  });

  // Requirement 11.7: Progress message
  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text: '📄 Processing your file...' },
    `inv-progress-${sellerId}`,
    'seller',
  );

  try {
    // Download media from Twilio
    const fileBuffer = await downloadTwilioMediaForInventory(mediaUrl);

    // Upload to S3
    const timestamp = Date.now();
    const ext = getExtensionForType(mediaType, mediaContentType);
    const s3Key = `inventory-uploads/${sellerId}/${timestamp}/upload.${ext}`;
    const config = await getConfig();

    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.productImagesBucket,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mediaContentType,
      }),
    );

    logger.info('Inventory file uploaded to S3', { requestId, sellerId, s3Key });

    // Extract items based on media type
    let items: InventoryItem[];

    if (mediaType === 'csv' || mediaType === 'excel') {
      items = await extractFromCsv(fileBuffer, requestId);
    } else if (mediaType === 'image') {
      items = await extractFromImage(fileBuffer, mediaContentType, requestId);
    } else {
      await whatsappSender.sendMessage(
        phoneNumber,
        {
          type: 'text',
          text: '❌ Unsupported file type. Please send a CSV, Excel file, or a photo of your Khata book.',
        },
        `inv-unsupported-${sellerId}`,
        'seller',
      );
      return [];
    }

    if (items.length === 0) {
      await whatsappSender.sendMessage(
        phoneNumber,
        {
          type: 'text',
          text: '⚠️ No items could be extracted from your file. Please check the format and try again.',
        },
        `inv-empty-${sellerId}`,
        'seller',
      );
      return [];
    }

    // Requirement 11.4: Send numbered list
    const listMessage = formatInventoryList(items);
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: listMessage },
      `inv-list-${sellerId}`,
      'seller',
    );

    return items;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('Inventory upload failed', { requestId, sellerId, error: errMsg });

    await whatsappSender.sendMessage(
      phoneNumber,
      {
        type: 'text',
        text: `❌ Failed to process your file: ${errMsg}\n\nPlease try again or type "menu" to go back.`,
      },
      `inv-error-${sellerId}`,
      'seller',
    );
    return [];
  }
}

/**
 * Handle seller confirmation of pending inventory.
 * Commits items to DynamoDB as product records.
 *
 * Requirement 11.5
 */
export async function commitInventory(
  sellerId: string,
  phoneNumber: string,
  items: InventoryItem[],
): Promise<void> {
  const config = await getConfig();
  const now = new Date().toISOString();
  const batchSize = 25;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const putRequests = batch.map((item) => {
      const productId = `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      return {
        PutRequest: {
          Item: marshall({
            PK: `PRODUCT#${productId}`,
            SK: 'METADATA',
            id: productId,
            sellerId,
            categoryId: item.category || 'uncategorized',
            name: item.name,
            description: '',
            price: item.price,
            originalPrice: item.price,
            discountedPrice: null,
            isDeadStock: false,
            stockQuantity: item.quantity,
            stockAddedDate: now,
            imageUrls: [],
            isActive: true,
            createdAt: now,
            updatedAt: now,
          }),
        },
      };
    });

    await dynamoDBClient.send(
      new BatchWriteItemCommand({
        RequestItems: { [config.tableName]: putRequests },
      }),
    );
  }

  await whatsappSender.sendMessage(
    phoneNumber,
    {
      type: 'text',
      text: `✅ ${items.length} items have been added to your inventory!\n\nType "menu" to go back.`,
    },
    `inv-committed-${sellerId}`,
    'seller',
  );

  logger.info('Inventory committed to DynamoDB', { sellerId, itemCount: items.length });
}

/**
 * Handle seller edit of a pending inventory item.
 * Updates the item in the pending list and re-displays.
 *
 * Requirement 11.6
 */
export function applyInventoryEdit(
  items: InventoryItem[],
  edit: ParsedEditCommand,
): { items: InventoryItem[]; error?: string } {
  if (edit.itemIndex < 1 || edit.itemIndex > items.length) {
    return {
      items,
      error: `Invalid item number. Please choose between 1 and ${items.length}.`,
    };
  }

  const updated = [...items];
  const target: InventoryItem = { ...updated[edit.itemIndex - 1]! };

  if (edit.field === 'price') {
    target.price = edit.value as number;
  } else if (edit.field === 'quantity') {
    target.quantity = Math.round(edit.value as number);
  } else if (edit.field === 'name') {
    target.name = edit.value as string;
  }

  updated[edit.itemIndex - 1] = target;
  return { items: updated };
}

// ---------------------------------------------------------------------------
// One-Step Dashboard Upload Flow
// ---------------------------------------------------------------------------

const DASHBOARD_BASE_URL = 'https://golden007-prog.github.io/Vyapar-Gyan/seller/inventory/';

export interface DashboardUploadContext {
  sellerId: string;
  phoneNumber: string;
  mediaUrl: string;
  mediaContentType: string;
  requestId: string;
}

/**
 * Handle a media attachment from a seller via the dashboard-link flow.
 *
 * 1. Send progress message
 * 2. Download media from Twilio
 * 3. Store in S3 (uploads/{sellerId}/csv/ or uploads/{sellerId}/khata/)
 * 4. Create UPLOAD# record in DynamoDB (status: processing)
 * 5. Process via shared service (Gemini CSV mapping or Khata OCR)
 * 6. Update UPLOAD# with results (status: completed)
 * 7. Send WhatsApp message with dashboard review link
 */
export async function handleInventoryUploadWithDashboard(
  context: DashboardUploadContext,
): Promise<string | null> {
  const { sellerId, phoneNumber, mediaContentType, mediaUrl, requestId } = context;
  const mediaType = detectMediaType(mediaContentType);
  const uploadId = randomUUID();
  const now = new Date().toISOString();
  const ttl24h = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  logger.info('Dashboard inventory upload started', {
    requestId, sellerId, mediaContentType, mediaType, uploadId,
  });

  // Progress message
  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text: '📄 Processing your file with AI...' },
    `inv-dash-progress-${sellerId}`,
    'seller',
  );

  try {
    // Download media from Twilio
    const fileBuffer = await downloadTwilioMediaForInventory(mediaUrl);

    // Determine S3 path
    const ext = getExtensionForType(mediaType, mediaContentType);
    const s3Folder = (mediaType === 'csv' || mediaType === 'excel') ? 'csv' : 'khata';
    const s3Key = `uploads/${sellerId}/${s3Folder}/${uploadId}.${ext}`;
    const config = await getConfig();

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.productImagesBucket,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mediaContentType,
      }),
    );

    logger.info('File uploaded to S3', { requestId, sellerId, s3Key });

    // Create initial UPLOAD# record (processing state)
    const initialRecord: UploadRecord = {
      uploadId,
      sellerId,
      phoneNumber,
      mediaType: (mediaType === 'csv' || mediaType === 'excel') ? 'csv' : 'image',
      s3Key,
      status: 'processing',
      productCount: 0,
      products: [],
      createdAt: now,
      updatedAt: now,
      expiresAt: ttl24h,
    };
    await putUpload(initialRecord);

    // Process with shared service
    if (mediaType === 'csv' || mediaType === 'excel') {
      const result = await processCsv(fileBuffer, requestId);

      if (result.errors.length > 0 && result.products.length === 0) {
        await updateUploadStatus(uploadId, 'failed', {
          errors: result.errors,
          warnings: result.warnings,
        });

        await whatsappSender.sendMessage(
          phoneNumber,
          {
            type: 'text',
            text: `❌ Could not process your CSV: ${result.errors.join(', ')}\n\nPlease check the format and try again.`,
          },
          `inv-dash-fail-${sellerId}`,
          'seller',
        );
        return null;
      }

      await updateUploadStatus(uploadId, 'completed', {
        products: result.products,
        productCount: result.products.length,
        columnMapping: result.columnMapping as unknown as Record<string, unknown>,
        headers: result.headers,
        csvLines: result.csvLines,
        errors: result.errors,
        warnings: result.warnings,
      });

      const dashboardUrl = `${DASHBOARD_BASE_URL}?uploadId=${uploadId}`;
      await whatsappSender.sendMessage(
        phoneNumber,
        {
          type: 'text',
          text: `✅ AI processed your CSV — ${result.products.length} products found.\n\nReview and confirm:\n${dashboardUrl}`,
        },
        `inv-dash-link-${sellerId}`,
        'seller',
      );

      logger.info('Dashboard upload completed (CSV)', {
        requestId, sellerId, uploadId, productCount: result.products.length,
      });
      return uploadId;

    } else if (mediaType === 'image') {
      const result = await processKhataImage(fileBuffer, mediaContentType, requestId);

      if (result.errors.length > 0 && result.products.length === 0) {
        await updateUploadStatus(uploadId, 'failed', {
          errors: result.errors,
          warnings: result.warnings,
        });

        await whatsappSender.sendMessage(
          phoneNumber,
          {
            type: 'text',
            text: `❌ Could not extract items from your image: ${result.errors.join(', ')}\n\nPlease try a clearer photo.`,
          },
          `inv-dash-fail-${sellerId}`,
          'seller',
        );
        return null;
      }

      await updateUploadStatus(uploadId, 'completed', {
        products: result.products,
        productCount: result.products.length,
        errors: result.errors,
        warnings: result.warnings,
      });

      const dashboardUrl = `${DASHBOARD_BASE_URL}?uploadId=${uploadId}`;
      await whatsappSender.sendMessage(
        phoneNumber,
        {
          type: 'text',
          text: `✅ AI read your Khata book — ${result.products.length} products found.\n\nReview and confirm:\n${dashboardUrl}`,
        },
        `inv-dash-link-${sellerId}`,
        'seller',
      );

      logger.info('Dashboard upload completed (Khata)', {
        requestId, sellerId, uploadId, productCount: result.products.length,
      });
      return uploadId;

    } else {
      await updateUploadStatus(uploadId, 'failed', {
        errors: ['Unsupported file type'],
      });
      await whatsappSender.sendMessage(
        phoneNumber,
        {
          type: 'text',
          text: '❌ Unsupported file type. Please send a CSV file or a photo of your Khata book.',
        },
        `inv-dash-unsupported-${sellerId}`,
        'seller',
      );
      return null;
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('Dashboard inventory upload failed', { requestId, sellerId, uploadId, error: errMsg });

    // Try to update the record as failed
    try {
      await updateUploadStatus(uploadId, 'failed', { errors: [errMsg] });
    } catch { /* best effort */ }

    await whatsappSender.sendMessage(
      phoneNumber,
      {
        type: 'text',
        text: `❌ Failed to process your file: ${errMsg}\n\nPlease try again or type "menu" to go back.`,
      },
      `inv-dash-error-${sellerId}`,
      'seller',
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getExtensionForType(mediaType: MediaCategory, contentType: string): string {
  if (mediaType === 'csv') return 'csv';
  if (mediaType === 'excel') return 'xlsx';
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'bin';
}

async function downloadTwilioMediaForInventory(mediaUrl: string): Promise<Buffer> {
  const config = await getConfig();
  const authHeader = Buffer.from(
    `${config.twilioAccountSid}:${config.twilioAuthToken}`,
  ).toString('base64');

  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${authHeader}` },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Extract inventory items from CSV/Excel buffer using Gemini smart mapping.
 * Reports row-level errors per Requirement 11.8.
 */
async function extractFromCsv(
  fileBuffer: Buffer,
  requestId: string,
): Promise<InventoryItem[]> {
  const csvContent = fileBuffer.toString('utf-8');
  const lines = csvContent.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    throw new Error('CSV file must have at least a header row and one data row');
  }

  const headers = lines[0]!.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const sampleRows: string[][] = [];
  for (let i = 1; i < Math.min(4, lines.length); i++) {
    sampleRows.push(lines[i]!.split(',').map((v) => v.trim().replace(/^"|"$/g, '')));
  }

  // Use Gemini for smart column mapping
  const gemini = new GeminiAdapter();
  const mapping = await gemini.mapCsvColumns(headers, sampleRows);

  logger.info('CSV column mapping resolved', { requestId, mapping });

  const items: InventoryItem[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));

    const name = mapping.name !== null ? values[mapping.name] : undefined;
    const priceStr = mapping.price !== null ? values[mapping.price] : undefined;
    const qtyStr = mapping.quantity !== null ? values[mapping.quantity] : undefined;
    const category = mapping.category !== null ? values[mapping.category] : undefined;

    if (!name || !name.trim()) {
      errors.push(`Row ${i + 1}: missing product name`);
      continue;
    }

    const price = parseFloat(priceStr || '0');
    if (isNaN(price) || price <= 0) {
      errors.push(`Row ${i + 1}: missing or invalid price`);
      continue;
    }

    const quantity = parseInt(qtyStr || '1', 10);

    items.push({
      name: name.trim(),
      price,
      quantity: isNaN(quantity) || quantity <= 0 ? 1 : quantity,
      ...(category?.trim() ? { category: category.trim() } : {}),
      rowIndex: i + 1,
    });
  }

  if (errors.length > 0) {
    logger.warn('CSV extraction had row errors', { requestId, errors });
  }

  return items;
}

/**
 * Extract inventory items from Khata book image using Gemini OCR.
 */
async function extractFromImage(
  fileBuffer: Buffer,
  mimeType: string,
  requestId: string,
): Promise<InventoryItem[]> {
  const gemini = new GeminiAdapter();
  const products: KhataBookProduct[] = await gemini.parseKhataBookImage(
    fileBuffer,
    mimeType,
  );

  logger.info('Khata OCR extraction complete', {
    requestId,
    productCount: products.length,
  });

  return products.map((p, i) => ({
    name: p.name,
    price: p.price,
    quantity: p.quantity,
    rowIndex: i + 1,
  }));
}
