/**
 * Get Order Detail Handler
 *
 * GET /api/v1/orders/:orderId — JWT-protected (customer auth)
 *
 * Returns order detail with items, timeline, and payment link info.
 * Verifies the authenticated customer owns the order.
 *
 * Requirements: 12.2
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

    const order = await orderService.getOrder(orderId);

    if (!order) {
      return response(404, { error: 'Order not found' });
    }

    // Verify the customer owns this order
    if (order.customerId !== customerId) {
      return response(403, { error: 'Access denied' });
    }

    logger.info('Order detail retrieved', { orderId, customerId, requestId });

    return response(200, {
      data: {
        id: order.id,
        orderId: order.orderId,
        sellerId: order.sellerId,
        items: order.items,
        subtotal: order.subtotal,
        totalAmount: order.totalAmount,
        status: order.status,
        channel: order.channel,
        paymentId: order.paymentId,
        shippingAddress: order.shippingAddress,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Get order detail failed', error, { requestId });
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
