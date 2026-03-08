/**
 * Cart Add Handler
 *
 * POST /api/v1/cart/items — JWT-protected
 *
 * Validates request body with AddToCartSchema, adds item to cart
 * using optimistic concurrency (cartVersion conditional write).
 * Returns 409 on ConditionalCheckFailedException (version conflict).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { AddToCartSchema } from '../../shared/schemas';
import { addItem, getCart } from '../../services/cart-service';
import { CatalogRepository } from '../../repositories/catalog-repository';
import type { UnifiedCartItem } from '../../adapters/dynamodb-adapter';
import { publishCountMetric } from '../../core/metrics';

const catalogRepo = new CatalogRepository();

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    // Parse and validate request body
    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = AddToCartSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => i.message),
      });
    }

    const { productId, quantity } = parsed.data;

    // Look up product to get name, price, sellerId
    const product = await catalogRepo.getProductById(productId);
    if (!product) {
      return response(404, { error: 'Product not found' });
    }

    const cartItem: UnifiedCartItem = {
      productId: product.id,
      sellerId: product.sellerId,
      name: product.name,
      price: product.price,
      quantity,
      ...(product.imageUrls?.length ? { thumbnailUrl: product.imageUrls[0] } : {}),
    };

    const updatedCart = await addItem(userId, cartItem);

    publishCountMetric('CartUpdates', 1);

    return response(200, {
      cart: {
        items: updatedCart.items,
        subtotal: updatedCart.subtotal,
        itemCount: updatedCart.itemCount,
        cartVersion: updatedCart.cartVersion,
      },
      addedItem: {
        productId: cartItem.productId,
        name: cartItem.name,
        price: cartItem.price,
        quantity: cartItem.quantity,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    if ((error as any)?.name === 'ConditionalCheckFailedException') {
      // Version conflict — client should retry with latest cart
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
    logger.error('Cart add failed', error, { requestId });
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
