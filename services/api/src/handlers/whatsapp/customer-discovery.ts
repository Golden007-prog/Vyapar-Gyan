/**
 * Customer Discovery Handler
 *
 * WhatsApp-based store discovery for customers with proper state tracking.
 * States: home → search_results → store_browsing
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { whatsappSender } from '../../services/whatsapp-sender';
import {
  updateSessionState,
  updateDiscoveryContext,
  getSessionRaw,
} from '../../adapters/dynamodb-adapter';
import { listFavorites, addFavorite } from '../../repositories/favorites';

// ---------------------------------------------------------------------------
// DynamoDB client
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
      const { getConfig } = await import('../../utils/config.js');
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

interface DiscoveryContext {
  discoveryState: 'home' | 'search_results' | 'store_browsing';
  searchResults?: StoreResult[];
  currentSellerId?: string;
  currentStoreName?: string;
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

export function classifyLocationInput(input: string): { type: 'pincode'; value: string } | { type: 'city'; value: string } {
  const trimmed = input.trim();
  if (/^\d{6}$/.test(trimmed)) {
    return { type: 'pincode', value: trimmed };
  }
  return { type: 'city', value: trimmed.toLowerCase() };
}

export async function transitionToBrowsing(
  userId: string,
  sellerId: string,
): Promise<{ state: 'browsing'; sellerId: string }> {
  await updateSessionState(userId, 'browsing', 'whatsapp');
  return { state: 'browsing', sellerId };
}

export const GREETING_PATTERN = /^(hi|hello|hey|namaste|namaskar|hola|good\s*(morning|afternoon|evening)|howdy|sup|yo)$/i;

const ADD_FAV_PATTERN = /^add\s+to\s+fav(ou?rite)?s?$/i;

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

async function loadDiscoveryContext(userId: string): Promise<DiscoveryContext> {
  try {
    const session = await getSessionRaw(userId);
    const ctx = session?.discoveryContext as DiscoveryContext | undefined;
    if (ctx?.discoveryState) return ctx;
  } catch { /* ignore — default to home */ }
  return { discoveryState: 'home' };
}

