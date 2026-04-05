/**
 * Intent Extraction Service
 *
 * Uses Gemini to extract shopping intent (product, store, language) from
 * customer messages. Routes to the correct seller context based on detected
 * store or product intent via OpenSearch.
 *
 * Supports 8 Indian languages: English, Hindi, Tamil, Telugu, Marathi,
 * Bengali, Gujarati, Kannada.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */

import { GeminiAdapter } from '../adapters/gemini-adapter';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types (exported for property testing)
// ---------------------------------------------------------------------------

/** Supported language codes for intent extraction. */
export const SUPPORTED_LANGUAGE_CODES = [
  'en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn',
] as const;

export type SupportedLanguageCode = typeof SUPPORTED_LANGUAGE_CODES[number];

/** Product intent extracted from a customer message. */
export interface ProductIntent {
  name: string | null;
  quantity: number | null;
  action: 'search' | 'buy' | 'check_price' | null;
}

/** Store intent extracted from a customer message. */
export interface StoreIntent {
  name: string | null;
}

/** Full structured intent extraction result. */
export interface IntentExtractionResult {
  product: ProductIntent;
  store: StoreIntent;
  language: SupportedLanguageCode;
}

/** Seller match from OpenSearch. */
export interface SellerMatch {
  sellerId: string;
  storeName: string;
}

/** Routing decision based on intent extraction. */
export interface IntentRoutingResult {
  intent: IntentExtractionResult;
  routing: {
    type: 'store_match' | 'product_search' | 'no_intent';
    seller?: SellerMatch;
    searchQuery?: string;
  };
}


// ---------------------------------------------------------------------------
// Pure validation functions (exported for property testing)
// ---------------------------------------------------------------------------

/**
 * Validate and normalize a raw Gemini intent extraction response into a
 * well-typed IntentExtractionResult.
 *
 * Ensures:
 * - product.name, product.quantity, product.action are correctly typed or null
 * - store.name is a string or null
 * - language is one of the 8 supported codes (defaults to 'en')
 */
export function validateIntentResponse(raw: unknown): IntentExtractionResult {
  const obj = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};

  const rawProduct = (typeof obj.product === 'object' && obj.product !== null)
    ? obj.product as Record<string, unknown>
    : {};

  const rawStore = (typeof obj.store === 'object' && obj.store !== null)
    ? obj.store as Record<string, unknown>
    : {};

  const productName = typeof rawProduct.name === 'string' && rawProduct.name.trim().length > 0
    ? rawProduct.name.trim()
    : null;

  const productQuantity = typeof rawProduct.quantity === 'number' && rawProduct.quantity > 0
    ? rawProduct.quantity
    : null;

  const validActions = new Set(['search', 'buy', 'check_price']);
  const productAction = typeof rawProduct.action === 'string' && validActions.has(rawProduct.action)
    ? rawProduct.action as ProductIntent['action']
    : null;

  const storeName = typeof rawStore.name === 'string' && rawStore.name.trim().length > 0
    ? rawStore.name.trim()
    : null;

  const rawLang = typeof obj.language === 'string' ? obj.language.trim().toLowerCase() : 'en';
  const language: SupportedLanguageCode =
    (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(rawLang)
      ? rawLang as SupportedLanguageCode
      : 'en';

  return {
    product: { name: productName, quantity: productQuantity, action: productAction },
    store: { name: storeName },
    language,
  };
}

/**
 * Determine the routing decision from an intent extraction result and a
 * seller match lookup function result.
 *
 * Pure function — no side effects. Exported for property testing.
 *
 * Rules:
 * - If store intent detected AND seller match found → route to that seller
 * - If product intent detected without store → search all sellers
 * - Otherwise → no intent (continue with default flow)
 */
export function resolveIntentRouting(
  intent: IntentExtractionResult,
  sellerMatch: SellerMatch | null,
): IntentRoutingResult {
  // Store intent with a match
  if (intent.store.name && sellerMatch) {
    return {
      intent,
      routing: {
        type: 'store_match',
        seller: sellerMatch,
      },
    };
  }

  // Product intent without store → search all sellers
  if (intent.product.name) {
    return {
      intent,
      routing: {
        type: 'product_search',
        searchQuery: intent.product.name,
      },
    };
  }

  // No actionable intent
  return {
    intent,
    routing: { type: 'no_intent' },
  };
}

