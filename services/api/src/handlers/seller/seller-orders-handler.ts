/**
 * Seller Orders List Handler
 *
 * GET /api/v1/seller/orders — JWT-protected (seller role)
 *
 * Returns a paginated list of orders for the authenticated seller.
 * Supports optional `?status=` query parameter for filtering.
 *
 * Requirements: 5.1, 13.1
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { OrderService } from '../../services/order-service';
import type { OrderStatus } from '../../services/order-state-machine';

const orderService = new OrderService();

const VALID_STATUSES: OrderStatus[] = [
  'pending_seller_confirmation', 'confirmed', 'payment_pending',
  'paid', 'preparing', 'shipped', 'delivered', 'completed',
  'rejected', 'cancelled', 'payment_failed', 'expired',
];

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);

    // Parse optional status filter
    const statusParam = event.queryStringParameters?.status;
    let statusFilter: OrderStatus | undefined;

    if (statusParam) {
      const normalized = statusParam.toLowerCase() as OrderStatus;
      if (!VALID_STATUSES.includes(normalized)) {
        return response(400, {
          error: `Invalid status filter. Must be one of: ${VALID_STATUSES.join(', ')}`,
        });
      }
      statusFilter = normalized;
    }

    // Parse optional limit
    const limitParam = event.queryStringParameters?.limit;
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 100) : 50;

    const orders = await orderService.listSellerOrders(sellerId, statusFilter, limit);

    logger.info('Seller orders listed', { sellerId, count: orders.length, statusFilter, requestId });

    return response(200, {
      data: orders,
      total: orders.length,
      limit,
      ...(statusFilter ? { statusFilter } : {}),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('List seller orders failed', error, { requestId });
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
