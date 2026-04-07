/**
 * DynamoDB Adapter — Omnichannel Commerce Access Patterns
 *
 * Centralised data-access layer for all new entity key patterns:
 *   USER#{userId}, SESSION#{userId}, CART#{userId}, THREAD#{userId},
 *   OTP#{phone}, APPROVAL#{approvalId}, CONSENT#{userId},
 *   TEMPLATE#{templateSid}, CAMPAIGN#{campaignId}, AUDIT#{auditId},
 *   RESTOCK_NOTIFY#{productId}
 *
 * Uses DynamoDB Document Client for cleaner marshalling.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { normalizeIndianPhone } from '../utils/phone-normalize';

// Types matching shared-contracts entity definitions (Section 1.1–1.11).
// Defined here to avoid cross-package resolution issues in Lambda bundles.
// Canonical source of truth: packages/shared-contracts/src/types.ts

export interface UserProfile {
  userId: string;
  role: 'admin' | 'seller' | 'customer';
  displayName: string;
  phoneNumber: string;
  phoneVerificationStatus: 'unverified' | 'pending_otp' | 'verified' | 'failed';
  preferredChannel: 'whatsapp' | 'web' | 'both';
  whatsappConnected: boolean;
  businessName?: string;
  businessAddress?: string;
  gstNumber?: string;
  sellerStatus?: 'pending_approval' | 'approved' | 'rejected' | 'suspended';
  cognitoId: string;
  status: 'active' | 'deleted';
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedSession {
  userId: string;
  state: 'greeting' | 'browsing' | 'product_inquiry' | 'ordering' | 'payment' | 'tracking' | 'idle' | 'closed' | 'onboarding' | 'seller_orders';
  lastActiveChannel: 'whatsapp' | 'web';
  lastActivityAt: string;
  phoneNumber: string;
  createdAt: string;
  expiresAt: number;
  /** Intent context stored by intent extraction for conversation continuity */
  lastIntent?: {
    product?: { name: string | null; quantity: number | null; action: string | null };
    store?: { name: string | null; sellerId?: string };
    language?: string;
  };
  /** Seller copilot sub-state persisted across Lambda invocations */
  sellerSubState?: string | undefined;
  /** Pending inventory upload ID for WhatsApp confirmation flow */
  pendingUploadId?: string | undefined;
  /** Human handoff fields (Req 10.1–10.5) */
  isHumanHandoff?: boolean;
  handoffSellerId?: string;
  handoffStartedAt?: string;
  handoffExpiresAt?: number; // Unix epoch seconds
}

export interface UnifiedCartItem {
  productId: string;
  sellerId: string;
  name: string;
  price: number;
  quantity: number;
  thumbnailUrl?: string;
}

export interface Cart {
  userId: string;
  items: UnifiedCartItem[];
  subtotal: number;
  itemCount: number;
  cartVersion: number;
  updatedAt: string;
  expiresAt: number;
}

export interface MessageThread {
  userId: string;
  messageId: string;
  direction: 'inbound' | 'outbound';
  channel: 'whatsapp' | 'web' | 'system';
  senderRole: 'customer' | 'seller' | 'system';
  messageType: 'text' | 'image' | 'audio' | 'interactive' | 'product_card' | 'system';
  content: unknown;
  deliveryStatus: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  errorCode?: string;
  createdAt: string;
  expiresAt: number;
}

export interface OTPRecord {
  phoneNumber: string;
  otpHash: string;
  failureCount: number;
  lockoutUntil?: string;
  createdAt: string;
  expiresAt: number;
}

