/**
 * Notification Router Worker
 *
 * EventBridge-triggered Lambda that handles cross-channel message bridging.
 * Routes customer messages to sellers (and seller replies to customers)
 * based on each party's preferredChannel setting.
 *
 * Event pattern consumed:
 *   source: vyapargyan.chat
 *   detail-type: CustomerMessageSent
 *
 * Routing logic (customer → seller):
 *   1. Look up seller's preferredChannel from USER#{sellerId} PROFILE
 *   2. whatsapp → send via TwilioAdapter (with service window / template check)
 *   3. web     → message already in THREAD#{sellerId}, appears on next inbox poll
 *   4. both    → deliver to both channels
 *   5. Always store message in THREAD#{sellerId} for the seller's inbox view
 *
 * Lambda config: timeout 30s, memory 256MB, triggered by EventBridge
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { getUserProfile, putMessage } from '../../adapters/dynamodb-adapter';
import { checkSendPermission } from '../../services/consent-service';
import { twilioAdapter } from '../../adapters/twilio-adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CustomerMessageSentDetail {
  userId: string;
  messageId: string;
  channel: 'web' | 'whatsapp';
  sellerId?: string;
  content: string;
  messageType: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** TTL for thread messages — 30 days in seconds */
const MESSAGE_TTL_DAYS = 30;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: EventBridgeEvent<'CustomerMessageSent', CustomerMessageSentDetail>,
): Promise<void> {
  const detail = event.detail;

  logger.info('Notification router processing', {
    userId: detail.userId,
    messageId: detail.messageId,
    channel: detail.channel,
    sellerId: detail.sellerId,
    messageType: detail.messageType,
  });

  if (!detail.sellerId) {
    logger.warn('No sellerId in event — skipping routing', {
      messageId: detail.messageId,
    });
    return;
  }

  try {
    await routeCustomerMessageToSeller(detail);
  } catch (error) {
    // Log and continue — don't throw so the event isn't retried endlessly
    logger.error('Notification router failed', error, {
      userId: detail.userId,
      sellerId: detail.sellerId,
      messageId: detail.messageId,
    });
  }
}


// ---------------------------------------------------------------------------
// Routing Logic
// ---------------------------------------------------------------------------

/**
 * Route a customer's message to the target seller.
 *
 * 1. Look up seller profile → preferredChannel + phoneNumber
 * 2. Store message in seller's THREAD for inbox view
 * 3. If seller prefers WhatsApp (or both) → send via Twilio with consent check
 * 4. If seller prefers web only → message is already in THREAD, no extra action
 */
async function routeCustomerMessageToSeller(
  detail: CustomerMessageSentDetail,
): Promise<void> {
  const { userId, sellerId, messageId, content, messageType, createdAt, channel } = detail;

  // 1. Look up seller profile
  const sellerProfile = await getUserProfile(sellerId!);

  if (!sellerProfile) {
    logger.warn('Seller profile not found — cannot route message', { sellerId });
    return;
  }

  const sellerChannel = sellerProfile.preferredChannel ?? 'web';

  logger.info('Seller channel preference resolved', {
    sellerId,
    sellerChannel,
    sellerPhone: sellerProfile.phoneNumber ? '***' : undefined,
  });

  // 2. Store message in seller's THREAD for inbox view
  const now = new Date();
  const ttlEpoch = Math.floor(now.getTime() / 1000) + MESSAGE_TTL_DAYS * 24 * 60 * 60;

  await putMessage({
    userId: sellerId!,
    messageId: `routed-${messageId}`,
    direction: 'inbound',
    channel,
    senderRole: 'customer',
    messageType: (messageType as any) || 'text',
    content: { text: content, fromUserId: userId },
    deliveryStatus: 'delivered',
    createdAt: createdAt || now.toISOString(),
    expiresAt: ttlEpoch,
  });

  logger.info('Message stored in seller THREAD', {
    sellerId,
    messageId,
  });

  // 3. Route to WhatsApp if seller prefers it (or both)
  if (sellerChannel === 'whatsapp' || sellerChannel === 'both') {
    await sendToWhatsApp(sellerId!, sellerProfile.phoneNumber, content, userId);
  }

  // If seller prefers 'web' only, the message is already in THREAD — nothing else to do.
  if (sellerChannel === 'web') {
    logger.info('Seller prefers web — message in THREAD, no WhatsApp delivery', {
      sellerId,
    });
  }
}

/**
 * Send a message to a seller (or customer) via WhatsApp through TwilioAdapter.
 * Checks consent / service window before sending.
 */
async function sendToWhatsApp(
  recipientUserId: string,
  phoneNumber: string,
  content: string,
  senderUserId: string,
): Promise<void> {
  if (!phoneNumber) {
    logger.warn('No phone number for WhatsApp delivery — skipping', {
      recipientUserId,
    });
    return;
  }

  // Check consent / service window
  const permission = await checkSendPermission(recipientUserId, 'transactional');

  if (!permission.allowed) {
    logger.info('WhatsApp send not allowed by consent service', {
      recipientUserId,
      reason: permission.reason,
    });
    return;
  }

  try {
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    const messageBody = `New message from customer: ${content}`;

    await twilioAdapter.sendWhatsAppMessage(formattedPhone, messageBody);

    logger.info('WhatsApp message delivered to recipient', {
      recipientUserId,
      senderUserId,
    });
  } catch (error) {
    // Log but don't throw — the message is already stored in THREAD
    logger.error('Failed to deliver WhatsApp message', error, {
      recipientUserId,
      senderUserId,
    });
  }
}
