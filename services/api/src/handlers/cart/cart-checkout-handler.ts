/**
 * Cart Checkout Handler
 *
 * POST /api/v1/cart/checkout — JWT-protected
 *
 * Validates cart items, publishes a CheckoutInitiated event to EventBridge,
 * and clears the cart on success. Returns 400 with issues on validation failure.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { validateCheckout, clearCart } from '../../services/cart-service';
import { getBasicConfig } from '../../utils/config';
import { cancelTimer } from '../../services/cart-abandonment-scheduler';

const eventBridgeClient = new EventBridgeClient({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    const { valid, cart, issues } = await validateCheckout(userId);

    if (!valid || !cart) {
      return response(400, { error: 'Checkout validation failed', issues });
    }

    // Generate order ID and publish CheckoutInitiated event
    const orderId = randomUUID();
    const config = getBasicConfig();

    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'vyapargyan.cart',
            DetailType: 'CheckoutInitiated',
            Detail: JSON.stringify({
              orderId,
              userId,
              items: cart.items,
              subtotal: cart.subtotal,
              itemCount: cart.itemCount,
              cartVersion: cart.cartVersion,
            }),
            EventBusName: config.eventBusName,
          },
        ],
      }),
    );

    // Clear cart after successful checkout initiation
    await clearCart(userId);

    // Cancel cart abandonment timer on checkout (Req 21.2)
    try {
      await cancelTimer(userId, userId);
    } catch (err) {
      // Non-fatal — log and continue
      logger.error('Failed to cancel cart nudge timer on checkout', err, { userId });
    }

    logger.info('Checkout initiated', { userId, orderId, itemCount: cart.itemCount });

    return response(200, { orderId, message: 'Checkout initiated' });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Cart checkout failed', error, { requestId });
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