export interface ApprovalRecord {
  approvalId: string;
  sellerId: string;
  type: 'discount' | 'campaign' | 'price_change' | 'stock_alert' | 'reorder_suggestion';
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'edited_approved' | 'executed';
  payload: Record<string, unknown>;
  originalPayload?: Record<string, unknown>;
  aiRationale: string;
  estimatedImpact: number;
  affectedProductIds: string[];
  priorityScore: number;
  approvedAt?: string;
  approvedBy?: string;
  rejectionReason?: string;
  scheduledFor?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppOptInConsent {
  optedIn: boolean;
  optedInAt?: string;
  optInMethod: 'registration' | 'user_initiated' | 'settings';
  optedOut: boolean;
  optedOutAt?: string;
  optOutMethod?: string;
  suppressPromotional: boolean;
}

export interface ServiceWindowConsent {
  serviceWindowExpiresAt: string;
  promotionalMessageCount: number;
  lastPromotionalResetAt: string;
}

export interface TemplateRegistry {
  templateSid: string;
  templateName: string;
  category: 'marketing' | 'utility' | 'authentication';
  language: string;
  parameterSchema: Record<string, unknown>;
  approvalStatus: 'approved' | 'pending' | 'rejected';
  createdAt: string;
}

export interface AudienceFilters {
  pastPurchasers?: string[];
  cartAbandoners?: boolean;
  highSpenders?: boolean;
  categoryInterest?: string[];
}

export interface CampaignRecord {
  campaignId: string;
  sellerId: string;
  approvalId?: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
  messageText: string;
  templateSid?: string;
  audienceFilters: AudienceFilters;
  estimatedReach: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  conversionCount: number;
  scheduledAt?: string;
  executedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  auditId: string;
  actorId: string;
  actorRole: 'admin' | 'seller' | 'system';
  actionType: string;
  resourceType: string;
  resourceId: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  approvalId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface RestockNotification {
  productId: string;
  userId: string;
  createdAt: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

let _tableName: string;

async function tableName(): Promise<string> {
  if (!_tableName) {
    // Read directly from env var — avoids loading full getConfig() which
    // requires ALL secrets (gemini, grok, razorpay) even when only DynamoDB is needed.
    const envTable = process.env.TABLE_NAME;
    if (envTable) {
      _tableName = envTable;
    } else {
      // Fallback to full config for local dev where env var may not be set
      const cfg = await getConfig();
      _tableName = cfg.tableName;
    }
  }
  return _tableName;
}


// ============================================================================
// Generic Item Operations
// ============================================================================

/**
 * Put a generic item into DynamoDB. Requires PK and SK fields.
 * Used for notification records and other ad-hoc entities.
 */
export async function putItem(item: Record<string, unknown>): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({ TableName: table, Item: item }),
  );
}

// ============================================================================
// 1. User Profile — PK: USER#{userId}  SK: PROFILE
// ============================================================================

export async function createUserProfile(profile: UserProfile): Promise<void> {
  const table = await tableName();
  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeIndianPhone(profile.phoneNumber);
  } catch {
    normalizedPhone = profile.phoneNumber;
  }
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `USER#${profile.userId}`,
        SK: 'PROFILE',
        GSI1PK: `PHONE#${normalizedPhone}`,
        GSI1SK: `USER#${profile.userId}`,
        GSI2PK: `ROLE#${profile.role}`,
        GSI2SK: `USER#${profile.userId}`,
        ...profile,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
  logger.info('User profile created', { userId: profile.userId, role: profile.role });
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `USER#${userId}`, SK: 'PROFILE' } }),
  );
  return (res.Item as UserProfile) ?? null;
}

export async function getUserByPhone(phoneNumber: string): Promise<UserProfile | null> {
  // Normalize phone to 10-digit Indian format for consistent GSI1PK lookup
  let normalized: string;
  try {
    normalized = normalizeIndianPhone(phoneNumber);
  } catch {
    normalized = phoneNumber;
  }

  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :userPrefix)',
      ExpressionAttributeValues: {
        ':pk': `PHONE#${normalized}`,
        ':userPrefix': 'USER#',
      },
      Limit: 1,
    }),
  );
  return (res.Items?.[0] as UserProfile) ?? null;
}

export async function updateUserProfile(
  userId: string,
  updates: Partial<Omit<UserProfile, 'userId' | 'createdAt'>>,
): Promise<void> {
  const table = await tableName();
  const sets: string[] = ['updatedAt = :now'];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':now': new Date().toISOString() };

  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined) continue;
    const token = `#${key}`;
    const valToken = `:${key}`;
    names[token] = key;
    values[valToken] = val;
    sets.push(`${token} = ${valToken}`);
  }

  // Update GSI1PK when phoneNumber changes (keeps GSI1 PHONE#{phone} in sync)
  if (updates.phoneNumber) {
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeIndianPhone(updates.phoneNumber);
    } catch {
      normalizedPhone = updates.phoneNumber;
    }
    sets.push('GSI1PK = :gsi1pk');
    values[':gsi1pk'] = `PHONE#${normalizedPhone}`;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function deleteUserProfile(userId: string): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new DeleteCommand({ TableName: table, Key: { PK: `USER#${userId}`, SK: 'PROFILE' } }),
  );
}


