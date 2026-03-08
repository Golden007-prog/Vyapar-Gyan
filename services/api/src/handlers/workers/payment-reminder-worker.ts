/**
 * Payment Reminder Worker
 *
 * EventBridge scheduled worker — rate(15 minutes).
 * Queries orders with status=pending_payment older than a configured threshold,
 * sends payment reminders via TwilioAdapter with consent checks, and auto-cancels
 * orders that have been pending for more than 48 hours.
 *
 * Lambda config: timeout 60s, memory 256MB
 */

import type { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { getUserProfile } from '../../adapters/dynamodb-adapter';
import { checkSendPermission } from '../../services/consent-service';
import { logAction } from '../../services/audit-service';
import { TwilioAdapter } from '../../adapters/twilio-adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Send first reminder after 30 minutes of pending payment */
const REMINDER_THRESHOLD_MS = 30 * 60 * 1000;

/** Auto-cancel after 48 hours of pending payment */
const AUTO_CANCEL_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/** Max orders to process per invocation to stay within Lambda timeout */
const MAX_ORDERS_PER_RUN = 50;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const ebClient = new EventBridgeClient({});
const twilioAdapter = new TwilioAdapter();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: ScheduledEvent): Promise<void> {
  logger.info('Payment reminder worker started', { time: event.time });

  try {
    const config = await getConfig();
    const now = Date.now();

    // Query orders with status=pending_payment
    const pendingOrders = await queryPendingPaymentOrders(config.tableName);

    logger.info('Pending payment orders found', { count: pendingOrders.length });

    let remindedCount = 0;
    let cancelledCount = 0;
    let skippedCount = 0;

    for (const order of pendingOrders) {
      const orderAge = now - new Date(order.createdAt).getTime();

      if (orderAge >= AUTO_CANCEL_THRESHOLD_MS) {
        // Auto-cancel: order has been pending for > 48h
        await autoCancelOrder(order, config);
        cancelledCount++;
      } else if (orderAge >= REMINDER_THRESHOLD_MS) {
        // Send reminder
        const sent = await sendPaymentReminder(order, config);
        if (sent) {
          remindedCount++;
        } else {
          skippedCount++;
        }
      }
    }

    logger.info('Payment reminder worker completed', {
      remindedCount,
      cancelledCount,
      skippedCount,
      totalProcessed: pendingOrders.length,
    });
  } catch (error) {
    logger.error('Payment reminder worker failed', error);
  }
}

// ---------------------------------------------------------------------------
// Query pending payment orders
// ---------------------------------------------------------------------------

interface PendingOrder {
  orderId: string;
  customerId: string;
  sellerId: string;
  totalAmount: number;
  createdAt: string;
  paymentLink?: string;
}

async function queryPendingPaymentOrders(tableName: string): Promise<PendingOrder[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :orderPrefix) AND SK = :metadata AND #status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':orderPrefix': 'ORDER#',
        ':metadata': 'METADATA',
        ':pending': 'pending_payment',
      },
      ProjectionExpression: 'PK, orderId, customerId, sellerId, totalAmount, createdAt, paymentLink',
      Limit: MAX_ORDERS_PER_RUN,
    }),
  );

  return (result.Items ?? []).map((item) => ({
    orderId: item.orderId ?? item.PK?.replace('ORDER#', ''),
    customerId: item.customerId,
    sellerId: item.sellerId,
    totalAmount: item.totalAmount ?? 0,
    createdAt: item.createdAt,
    paymentLink: item.paymentLink,
  }));
}

// ---------------------------------------------------------------------------
// Send payment reminder
// ---------------------------------------------------------------------------

async function sendPaymentReminder(
  order: PendingOrder,
  _config: { tableName: string; eventBusName: string },
): Promise<boolean> {
  try {
    // Resolve customer phone
    const user = await getUserProfile(order.customerId);
    if (!user?.phoneNumber) {
      logger.debug('No phone number for customer — skipping reminder', {
        orderId: order.orderId,
        customerId: order.customerId,
      });
      return false;
    }

    // Consent check — payment reminders are transactional (order-related)
    const permission = await checkSendPermission(order.customerId, 'transactional');
    if (!permission.allowed) {
      logger.debug('Send blocked by consent', {
        orderId: order.orderId,
        reason: permission.reason,
      });
      return false;
    }

    // Build reminder message
    const amount = `₹${order.totalAmount.toLocaleString('en-IN')}`;
    const paymentInfo = order.paymentLink
      ? `\n\nPay here: ${order.paymentLink}`
      : '';
    const message =
      `⏰ Payment Reminder\n\nYour order #${order.orderId.slice(-8)} for ${amount} is awaiting payment.` +
      `${paymentInfo}\n\nPlease complete payment to confirm your order. It will be auto-cancelled if not paid within 48 hours.`;

    await twilioAdapter.sendWhatsAppMessage(user.phoneNumber, message);

    logger.info('Payment reminder sent', {
      orderId: order.orderId,
      customerId: order.customerId,
    });

    return true;
  } catch (error) {
    logger.error('Failed to send payment reminder', error, {
      orderId: order.orderId,
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auto-cancel order
// ---------------------------------------------------------------------------

async function autoCancelOrder(
  order: PendingOrder,
  config: { tableName: string; eventBusName: string },
): Promise<void> {
  try {
    // Update order status to cancelled
    await docClient.send(
      new UpdateCommand({
        TableName: config.tableName,
        Key: { PK: `ORDER#${order.orderId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #status = :cancelled, cancelledAt = :now, cancellationReason = :reason, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':cancelled': 'cancelled',
          ':now': new Date().toISOString(),
          ':reason': 'auto_cancelled_payment_timeout',
        },
        ConditionExpression: '#status = :pending',
      }),
    );

    // Publish OrderAutoCancel event
    await ebClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'vyapargyan.order',
            DetailType: 'OrderAutoCancel',
            Detail: JSON.stringify({
              orderId: order.orderId,
              customerId: order.customerId,
              sellerId: order.sellerId,
              reason: 'payment_timeout_48h',
            }),
            EventBusName: config.eventBusName,
          },
        ],
      }),
    );

    // Notify customer
    const user = await getUserProfile(order.customerId);
    if (user?.phoneNumber) {
      const amount = `₹${order.totalAmount.toLocaleString('en-IN')}`;
      await twilioAdapter.sendWhatsAppMessage(
        user.phoneNumber,
        `❌ Order Cancelled\n\nYour order #${order.orderId.slice(-8)} for ${amount} has been automatically cancelled due to non-payment after 48 hours.\n\nFeel free to place a new order anytime!`,
      );
    }

    // Audit log
    await logAction({
      actorId: 'system',
      actorRole: 'system',
      actionType: 'order_auto_cancelled',
      resourceType: 'order',
      resourceId: order.orderId,
      oldValues: { status: 'pending_payment' },
      newValues: { status: 'cancelled', reason: 'payment_timeout_48h' },
    });

    logger.info('Order auto-cancelled', {
      orderId: order.orderId,
      customerId: order.customerId,
    });
  } catch (error) {
    logger.error('Failed to auto-cancel order', error, {
      orderId: order.orderId,
    });
  }
}
