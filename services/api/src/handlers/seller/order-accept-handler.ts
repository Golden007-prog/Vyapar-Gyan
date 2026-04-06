/**
 * Order Accept Handler
 *
 * POST /api/v1/seller/orders/:orderId/accept — JWT-protected (seller role)
 *
 * Transitions order from `pending_seller_confirmation` to `confirmed`,
 * then generates a Razorpay payment link and transitions to `payment_pending`.
 *
 * Requirements: 5.3, 5.5, 7.1, 7.2, 7.5, 7.6, 7.7
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { OrderService } from '../../services/order-service';
import { RazorpayAdapter } from '../../adapters/razorpay-adapter';

const orderService = new OrderService();
const razorpayAdapter = new RazorpayAdapter();
const dynamoDBClient = new DynamoDBClient({});

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);
    const orderId = event.pathParameters?.orderId;

    if (!orderId) {
      return response(400, { error: 'Order ID is required' });
    }

    // 1. Transition to confirmed
    const result = await orderService.transitionOrder({
      orderId,
      targetStatus: 'confirmed',
      actor: 'seller',
      actorId: sellerId,
    });

    if (!result.success) {
      const isConcurrent = result.error?.includes('concurrently');
      return response(isConcurrent ? 409 : 400, {
        error: result.error || 'Failed to accept order',
      });
    }

    logger.info('Order accepted by seller', { orderId, sellerId, requestId });

    const order = result.order!;

    // 2. Generate payment link and transition to payment_pending
    try {
      await generatePaymentLinkWithRetry(order, requestId);
    } catch (paymentError) {
      // Payment link generation failed after retries — order stays in confirmed
      logger.error('Payment link generation failed after retries', paymentError, {
        orderId: order.orderId,
        requestId,
      });
      // Return success for the accept — payment link will be retried
      return response(200, {
        success: true,
        order: result.order,
        warning: 'Order accepted but payment link generation failed. Retrying automatically.',
      });
    }

    // Re-fetch order to get updated payment link fields
    const updatedOrder = await orderService.getOrder(orderId);

    return response(200, {
      success: true,
      order: updatedOrder || result.order,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Order accept failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

/**
 * Generate a Razorpay payment link with 3-retry exponential backoff.
 * On success, updates the order with paymentLinkId/Url and transitions to payment_pending.
 */
async function generatePaymentLinkWithRetry(order: any, requestId: string): Promise<void> {
  const config = await getConfig();
  const tableName = config.tableName;

  // Fetch seller profile to get razorpayAccountId
  const sellerProfile = await getSellerProfile(tableName, order.sellerId);
  const sellerAccountId = sellerProfile?.razorpayAccountId;

  if (!sellerAccountId) {
    throw new Error(`Seller ${order.sellerId} has no Razorpay account configured`);
  }

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const link = await razorpayAdapter.createPaymentLink({
        orderId: order.orderId,
        amount: order.totalAmount,
        customerPhone: order.customerPhone,
        customerName: order.customerDisplayName || 'Customer',
        description: `Order ${order.orderId}`,
        sellerAccountId,
        commissionAmount: order.commissionAmount,
      });

      logger.info('Payment link created', {
        orderId: order.orderId,
        paymentLinkId: link.id,
        shortUrl: link.short_url,
        attempt,
        requestId,
      });

      // Update order with payment link details
      await updateOrderPaymentLink(tableName, order.id, {
        paymentLinkId: link.id,
        paymentLinkUrl: link.short_url,
      });

      // Transition to payment_pending
      const transitionResult = await orderService.transitionOrder({
        orderId: order.id,
        targetStatus: 'payment_pending',
        actor: 'system',
        actorId: 'system',
      });

      if (!transitionResult.success) {
        logger.warn('Failed to transition to payment_pending', {
          orderId: order.orderId,
          error: transitionResult.error,
          requestId,
        });
      }

      // Cancel seller reminder schedules (order has been accepted)
      // and schedule payment nudges (2h + 24h)
      try {
        const { cancelOrderSchedules, schedulePaymentNudges } = await import('../../services/order-scheduler-service.js');
        await cancelOrderSchedules(order.id);
        await schedulePaymentNudges(order.id, order.customerId, link.short_url);
      } catch (schedErr) {
        // Non-fatal — payment link was created successfully
        logger.warn('Failed to manage order schedules (non-fatal)', {
          orderId: order.orderId,
          error: schedErr instanceof Error ? schedErr.message : String(schedErr),
        });
      }

      return; // Success
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn('Payment link creation attempt failed', {
        orderId: order.orderId,
        attempt,
        maxRetries: MAX_RETRIES,
        error: lastError.message,
        requestId,
      });

      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError || new Error('Payment link generation failed');
}

/**
 * Fetch seller profile from DynamoDB.
 */
async function getSellerProfile(tableName: string, sellerId: string): Promise<any> {
  const command = new GetItemCommand({
    TableName: tableName,
    Key: marshall({ PK: `SELLER#${sellerId}`, SK: 'METADATA' }),
  });

  const result = await dynamoDBClient.send(command);
  return result.Item ? unmarshall(result.Item) : null;
}

/**
 * Update order record with payment link details.
 */
async function updateOrderPaymentLink(
  tableName: string,
  orderUUID: string,
  fields: { paymentLinkId: string; paymentLinkUrl: string },
): Promise<void> {
  const command = new UpdateItemCommand({
    TableName: tableName,
    Key: marshall({ PK: `ORDER#${orderUUID}`, SK: 'METADATA' }),
    UpdateExpression: 'SET paymentLinkId = :plId, paymentLinkUrl = :plUrl, updatedAt = :now',
    ExpressionAttributeValues: marshall({
      ':plId': fields.paymentLinkId,
      ':plUrl': fields.paymentLinkUrl,
      ':now': new Date().toISOString(),
    }),
  });

  await dynamoDBClient.send(command);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
