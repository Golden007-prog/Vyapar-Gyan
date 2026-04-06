/**
 * Notification Router Worker
 *
 * EventBridge-triggered Lambda that handles:
 * 1. Cross-channel message bridging (CustomerMessageSent from vyapargyan.chat)
 * 2. Order event notifications (order.* from vyapargyan.orders)
 *
 * For order events:
 *   - Queries recipient active channels (WebSocket connection, WhatsApp service window)
 *   - Formats notification per channel using order notification formatter
 *   - Delivers to all active channels; logs failures without blocking
 *   - Creates notification record in DynamoDB (PK: NOTIFICATION#{id}, SK: METADATA)
 *
 * Lambda config: timeout 30s, memory 256MB, triggered by EventBridge
 */

import { randomUUID } from 'crypto';
import type { EventBridgeEvent } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { getUserProfile, putMessage, putItem } from '../../adapters/dynamodb-adapter';
import { checkSendPermission } from '../../services/consent-service';
import { twilioAdapter } from '../../adapters/twilio-adapter';
import {
  formatOrderNotification,
  type OrderEventDetail,
  type NotificationChannel,
  type RecipientRole,
} from '../../services/order-notification-formatter';

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
  event: EventBridgeEvent<string, any>,
): Promise<void> {
  const source = event.source;

  // Route based on event source
  if (source === 'vyapargyan.orders') {
    await handleOrderEvent(event as EventBridgeEvent<string, OrderEventDetail>);
    return;
  }

  // Default: handle chat message routing (CustomerMessageSent)
  const detail = event.detail as CustomerMessageSentDetail;

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


// ---------------------------------------------------------------------------
// Order Event Handling
// ---------------------------------------------------------------------------

/**
 * Handle order lifecycle events from vyapargyan.orders source.
 *
 * 1. Resolve customer and seller profiles for display names and channels
 * 2. Format notifications per channel using order notification formatter
 * 3. Deliver to all active channels; log failures without blocking
 * 4. Create notification records in DynamoDB
 */
async function handleOrderEvent(
  event: EventBridgeEvent<string, OrderEventDetail>,
): Promise<void> {
  const detailType = event['detail-type'];
  const detail = event.detail;

  logger.info('Order event received', {
    detailType,
    orderId: detail.humanReadableId || detail.orderId,
    sellerId: detail.sellerId,
    customerId: detail.customerId,
    status: detail.status,
  });

  // Resolve profiles for display names and channel preferences
  const [sellerProfile, customerProfile] = await Promise.all([
    getUserProfile(detail.sellerId).catch(() => null),
    getUserProfile(detail.customerId).catch(() => null),
  ]);

  // Enrich event with display names
  const enrichedEvent: OrderEventDetail = {
    ...detail,
    sellerName: sellerProfile?.businessName || sellerProfile?.displayName || detail.sellerId,
    customerName: customerProfile?.profileName || customerProfile?.displayName || detail.customerId,
  };

  // Determine which recipients to notify based on event type
  const recipients = getRecipientsForEvent(detailType);

  // Deliver to each recipient on all their active channels
  const deliveryPromises: Promise<void>[] = [];

  for (const recipient of recipients) {
    const profile = recipient.role === 'seller' ? sellerProfile : customerProfile;
    const userId = recipient.role === 'seller' ? detail.sellerId : detail.customerId;

    if (!profile) {
      logger.warn('Profile not found for notification recipient', {
        userId,
        role: recipient.role,
      });
      continue;
    }

    const channels = resolveActiveChannels(profile);

    for (const channel of channels) {
      deliveryPromises.push(
        deliverOrderNotification(
          detailType,
          enrichedEvent,
          channel,
          recipient.role,
          userId,
          profile,
        ),
      );
    }
  }

  // Deliver all notifications in parallel; failures are logged, not thrown
  await Promise.allSettled(deliveryPromises);
}

/**
 * Determine which recipients (customer, seller, or both) should be notified
 * for a given order event type.
 */
function getRecipientsForEvent(detailType: string): Array<{ role: RecipientRole }> {
  switch (detailType) {
    // Seller-only notifications
    case 'order.created':
    case 'order.cancelled':
      return [{ role: 'seller' }];

    // Customer-only notifications
    case 'order.confirmed':
    case 'order.payment_pending':
    case 'order.preparing':
    case 'order.shipped':
    case 'order.delivered':
    case 'order.rejected':
    case 'order.expired':
    case 'order.payment_failed':
      return [{ role: 'customer' }];

    // Both parties
    case 'order.paid':
      return [{ role: 'customer' }, { role: 'seller' }];

    default:
      return [{ role: 'customer' }, { role: 'seller' }];
  }
}

/**
 * Resolve active notification channels for a user profile.
 * Checks preferredChannel setting to determine which channels to use.
 */
function resolveActiveChannels(profile: any): NotificationChannel[] {
  const preferred = profile.preferredChannel || 'web';
  const hasPhone = !!profile.phoneNumber || !!profile.phone;

  if (preferred === 'both' && hasPhone) return ['whatsapp', 'web'];
  if (preferred === 'whatsapp' && hasPhone) return ['whatsapp'];
  return ['web'];
}

/**
 * Deliver a formatted order notification to a specific channel.
 * Creates a notification record in DynamoDB after delivery.
 */
async function deliverOrderNotification(
  detailType: string,
  event: OrderEventDetail,
  channel: NotificationChannel,
  recipientRole: RecipientRole,
  recipientUserId: string,
  profile: any,
): Promise<void> {
  const notificationId = randomUUID();
  let deliveryStatus: 'sent' | 'failed' = 'sent';

  try {
    const formatted = formatOrderNotification(detailType, event, channel, recipientRole);

    if (channel === 'whatsapp') {
      const phone = profile.phoneNumber || profile.phone;
      if (!phone) {
        logger.warn('No phone number for WhatsApp order notification', { recipientUserId });
        deliveryStatus = 'failed';
      } else {
        // Check consent before sending
        const permission = await checkSendPermission(recipientUserId, 'transactional');
        if (!permission.allowed) {
          logger.info('WhatsApp order notification blocked by consent', {
            recipientUserId,
            reason: permission.reason,
          });
          deliveryStatus = 'failed';
        } else {
          const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
          await twilioAdapter.sendWhatsAppMessage(formattedPhone, formatted.body);
          logger.info('WhatsApp order notification sent', {
            recipientUserId,
            detailType,
            orderId: event.humanReadableId,
          });
        }
      }
    } else {
      // Web channel — notification is stored in DynamoDB for frontend polling/WebSocket push
      logger.info('Web order notification recorded', {
        recipientUserId,
        detailType,
        orderId: event.humanReadableId,
      });
    }
  } catch (error) {
    deliveryStatus = 'failed';
    logger.error('Failed to deliver order notification', error, {
      recipientUserId,
      channel,
      detailType,
      orderId: event.humanReadableId,
    });
  }

  // Create notification record in DynamoDB
  try {
    await putItem({
      PK: `NOTIFICATION#${notificationId}`,
      SK: 'METADATA',
      notificationId,
      channel,
      recipientId: recipientUserId,
      recipientRole,
      orderId: event.orderId,
      humanReadableId: event.humanReadableId,
      detailType,
      status: deliveryStatus,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    // Non-fatal — notification was already delivered (or attempted)
    logger.error('Failed to create notification record', error, {
      notificationId,
      recipientUserId,
    });
  }
}