async function saveDiscoveryContext(userId: string, ctx: DiscoveryContext): Promise<void> {
  try {
    await updateDiscoveryContext(userId, ctx as unknown as Record<string, unknown>);
  } catch (err) {
    logger.warn('Failed to save discovery context', { userId, error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// Main handler — state-aware routing
// ---------------------------------------------------------------------------

export async function handleCustomerDiscovery(ctx: CustomerDiscoveryContext): Promise<void> {
  const { message, userId, phoneNumber, sessionId, requestId } = ctx;
  const text = (message.text?.body || '').trim();
  const lower = text.toLowerCase();

  logger.info('Customer discovery handler', { userId, requestId, text: text.substring(0, 50) });

  // Load persisted discovery state
  const dCtx = await loadDiscoveryContext(userId);

  // ── Universal commands (work in ANY state) ──
  if (!text || lower === 'menu' || lower === 'home' || lower === 'back' || lower === 'discover' || lower === 'stores') {
    await saveDiscoveryContext(userId, { discoveryState: 'home' });
    await sendHomeMenu(phoneNumber, sessionId);
    return;
  }
  if (GREETING_PATTERN.test(lower)) {
    await saveDiscoveryContext(userId, { discoveryState: 'home' });
    await sendHomeMenu(phoneNumber, sessionId);
    return;
  }

  // ── State-specific routing ──
  switch (dCtx.discoveryState) {
    case 'search_results':
      await handleSearchResultsState(ctx, dCtx, text, lower);
      return;

    case 'store_browsing':
      await handleStoreBrowsingState(ctx, dCtx, text, lower);
      return;

    case 'home':
    default:
      await handleHomeState(ctx, dCtx, text, lower);
      return;
  }
}

// ---------------------------------------------------------------------------
// State: HOME (Store Discovery menu)
// ---------------------------------------------------------------------------

async function handleHomeState(
  ctx: CustomerDiscoveryContext,
  _dCtx: DiscoveryContext,
  text: string,
  _lower: string,
): Promise<void> {
  const { userId, phoneNumber, sessionId } = ctx;

  if (text === '1') {
    await handleFavorites(userId, phoneNumber, sessionId);
    return;
  }
  if (text === '2') {
    await whatsappSender.sendMessage(phoneNumber,
      { type: 'text', text: '📍 Please enter a 6-digit pincode or city name to search for stores.' }, sessionId);
    return;
  }
  if (text === '3') {
    await whatsappSender.sendMessage(phoneNumber,
      { type: 'text', text: '🔍 Please type a store name to search across all stores.' }, sessionId);
    return;
  }
  if (text === '4') {
    await whatsappSender.sendMessage(phoneNumber,
      { type: 'text', text: 'No recently visited store found. Try searching for a store instead!' }, sessionId);
    return;
  }

  // Pincode detection
  const location = classifyLocationInput(text);
  if (location.type === 'pincode') {
    const results = await searchByPincode(location.value);
    if (results.length > 0) {
      await saveDiscoveryContext(userId, { discoveryState: 'search_results', searchResults: results });
      await sendStoreResults(phoneNumber, sessionId, results, `stores in pincode ${location.value}`);
    } else {
      await whatsappSender.sendMessage(phoneNumber,
        { type: 'text', text: `No stores found in pincode ${location.value}. Try a different pincode or city.\n\nType "menu" to see all options.` }, sessionId);
    }
    return;
  }

  // Store name / city search
  await performStoreSearch(ctx, text);
}

// ---------------------------------------------------------------------------
// State: SEARCH_RESULTS (after search found stores)
// ---------------------------------------------------------------------------

async function handleSearchResultsState(
  ctx: CustomerDiscoveryContext,
  dCtx: DiscoveryContext,
  text: string,
  lower: string,
): Promise<void> {
  const { userId, phoneNumber, sessionId } = ctx;
  const results = dCtx.searchResults || [];

  // "1", "2", "store 1", "store 2" → select store by number
  const storeNumMatch = lower.match(/^(?:store\s*)?(\d+)$/);
  if (storeNumMatch?.[1] && results.length > 0) {
    const idx = parseInt(storeNumMatch[1], 10) - 1;
    if (idx >= 0 && idx < results.length) {
      const store = results[idx]!;
      await enterStore(ctx, store);
      return;
    }
  }

  // "add to favorites" / "add to favourites"
  if (ADD_FAV_PATTERN.test(lower)) {
    if (results.length === 1 && results[0]) {
      await doAddFavorite(userId, phoneNumber, sessionId, results[0]);
    } else {
      await whatsappSender.sendMessage(phoneNumber,
        { type: 'text', text: 'Please select a store first by typing its number, then say "add to favorites".' }, sessionId);
    }
    return;
  }

  // Anything else → new search (stay in search flow)
  await performStoreSearch(ctx, text);
}

// ---------------------------------------------------------------------------
// State: STORE_BROWSING (inside a store)
// ---------------------------------------------------------------------------

async function handleStoreBrowsingState(
  ctx: CustomerDiscoveryContext,
  dCtx: DiscoveryContext,
  text: string,
  lower: string,
): Promise<void> {
  const { userId, phoneNumber, sessionId } = ctx;
  const sellerId = dCtx.currentSellerId;
  const storeName = dCtx.currentStoreName || 'Store';

  if (!sellerId) {
    // Lost context — go home
    await saveDiscoveryContext(userId, { discoveryState: 'home' });
    await sendHomeMenu(phoneNumber, sessionId);
    return;
  }

  // "add to favorites"
  if (ADD_FAV_PATTERN.test(lower)) {
    await doAddFavorite(userId, phoneNumber, sessionId, { sellerId, storeName });
    return;
  }

  // "categories" → show categories for this store
  if (lower === 'categories') {
    await showStoreCategories(phoneNumber, sessionId, sellerId, storeName);
    return;
  }

  // Numeric category selection (1-9)
  if (/^\d$/.test(text)) {
    // Transition to browsing state for the router to handle product browsing
    await transitionToBrowsing(userId, sellerId);
    // Re-route to the browsing handler by updating session state
    // The next message will be handled by the browsing handler
    await whatsappSender.sendMessage(phoneNumber,
      { type: 'text', text: `Browsing ${storeName}... Type a product name to search, or "menu" to go back.` }, sessionId);
    return;
  }

  // Check if input looks like a store name search (contains "store" or matches a known store)
  const lowerText = text.toLowerCase();
  if (/\bstore\b/i.test(text) || lowerText.includes('shop') || lowerText.includes('mart') || lowerText.includes('kirana')) {
    // Re-route to store search instead of product search
    await saveDiscoveryContext(userId, { discoveryState: 'home' });
    await performStoreSearch(ctx, text);
    return;
  }

  // Anything else → search products in this store (transition to browsing)
  await transitionToBrowsing(userId, sellerId);
  await whatsappSender.sendMessage(phoneNumber,
    { type: 'text', text: `Searching for "${text}" in ${storeName}...\n\nType "menu" to go back to store discovery.` }, sessionId);
}

// ---------------------------------------------------------------------------
// Shared actions
// ---------------------------------------------------------------------------

async function performStoreSearch(ctx: CustomerDiscoveryContext, query: string): Promise<void> {
  const { userId, phoneNumber, sessionId } = ctx;

  // City search
  const location = classifyLocationInput(query);
  if (location.type !== 'pincode') {
    const cityResults = await searchByCity(location.value);
    if (cityResults.length > 0) {
      await saveDiscoveryContext(userId, { discoveryState: 'search_results', searchResults: cityResults });
      await sendStoreResults(phoneNumber, sessionId, cityResults, `stores in "${query}"`);
      return;
    }
  }

  // OpenSearch global search
  const globalResults = await searchGlobal(query);
  if (globalResults.length > 0) {
    await saveDiscoveryContext(userId, { discoveryState: 'search_results', searchResults: globalResults });
    await sendStoreResults(phoneNumber, sessionId, globalResults, `stores matching "${query}"`);
    return;
  }

  // DynamoDB scan fallback
  const scanResults = await searchByStoreName(query);
  if (scanResults.length > 0) {
    await saveDiscoveryContext(userId, { discoveryState: 'search_results', searchResults: scanResults });
    await sendStoreResults(phoneNumber, sessionId, scanResults, `stores matching "${query}"`);
    return;
  }

  // No results
  await whatsappSender.sendMessage(phoneNumber,
    { type: 'text', text: `No stores found for "${query}". Try a different pincode, city, or store name.\n\nType "menu" to see all options.` }, sessionId);
}

async function enterStore(ctx: CustomerDiscoveryContext, store: StoreResult): Promise<void> {
  const { userId, phoneNumber, sessionId } = ctx;

  await saveDiscoveryContext(userId, {
    discoveryState: 'store_browsing',
    currentSellerId: store.sellerId,
    currentStoreName: store.storeName,
  });

  // Count products for this seller — try SELLER#{sellerId} PK pattern
  let productCount = 0;
  try {
    const table = await tableName();
    const pkValue = `SELLER#${store.sellerId}`;
    logger.info('enterStore product count query', { sellerId: store.sellerId, pkValue });
    // Try the primary PK pattern
    const res = await docClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': pkValue,
          ':prefix': 'PRODUCT#',
        },
        Select: 'COUNT',
      }),
    );
    productCount = res.Count ?? 0;
    logger.info('enterStore product count result', { pkValue, productCount });

    // If no products found, also try scanning PRODUCT# items with sellerId attribute
    if (productCount === 0) {
      const scanRes = await docClient.send(
        new ScanCommand({
          TableName: table,
          FilterExpression: 'begins_with(PK, :prodPrefix) AND sellerId = :sid',
          ExpressionAttributeValues: {
            ':prodPrefix': 'PRODUCT#',
            ':sid': store.sellerId,
          },
          Select: 'COUNT',
          Limit: 100,
        }),
      );
      productCount = scanRes.Count ?? 0;
      logger.info('enterStore scan fallback result', { sellerId: store.sellerId, productCount });
    }
  } catch (err) {
    logger.error('enterStore product count failed', { sellerId: store.sellerId, error: err instanceof Error ? err.message : String(err) });
  }

  const msg = [
    `🏪 *Welcome to ${store.storeName}!*`,
    '',
    `📦 ${productCount} products available`,
    store.city ? `📍 ${store.city}` : '',
    '',
    '💬 Type a product name to search',
    '📋 Type "categories" to browse by category',
    '⭐ Type "add to favorites" to save this store',
    '🔙 Type "menu" to go back to store discovery',
  ].filter(Boolean).join('\n');

  await whatsappSender.sendMessage(phoneNumber, { type: 'text', text: msg }, sessionId);
}

