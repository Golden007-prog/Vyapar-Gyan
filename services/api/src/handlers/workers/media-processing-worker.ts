/**
 * Media Processing Worker
 *
 * SQS-triggered Lambda that processes voice notes and image search requests.
 * Consumes messages from the media-retry queue, branching on mediaType:
 *   - voice_note → transcribeVoiceNote via Gemini, then search catalog + add to cart
 *   - image_search → analyzeProductImage via Gemini Vision, then weighted catalog search
 *
 * Retry strategy:
 *   - SQS redrivePolicy handles retries (maxReceiveCount: 3)
 *   - On transient failures the handler throws, causing SQS to retry
 *   - On final attempt (approximateReceiveCount >= 3) a fallback message is sent instead
 *
 * Lambda config: timeout 120s, memory 1024MB, event source: SQS media-retry queue
 */

import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { GeminiAdapter } from '../../adapters/gemini-adapter';
import type { ProductImageAnalysis } from '../../adapters/gemini-adapter';
import { twilioAdapter } from '../../adapters/twilio-adapter';
import { getUserProfile } from '../../adapters/dynamodb-adapter';
import { addItem } from '../../services/cart-service';
import { CatalogRepository, type Product } from '../../repositories/catalog-repository';
import { publishLatencyMetric, publishPercentMetric } from '../../core/metrics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MediaMessage {
  mediaType: 'voice_note' | 'image_search';
  userId: string;
  s3Key: string;
  mimeType: string;
  languageHint?: string;
  browsingContext?: string[];
  channel: 'whatsapp' | 'web';
  sellerId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECEIVE_COUNT = 3;

const VOICE_FALLBACK_MSG =
  "I couldn't understand the voice note. Could you type what you'd like to order?";
const IMAGE_FALLBACK_MSG =
  "I couldn't analyze that image. Could you describe what you're looking for?";
const PROCESSING_INDICATOR = '🔄 Analyzing your request...';

/** Confidence threshold for auto-adding to cart */
const CONFIDENCE_THRESHOLD = 80;

/** Minimum similarity score to consider a match */
const MIN_SIMILARITY_SCORE = 0.40;

/** Max products to return for image search */
const MAX_IMAGE_RESULTS = 5;

// Weighted match factors for image search
const WEIGHT_CATEGORY = 0.40;
const WEIGHT_COLOR = 0.20;
const WEIGHT_MATERIAL = 0.15;
const WEIGHT_STYLE = 0.15;
const WEIGHT_BRAND = 0.10;

// ---------------------------------------------------------------------------
// Clients (reused across invocations)
// ---------------------------------------------------------------------------

const s3Client = new S3Client({});
const geminiAdapter = new GeminiAdapter();
const catalogRepo = new CatalogRepository();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    await processRecord(record);
  }
}