// ============================================================================
// 2. Unified Session — PK: SESSION#{userId}  SK: ACTIVE
// ============================================================================

export async function putSession(session: UnifiedSession): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `SESSION#${session.userId}`,
        SK: 'ACTIVE',
        GSI1PK: `PHONE#${session.phoneNumber}`,
        GSI1SK: `SESSION#${session.userId}`,
        ...session,
      },
    }),
  );
}

export async function getSession(userId: string): Promise<UnifiedSession | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `SESSION#${userId}`, SK: 'ACTIVE' } }),
  );
  return (res.Item as UnifiedSession) ?? null;
}

export async function getSessionByPhone(phoneNumber: string): Promise<UnifiedSession | null> {
  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `PHONE#${phoneNumber}`, ':prefix': 'SESSION#' },
      Limit: 1,
    }),
  );
  return (res.Items?.[0] as UnifiedSession) ?? null;
}

export async function updateSessionState(
  userId: string,
  state: UnifiedSession['state'],
  channel: UnifiedSession['lastActiveChannel'],
): Promise<void> {
  const table = await tableName();
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `SESSION#${userId}`, SK: 'ACTIVE' },
      UpdateExpression: 'SET #state = :s, lastActiveChannel = :ch, lastActivityAt = :now',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: { ':s': state, ':ch': channel, ':now': now },
    }),
  );
}

/**
 * Update the lastIntent field on a session record.
 * Used by intent extraction to store context for conversation continuity.
 */
export async function updateSessionIntent(
  userId: string,
  lastIntent: UnifiedSession['lastIntent'],
): Promise<void> {
  const table = await tableName();
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `SESSION#${userId}`, SK: 'ACTIVE' },
      UpdateExpression: 'SET lastIntent = :intent, lastActivityAt = :now',
      ExpressionAttributeValues: { ':intent': lastIntent, ':now': now },
    }),
  );
}

/**
 * Store customer discovery context (search results, selected store) in the session.
 * Used by customer-discovery.ts to track state across messages.
 */
export async function updateDiscoveryContext(
  userId: string,
  discoveryContext: Record<string, unknown>,
): Promise<void> {
  const table = await tableName();
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `SESSION#${userId}`, SK: 'ACTIVE' },
      UpdateExpression: 'SET discoveryContext = :ctx, lastActivityAt = :now',
      ExpressionAttributeValues: { ':ctx': discoveryContext, ':now': now },
    }),
  );
}

/**
 * Read the raw session record for a user (SESSION#{userId} ACTIVE).
 * Returns the full DynamoDB item including any extra attributes like discoveryContext.
 */
export async function getSessionRaw(userId: string): Promise<Record<string, unknown> | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `SESSION#${userId}`, SK: 'ACTIVE' } }),
  );
  return (res.Item as Record<string, unknown>) ?? null;
}

// ============================================================================
// 3. Cart — PK: CART#{userId}  SK: ACTIVE  (version-based conditional writes)
// ============================================================================

export async function getCart(userId: string): Promise<Cart | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `CART#${userId}`, SK: 'ACTIVE' } }),
  );
  return (res.Item as Cart) ?? null;
}

/**
 * Put cart with optimistic concurrency.
 * If expectedVersion is provided, the write only succeeds when the stored
 * cartVersion matches — otherwise a ConditionalCheckFailedException is thrown.
 */
export async function putCart(cart: Cart, expectedVersion?: number): Promise<void> {
  const table = await tableName();
  const item: Record<string, unknown> = {
    PK: `CART#${cart.userId}`,
    SK: 'ACTIVE',
    ...cart,
  };

  const params: ConstructorParameters<typeof PutCommand>[0] = {
    TableName: table,
    Item: item,
  };

  if (expectedVersion !== undefined) {
    params.ConditionExpression = 'cartVersion = :v';
    params.ExpressionAttributeValues = { ':v': expectedVersion };
  }

  await docClient.send(new PutCommand(params));
}

export async function deleteCart(userId: string): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new DeleteCommand({ TableName: table, Key: { PK: `CART#${userId}`, SK: 'ACTIVE' } }),
  );
}


// ============================================================================
// 4. Message Thread — PK: THREAD#{userId}  SK: MSG#{ts}#{id}
// ============================================================================

