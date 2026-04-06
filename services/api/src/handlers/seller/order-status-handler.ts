/**
 * Order Fulfillment Status Update Handler
 *
 * POST /api/v1/seller/orders/:orderId/status — JWT-protected (seller role)
 *
 * Updates order fulfillment status. Accepts body: { status: 'preparing' | 'shipped' | 'delivered' }
 * Validates the target status is a valid fulfillment transition from the current status.
 *
 * Requirements: 5.7, 9.1, 9.2, 9.3
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { OrderService } from '../../services/order-service';
import type { OrderStatus } from '../../services/order-state-machine';

const orderService = new OrderService();

const VALID_FULFILLMENT_STATUSES: OrderStatus[] = ['preparing', 'shipped', 'delivered'];

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
    const targetStatus = body.status as OrderStatus;

    if (!targetStatus || !VALID_FULFILLMENT_STATUSES.includes(targetStatus)) {
      return response(400, {
        error: `Invalid status. Must be one of: ${VALID_FULFILLMENT_STATUSES.join(', ')}`,
      });
    }

    const result = await orderService.transitionOrder({
      orderId,
      targetStatus,
      actor: 'seller',
      actorId: sellerId,
    });

    if (!result.success) {
      const isConcurrent = result.error?.includes('concurrently');
      return response(isConcurrent ? 409 : 400, {
        error: result.error || 'Failed to update order status',
      });
    }

    logger.info('Order fulfillment status updated', { orderId, sellerId, targetStatus, requestId });

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
    logger.error('Order status update failed', error, { requestId });
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