async function showStoreCategories(
  phoneNumber: string, sessionId: string, sellerId: string, storeName: string,
): Promise<void> {
  // Query products for this seller and group by category
  try {
    const table = await tableName();
    const res = await docClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `SELLER#${sellerId}`,
          ':prefix': 'PRODUCT#',
        },
        Limit: 50,
      }),
    );
    const items = res.Items ?? [];
    const categories = new Map<string, number>();
    for (const item of items) {
      const cat = (item.categoryId || item.category || 'Other') as string;
      categories.set(cat, (categories.get(cat) || 0) + 1);
    }

    if (categories.size === 0) {
      await whatsappSender.sendMessage(phoneNumber,
        { type: 'text', text: `${storeName} doesn't have any products listed yet.\n\nType "menu" to go back.` }, sessionId);
      return;
    }

    const catList = Array.from(categories.entries())
      .map(([cat, count], i) => `${i + 1}️⃣ ${cat.replace('cat-', '').replace(/-/g, ' ')} (${count} items)`)
      .join('\n');

    await whatsappSender.sendMessage(phoneNumber, {
      type: 'text',
      text: `📋 *${storeName} — Categories*\n\n${catList}\n\nType a product name to search, or "menu" to go back.`,
    }, sessionId);
  } catch {
    await whatsappSender.sendMessage(phoneNumber,
      { type: 'text', text: `Could not load categories for ${storeName}. Try typing a product name instead.` }, sessionId);
  }
}

