/**
 * Cart Get Handler
 *
 * GET /api/v1/cart — JWT-protected
 *
 * Returns the current cart for the authenticated user.
 * If no cart exists, returns an empty cart state.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getCart } from '../../services/cart-service';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    const cart = await getCart(userId);

    if (!cart) {
      return response(200, {
        cart: { items: [], subtotal: 0, itemCount: 0, cartVersion: 0 },
      });
    }

    return response(200, { cart });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Cart get failed', error, { requestId });
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