export async function putMessage(msg: MessageThread): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `THREAD#${msg.userId}`,
        SK: `MSG#${msg.createdAt}#${msg.messageId}`,
        ...msg,
      },
    }),
  );
}

export interface QueryMessagesOptions {
  userId: string;
  sinceTimestamp?: string;
  limit?: number;
  scanForward?: boolean;
  exclusiveStartKey?: Record<string, unknown>;
}

export interface QueryMessagesResult {
  messages: MessageThread[];
  lastEvaluatedKey?: Record<string, unknown> | undefined;
}

export async function queryMessages(opts: QueryMessagesOptions): Promise<QueryMessagesResult> {
  const table = await tableName();
  const { userId, sinceTimestamp, limit = 50, scanForward = false, exclusiveStartKey } = opts;

  let keyExpr = 'PK = :pk';
  const exprValues: Record<string, unknown> = { ':pk': `THREAD#${userId}` };

  if (sinceTimestamp) {
    keyExpr += ' AND SK > :since';
    exprValues[':since'] = `MSG#${sinceTimestamp}`;
  }

  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: keyExpr,
      ExpressionAttributeValues: exprValues,
      ScanIndexForward: scanForward,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );

  return {
    messages: (res.Items ?? []) as MessageThread[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

export async function updateMessageDeliveryStatus(
  userId: string,
  sortKey: string,
  status: MessageThread['deliveryStatus'],
  timestampField?: 'sentAt' | 'deliveredAt' | 'readAt' | 'failedAt',
  errorCode?: string,
): Promise<void> {
  const table = await tableName();
  let updateExpr = 'SET deliveryStatus = :s';
  const values: Record<string, unknown> = { ':s': status };

  if (timestampField) {
    updateExpr += `, ${timestampField} = :ts`;
    values[':ts'] = new Date().toISOString();
  }
  if (errorCode) {
    updateExpr += ', errorCode = :ec';
    values[':ec'] = errorCode;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `THREAD#${userId}`, SK: sortKey },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: values,
    }),
  );
}

/**
 * Find a message in a THREAD by its messageId (Twilio SID).
 * Scans recent messages (last 100) and filters by messageId.
 * Returns the sort key needed for updateMessageDeliveryStatus.
 */
export async function findMessageSortKeyBySid(
  userId: string,
  messageSid: string,
): Promise<string | null> {
  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'messageId = :mid',
      ExpressionAttributeValues: {
        ':pk': `THREAD#${userId}`,
        ':prefix': 'MSG#',
        ':mid': messageSid,
      },
      ScanIndexForward: false,
      Limit: 100,
    }),
  );
  if (res.Items && res.Items.length > 0) {
    const item = res.Items[0];
    return item ? (item.SK as string) : null;
  }
  return null;
}

// ============================================================================
// 5. OTP — PK: OTP#{phoneNumber}  SK: LATEST
// ============================================================================

export async function putOTP(otp: OTPRecord): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `OTP#${otp.phoneNumber}`,
        SK: 'LATEST',
        ...otp,
      },
    }),
  );
}

export async function getOTP(phoneNumber: string): Promise<OTPRecord | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `OTP#${phoneNumber}`, SK: 'LATEST' } }),
  );
  return (res.Item as OTPRecord) ?? null;
}

export async function updateOTPFailure(phoneNumber: string, failureCount: number, lockoutUntil?: string): Promise<void> {
  const table = await tableName();
  let updateExpr = 'SET failureCount = :fc';
  const values: Record<string, unknown> = { ':fc': failureCount };

  if (lockoutUntil) {
    updateExpr += ', lockoutUntil = :lu';
    values[':lu'] = lockoutUntil;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `OTP#${phoneNumber}`, SK: 'LATEST' },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: values,
    }),
  );
}


// ============================================================================
// 6. Approval Record — PK: APPROVAL#{approvalId}  SK: METADATA
// ============================================================================

export async function putApproval(approval: ApprovalRecord): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `APPROVAL#${approval.approvalId}`,
        SK: 'METADATA',
        GSI1PK: `SELLER#${approval.sellerId}`,
        GSI1SK: `STATUS#${approval.status}#TS#${approval.createdAt}`,
        ...approval,
      },
    }),
  );
}

export async function getApproval(approvalId: string): Promise<ApprovalRecord | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `APPROVAL#${approvalId}`, SK: 'METADATA' } }),
  );
  return (res.Item as ApprovalRecord) ?? null;
}

