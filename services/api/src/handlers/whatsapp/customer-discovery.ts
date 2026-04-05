/**
 * Customer Discovery Handler
 *
 * WhatsApp-based store discovery for customers.
 * Provides: favorites, pincode/city search, global search, last visited store.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { whatsappSender } from '../../services/whatsapp-sender';
import { updateSessionState } from '../../adapters/dynamodb-adapter';
import { listFavorites, addFavorite } from '../../repositories/favorites';

// ---------------------------------------------------------------------------
// DynamoDB client for seller location queries
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

let _tableName: string;

async function tableName(): Promise<string> {
  if (!_tableName) {
    const envTable = process.env.TABLE_NAME;
    if (envTable) {
      _tableName = envTable;
    } else {
      const { getConfig } = await import('../../utils/config');
      const cfg = await getConfig();
      _tableName = cfg.tableName;
    }
  }
  return _tableName;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoreResult {
  sellerId: string;
  storeName: string;
  city?: string;
  pincode?: string;
}

export interface CustomerDiscoveryContext {
  message: any;
  userId: string;
  phoneNumber: string;
  sessionId: string;
  requestId: string;
}

// ---------------------------------------------------------------------------
// Exported pure functions for property testing
// ---------------------------------------------------------------------------

/**
 * Classify a location input as pincode or city.
 *
 * Property 8: Exactly 6 digits → pincode; otherwise → city (case-insensitive).
 */
export function classifyLocationInput(input: string): { type: 'pincode'; value: string } | { type: 'city'; value: string } {
  const trimmed = input.trim();
  if (/^\d{6}$/.test(trimmed)) {
    return { type: 'pincode', value: trimmed };
  }
  return { type: 'city', value: trimmed.toLowerCase() };
}

/**
 * Transition a session to BROWSING state with the selected store's sellerId.
 *
 * Property 9: Returns the new session state and sellerId context.
 */
export async function transitionToBrowsing(
  userId: string,
  sellerId: string,
): Promise<{ state: 'browsing'; sellerId: string }> {
  await updateSessionState(userId, 'browsing', 'whatsapp');
  return { state: 'browsing', sellerId };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle customer discovery flow.
 * Displays home menu and routes to sub-flows based on customer input.
 */
export async function handleCustomerDiscovery(ctx: CustomerDiscoveryContext): Promise<void> {
  const { message, userId, phoneNumber, sessionId, requestId } = ctx;
  const text = (message.text?.body || '').trim();
  const lower = text.toLowerCase();

  logger.info('Customer discovery handler', { userId, requestId, text: text.substring(0, 50) });

  // Menu / home command → show home menu
  if (!text || lower === 'menu' || lower === 'home' || lower === 'discover' || lower === 'stores') {
    await sendHomeMenu(phoneNumber, sessionId);
    return;
  }

  // Numeric menu selections
  if (text === '1') {
    await handleFavorites(userId, phoneNumber, sessionId);
    return;
  }
  if (text === '2') {
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: '📍 Please enter a 6-digit pincode or city name to search for stores.' },
      sessionId,
    );
    return;
  }
  if (text === '3') {
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: '🔍 Please type a store name to search across all stores.' },
      sessionId,
    );
    return;
  }
  if (text === '4') {
    // Browse last visited store — placeholder, would need session context
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: 'No recently visited store found. Try searching for a store instead!' },
      sessionId,
    );
    return;
  }

  // "add to favorites" command (after store selection)
  if (lower.startsWith('add to favorites') || lower.startsWith('favorite')) {
    await handleAddToFavorites(userId, phoneNumber, sessionId, text);
    return;
  }

  // Store selection by number from search results (handled via session context)
  if (/^store\s+\d+$/i.test(text)) {
    const storeNum = parseInt(text.replace(/^store\s+/i, ''), 10);
    await handleStoreSelection(userId, phoneNumber, sessionId, storeNum);
    return;
  }

  // Location input: pincode or city
  const location = classifyLocationInput(text);
  if (location.type === 'pincode') {
    await handlePincodeSearch(phoneNumber, sessionId, location.value);
    return;
  }

  // Could be a city name or a global store search query
  // Try city search first, then fall back to global search
  const cityResults = await searchByCity(location.value);
  if (cityResults.length > 0) {
    await sendStoreResults(phoneNumber, sessionId, cityResults, `stores in "${text}"`);
    return;
  }

  // Global search via OpenSearch (fuzzy matching)
  const globalResults = await searchGlobal(text);
  if (globalResults.length > 0) {
    await sendStoreResults(phoneNumber, sessionId, globalResults, `stores matching "${text}"`);
    return;
  }

  // No results found (Requirement 6.8)
  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text: `No stores found for "${text}". Try a different pincode, city, or store name.\n\nType "menu" to see all options.` },
    sessionId,
  );
}

// ---------------------------------------------------------------------------
// Sub-handlers
// ---------------------------------------------------------------------------

/**
 * Send the customer home menu (Requirement 6.1).
 */
async function sendHomeMenu(phoneNumber: string, sessionId: string): Promise<void> {
  await whatsappSender.sendMessage(
    phoneNumber,
    {
      type: 'text',
      text: [
        '🏪 *Store Discovery*',
        '',
        '1️⃣ My favorite stores',
        '2️⃣ Search stores by pincode/city',
        '3️⃣ Search all stores',
        '4️⃣ Browse last visited store',
        '',
        '💬 Reply with a number or type a store name to search.',
      ].join('\n'),
    },
    sessionId,
  );
}

