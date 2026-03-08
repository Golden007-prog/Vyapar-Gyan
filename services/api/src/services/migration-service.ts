/**
 * Lazy Data Migration Service — Section 1.0
 *
 * Handles on-the-fly migration from legacy key patterns to new userId-keyed
 * patterns when an existing WhatsApp user is encountered after deployment.
 *
 * Legacy patterns:
 *   CUSTOMER#{phone}  SK: PROFILE
 *   SESSION#{customerId}  SK: WHATSAPP#{phone}   (cart embedded in session.context)
 *
 * New patterns:
 *   USER#{userId}  SK: PROFILE   (GSI1 PHONE#{phone})
 *   SESSION#{userId}  SK: ACTIVE  (GSI1 PHONE#{phone})
 *   CART#{userId}  SK: ACTIVE
 *
 * Migration rules:
 *   1. New registrations write directly to new key patterns.
 *   2. Existing WhatsApp users are migrated on first contact:
 *      - Resolve phone via GSI1 → if no USER# record, check legacy CUSTOMER#{phone}
 *      - Create USER#{userId} from legacy customer data
 *      - Create SESSION#{userId} ACTIVE from legacy session
 *      - Extract cart from session.context into CART#{userId} ACTIVE
 *   3. Message history is NOT migrated — old messages stay under legacy keys.
 *   4. Legacy records are never deleted — only marked with migratedToUserId.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { getConfig } from '../utils/config';
import { logger } from '../utils/logger';
import {
  getUserByPhone,
  createUserProfile,
  putSession,
  putCart,
} from '../adapters/dynamodb-adapter';
import type {
  UserProfile,
  UnifiedSession,
  Cart,
  UnifiedCartItem,
} from '../adapters/dynamodb-adapter';

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});


let _tableName: string;
async function tableName(): Promise<string> {
  if (!_tableName) {
    const cfg = await getConfig();
    _tableName = cfg.tableName;
  }
  return _tableName;
}

// ---------------------------------------------------------------------------
// Legacy record shapes (matching existing CustomerRepository / SessionRepository)
// ---------------------------------------------------------------------------

interface LegacyCustomer {
  id: string;
  phoneNumber: string;
  profileName: string;
  whatsappId?: string;
  migratedToUserId?: string;
  createdAt: string;
  updatedAt: string;
}

interface LegacyCartItem {
  productId: string;
  sellerId: string;
  name: string;
  price: number;
  quantity: number;
  addedAt: string;
}

interface LegacySession {
  id: string;
  customerId: string;
  phoneNumber: string;
  channelType: string;
  state: string;
  context?: Record<string, unknown>;
  cart?: LegacyCartItem[];
  migratedToUserId?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

// ---------------------------------------------------------------------------
// Read helpers for legacy records
// ---------------------------------------------------------------------------

async function getLegacyCustomer(phoneNumber: string): Promise<LegacyCustomer | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { PK: `CUSTOMER#${phoneNumber}`, SK: 'PROFILE' },
    }),
  );
  return (res.Item as LegacyCustomer | undefined) ?? null;
}

async function getLegacySession(
  customerId: string,
  phoneNumber: string,
): Promise<LegacySession | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { PK: `SESSION#${customerId}`, SK: `WHATSAPP#${phoneNumber}` },
    }),
  );
  return (res.Item as LegacySession | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Mark legacy records as migrated (never delete)
// ---------------------------------------------------------------------------

async function markLegacyCustomerMigrated(phoneNumber: string, userId: string): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `CUSTOMER#${phoneNumber}`, SK: 'PROFILE' },
      UpdateExpression: 'SET migratedToUserId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );
}

async function markLegacySessionMigrated(
  customerId: string,
  phoneNumber: string,
  userId: string,
): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `SESSION#${customerId}`, SK: `WHATSAPP#${phoneNumber}` },
      UpdateExpression: 'SET migratedToUserId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
    }),
  );
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolvedUser {
  userProfile: UserProfile;
  session: UnifiedSession | null;
  cart: Cart | null;
  wasMigrated: boolean;
}

/**
 * Resolve a user by phone number with lazy migration fallback.
 *
 * 1. Query GSI1 PHONE#{phone} for a USER# record.
 * 2. If found → return it (already migrated or natively created).
 * 3. If not found → check legacy CUSTOMER#{phone}.
 * 4. If legacy found and not yet migrated → create USER#{userId}, migrate
 *    session and cart, mark legacy records.
 * 5. If nothing found → return null (caller should create a new user).
 */