export interface QueryApprovalsOptions {
  sellerId: string;
  statusPrefix?: string; // e.g. 'pending_review'
  limit?: number;
  exclusiveStartKey?: Record<string, unknown>;
}

export async function queryApprovalsBySeller(opts: QueryApprovalsOptions): Promise<{
  approvals: ApprovalRecord[];
  lastEvaluatedKey?: Record<string, unknown> | undefined;
}> {
  const table = await tableName();
  const { sellerId, statusPrefix, limit = 20, exclusiveStartKey } = opts;

  let keyExpr = 'GSI1PK = :pk';
  const values: Record<string, unknown> = { ':pk': `SELLER#${sellerId}` };

  if (statusPrefix) {
    keyExpr += ' AND begins_with(GSI1SK, :sp)';
    values[':sp'] = `STATUS#${statusPrefix}`;
  }

  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: keyExpr,
      ExpressionAttributeValues: values,
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );

  return {
    approvals: (res.Items ?? []) as ApprovalRecord[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

export async function updateApprovalStatus(
  approvalId: string,
  _sellerId: string,
  updates: Partial<ApprovalRecord>,
): Promise<void> {
  const table = await tableName();
  const now = new Date().toISOString();
  const sets: string[] = ['updatedAt = :now'];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':now': now };

  // Rebuild GSI1SK when status changes
  if (updates.status) {
    sets.push('GSI1SK = :gsi1sk');
    values[':gsi1sk'] = `STATUS#${updates.status}#TS#${updates.createdAt ?? now}`;
  }

  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined || key === 'approvalId' || key === 'sellerId' || key === 'createdAt') continue;
    const token = `#${key}`;
    const valToken = `:${key}`;
    names[token] = key;
    values[valToken] = val;
    sets.push(`${token} = ${valToken}`);
  }

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `APPROVAL#${approvalId}`, SK: 'METADATA' },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
    }),
  );
}

// ============================================================================
// 7. Consent Record — PK: CONSENT#{userId}  SK: WHATSAPP_OPTIN | SERVICE_WINDOW
// ============================================================================

export async function putWhatsAppOptIn(userId: string, consent: WhatsAppOptInConsent): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: { PK: `CONSENT#${userId}`, SK: 'WHATSAPP_OPTIN', ...consent },
    }),
  );
}

export async function getWhatsAppOptIn(userId: string): Promise<WhatsAppOptInConsent | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `CONSENT#${userId}`, SK: 'WHATSAPP_OPTIN' } }),
  );
  return (res.Item as WhatsAppOptInConsent) ?? null;
}

export async function putServiceWindow(userId: string, sw: ServiceWindowConsent): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: { PK: `CONSENT#${userId}`, SK: 'SERVICE_WINDOW', ...sw },
    }),
  );
}

export async function getServiceWindow(userId: string): Promise<ServiceWindowConsent | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `CONSENT#${userId}`, SK: 'SERVICE_WINDOW' } }),
  );
  return (res.Item as ServiceWindowConsent) ?? null;
}


// ============================================================================
// 8. Template Registry — PK: TEMPLATE#{templateSid}  SK: METADATA
// ============================================================================

export async function putTemplate(tpl: TemplateRegistry): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: { PK: `TEMPLATE#${tpl.templateSid}`, SK: 'METADATA', ...tpl },
    }),
  );
}

export async function getTemplate(templateSid: string): Promise<TemplateRegistry | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `TEMPLATE#${templateSid}`, SK: 'METADATA' } }),
  );
  return (res.Item as TemplateRegistry) ?? null;
}

/**
 * Scan all templates, optionally filtering by category.
 * Uses a scan with filter since templates are a small, bounded dataset.
 */
export async function scanTemplates(
  category?: TemplateRegistry['category'],
): Promise<TemplateRegistry[]> {
  const table = await tableName();

  const params: ConstructorParameters<typeof ScanCommand>[0] = {
    TableName: table,
    FilterExpression: 'SK = :sk',
    ExpressionAttributeValues: { ':sk': 'METADATA' } as Record<string, unknown>,
  };

  if (category) {
    params.FilterExpression += ' AND category = :cat';
    (params.ExpressionAttributeValues as Record<string, unknown>)[':cat'] = category;
  }

  // Also filter to only TEMPLATE# PKs
  params.FilterExpression += ' AND begins_with(PK, :prefix)';
  (params.ExpressionAttributeValues as Record<string, unknown>)[':prefix'] = 'TEMPLATE#';

  const res = await docClient.send(new ScanCommand(params));
  return (res.Items ?? []) as TemplateRegistry[];
}

