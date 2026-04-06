import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { RazorpayAdapter } from '../../adapters/razorpay-adapter';
import { OrderService } from '../../services/order-service';

const dynamoDBClient = new DynamoDBClient({});
const razorpayAdapter = new RazorpayAdapter();
const orderService = new OrderService();

/**
 * Razorpay Webhook Handler
 *
 * Handles payment events from Razorpay using the new order state machine.
 * All transitions go through orderService.transitionOrder() for consistency.
 *
 * Events handled:
 * - payment_link.paid  → payment_pending → paid (stock finalization)
 * - payment_link.expired → payment_pending → expired (stock unreservation)
 * - payment.failed → payment_pending → payment_failed
 * - payment.captured → (legacy compat, delegates to payment_link.paid logic)
 *
 * Security: Verifies X-Razorpay-Signature via HMAC-SHA256.
 * Idempotency: EVENT#{eventId} record with attribute_not_exists(PK) conditional write.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.6, 8.7, 8.8
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const requestId = event.requestContext.requestId;

  logger.info('Razorpay webhook received', { requestId });

  try {
    // Verify signature
    const signature = event.headers['x-razorpay-signature'] || event.headers['X-Razorpay-Signature'];

    if (!signature) {
      logger.warn('Missing Razorpay webhook signature', { requestId });
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing signature' }) };
    }

    const payload = event.body || '';
    const isValid = razorpayAdapter.verifyWebhookSignature(payload, signature);

    if (!isValid) {
      logger.error('Invalid Razorpay webhook signature', undefined, { requestId });
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
    }

    const webhookData = JSON.parse(payload);
    const eventType = webhookData.event;

    logger.info('Processing Razorpay webhook event', { requestId, eventType });

    switch (eventType) {
      case 'payment_link.paid':
        await handlePaymentLinkPaid(webhookData, requestId);
        break;

      case 'payment_link.expired':
        await handlePaymentLinkExpired(webhookData, requestId);
        break;

      case 'payment.failed':
        await handlePaymentFailed(webhookData, requestId);
        break;

      case 'payment.captured':
        // Legacy compat — treat as payment_link.paid if reference_id present
        await handlePaymentCaptured(webhookData, requestId);
        break;

      default:
        logger.info('Unhandled webhook event type', { requestId, eventType });
    }

    return { statusCode: 200, body: JSON.stringify({ status: 'success' }) };
  } catch (error) {
    logger.error('Error processing Razorpay webhook', error, { requestId });
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

/**
 * Check idempotency by writing EVENT#{eventId} with attribute_not_exists(PK).
 * Returns true if the event was already processed (duplicate).
 */
