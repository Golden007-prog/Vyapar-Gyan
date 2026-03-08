/**
 * Cart Update Handler
 *
 * PUT /api/v1/cart/items/{productId} — JWT-protected
 *
 * Updates the quantity of an existing cart item.
 * Returns 409 on version conflict, 404 if product not in cart.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { updateQuantity, getCart } from '../../services/cart-service';

const UpdateQuantitySchema = z.object({
  quantity: z.coerce.number().int().min(1).max(99),
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    const productId = event.pathParameters?.productId;
    if (!productId) {
      return response(400, { error: 'Missing productId path parameter' });
    }

    // Parse and validate request body
    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = UpdateQuantitySchema.safeParse(body);
    if (!parsed.success) {
      return response(400, {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => i.message),
      });
    }

    const { quantity } = parsed.data;

    const updatedCart = await updateQuantity(userId, productId, quantity);

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
    logger.error('Cart update failed', error, { requestId });
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