// ============================================================================
// 9. Campaign — PK: CAMPAIGN#{campaignId}  SK: METADATA
// ============================================================================

export async function putCampaign(campaign: CampaignRecord): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `CAMPAIGN#${campaign.campaignId}`,
        SK: 'METADATA',
        GSI1PK: `SELLER#${campaign.sellerId}`,
        GSI1SK: `CAMPAIGN#TS#${campaign.createdAt}`,
        ...campaign,
      },
    }),
  );
}

export async function getCampaign(campaignId: string): Promise<CampaignRecord | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({ TableName: table, Key: { PK: `CAMPAIGN#${campaignId}`, SK: 'METADATA' } }),
  );
  return (res.Item as CampaignRecord) ?? null;
}

export async function updateCampaign(
  campaignId: string,
  updates: Partial<Omit<CampaignRecord, 'campaignId' | 'sellerId' | 'createdAt'>>,
): Promise<void> {
  const table = await tableName();
  const sets: string[] = ['updatedAt = :now'];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':now': new Date().toISOString() };

  for (const [key, val] of Object.entries(updates)) {
    if (val === undefined) continue;
    const token = `#${key}`;
    const valToken = `:${key}`;
    names[token] = key;
    values[valToken] = val;
    sets.push(`${token} = ${valToken}`);
  }

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `CAMPAIGN#${campaignId}`, SK: 'METADATA' },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function queryCampaignsBySeller(
  sellerId: string,
  limit = 20,
  exclusiveStartKey?: Record<string, unknown>,
): Promise<{ campaigns: CampaignRecord[]; lastEvaluatedKey?: Record<string, unknown> | undefined }> {
  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `SELLER#${sellerId}`, ':prefix': 'CAMPAIGN#TS#' },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );
  return {
    campaigns: (res.Items ?? []) as CampaignRecord[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

// ============================================================================
// 10. Audit Log — PK: AUDIT#{auditId}  SK: TS#{timestamp}
// ============================================================================

export async function putAuditLog(log: AuditLog): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `AUDIT#${log.auditId}`,
        SK: `TS#${log.createdAt}`,
        GSI1PK: `ACTOR#${log.actorId}`,
        GSI1SK: `TS#${log.createdAt}`,
        GSI2PK: `RESOURCE#${log.resourceType}#${log.resourceId}`,
        GSI2SK: `TS#${log.createdAt}`,
        ...log,
      },
    }),
  );
}

export async function queryAuditByActor(
  actorId: string,
  limit = 50,
  exclusiveStartKey?: Record<string, unknown>,
): Promise<{ logs: AuditLog[]; lastEvaluatedKey?: Record<string, unknown> | undefined }> {
  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `ACTOR#${actorId}` },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );
  return { logs: (res.Items ?? []) as AuditLog[], lastEvaluatedKey: res.LastEvaluatedKey };
}

export async function queryAuditByResource(
  resourceType: string,
  resourceId: string,
  limit = 50,
  exclusiveStartKey?: Record<string, unknown>,
): Promise<{ logs: AuditLog[]; lastEvaluatedKey?: Record<string, unknown> | undefined }> {
  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `RESOURCE#${resourceType}#${resourceId}` },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );
  return { logs: (res.Items ?? []) as AuditLog[], lastEvaluatedKey: res.LastEvaluatedKey };
}

// ============================================================================
// 11. Restock Notification — PK: RESTOCK_NOTIFY#{productId}  SK: USER#{userId}
// ============================================================================

export async function putRestockNotification(notif: RestockNotification): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `RESTOCK_NOTIFY#${notif.productId}`,
        SK: `USER#${notif.userId}`,
        ...notif,
      },
    }),
  );
}

export async function getRestockNotification(
  productId: string,
  userId: string,
): Promise<RestockNotification | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { PK: `RESTOCK_NOTIFY#${productId}`, SK: `USER#${userId}` },
    }),
  );
  return (res.Item as RestockNotification) ?? null;
}

export async function queryRestockSubscribers(
  productId: string,
): Promise<RestockNotification[]> {
  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `RESTOCK_NOTIFY#${productId}` },
    }),
  );
  return (res.Items ?? []) as RestockNotification[];
}

