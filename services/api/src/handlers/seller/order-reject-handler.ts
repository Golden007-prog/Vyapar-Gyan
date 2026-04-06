/**
 * Order Reject Handler
 *
 * POST /api/v1/seller/orders/:orderId/reject — JWT-protected (seller role)
 *
 * Transitions order from `pending_seller_confirmation` to `rejected`.
 * Requires a rejection reason in the request body.
 * Returns 200 with updated order on success.
 *
 * Requirements: 5.4, 5.6
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { OrderService } from '../../services/order-service';

const orderService = new OrderService();

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);
    const orderId = event.pathParameters?.orderId;

    if (!orderId) {
      return response(400, { error: 'Order ID is required' });
    }

    // Parse and validate body
    const body = event.body ? JSON.parse(event.body) : {};
    const reason = body.reason;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return response(400, { error: 'Rejection reason is required' });
    }

    const result = await orderService.transitionOrder({
      orderId,
      targetStatus: 'rejected',
      actor: 'seller',
      actorId: sellerId,
      reason: reason.trim(),
    });

    if (!result.success) {
      const isConcurrent = result.error?.includes('concurrently');
      return response(isConcurrent ? 409 : 400, {
        error: result.error || 'Failed to reject order',
      });
    }

    logger.info('Order rejected by seller', { orderId, sellerId, reason: reason.trim(), requestId });

    // Cancel any pending seller reminder schedules — non-blocking
    try {
      const { cancelOrderSchedules } = await import('../../services/order-scheduler-service');
      await cancelOrderSchedules(orderId);
    } catch (schedErr) {
      logger.warn('Failed to cancel order schedules (non-fatal)', {
        orderId,
        error: schedErr instanceof Error ? schedErr.message : String(schedErr),
      });
    }

    return response(200, {
      success: true,
      order: result.order,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON body' });
    }
    logger.error('Order reject failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
