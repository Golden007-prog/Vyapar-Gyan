/**
 * Consent Service
 *
 * Enforces WhatsApp Business API policies before any outbound message.
 * Wraps the consent records stored in DynamoDB:
 *   - CONSENT#{userId} WHATSAPP_OPTIN  — opt-in / opt-out preferences
 *   - CONSENT#{userId} SERVICE_WINDOW   — 24h service window + frequency cap
 *
 * Policy checks (in order):
 * 1. Transactional messages always bypass all checks
 * 2. Opt-out status — promotional messages blocked if opted out
 * 3. Quiet hours — 22:00–09:00 IST, promotional messages queued for morning
 * 4. Frequency cap — max 3 promotional messages per rolling 24h window
 * 5. Service window — if expired, outbound requires a pre-approved template
 */

import { logger } from '../utils/logger';
import {
  getWhatsAppOptIn,
  putWhatsAppOptIn,
  getServiceWindow,
  putServiceWindow,
  type WhatsAppOptInConsent,
  type ServiceWindowConsent,
} from '../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IST offset from UTC in hours */
const IST_OFFSET_HOURS = 5.5;

/** Quiet hours: 22:00–09:00 IST */
const QUIET_HOUR_START = 22; // 10 PM IST
const QUIET_HOUR_END = 9;   // 9 AM IST

/** Max promotional messages per rolling 24h window */
const FREQUENCY_CAP = 3;

/** Service window duration: 24 hours in milliseconds */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Rolling window for frequency cap reset: 24 hours in milliseconds */
const FREQUENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Opt-out keywords (case-insensitive) — English and Hindi */
const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'रुको', 'बंद करो'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MessageType = 'transactional' | 'promotional';

export interface SendPermission {
  allowed: boolean;
  reason?: 'opted_out' | 'quiet_hours' | 'frequency_cap';
  action?: 'queue_for_morning';
  requiresTemplate?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the current hour in IST (0–23). */
function getCurrentISTHour(): number {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const istTotalMinutes = (utcHours * 60 + utcMinutes) + (IST_OFFSET_HOURS * 60);
  const istHour = Math.floor(istTotalMinutes / 60) % 24;
  return istHour;
}

/** Check if the current time falls within quiet hours (22:00–09:00 IST). */
function isQuietHours(): boolean {
  const hour = getCurrentISTHour();
  // Quiet hours wrap around midnight: 22, 23, 0, 1, ..., 8
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
}

/** Check if the frequency counter needs a reset (older than 24h). */
function shouldResetFrequency(lastResetAt: string): boolean {
  const lastReset = new Date(lastResetAt).getTime();
  return Date.now() - lastReset >= FREQUENCY_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a message can be sent to a user.
 *
 * Transactional messages (OTP, order updates, shipping) always pass.
 * Promotional messages are subject to opt-out, quiet hours, frequency cap,
 * and service window checks.
 */
export async function checkSendPermission(
  userId: string,
  messageType: MessageType,
): Promise<SendPermission> {
  // 1. Transactional messages always allowed
  if (messageType === 'transactional') {
    return { allowed: true };
  }

  // 2. Check opt-out status
  const optIn = await getWhatsAppOptIn(userId);
  if (optIn?.optedOut) {
    logger.info('Send blocked: user opted out', { userId });
    return { allowed: false, reason: 'opted_out' };
  }

  // 3. Check quiet hours (22:00–09:00 IST)
  if (isQuietHours()) {
    logger.info('Send blocked: quiet hours', { userId });
    return { allowed: false, reason: 'quiet_hours', action: 'queue_for_morning' };
  }

  // 4. Check frequency cap (3 promotional per 24h rolling window)
  const sw = await getServiceWindow(userId);
  if (sw) {
    let count = sw.promotionalMessageCount;

    // Reset counter if the window has elapsed
    if (shouldResetFrequency(sw.lastPromotionalResetAt)) {
      count = 0;
    }

    if (count >= FREQUENCY_CAP) {
      logger.info('Send blocked: frequency cap reached', { userId, count });
      return { allowed: false, reason: 'frequency_cap' };
    }
  }

  // 5. Check service window (last inbound + 24h)
  if (sw) {
    const windowExpiry = new Date(sw.serviceWindowExpiresAt).getTime();
    if (Date.now() >= windowExpiry) {
      logger.info('Service window expired — template required', { userId });
      return { allowed: true, requiresTemplate: true };
    }
  } else {
    // No service window record at all — template required
    return { allowed: true, requiresTemplate: true };
  }

  return { allowed: true, requiresTemplate: false };
}

/**
 * Record an inbound message from a user.
 * Updates the service window expiry to now + 24 hours.
 */
export async function recordInboundMessage(userId: string): Promise<void> {
  const now = new Date();
  const existing = await getServiceWindow(userId);

  const sw: ServiceWindowConsent = {
    serviceWindowExpiresAt: new Date(now.getTime() + SERVICE_WINDOW_MS).toISOString(),
    promotionalMessageCount: existing?.promotionalMessageCount ?? 0,
    lastPromotionalResetAt: existing?.lastPromotionalResetAt ?? now.toISOString(),
  };

  // Reset frequency counter if the window has elapsed
  if (existing && shouldResetFrequency(existing.lastPromotionalResetAt)) {
    sw.promotionalMessageCount = 0;
    sw.lastPromotionalResetAt = now.toISOString();
  }

  await putServiceWindow(userId, sw);
  logger.info('Inbound message recorded — service window updated', { userId });
}

/**
 * Detect opt-out keywords and update consent record.
 * Supports: STOP, Unsubscribe, रुको, बंद करो (case-insensitive).
 *
 * Returns true if the message was an opt-out keyword.
 */
export async function handleOptOut(
  userId: string,
  messageText: string,
): Promise<boolean> {
  const normalised = messageText.trim().toLowerCase();
  const isOptOut = OPT_OUT_KEYWORDS.some((kw) => normalised === kw);

  if (!isOptOut) {
    return false;
  }

  const now = new Date().toISOString();
  const existing = await getWhatsAppOptIn(userId);

  const consent: WhatsAppOptInConsent = {
    optedIn: existing?.optedIn ?? false,
    optInMethod: existing?.optInMethod ?? 'registration',
    optedOut: true,
    optedOutAt: now,
    optOutMethod: `keyword:${normalised}`,
    suppressPromotional: true,
  };

  // Preserve optedInAt only if it exists
  if (existing?.optedInAt) {
    consent.optedInAt = existing.optedInAt;
  }

  await putWhatsAppOptIn(userId, consent);
  logger.info('User opted out of promotional messages', {
    userId,
    keyword: normalised,
  });

  return true;
}

/**
 * Increment the promotional message counter after a successful send.
 * Should be called by the sending layer after delivering a promotional message.
 */
export async function incrementPromotionalCount(userId: string): Promise<void> {
  const now = new Date();
  const existing = await getServiceWindow(userId);

  if (!existing) {
    // No service window — create one with count = 1
    await putServiceWindow(userId, {
      serviceWindowExpiresAt: now.toISOString(), // no active window
      promotionalMessageCount: 1,
      lastPromotionalResetAt: now.toISOString(),
    });
    return;
  }

  let count = existing.promotionalMessageCount;
  let resetAt = existing.lastPromotionalResetAt;

  if (shouldResetFrequency(resetAt)) {
    count = 0;
    resetAt = now.toISOString();
  }

  await putServiceWindow(userId, {
    ...existing,
    promotionalMessageCount: count + 1,
    lastPromotionalResetAt: resetAt,
  });

  logger.debug('Promotional message count incremented', {
    userId,
    newCount: count + 1,
  });
}