async function checkAndRecordEvent(eventId: string): Promise<boolean> {
  const config = await getConfig();

  try {
    await dynamoDBClient.send(new PutItemCommand({
      TableName: config.tableName,
      Item: marshall({
        PK: `EVENT#${eventId}`,
        SK: 'WEBHOOK',
        processedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7-day TTL
      }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    return false; // New event, not a duplicate
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return true; // Already processed
    }
    throw error;
  }
}

/**
 * Cancel pending nudge schedules for an order.
 * Best-effort — failures are logged but don't block processing.
 */
async function cancelNudgeSchedules(orderId: string): Promise<void> {
  try {
    // Dynamic import to avoid hard dependency if scheduler service isn't deployed yet
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await import(/* webpackIgnore: true */ '../../services/order-scheduler-service' + '');
    await mod.cancelOrderSchedules(orderId);
    logger.info('Cancelled nudge schedules', { orderId });
  } catch (error) {
    // Non-fatal — scheduler service may not be deployed yet
    logger.warn('Failed to cancel nudge schedules (non-fatal)', {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle payment_link.paid event.
 *
 * Transitions from payment_pending → paid using orderService.transitionOrder().
 * Validates payment amount matches order totalAmount.
 * Cancels pending nudge schedules.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.8
 */
async function handlePaymentLinkPaid(webhookData: any, requestId: string): Promise<void> {
  const paymentLink = webhookData.payload.payment_link.entity;
  const orderId = paymentLink.reference_id;
  const paymentLinkId = paymentLink.id;

  if (!orderId) {
    logger.error('Order ID (reference_id) not found in payment_link.paid event', undefined, {
      requestId,
      paymentLinkId,
    });
    return;
  }

  // Idempotency check
  const eventId = webhookData.payload.payment_link.entity.id + '_paid';
  const alreadyProcessed = await checkAndRecordEvent(eventId);
  if (alreadyProcessed) {
    logger.info('Duplicate payment_link.paid event, skipping', { requestId, orderId, eventId });
    return;
  }

  logger.info('Processing payment link paid', {
    requestId,
    orderId,
    paymentLinkId,
    amount: paymentLink.amount,
  });

  // Fetch order
  const order = await orderService.getOrder(orderId);
  if (!order) {
    logger.error('Order not found for payment_link.paid', undefined, { requestId, orderId });
    return;
  }

  // Only process if order is in payment_pending
  if (order.status !== 'payment_pending') {
    logger.info('Order not in payment_pending, skipping', {
      requestId,
      orderId,
      currentStatus: order.status,
    });
    return;
  }

  // Validate payment amount matches order total
  const paidAmountRupees = paymentLink.amount_paid / 100;
  if (paidAmountRupees !== order.totalAmount) {
    logger.error('Payment amount mismatch', undefined, {
      requestId,
      orderId,
      expected: order.totalAmount,
      received: paidAmountRupees,
    });
    return;
  }

  // Transition to paid (handles stock finalization via transitionOrder)
  const result = await orderService.transitionOrder({
    orderId: order.id,
    targetStatus: 'paid',
    actor: 'webhook',
    actorId: `razorpay:${paymentLinkId}`,
    reason: `Payment captured via payment link ${paymentLinkId}`,
  });

  if (!result.success) {
    logger.error('Failed to transition order to paid', undefined, {
      requestId,
      orderId,
      error: result.error,
    });
    return;
  }

  logger.info('Order transitioned to paid', { requestId, orderId, paymentLinkId });

  // Cancel pending nudge schedules
  await cancelNudgeSchedules(orderId);
}

/**
 * Handle payment_link.expired event.
 *
 * Transitions from payment_pending → expired using orderService.transitionOrder().
 * Stock unreservation is handled by transitionOrder for expired status.
 * Cancels pending nudge schedules.
 *
 * Requirements: 8.7
 */
async function handlePaymentLinkExpired(webhookData: any, requestId: string): Promise<void> {
  const paymentLink = webhookData.payload.payment_link.entity;
  const orderId = paymentLink.reference_id;

  if (!orderId) {
    logger.error('Order ID not found in payment_link.expired event', undefined, { requestId });
    return;
  }

  // Idempotency check
  const eventId = paymentLink.id + '_expired';
  const alreadyProcessed = await checkAndRecordEvent(eventId);
  if (alreadyProcessed) {
    logger.info('Duplicate payment_link.expired event, skipping', { requestId, orderId, eventId });
    return;
  }

  logger.info('Processing payment link expired', {
    requestId,
    orderId,
    paymentLinkId: paymentLink.id,
  });

  const order = await orderService.getOrder(orderId);
  if (!order) {
    logger.error('Order not found for expired payment link', undefined, { requestId, orderId });
    return;
  }

  // Only process if order is in payment_pending
  if (order.status !== 'payment_pending') {
    logger.info('Order not in payment_pending, skipping expiry', {
      requestId,
      orderId,
      currentStatus: order.status,
    });
    return;
  }

  // Transition to expired (handles stock unreservation via transitionOrder)
  const result = await orderService.transitionOrder({
    orderId: order.id,
    targetStatus: 'expired',
    actor: 'webhook',
    actorId: `razorpay:${paymentLink.id}`,
    reason: 'Payment link expired',
  });

  if (!result.success) {
    logger.error('Failed to transition order to expired', undefined, {
      requestId,
      orderId,
      error: result.error,
    });
    return;
  }

  logger.info('Order transitioned to expired', { requestId, orderId });

  // Cancel pending nudge schedules
  await cancelNudgeSchedules(orderId);
}

/**
 * Handle payment.failed event.
 *
 * Transitions from payment_pending → payment_failed.
 * Stock stays reserved for retry (no unreservation on payment_failed).
 *
 * Requirements: 8.6
 */
async function handlePaymentFailed(webhookData: any, requestId: string): Promise<void> {
  const payment = webhookData.payload.payment.entity;
  const orderId = payment.notes?.order_id;

  if (!orderId) {
    logger.error('Order ID not found in payment.failed event', undefined, {
      requestId,
      paymentId: payment.id,
    });
    return;
  }

  // Idempotency check
  const eventId = payment.id + '_failed';
  const alreadyProcessed = await checkAndRecordEvent(eventId);
  if (alreadyProcessed) {
    logger.info('Duplicate payment.failed event, skipping', { requestId, orderId, eventId });
    return;
  }

  logger.info('Processing payment failed', {
    requestId,
    orderId,
    paymentId: payment.id,
    errorCode: payment.error_code,
  });

  const order = await orderService.getOrder(orderId);
  if (!order) {
    logger.error('Order not found for payment.failed', undefined, { requestId, orderId });
    return;
  }

  if (order.status !== 'payment_pending') {
    logger.info('Order not in payment_pending, skipping failure', {
      requestId,
      orderId,
      currentStatus: order.status,
    });
    return;
  }

  const result = await orderService.transitionOrder({
    orderId: order.id,
    targetStatus: 'payment_failed',
    actor: 'webhook',
    actorId: `razorpay:${payment.id}`,
    reason: payment.error_description || 'Payment failed',
  });

  if (!result.success) {
    logger.error('Failed to transition order to payment_failed', undefined, {
      requestId,
      orderId,
      error: result.error,
    });
    return;
  }

  logger.info('Order transitioned to payment_failed', { requestId, orderId });

  // Cancel pending nudge schedules on payment failure
  await cancelNudgeSchedules(orderId);
}

/**
 * Handle payment.captured event (legacy compatibility).
 *
 * For orders using the new flow, the reference_id in notes maps to orderId.
 * Delegates to the same paid transition logic.
 */
async function handlePaymentCaptured(webhookData: any, requestId: string): Promise<void> {
  const payment = webhookData.payload.payment.entity;
  const orderId = payment.notes?.order_id;

  if (!orderId) {
    logger.error('Order ID not found in payment.captured notes', undefined, {
      requestId,
      paymentId: payment.id,
    });
    return;
  }

  // Idempotency check
  const eventId = payment.id + '_captured';
  const alreadyProcessed = await checkAndRecordEvent(eventId);
  if (alreadyProcessed) {
    logger.info('Duplicate payment.captured event, skipping', { requestId, orderId, eventId });
    return;
  }

  logger.info('Processing payment captured (legacy)', {
    requestId,
    orderId,
    paymentId: payment.id,
    amount: payment.amount,
  });

  const order = await orderService.getOrder(orderId);
  if (!order) {
    logger.error('Order not found for payment.captured', undefined, { requestId, orderId });
    return;
  }

  if (order.status !== 'payment_pending') {
    logger.info('Order not in payment_pending, skipping captured event', {
      requestId,
      orderId,
      currentStatus: order.status,
    });
    return;
  }

  // Validate amount
  const paidAmountRupees = payment.amount / 100;
  if (paidAmountRupees !== order.totalAmount) {
    logger.error('Payment amount mismatch on captured', undefined, {
      requestId,
      orderId,
      expected: order.totalAmount,
      received: paidAmountRupees,
    });
    return;
  }

  const result = await orderService.transitionOrder({
    orderId: order.id,
    targetStatus: 'paid',
    actor: 'webhook',
    actorId: `razorpay:${payment.id}`,
    reason: `Payment captured ${payment.id}`,
  });

  if (!result.success) {
    logger.error('Failed to transition order to paid (captured)', undefined, {
      requestId,
      orderId,
      error: result.error,
    });
    return;
  }

  logger.info('Order transitioned to paid via payment.captured', { requestId, orderId });

  await cancelNudgeSchedules(orderId);
}
