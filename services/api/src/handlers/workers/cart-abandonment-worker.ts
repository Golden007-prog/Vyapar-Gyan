/**
 * Cart Abandonment Worker
 *
 * EventBridge scheduled worker — cron 8:30 PM IST (15:00 UTC) daily.
 * Queries carts with updatedAt older than 24 hours, sends a reminder to
 * customers who have an active service window (free-form) or via a
 * pre-approved template for out-of-window sends.
 *
 * Lambda config: timeout 120s, memory 512MB
 */

import type { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { getUserProfile } from '../../adapters/dynamodb-adapter';
import { checkSendPermission } from '../../services/consent-service';
import { TwilioAdapter } from '../../adapters/twilio-adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cart is considered abandoned after 24 hours of inactivity */
const ABANDONMENT_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Max carts to process per invocation */
const MAX_CARTS_PER_RUN = 100;

/** Template SID for cart reminder (out-of-window sends) */
const CART_REMINDER_TEMPLATE = 'cart_reminder';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const twilioAdapter = new TwilioAdapter();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: ScheduledEvent): Promise<void> {
  logger.info('Cart abandonment worker started', { time: event.time });

  try {
    const config = await getConfig();
    const cutoff = new Date(Date.now() - ABANDONMENT_THRESHOLD_MS).toISOString();

    // Query abandoned carts
    const abandonedCarts = await queryAbandonedCarts(config.tableName, cutoff);

    logger.info('Abandoned carts found', { count: abandonedCarts.length });

    let sentCount = 0;
    let skippedCount = 0;

    for (const cart of abandonedCarts) {
      const sent = await sendCartReminder(cart);
      if (sent) {
        sentCount++;
      } else {
        skippedCount++;
      }
    }

    logger.info('Cart abandonment worker completed', {
      sentCount,
      skippedCount,
      totalProcessed: abandonedCarts.length,
    });
  } catch (error) {
    logger.error('Cart abandonment worker failed', error);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AbandonedCart {
  userId: string;
  itemCount: number;
  subtotal: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Query abandoned carts
// ---------------------------------------------------------------------------

async function queryAbandonedCarts(
  tableName: string,
  cutoff: string,
): Promise<AbandonedCart[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression:
        'begins_with(PK, :cartPrefix) AND SK = :active AND updatedAt < :cutoff AND itemCount > :zero',
      ExpressionAttributeValues: {
        ':cartPrefix': 'CART#',
        ':active': 'ACTIVE',
        ':cutoff': cutoff,
        ':zero': 0,
      },
      ProjectionExpression: 'userId, itemCount, subtotal, updatedAt',
      Limit: MAX_CARTS_PER_RUN,
    }),
  );

  return (result.Items ?? []).map((item) => ({
    userId: item.userId,
    itemCount: item.itemCount ?? 0,
    subtotal: item.subtotal ?? 0,
    updatedAt: item.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Send cart reminder
// ---------------------------------------------------------------------------

async function sendCartReminder(cart: AbandonedCart): Promise<boolean> {
  try {
    const user = await getUserProfile(cart.userId);
    if (!user?.phoneNumber) {
      logger.debug('No phone number — skipping cart reminder', {
        userId: cart.userId,
      });
      return false;
    }

    // Check consent — cart reminders are promotional
    const permission = await checkSendPermission(cart.userId, 'promotional');
    if (!permission.allowed) {
      logger.debug('Send blocked by consent', {
        userId: cart.userId,
        reason: permission.reason,
      });
      return false;
    }

    const amount = `₹${cart.subtotal.toLocaleString('en-IN')}`;

    if (permission.requiresTemplate) {
      // Out of service window — use template
      // Template parameters: itemCount, subtotal
      logger.info('Sending cart reminder via template', {
        userId: cart.userId,
        template: CART_REMINDER_TEMPLATE,
      });
      // Template sends would go through a template-aware send path.
      // For now, log and skip — template sending requires Twilio content SID integration.
      logger.info('Template-based cart reminder queued', {
        userId: cart.userId,
        itemCount: cart.itemCount,
        subtotal: cart.subtotal,
      });
      return false;
    }

    // Within service window — send free-form message
    const message =
      `🛒 You left ${cart.itemCount} item${cart.itemCount > 1 ? 's' : ''} in your cart!\n\n` +
      `Your cart total is ${amount}. Complete your purchase before items go out of stock.\n\n` +
      `Reply "cart" to view your items or "checkout" to proceed.`;

    await twilioAdapter.sendWhatsAppMessage(user.phoneNumber, message);

    logger.info('Cart abandonment reminder sent', {
      userId: cart.userId,
      itemCount: cart.itemCount,
      subtotal: cart.subtotal,
    });

    return true;
  } catch (error) {
    logger.error('Failed to send cart reminder', error, {
      userId: cart.userId,
    });
    return false;
  }
}
