/**
 * Cart Remove Handler
 *
 * DELETE /api/v1/cart/items/{productId} — JWT-protected
 *
 * Removes an item from the cart by productId.
 * Returns 409 on version conflict, 404 if product not in cart.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { removeItem, getCart } from '../../services/cart-service';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    const productId = event.pathParameters?.productId;
    if (!productId) {
      return response(400, { error: 'Missing productId path parameter' });
    }

    const updatedCart = await removeItem(userId, productId);

    return response(200, {
      cart: {
        items: updatedCart.items,
        subtotal: updatedCart.subtotal,
        itemCount: updatedCart.itemCount,
        cartVersion: updatedCart.cartVersion,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    if ((error as any)?.name === 'ConditionalCheckFailedException') {
      let currentVersion = 0;
      try {
        const jwtClaims = (event.requestContext as any)?.authorizer?.jwt?.claims;
        const uid = jwtClaims?.sub || event.headers?.['x-user-id'];
        if (uid) {
          const cart = await getCart(uid);
          currentVersion = cart?.cartVersion ?? 0;
        }
      } catch { /* ignore */ }
      return response(409, { error: 'Cart was modified', currentVersion });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return response(404, { error: error.message });
    }
    logger.error('Cart remove failed', error, { requestId });
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