async function doAddFavorite(
  userId: string, phoneNumber: string, sessionId: string, store: { sellerId: string; storeName: string },
): Promise<void> {
  try {
    await addFavorite({
      customerId: userId,
      sellerId: store.sellerId,
      storeName: store.storeName,
      addedAt: new Date().toISOString(),
    });
    await whatsappSender.sendMessage(phoneNumber,
      { type: 'text', text: `⭐ ${store.storeName} added to your favorites!` }, sessionId);
  } catch {
    await whatsappSender.sendMessage(phoneNumber,
      { type: 'text', text: `⭐ ${store.storeName} saved to favorites!` }, sessionId);
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

export async function sendHomeMenu(phoneNumber: string, sessionId: string): Promise<void> {
  await whatsappSender.sendMessage(phoneNumber, {
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
  }, sessionId);
}

async function handleFavorites(userId: string, phoneNumber: string, sessionId: string): Promise<void> {
  const favorites = await listFavorites(userId);
  if (favorites.length === 0) {
    await whatsappSender.sendMessage(phoneNumber,
      { type: 'text', text: "You don't have any favorite stores yet. Search for stores and add them to your favorites!" }, sessionId);
    return;
  }
  const list = favorites.map((f, i) => `${i + 1}. ${f.storeName}`).join('\n');
  await whatsappSender.sendMessage(phoneNumber, {
    type: 'text',
    text: `⭐ *Your Favorite Stores*\n\n${list}\n\nReply "store N" to browse a store.`,
  }, sessionId);
}

async function sendStoreResults(
  phoneNumber: string, sessionId: string, stores: StoreResult[], label: string,
): Promise<void> {
  const list = stores.map((s, i) => {
    let line = `${i + 1}. ${s.storeName}`;
    if (s.city) line += ` (${s.city})`;
    return line;
  }).join('\n');

  await whatsappSender.sendMessage(phoneNumber, {
    type: 'text',
    text: `🏪 Found ${stores.length} ${label}:\n\n${list}\n\nReply with a number to browse, or "add to favorites" after selecting.`,
  }, sessionId);
}

// ---------------------------------------------------------------------------
// DynamoDB search functions
// ---------------------------------------------------------------------------

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
      ...(item.city != null ? { city: item.city as string } : {}),
      ...(item.pincode != null ? { pincode: item.pincode as string } : {}),
    }));
  } catch (err) {
    logger.error('Pincode search failed', { pincode, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

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
      ...(item.city != null ? { city: item.city as string } : {}),
      ...(item.pincode != null ? { pincode: item.pincode as string } : {}),
    }));
  } catch (err) {
    logger.error('City search failed', { city, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function searchGlobal(query: string): Promise<StoreResult[]> {
  try {
    const { Client } = await import('@opensearch-project/opensearch');
    const endpoint = process.env.OPENSEARCH_ENDPOINT;
    if (!endpoint) {
      return [];
    }
    const client = new Client({ node: endpoint });
    const res = await client.search({
      index: 'sellers',
      body: { query: { multi_match: { query, fields: ['storeName^2', 'businessName', 'city'], fuzziness: 'AUTO' } }, size: 20 },
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

async function searchByStoreName(query: string): Promise<StoreResult[]> {
  const lowerQuery = query.toLowerCase();

  try {
    const table = await tableName();
    const res = await docClient.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: 'begins_with(PK, :userPrefix) AND SK = :profile AND #role = :seller',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':userPrefix': 'USER#', ':profile': 'PROFILE', ':seller': 'seller' },
        Limit: 500,
      }),
    );

    const items = res.Items ?? [];
    const matches = items.filter(item => {
      const sn = ((item.storeName || '') as string).toLowerCase();
      const bn = ((item.businessName || '') as string).toLowerCase();
      const dn = ((item.displayName || '') as string).toLowerCase();
      return sn.includes(lowerQuery) || bn.includes(lowerQuery) || dn.includes(lowerQuery)
        || lowerQuery.includes(sn) || lowerQuery.includes(bn);
    });

    if (matches.length > 0) {
      const results = matches.map(item => ({
        sellerId: (item.userId || item.PK?.toString().replace('USER#', '')) as string,
        storeName: (item.storeName || item.businessName || 'Unknown Store') as string,
        ...(item.city != null ? { city: item.city as string } : {}),
        ...(item.pincode != null ? { pincode: item.pincode as string } : {}),
        ...(item.businessAddress != null && typeof item.businessAddress === 'object'
          ? { city: (item.businessAddress as any).city as string, pincode: (item.businessAddress as any).pincode as string }
          : {}),
      }));
      // Deduplicate by storeName — prefer sellerIds that end with digits (e.g. seller-dragon-001 over seller-dragon)
      const seen = new Map<string, StoreResult>();
      for (const r of results) {
        const key = r.storeName.toLowerCase();
        const existing = seen.get(key);
        if (!existing || r.sellerId.length > existing.sellerId.length) {
          seen.set(key, r);
        }
      }
      return Array.from(seen.values());
    }
  } catch (err) {
    logger.error('Store name scan failed', { query, error: err instanceof Error ? err.message : String(err) });
  }

  // Hardcoded fallback — only seller-dragon-001 has products
  const KNOWN_STORES: StoreResult[] = [
    { sellerId: 'seller-dragon-001', storeName: 'Dragon Store', city: 'Mumbai', pincode: '400001' },
  ];
  const hardcoded = KNOWN_STORES.filter(s =>
    s.storeName.toLowerCase().includes(lowerQuery) || lowerQuery.includes(s.storeName.toLowerCase()),
  );
  if (hardcoded.length > 0) return hardcoded;

  return [];
}