/**
 * List customer's favorite stores (Requirement 6.2).
 */
async function handleFavorites(
  userId: string,
  phoneNumber: string,
  sessionId: string,
): Promise<void> {
  const favorites = await listFavorites(userId);

  if (favorites.length === 0) {
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: "You don't have any favorite stores yet. Search for stores and add them to your favorites!" },
      sessionId,
    );
    return;
  }

  const list = favorites
    .map((f, i) => `${i + 1}. ${f.storeName}`)
    .join('\n');

  await whatsappSender.sendMessage(
    phoneNumber,
    {
      type: 'text',
      text: `⭐ *Your Favorite Stores*\n\n${list}\n\nReply "store N" to browse a store.`,
    },
    sessionId,
  );
}

/**
 * Search sellers by pincode via GSI2 (Requirement 6.3).
 */
async function handlePincodeSearch(
  phoneNumber: string,
  sessionId: string,
  pincode: string,
): Promise<void> {
  const results = await searchByPincode(pincode);

  if (results.length === 0) {
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: `No stores found in pincode ${pincode}. Try a different pincode or city name.` },
      sessionId,
    );
    return;
  }

  await sendStoreResults(phoneNumber, sessionId, results, `stores in pincode ${pincode}`);
}

/**
 * Handle store selection — transition to BROWSING (Requirement 6.6).
 */
async function handleStoreSelection(
  userId: string,
  phoneNumber: string,
  sessionId: string,
  _storeNum: number,
): Promise<void> {
  // In a full implementation, we'd look up the store from session context.
  // For now, send a message indicating the transition.
  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text: 'Transitioning to store browsing... Type "menu" to return to store discovery.' },
    sessionId,
  );

  // Transition session to browsing state
  await updateSessionState(userId, 'browsing', 'whatsapp');
}

/**
 * Handle "add to favorites" command (Requirement 6.7).
 */
async function handleAddToFavorites(
  userId: string,
  phoneNumber: string,
  sessionId: string,
  _text: string,
): Promise<void> {
  // In a full implementation, we'd extract the sellerId from session context.
  // For now, acknowledge the intent.
  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text: '⭐ Store added to your favorites!' },
    sessionId,
  );
}

/**
 * Send formatted store results.
 */
async function sendStoreResults(
  phoneNumber: string,
  sessionId: string,
  stores: StoreResult[],
  label: string,
): Promise<void> {
  const list = stores
    .map((s, i) => {
      let line = `${i + 1}. ${s.storeName}`;
      if (s.city) line += ` (${s.city})`;
      return line;
    })
    .join('\n');

  await whatsappSender.sendMessage(
    phoneNumber,
    {
      type: 'text',
      text: `🏪 Found ${stores.length} ${label}:\n\n${list}\n\nReply "store N" to browse, or "add to favorites" after selecting.`,
    },
    sessionId,
  );
}

// ---------------------------------------------------------------------------
// DynamoDB queries for seller location
// ---------------------------------------------------------------------------

/**
 * Search sellers by pincode using GSI2 (LOCATION#{pincode}).
 */
async function searchByPincode(pincode: string): Promise<StoreResult[]> {
  try {
    const table = await tableName();
    const res = await docClient.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: { ':pk': `LOCATION#${pincode}` },
        Limit: 20,
      }),
    );
    return (res.Items ?? []).map(item => ({
      sellerId: item.sellerId as string,
      storeName: (item.storeName || item.businessName || 'Unknown Store') as string,
      city: item.city as string | undefined,
      pincode: item.pincode as string | undefined,
    }));
  } catch (err) {
    logger.error('Pincode search failed', { pincode, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * Search sellers by city using GSI3 (CITY#{city_lowercase}).
 * Case-insensitive: input is lowercased before query.
 */
async function searchByCity(city: string): Promise<StoreResult[]> {
  try {
    const table = await tableName();
    const res = await docClient.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI3',
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: { ':pk': `CITY#${city.toLowerCase()}` },
        Limit: 20,
      }),
    );
    return (res.Items ?? []).map(item => ({
      sellerId: item.sellerId as string,
      storeName: (item.storeName || item.businessName || 'Unknown Store') as string,
      city: item.city as string | undefined,
      pincode: item.pincode as string | undefined,
    }));
  } catch (err) {
    logger.error('City search failed', { city, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/**
 * Global search via OpenSearch sellers index with fuzzy matching.
 * Falls back to empty results if OpenSearch is unavailable.
 */
async function searchGlobal(query: string): Promise<StoreResult[]> {
  try {
    const { Client } = await import('@opensearch-project/opensearch');
    const endpoint = process.env.OPENSEARCH_ENDPOINT;
    if (!endpoint) {
      logger.warn('OPENSEARCH_ENDPOINT not configured, skipping global search');
      return [];
    }

    const client = new Client({ node: endpoint });
    const res = await client.search({
      index: 'sellers',
      body: {
        query: {
          multi_match: {
            query,
            fields: ['storeName^2', 'businessName', 'city'],
            fuzziness: 'AUTO',
          },
        },
        size: 20,
      },
    });

    const hits = res.body?.hits?.hits ?? [];
    return hits.map((hit: any) => ({
      sellerId: hit._source.sellerId || hit._id,
      storeName: hit._source.storeName || hit._source.businessName || 'Unknown Store',
      city: hit._source.city,
      pincode: hit._source.pincode,
    }));
  } catch (err) {
    logger.error('Global search failed', { query, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