// ---------------------------------------------------------------------------
// Gemini prompt and extraction (side-effectful)
// ---------------------------------------------------------------------------

const INTENT_EXTRACTION_PROMPT = `Extract shopping intent from this customer message. Return JSON only, no markdown:
{
  "product": {
    "name": string | null,
    "quantity": number | null,
    "action": "search" | "buy" | "check_price" | null
  },
  "store": {
    "name": string | null
  },
  "language": "en" | "hi" | "ta" | "te" | "mr" | "bn" | "gu" | "kn"
}

Rules:
- Extract product names in their original language
- Quantity defaults to 1 if mentioned but not specified
- Store name should match the seller's store name as closely as possible
- If no shopping intent, return all nulls
- Detect the primary language of the message
- Supported languages: English (en), Hindi (hi), Tamil (ta), Telugu (te), Marathi (mr), Bengali (bn), Gujarati (gu), Kannada (kn)

Message: "{message}"`;

/**
 * Extract intent from a customer message using Gemini.
 *
 * @param messageText - The raw customer message text
 * @param geminiAdapter - Optional pre-configured GeminiAdapter instance
 * @returns Validated IntentExtractionResult
 */
export async function extractIntent(
  messageText: string,
  geminiAdapter?: GeminiAdapter,
): Promise<IntentExtractionResult> {
  const adapter = geminiAdapter ?? new GeminiAdapter();

  try {
    const client = await (adapter as any).getClient();
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = INTENT_EXTRACTION_PROMPT.replace('{message}', messageText);
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Clean markdown fences
    let clean = text.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(clean.trim());
    const validated = validateIntentResponse(parsed);

    logger.info('Intent extracted', {
      hasProduct: !!validated.product.name,
      hasStore: !!validated.store.name,
      language: validated.language,
      action: validated.product.action,
    });

    return validated;
  } catch (error) {
    logger.error('Intent extraction failed, returning empty intent', {
      error: error instanceof Error ? error.message : String(error),
      messageText: messageText.substring(0, 100),
    });

    // Graceful degradation — return empty intent so the flow continues
    return {
      product: { name: null, quantity: null, action: null },
      store: { name: null },
      language: 'en',
    };
  }
}

/**
 * Search OpenSearch for a seller matching the detected store name.
 *
 * @param storeName - Store name from intent extraction
 * @returns Matching seller or null
 */
export async function findSellerByStoreName(
  storeName: string,
): Promise<SellerMatch | null> {
  try {
    // Lazy import to avoid requiring OpenSearch in test environments
    const { OpenSearchAdapter } = await import('../adapters/opensearch-adapter');
    const osAdapter = new OpenSearchAdapter();

    const result = await osAdapter.search<Record<string, unknown>>('sellers', {
      size: 1,
      query: {
        bool: {
          should: [
            { match: { storeName: { query: storeName, fuzziness: 'AUTO' } } },
            { match_phrase: { storeName: storeName } },
          ],
        },
      },
    });

    if (result.hits.length > 0) {
      const hit = result.hits[0];
      const sellerId = (hit?.sellerId as string) ?? '';
      const matchedName = (hit?.storeName as string) ?? storeName;

      if (sellerId) {
        logger.info('Seller matched by store name', { storeName, sellerId, matchedName });
        return { sellerId, storeName: matchedName };
      }
    }

    logger.info('No seller match for store name', { storeName });
    return null;
  } catch (error) {
    logger.warn('OpenSearch seller lookup failed, skipping store routing', {
      storeName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Full intent extraction pipeline: extract intent → resolve routing.
 *
 * Stores the extraction result in the session context for continuity.
 *
 * @param messageText - Customer message text
 * @param geminiAdapter - Optional pre-configured GeminiAdapter
 * @returns IntentRoutingResult with routing decision
 */
export async function extractAndRouteIntent(
  messageText: string,
  geminiAdapter?: GeminiAdapter,
): Promise<IntentRoutingResult> {
  const intent = await extractIntent(messageText, geminiAdapter);

  // If store intent detected, try to find matching seller
  let sellerMatch: SellerMatch | null = null;
  if (intent.store.name) {
    sellerMatch = await findSellerByStoreName(intent.store.name);
  }

  return resolveIntentRouting(intent, sellerMatch);
}
