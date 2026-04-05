/**
 * Cart Abandonment Worker
 *
 * Invoked by EventBridge Scheduler when a cart inactivity timer fires.
 * Handles both first nudge (2h) and second nudge (24h) flows.
 *
 * First nudge: "You have {n} items in your cart worth ₹{amount}. Ready to checkout?"
 * Second nudge: includes small incentive (free delivery)
 *
 * Channel selection: WhatsApp if active session, Web Chat otherwise.
 *
 * Lambda config: timeout 120s, memory 512MB
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6
 */

import type { ScheduledEvent } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { getUserProfile } from '../../adapters/dynamodb-adapter';
import { getCart } from '../../adapters/dynamodb-adapter';
import { getSessionByPhone } from '../../adapters/dynamodb-adapter';
import { checkSendPermission } from '../../services/consent-service';
import { TwilioAdapter } from '../../adapters/twilio-adapter';
import {
  formatNudgeMessage,
  selectNudgeChannel,
  createSecondNudgeTimer,
  trackNudge,
} from '../../services/cart-abandonment-scheduler';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const twilioAdapter = new TwilioAdapter();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NudgeEvent {
  userId: string;
  cartId: string;
  nudgeType: 'first' | 'second';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: ScheduledEvent | NudgeEvent): Promise<void> {
  // The event may come from EventBridge Scheduler with the payload in detail,
  // or directly as a NudgeEvent from the scheduler target input.
  const nudgeEvent: NudgeEvent =
    'detail' in event && typeof event.detail === 'object' && event.detail !== null
      ? (event.detail as NudgeEvent)
      : (event as NudgeEvent);

  const { userId, cartId, nudgeType } = nudgeEvent;

  logger.info('Cart abandonment worker invoked', { userId, cartId, nudgeType });

  try {
    // 1. Check if cart still exists and has items (may have been checked out)
    const cart = await getCart(userId);
    if (!cart || cart.items.length === 0) {
      logger.info('Cart is empty or checked out — skipping nudge', { userId });
      return;
    }

    // 2. Get user profile for phone number
    const user = await getUserProfile(userId);
    if (!user?.phoneNumber) {
      logger.debug('No phone number — skipping cart nudge', { userId });
      return;
    }

    // 3. Check consent
    const permission = await checkSendPermission(userId, 'promotional');
    if (!permission.allowed) {
      logger.debug('Send blocked by consent', { userId, reason: permission.reason });
      return;
    }

    // 4. Determine channel: WhatsApp if active session, Web Chat otherwise
    const session = await getSessionByPhone(user.phoneNumber);
    const hasActiveWhatsApp = session !== null && session.state !== 'closed';
    const channel = selectNudgeChannel(hasActiveWhatsApp);

    // 5. Format nudge message
    const message = formatNudgeMessage(cart.itemCount, cart.subtotal, nudgeType);

    // 6. Send nudge via selected channel
    if (channel === 'whatsapp') {
      await twilioAdapter.sendWhatsAppMessage(user.phoneNumber, message);
      logger.info('Cart nudge sent via WhatsApp', { userId, nudgeType });
    } else {
      // Web Chat: log for now — WebSocket push would be handled by fan-out
      logger.info('Cart nudge queued for Web Chat', { userId, nudgeType, message });
    }

    // 7. Track nudge effectiveness (Req 21.6)
    await trackNudge({
      userId,
      nudgeType,
      channel,
      sentAt: new Date().toISOString(),
      cartRecovered: false,
      cartValue: cart.subtotal,
      itemCount: cart.itemCount,
    });

    // 8. If first nudge, create 24h second nudge timer (Req 21.5)
    if (nudgeType === 'first') {
      try {
        await createSecondNudgeTimer(userId, cartId);
        logger.info('Second nudge timer created', { userId, cartId });
      } catch (err) {
        logger.error('Failed to create second nudge timer', err, { userId });
      }
    }

    logger.info('Cart abandonment nudge completed', {
      userId,
      nudgeType,
      channel,
      itemCount: cart.itemCount,
      cartValue: cart.subtotal,
    });
  } catch (error) {
    logger.error('Cart abandonment worker failed', error, { userId, nudgeType });
  }
}
