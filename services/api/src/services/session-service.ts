/**
 * Session Service
 *
 * Manages unified sessions spanning WhatsApp and web channels.
 * Sessions are keyed by userId (PK: SESSION#{userId}, SK: ACTIVE) with
 * phone-based GSI1 lookup for WhatsApp resolution.
 *
 * Responsibilities:
 * - Resolve or create sessions by userId or phone number
 * - Update session state transitions
 * - Mark sessions as expired/closed
 * - Restore sessions with existing cart on customer return
 */

import { logger } from '../utils/logger';
import {
  putSession,
  getSession,
  getSessionByPhone,
  updateSessionState as dbUpdateSessionState,
  getUserByPhone,
  getCart,
  putOnboardingSession,
  getOnboardingSession,
  updateOnboardingWelcomeSent,
  activateHandoff as dbActivateHandoff,
  resetHandoffExpiry as dbResetHandoffExpiry,
  deactivateHandoff as dbDeactivateHandoff,
  type UnifiedSession,
  type Cart,
} from '../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Session TTL: 30 days in seconds */
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Onboarding session TTL: 24 hours in seconds */
const ONBOARDING_TTL_SECONDS = 86400;

/** Inactivity threshold before a session is considered expired: 24 hours */
const INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedSession {
  session: UnifiedSession;
  isNew: boolean;
  restoredCart?: Cart;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an existing session or create a new one.
 *
 * Resolution order:
 * 1. If userId is provided, look up SESSION#{userId} ACTIVE directly.
 * 2. If phone is provided, look up user via GSI1 PHONE#{phone} → get userId,
 *    then resolve session by userId.
 * 3. If no session exists, create a new one in "greeting" state.
 * 4. If a previous session was closed but a cart still exists (within 7-day TTL),
 *    restore the cart reference and send a "welcome back" indicator.
 */
export async function resolveOrCreateSession(params: {
  userId?: string;
  phoneNumber?: string;
  channel: UnifiedSession['lastActiveChannel'];
}): Promise<ResolvedSession> {
  const { userId, phoneNumber, channel } = params;

  // Determine the userId — either provided directly or resolved from phone
  let resolvedUserId = userId;

  if (!resolvedUserId && phoneNumber) {
    const user = await getUserByPhone(phoneNumber);
    if (user) {
      resolvedUserId = user.userId;
    }
  }

  if (!resolvedUserId) {
    throw new Error('Cannot resolve session: no userId or matching phone found');
  }

  // Try to get existing session
  const existing = await getSession(resolvedUserId);

  if (existing && existing.state !== 'closed') {
    // Update last activity and channel
    await dbUpdateSessionState(resolvedUserId, existing.state, channel);
    logger.info('Session resolved', { userId: resolvedUserId, state: existing.state, channel });
    return { session: { ...existing, lastActiveChannel: channel, lastActivityAt: new Date().toISOString() }, isNew: false };
  }

  // Check for existing cart to restore (welcome back flow)
  let restoredCart: Cart | undefined;
  if (existing?.state === 'closed') {
    const cart = await getCart(resolvedUserId);
    if (cart && cart.items.length > 0) {
      restoredCart = cart;
      logger.info('Restoring cart for returning customer', {
        userId: resolvedUserId,
        itemCount: cart.itemCount,
      });
    }
  }

  // Create new session
  const now = new Date();
  const newSession: UnifiedSession = {
    userId: resolvedUserId,
    state: 'greeting',
    lastActiveChannel: channel,
    lastActivityAt: now.toISOString(),
    phoneNumber: phoneNumber || existing?.phoneNumber || '',
    createdAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS,
  };

  await putSession(newSession);
  logger.info('New session created', {
    userId: resolvedUserId,
    channel,
    hasRestoredCart: !!restoredCart,
  });

  return { session: newSession, isNew: true, ...(restoredCart ? { restoredCart } : {}) };
}

/**
 * Update the state of an active session.
 * Also refreshes lastActivityAt and the TTL.
 */
export async function updateState(
  userId: string,
  state: UnifiedSession['state'],
  channel: UnifiedSession['lastActiveChannel'],
): Promise<void> {
  await dbUpdateSessionState(userId, state, channel);
  logger.info('Session state updated', { userId, state, channel });
}

/**
 * Mark a session as expired/closed.
 * The cart and message history are preserved per their own TTLs
 * (cart: 7 days, messages: 30 days).
 */
export async function markExpired(userId: string): Promise<void> {
  await dbUpdateSessionState(userId, 'closed', 'web');
  logger.info('Session marked as expired', { userId });
}

/**
 * Check if a session is inactive beyond the threshold (24 hours).
 */
export function isInactive(session: UnifiedSession): boolean {
  const lastActivity = new Date(session.lastActivityAt).getTime();
  return Date.now() - lastActivity > INACTIVITY_THRESHOLD_MS;
}

/**
 * Resolve a session by phone number only (convenience for WhatsApp webhook).
 * Returns null if no user or session is found for the phone.
 */
export async function resolveByPhone(
  phoneNumber: string,
): Promise<UnifiedSession | null> {
  const session = await getSessionByPhone(phoneNumber);
  if (session) {
    logger.debug('Session resolved by phone', { phoneNumber, userId: session.userId });
  }
  return session;
}

// ---------------------------------------------------------------------------
// Onboarding Session (unregistered users — 24h TTL)
// ---------------------------------------------------------------------------

export interface OnboardingSession {
  phoneNumber: string;
  welcomeSent: boolean;
  createdAt: string;
  expiresAt: number; // DynamoDB TTL (epoch seconds)
}

/**
 * Compute the DynamoDB TTL for an onboarding session.
 * TTL = floor(createdAt / 1000) + 86400
 */
export function computeOnboardingTTL(createdAtMs: number): number {
  return Math.floor(createdAtMs / 1000) + ONBOARDING_TTL_SECONDS;
}

/**
 * Resolve or create an onboarding session for an unregistered phone number.
 *
 * - If an active onboarding session exists (not yet expired), return it.
 * - Otherwise create a new one with `welcomeSent = false` and a 24h TTL.
 *
 * After the first welcome message is sent the caller should call
 * `markOnboardingWelcomeSent()` to flip the flag so subsequent messages
 * within the same 24h window receive the shorter reminder.
 */
export async function resolveOrCreateOnboardingSession(
  phoneNumber: string,
): Promise<{ session: OnboardingSession; isNew: boolean }> {
  const existing = await getOnboardingSession(phoneNumber);

  if (existing) {
    logger.info('Onboarding session resolved', { phoneNumber, welcomeSent: existing.welcomeSent });
    return { session: existing, isNew: false };
  }

  const now = Date.now();
  const newSession: OnboardingSession = {
    phoneNumber,
    welcomeSent: false,
    createdAt: new Date(now).toISOString(),
    expiresAt: computeOnboardingTTL(now),
  };

  await putOnboardingSession(newSession);
  logger.info('Onboarding session created', { phoneNumber, expiresAt: newSession.expiresAt });
  return { session: newSession, isNew: true };
}

/**
 * Mark the onboarding session as having sent the full welcome message.
 */
export async function markOnboardingWelcomeSent(phoneNumber: string): Promise<void> {
  await updateOnboardingWelcomeSent(phoneNumber);
  logger.info('Onboarding welcome marked as sent', { phoneNumber });
}


// ---------------------------------------------------------------------------
// Human Handoff Protocol (Req 10.1–10.5)
// ---------------------------------------------------------------------------

/** Handoff inactivity timeout: 30 minutes in seconds */
const HANDOFF_TIMEOUT_SECONDS = 30 * 60;

/**
 * Pure function: determine if a session's handoff has expired.
 * Returns true when handoffExpiresAt <= nowEpoch (or handoff fields are missing).
 */
export function isHandoffExpired(
  session: Pick<UnifiedSession, 'isHumanHandoff' | 'handoffExpiresAt'>,
  nowEpoch: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!session.isHumanHandoff) return true;
  if (session.handoffExpiresAt === undefined || session.handoffExpiresAt === null) return true;
  return session.handoffExpiresAt <= nowEpoch;
}