export async function deleteRestockNotification(productId: string, userId: string): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new DeleteCommand({
      TableName: table,
      Key: { PK: `RESTOCK_NOTIFY#${productId}`, SK: `USER#${userId}` },
    }),
  );
}

// ============================================================================
// 12. Onboarding Session — PK: ONBOARDING#{phoneNumber}  SK: ACTIVE
//     24-hour TTL for unregistered user welcome flow
// ============================================================================

export interface OnboardingSessionRecord {
  phoneNumber: string;
  welcomeSent: boolean;
  createdAt: string;
  expiresAt: number; // DynamoDB TTL (epoch seconds)
}

export async function putOnboardingSession(session: OnboardingSessionRecord): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `ONBOARDING#${session.phoneNumber}`,
        SK: 'ACTIVE',
        ...session,
      },
    }),
  );
}

export async function getOnboardingSession(
  phoneNumber: string,
): Promise<OnboardingSessionRecord | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { PK: `ONBOARDING#${phoneNumber}`, SK: 'ACTIVE' },
    }),
  );
  const item = res.Item as OnboardingSessionRecord | undefined;
  if (!item) return null;

  // Check if the session has expired (DynamoDB TTL cleanup is eventually consistent)
  if (item.expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return item;
}

export async function updateOnboardingWelcomeSent(phoneNumber: string): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `ONBOARDING#${phoneNumber}`, SK: 'ACTIVE' },
      UpdateExpression: 'SET welcomeSent = :t',
      ExpressionAttributeValues: { ':t': true },
    }),
  );
}


// ============================================================================
// 13. Session Handoff — Updates handoff fields on SESSION#{userId} ACTIVE
// ============================================================================

/**
 * Activate human handoff on a session.
 * Sets isHumanHandoff=true, handoffSellerId, handoffStartedAt, and handoffExpiresAt.
 */
export async function activateHandoff(
  userId: string,
  sellerId: string,
  expiresAtEpoch: number,
): Promise<void> {
  const table = await tableName();
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `SESSION#${userId}`, SK: 'ACTIVE' },
      UpdateExpression:
        'SET isHumanHandoff = :t, handoffSellerId = :sid, handoffStartedAt = :now, handoffExpiresAt = :exp, lastActivityAt = :now',
      ExpressionAttributeValues: {
        ':t': true,
        ':sid': sellerId,
        ':now': now,
        ':exp': expiresAtEpoch,
      },
    }),
  );
}

/**
 * Reset handoff expiry timer (on each seller reply).
 */
export async function resetHandoffExpiry(
  userId: string,
  expiresAtEpoch: number,
): Promise<void> {
  const table = await tableName();
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `SESSION#${userId}`, SK: 'ACTIVE' },
      UpdateExpression: 'SET handoffExpiresAt = :exp, lastActivityAt = :now',
      ExpressionAttributeValues: { ':exp': expiresAtEpoch, ':now': now },
    }),
  );
}

/**
 * Deactivate human handoff (e.g. /ai command or auto-reset).
 */
export async function deactivateHandoff(userId: string): Promise<void> {
  const table = await tableName();
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `SESSION#${userId}`, SK: 'ACTIVE' },
      UpdateExpression:
        'SET isHumanHandoff = :f, lastActivityAt = :now REMOVE handoffSellerId, handoffStartedAt, handoffExpiresAt',
      ExpressionAttributeValues: { ':f': false, ':now': now },
    }),
  );
}


// ============================================================================
// 14. Campaign Delivery — PK: CAMPAIGN#{campaignId}  SK: DELIVERY#{customerId}
//     Per-customer per-channel delivery tracking for omnichannel campaigns
// ============================================================================

export interface CampaignDeliveryRecord {
  campaignId: string;
  customerId: string;
  channel: 'web' | 'whatsapp';
  sentAt: string;
  deliveredAt?: string;
  readAt?: string;
  convertedAt?: string;
  twilioSid?: string;
  status: 'sent' | 'delivered' | 'read' | 'converted' | 'failed';
}

export async function putCampaignDelivery(record: CampaignDeliveryRecord): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `CAMPAIGN#${record.campaignId}`,
        SK: `DELIVERY#${record.customerId}#${record.channel}`,
        ...record,
      },
    }),
  );
}