export async function resolveUserByPhone(phoneNumber: string): Promise<ResolvedUser | null> {
  // Step 1: Try new pattern via GSI1
  const existing = await getUserByPhone(phoneNumber);
  if (existing) {
    logger.info('User resolved via new pattern', { userId: existing.userId, phoneNumber });
    return { userProfile: existing, session: null, cart: null, wasMigrated: false };
  }

  // Step 2: Try legacy CUSTOMER#{phone}
  const legacy = await getLegacyCustomer(phoneNumber);
  if (!legacy) {
    return null; // No record at all — caller creates fresh user
  }

  // Already migrated previously?
  if (legacy.migratedToUserId) {
    const migrated = await getUserByPhone(phoneNumber);
    if (migrated) {
      return { userProfile: migrated, session: null, cart: null, wasMigrated: false };
    }
    // Edge case: marker exists but USER record missing — re-migrate
  }

  // Step 3: Migrate legacy customer → new USER#{userId}
  const userId = randomUUID();
  const now = new Date().toISOString();
  const thirtyDaysTTL = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const sevenDaysTTL = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  const userProfile: UserProfile = {
    userId,
    role: 'customer',
    displayName: legacy.profileName || 'WhatsApp User',
    phoneNumber: legacy.phoneNumber,
    phoneVerificationStatus: 'unverified',
    preferredChannel: 'whatsapp',
    whatsappConnected: true,
    cognitoId: '', // Will be linked when user registers via Cognito
    status: 'active',
    createdAt: legacy.createdAt || now,
    updatedAt: now,
  };

  await createUserProfile(userProfile);
  logger.info('Legacy customer migrated to new user', { userId, phoneNumber, legacyId: legacy.id });

  // Step 4: Migrate session
  let migratedSession: UnifiedSession | null = null;
  const legacySession = await getLegacySession(legacy.id, phoneNumber);

  if (legacySession && !legacySession.migratedToUserId) {
    migratedSession = {
      userId,
      state: mapLegacyState(legacySession.state),
      lastActiveChannel: 'whatsapp',
      lastActivityAt: legacySession.lastActivityAt || now,
      phoneNumber,
      createdAt: legacySession.createdAt || now,
      expiresAt: thirtyDaysTTL,
    };
    await putSession(migratedSession);
    await markLegacySessionMigrated(legacy.id, phoneNumber, userId);
    logger.info('Legacy session migrated', { userId, legacySessionId: legacySession.id });
  }

  // Step 5: Extract cart from legacy session
  let migratedCart: Cart | null = null;
  const legacyCartItems = legacySession?.cart ?? extractCartFromContext(legacySession?.context);

  if (legacyCartItems && legacyCartItems.length > 0) {
    const items: UnifiedCartItem[] = legacyCartItems.map((item) => ({
      productId: item.productId,
      sellerId: item.sellerId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));
    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

    migratedCart = {
      userId,
      items,
      subtotal,
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
      cartVersion: 1,
      updatedAt: now,
      expiresAt: sevenDaysTTL,
    };
    await putCart(migratedCart);
    logger.info('Legacy cart migrated', { userId, itemCount: migratedCart.itemCount });
  }

  // Step 6: Mark legacy customer as migrated
  await markLegacyCustomerMigrated(phoneNumber, userId);

  return {
    userProfile,
    session: migratedSession,
    cart: migratedCart,
    wasMigrated: true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map legacy session states to the new unified state enum. */
function mapLegacyState(
  legacyState: string,
): UnifiedSession['state'] {
  const mapping: Record<string, UnifiedSession['state']> = {
    greeting: 'greeting',
    browsing: 'browsing',
    viewing_product: 'product_inquiry',
    cart: 'ordering',
    checkout: 'payment',
    order_placed: 'tracking',
  };
  return mapping[legacyState] ?? 'idle';
}

/**
 * Extract cart items from the legacy session.context JSON blob.
 * The old code stored cart as `context.cart` (array of OrderItem-like objects).
 */
function extractCartFromContext(
  context?: Record<string, unknown>,
): LegacyCartItem[] | null {
  if (!context) return null;
  const cart = context['cart'];
  if (!Array.isArray(cart)) return null;
  return cart as LegacyCartItem[];
}