/**
 * Pure function: determine if AI processing should be bypassed.
 * Returns true when handoff is active AND not expired.
 */
export function shouldBypassAI(
  session: Pick<UnifiedSession, 'isHumanHandoff' | 'handoffExpiresAt'>,
  nowEpoch: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!session.isHumanHandoff) return false;
  return !isHandoffExpired(session, nowEpoch);
}

/**
 * Activate human handoff for a customer session.
 * Called when a seller sends the first reply from the web Inbox.
 */
export async function startHandoff(
  customerUserId: string,
  sellerId: string,
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + HANDOFF_TIMEOUT_SECONDS;
  await dbActivateHandoff(customerUserId, sellerId, expiresAt);
  logger.info('Human handoff activated', { customerUserId, sellerId, expiresAt });
}

/**
 * Extend handoff timer on each subsequent seller reply.
 */
export async function extendHandoff(customerUserId: string): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + HANDOFF_TIMEOUT_SECONDS;
  await dbResetHandoffExpiry(customerUserId, expiresAt);
  logger.info('Handoff timer extended', { customerUserId, expiresAt });
}

/**
 * Deactivate human handoff (seller types /ai or auto-reset).
 */
export async function endHandoff(customerUserId: string): Promise<void> {
  await dbDeactivateHandoff(customerUserId);
  logger.info('Human handoff deactivated', { customerUserId });
}