export async function queryCampaignDeliveries(
  campaignId: string,
  limit = 100,
): Promise<CampaignDeliveryRecord[]> {
  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CAMPAIGN#${campaignId}`,
        ':prefix': 'DELIVERY#',
      },
      Limit: limit,
    }),
  );
  return (res.Items ?? []) as CampaignDeliveryRecord[];
}

export async function updateCampaignDeliveryStatus(
  campaignId: string,
  customerId: string,
  channel: 'web' | 'whatsapp',
  status: CampaignDeliveryRecord['status'],
  timestampField?: 'deliveredAt' | 'readAt' | 'convertedAt',
): Promise<void> {
  const table = await tableName();
  let updateExpr = 'SET #status = :s';
  const names: Record<string, string> = { '#status': 'status' };
  const values: Record<string, unknown> = { ':s': status };

  if (timestampField) {
    updateExpr += `, ${timestampField} = :ts`;
    values[':ts'] = new Date().toISOString();
  }

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: {
        PK: `CAMPAIGN#${campaignId}`,
        SK: `DELIVERY#${customerId}#${channel}`,
      },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

// ============================================================================
// 14. Upload Record — PK: UPLOAD#{uploadId}  SK: METADATA
//     GSI1PK: SELLER#{sellerId}  GSI1SK: TS#{createdAt}
//     24-hour TTL for auto-cleanup
// ============================================================================

export interface UploadRecord {
  uploadId: string;
  sellerId: string;
  phoneNumber: string;
  mediaType: 'csv' | 'image';
  s3Key: string;
  status: 'processing' | 'completed' | 'failed';
  productCount: number;
  /** CSV-specific: AI column mapping result */
  columnMapping?: Record<string, unknown>;
  /** CSV-specific: header row */
  headers?: string[];
  /** CSV-specific: all CSV lines for frontend re-parsing */
  csvLines?: string[];
  /** Extracted/mapped products ready for review */
  products: Array<{
    name: string;
    price: number;
    quantity: number;
    category?: string;
    sku?: string;
    brand?: string;
    variant?: string;
    confidence?: number;
    rowIndex?: number;
  }>;
  /** Processing errors */
  errors?: string[];
  /** Processing warnings */
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
  /** DynamoDB TTL — 24 hours from creation */
  expiresAt: number;
}

export async function putUpload(record: UploadRecord): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `UPLOAD#${record.uploadId}`,
        SK: 'METADATA',
        GSI1PK: `SELLER#${record.sellerId}`,
        GSI1SK: `TS#${record.createdAt}`,
        ...record,
      },
    }),
  );
  logger.info('Upload record saved', { uploadId: record.uploadId, sellerId: record.sellerId, status: record.status });
}

export async function getUpload(uploadId: string): Promise<UploadRecord | null> {
  const table = await tableName();
  const res = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { PK: `UPLOAD#${uploadId}`, SK: 'METADATA' },
    }),
  );
  return (res.Item as UploadRecord) ?? null;
}

export async function updateUploadStatus(
  uploadId: string,
  status: UploadRecord['status'],
  updates: Partial<Pick<UploadRecord, 'products' | 'productCount' | 'columnMapping' | 'headers' | 'csvLines' | 'errors' | 'warnings'>>,
): Promise<void> {
  const table = await tableName();
  const now = new Date().toISOString();

  let updateExpr = 'SET #status = :s, updatedAt = :now';
  const names: Record<string, string> = { '#status': 'status' };
  const values: Record<string, unknown> = { ':s': status, ':now': now };

  if (updates.products !== undefined) {
    updateExpr += ', products = :products, productCount = :pc';
    values[':products'] = updates.products;
    values[':pc'] = updates.products.length;
  }
  if (updates.columnMapping !== undefined) {
    updateExpr += ', columnMapping = :cm';
    values[':cm'] = updates.columnMapping;
  }
  if (updates.headers !== undefined) {
    updateExpr += ', headers = :headers';
    values[':headers'] = updates.headers;
  }
  if (updates.csvLines !== undefined) {
    updateExpr += ', csvLines = :csvLines';
    values[':csvLines'] = updates.csvLines;
  }
  if (updates.errors !== undefined) {
    updateExpr += ', errors = :errors';
    values[':errors'] = updates.errors;
  }
  if (updates.warnings !== undefined) {
    updateExpr += ', warnings = :warnings';
    values[':warnings'] = updates.warnings;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `UPLOAD#${uploadId}`, SK: 'METADATA' },
      UpdateExpression: updateExpr,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}
