/**
 * Create Order Handler
 *
 * POST /api/v1/orders — JWT-protected (customer auth)
 *
 * Validates the customer's cart, creates an order with status
 * `pending_seller_confirmation`, reserves stock atomically, and clears the cart.
 * Returns 201 with orderId on success, 409 with unavailable items on stock failure.
 *
 * Requirements: 3.4, 3.5, 3.6
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { OrderService } from '../../services/order-service';
import { validateCheckout, clearCart } from '../../services/cart-service';

const orderService = new OrderService();

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const customerId = extractUserId(event);

    // Parse optional body for shipping address
    const body = event.body ? JSON.parse(event.body) : {};

    // Validate cart
    const { valid, cart, issues } = await validateCheckout(customerId);

    if (!valid || !cart) {
      return response(400, { error: 'Cart validation failed', issues });
    }

    // Determine sellerId from cart items (single-seller MVP)
    const sellerId = cart.items[0]?.sellerId;
    if (!sellerId) {
      return response(400, { error: 'No seller found for cart items' });
    }

    // Create order via OrderService
    const result = await orderService.createOrder({
      customerId,
      customerPhone: body.customerPhone || '',
      sellerId,
      cartItems: cart.items.map(item => ({
        productId: item.productId,
        sellerId: item.sellerId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        addedAt: new Date().toISOString(),
      })),
      channel: 'web',
      shippingAddress: body.shippingAddress,
    });

    if (!result.success) {
      // Stock failure → 409 with unavailable items
      if (result.outOfStockItems && result.outOfStockItems.length > 0) {
        return response(409, {
          error: result.error || 'Some items are out of stock',
          unavailableItems: result.outOfStockItems,
        });
      }
      return response(400, { error: result.error || 'Failed to create order' });
    }

    // Clear cart after successful order creation
    await clearCart(customerId);

    // Schedule seller reminders (30min reminder + 2h customer notify) — non-blocking
    try {
      const { scheduleSellerReminders } = await import('../../services/order-scheduler-service.js');
      await scheduleSellerReminders(result.order!.id, sellerId);
    } catch (schedErr) {
      // Non-fatal — order was created successfully
      logger.warn('Failed to schedule seller reminders (non-fatal)', {
        orderId: result.order!.orderId,
        error: schedErr instanceof Error ? schedErr.message : String(schedErr),
      });
    }

    logger.info('Web order created', {
      orderId: result.order!.orderId,
      customerId,
      sellerId,
      totalAmount: result.order!.totalAmount,
      requestId,
    });

    return response(201, {
      success: true,
      orderId: result.order!.orderId,
      orderUUID: result.order!.id,
      status: result.order!.status,
      totalAmount: result.order!.totalAmount,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON body' });
    }
    logger.error('Create order failed', error, { requestId });
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