async function processRecord(record: SQSRecord): Promise<void> {
  const receiveCount = parseInt(
    record.attributes?.ApproximateReceiveCount ?? '1',
    10,
  );
  const isFinalAttempt = receiveCount >= MAX_RECEIVE_COUNT;

  let message: MediaMessage;
  try {
    message = JSON.parse(record.body) as MediaMessage;
  } catch {
    logger.error('Failed to parse SQS message body', undefined, {
      body: record.body,
    });
    return; // Don't retry unparseable messages
  }

  logger.info('Media processing worker started', {
    mediaType: message.mediaType,
    userId: message.userId,
    s3Key: message.s3Key,
    receiveCount,
    isFinalAttempt,
  });

  try {
    // Send processing indicator immediately
    await sendProcessingIndicator(message);

    const aiStart = Date.now();
    let aiSuccess = true;

    try {
      switch (message.mediaType) {
        case 'voice_note':
          await processVoiceNote(message);
          break;
        case 'image_search':
          await processImageSearch(message);
          break;
        default:
          logger.warn('Unknown mediaType — skipping', {
            mediaType: (message as any).mediaType,
          });
      }
    } catch (err) {
      aiSuccess = false;
      throw err;
    } finally {
      publishLatencyMetric('AIProcessingLatency', Date.now() - aiStart, { Service: 'gemini' });
      publishPercentMetric('AIFailureRate', aiSuccess ? 0 : 100, { Service: 'gemini' });
    }

    logger.info('Media processing completed', {
      mediaType: message.mediaType,
      userId: message.userId,
    });
  } catch (error) {
    logger.error('Media processing failed', error, {
      mediaType: message.mediaType,
      userId: message.userId,
      receiveCount,
      isFinalAttempt,
    });

    if (isFinalAttempt) {
      // Final attempt — send fallback message instead of retrying
      await sendFallbackMessage(message);
      return; // Don't throw — message will go to DLQ but user is notified
    }

    // Throw to trigger SQS retry
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Processing indicator (Req 15)
// ---------------------------------------------------------------------------

async function sendProcessingIndicator(message: MediaMessage): Promise<void> {
  try {
    if (message.channel === 'whatsapp') {
      const user = await getUserProfile(message.userId);
      if (user?.phoneNumber) {
        await twilioAdapter.sendWhatsAppMessage(
          user.phoneNumber,
          PROCESSING_INDICATOR,
        );
      }
    }
    // For web channel, the indicator is handled client-side via sync polling
  } catch (err) {
    // Non-fatal — log and continue with actual processing
    logger.warn('Failed to send processing indicator', {
      userId: message.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Fallback messages
// ---------------------------------------------------------------------------

async function sendFallbackMessage(message: MediaMessage): Promise<void> {
  const fallbackText =
    message.mediaType === 'voice_note' ? VOICE_FALLBACK_MSG : IMAGE_FALLBACK_MSG;

  try {
    if (message.channel === 'whatsapp') {
      const user = await getUserProfile(message.userId);
      if (user?.phoneNumber) {
        await twilioAdapter.sendWhatsAppMessage(user.phoneNumber, fallbackText);
      }
    }
    // For web channel, store a system message in the thread
    // (handled by the notification router or chat sync)
    logger.info('Fallback message sent', {
      userId: message.userId,
      mediaType: message.mediaType,
    });
  } catch (err) {
    logger.error('Failed to send fallback message', err, {
      userId: message.userId,
      mediaType: message.mediaType,
    });
  }
}

// ---------------------------------------------------------------------------
// Voice note processing (Req 7)
// ---------------------------------------------------------------------------

async function processVoiceNote(message: MediaMessage): Promise<void> {
  // 1. Download audio from S3
  const audioBuffer = await downloadFromS3(message.s3Key);

  // 2. Transcribe via Gemini
  const transcription = await geminiAdapter.transcribeVoiceNote(
    audioBuffer,
    message.languageHint ?? 'Hindi',
    message.browsingContext ?? [],
  );

  logger.info('Voice transcription result', {
    userId: message.userId,
    detectedLanguage: transcription.detectedLanguage,
    productCount: transcription.products.length,
    transcriptLength: transcription.transcript.length,
  });

  // 3. Branch on confidence
  const highConfidence = transcription.products.filter(
    (p) => p.confidence >= CONFIDENCE_THRESHOLD,
  );
  const lowConfidence = transcription.products.filter(
    (p) => p.confidence < CONFIDENCE_THRESHOLD,
  );

  // Handle high-confidence products — search catalog and add to cart
  const addedItems: string[] = [];
  for (const product of highConfidence) {
    const catalogMatch = await catalogRepo.searchProducts(product.name, 1);
    if (catalogMatch.length > 0) {
      const matched = catalogMatch[0]!;
      await addItem(message.userId, {
        productId: matched.id,
        sellerId: matched.sellerId,
        name: matched.name,
        price: matched.price,
        quantity: product.quantity,
      });
      addedItems.push(`${product.quantity}x ${matched.name} — ₹${matched.price}`);
    }
  }

  // Build response message
  if (message.channel === 'whatsapp') {
    const user = await getUserProfile(message.userId);
    if (!user?.phoneNumber) return;

    if (addedItems.length > 0 && lowConfidence.length === 0) {
      // All products matched with high confidence
      const itemList = addedItems.join('\n');
      await twilioAdapter.sendWhatsAppMessage(
        user.phoneNumber,
        `✅ Added to your cart:\n${itemList}\n\nSay "checkout" when you're ready!`,
      );
    } else if (addedItems.length > 0 && lowConfidence.length > 0) {
      // Some matched, some need clarification
      const itemList = addedItems.join('\n');
      const unclear = lowConfidence
        .map((p) => `• "${p.name}" (${p.confidence}% match)`)
        .join('\n');
      await twilioAdapter.sendWhatsAppMessage(
        user.phoneNumber,
        `✅ Added to your cart:\n${itemList}\n\n❓ I wasn't sure about:\n${unclear}\n\nCould you clarify what you meant?`,
      );
    } else if (lowConfidence.length > 0) {
      // All products have low confidence — send clarification
      const options = lowConfidence
        .map((p, i) => `${i + 1}. "${p.name}"`)
        .join('\n');
      await twilioAdapter.sendWhatsAppMessage(
        user.phoneNumber,
        `I heard your voice note but wasn't sure about these items:\n${options}\n\nCould you confirm or type what you'd like to order?`,
      );
    } else if (transcription.products.length === 0) {
      // No products detected in transcription
      await twilioAdapter.sendWhatsAppMessage(
        user.phoneNumber,
        `I heard: "${transcription.transcript}"\n\nI couldn't identify any products. Could you try again or type your order?`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Image search processing (Req 8)
// ---------------------------------------------------------------------------

async function processImageSearch(message: MediaMessage): Promise<void> {
  // 1. Download image from S3
  const imageBuffer = await downloadFromS3(message.s3Key);

  // 2. Analyze via Gemini Vision
  const analysis = await geminiAdapter.analyzeProductImage(
    imageBuffer,
    message.mimeType,
  );

  logger.info('Image analysis result', {
    userId: message.userId,
    category: analysis.category,
    color: analysis.color,
    material: analysis.material,
    style: analysis.style,
    brand: analysis.brand,
  });

  // 3. Search catalog by category and compute weighted similarity
  const categoryProducts = await catalogRepo.getProductsByCategory(
    analysis.category,
    50,
  );

  // Also search by description keywords as fallback
  const descriptionProducts = await catalogRepo.searchProducts(
    analysis.description,
    20,
  );

  // Merge and deduplicate
  const allProducts = deduplicateProducts([
    ...categoryProducts,
    ...descriptionProducts,
  ]);

  // 4. Score each product
  const scored = allProducts
    .map((product) => ({
      ...product,
      similarityScore: computeSimilarityScore(product, analysis),
    }))
    .sort((a, b) => b.similarityScore - a.similarityScore);

  // 5. Filter and respond
  const topMatches = scored
    .filter((p) => p.similarityScore > MIN_SIMILARITY_SCORE)
    .slice(0, MAX_IMAGE_RESULTS);

  if (message.channel === 'whatsapp') {
    const user = await getUserProfile(message.userId);
    if (!user?.phoneNumber) return;

    if (topMatches.length > 0) {
      // Return top matches as a list
      const productList = topMatches
        .map(
          (p, i) =>
            `${i + 1}. *${p.name}* — ₹${p.price}\n   Match: ${Math.round(p.similarityScore * 100)}%`,
        )
        .join('\n\n');

      await twilioAdapter.sendWhatsAppMessage(
        user.phoneNumber,
        `📸 Here's what I found:\n\n${productList}\n\nReply with a number to add to cart, or say "more" to browse the full category.`,
      );
    } else {
      // No good matches — suggest category browse
      const categoryName = analysis.category || 'similar items';
      await twilioAdapter.sendWhatsAppMessage(
        user.phoneNumber,
        `I see this looks like a *${categoryName}*. Want to browse our ${categoryName} collection?\n\nReply "browse ${categoryName}" to see all options.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Similarity scoring
// ---------------------------------------------------------------------------

function computeSimilarityScore(
  product: Product,
  analysis: ProductImageAnalysis,
): number {
  let score = 0;

  // Category match (40%)
  if (matchesAttribute(product.categoryId, analysis.category)) {
    score += WEIGHT_CATEGORY;
  }

  // Color match (20%) — check in product name or description
  if (matchesInText(product, analysis.color)) {
    score += WEIGHT_COLOR;
  }

  // Material match (15%)
  if (matchesInText(product, analysis.material)) {
    score += WEIGHT_MATERIAL;
  }

  // Style match (15%)
  if (matchesInText(product, analysis.style)) {
    score += WEIGHT_STYLE;
  }

  // Brand match (10%)
  if (analysis.brand && matchesInText(product, analysis.brand)) {
    score += WEIGHT_BRAND;
  }

  return score;
}

/** Case-insensitive check if attribute appears in category ID or name */
function matchesAttribute(productValue: string, analysisValue: string): boolean {
  if (!productValue || !analysisValue) return false;
  const pv = productValue.toLowerCase();
  const av = analysisValue.toLowerCase();
  return pv.includes(av) || av.includes(pv);
}

/** Check if an attribute value appears in the product name or description */
function matchesInText(product: Product, value: string): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  const nameMatch = product.name?.toLowerCase().includes(lower) ?? false;
  const descMatch = product.description?.toLowerCase().includes(lower) ?? false;
  return nameMatch || descMatch;
}

/** Deduplicate products by ID */
function deduplicateProducts(products: Product[]): Product[] {
  const seen = new Set<string>();
  return products.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// S3 download helper
// ---------------------------------------------------------------------------

async function downloadFromS3(s3Key: string): Promise<Buffer> {
  const config = await getConfig();
  const bucket = config.productImagesBucket;

  logger.debug('Downloading from S3', { bucket, key: s3Key });

  const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error(`Empty response body for S3 key: ${s3Key}`);
  }

  // Convert readable stream to Buffer
  const chunks: Uint8Array[] = [];
  const stream = response.Body as NodeJS.ReadableStream;
  for await (const chunk of stream) {
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks);
}
