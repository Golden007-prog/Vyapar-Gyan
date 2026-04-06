/**
 * Cancel Order Handler
 *
 * POST /api/v1/orders/:orderId/cancel — JWT-protected (customer auth)
 *
 * Transitions order to `cancelled` status. Only allowed when order is in
 * `pending_seller_confirmation` or `confirmed` state.
 * Returns 200 on success, 400 if order is not in a cancellable state.
 *
 * Requirements: 1.4, 12.4
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { OrderService } from '../../services/order-service';

const orderService = new OrderService();

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const customerId = extractUserId(event);
    const orderId = event.pathParameters?.orderId;

    if (!orderId) {
      return response(400, { error: 'Order ID is required' });
    }

    // Verify the customer owns this order before attempting transition
    const order = await orderService.getOrder(orderId);

    if (!order) {
      return response(404, { error: 'Order not found' });
    }

    if (order.customerId !== customerId) {
      return response(403, { error: 'Access denied' });
    }

    const result = await orderService.transitionOrder({
      orderId,
      targetStatus: 'cancelled',
      actor: 'customer',
      actorId: customerId,
    });

    if (!result.success) {
      const isConcurrent = result.error?.includes('concurrently');
      return response(isConcurrent ? 409 : 400, {
        error: result.error || 'Failed to cancel order',
      });
    }

    logger.info('Order cancelled by customer', { orderId, customerId, requestId });

    // Cancel any pending schedules (seller reminders or payment nudges) — non-blocking
    try {
      const { cancelOrderSchedules } = await import('../../services/order-scheduler-service.js');
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
    logger.error('Cancel order failed', error, { requestId });
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
