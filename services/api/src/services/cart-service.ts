/**
 * Cart Service
 *
 * Manages the shopping cart as a first-class DynamoDB entity
 * (PK: CART#{userId}, SK: ACTIVE) with optimistic concurrency via cartVersion.
 *
 * All mutations use conditional writes to prevent race conditions when
 * concurrent updates arrive from WhatsApp and web channels. After each
 * successful mutation a CartUpdated event is published to EventBridge.
 *
 * Responsibilities:
 * - Get current cart state
 * - Add / update / remove items with version-checked writes
 * - Validate checkout (stock availability for all items)
 * - Clear cart after successful order
 * - Publish CartUpdated events for cross-channel sync
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';
import {
  getCart as dbGetCart,
  putCart,
  deleteCart,
  type Cart,
  type UnifiedCartItem,
} from '../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cart TTL: 7 days in seconds */
const CART_TTL_SECONDS = 7 * 24 * 60 * 60;

/** EventBridge source for cart events */
const EVENT_SOURCE = 'vyapargyan.cart';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const eventBridgeClient = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recalculate subtotal and itemCount from items array. */
function recalculate(items: UnifiedCartItem[]): { subtotal: number; itemCount: number } {
  let subtotal = 0;
  let itemCount = 0;
  for (const item of items) {
    subtotal += item.price * item.quantity;
    itemCount += item.quantity;
  }
  return { subtotal: Math.round(subtotal * 100) / 100, itemCount };
}

/** Publish a CartUpdated event to EventBridge. */
async function publishCartUpdated(cart: Cart): Promise<void> {
  try {
    const config = await getConfig();
    await eventBridgeClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: EVENT_SOURCE,
            DetailType: 'CartUpdated',
            Detail: JSON.stringify({
              userId: cart.userId,
              cartVersion: cart.cartVersion,
              itemCount: cart.itemCount,
            }),
            EventBusName: config.eventBusName,
          },
        ],
      }),
    );
    logger.debug('CartUpdated event published', {
      userId: cart.userId,
      cartVersion: cart.cartVersion,
    });
  } catch (err) {
    // Non-fatal — log and continue. The cart write already succeeded.
    logger.error('Failed to publish CartUpdated event', err, { userId: cart.userId });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the current cart for a user, or null if no cart exists.
 */
export async function getCart(userId: string): Promise<Cart | null> {
  const cart = await dbGetCart(userId);
  logger.debug('Cart retrieved', { userId, found: !!cart });
  return cart;
}

/**
 * Add an item to the cart. If the product already exists, its quantity is
 * incremented. Uses optimistic concurrency via cartVersion conditional write.
 *
 * @throws ConditionalCheckFailedException on version conflict (caller should retry).
 */
export async function addItem(
  userId: string,
  item: UnifiedCartItem,
): Promise<Cart> {
  const existing = await dbGetCart(userId);
  const now = new Date();

  let items: UnifiedCartItem[];
  let currentVersion: number;

  if (existing) {
    items = [...existing.items];
    currentVersion = existing.cartVersion;

    const idx = items.findIndex((i) => i.productId === item.productId);
    if (idx >= 0) {
      const ei = items[idx]!;
      const updated: UnifiedCartItem = {
        productId: ei.productId,
        sellerId: ei.sellerId,
        name: ei.name,
        price: ei.price,
        quantity: ei.quantity + item.quantity,
      };
      if (ei.thumbnailUrl) updated.thumbnailUrl = ei.thumbnailUrl;
      items[idx] = updated;
    } else {
      items.push(item);
    }
  } else {
    items = [item];
    currentVersion = 0;
  }

  const { subtotal, itemCount } = recalculate(items);

  const updatedCart: Cart = {
    userId,
    items,
    subtotal,
    itemCount,
    cartVersion: currentVersion + 1,
    updatedAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + CART_TTL_SECONDS,
  };

  // Conditional write — only succeeds if version matches (or cart is new)
  await putCart(updatedCart, currentVersion || undefined);

  logger.info('Item added to cart', {
    userId,
    productId: item.productId,
    quantity: item.quantity,
    cartVersion: updatedCart.cartVersion,
  });

  await publishCartUpdated(updatedCart);
  return updatedCart;
}

/**
 * Update the quantity of an existing cart item.
 * Setting quantity to 0 removes the item.
 *
 * @throws ConditionalCheckFailedException on version conflict.
 * @throws Error if the product is not in the cart.
 */
export async function updateQuantity(
  userId: string,
  productId: string,
  quantity: number,
): Promise<Cart> {
  const existing = await dbGetCart(userId);
  if (!existing) {
    throw new Error('Cart not found');
  }

  let items = [...existing.items];
  const idx = items.findIndex((i) => i.productId === productId);
  if (idx < 0) {
    throw new Error(`Product ${productId} not found in cart`);
  }

  if (quantity <= 0) {
    items.splice(idx, 1);
  } else {
    const cur = items[idx]!;
    const updated: UnifiedCartItem = {
      productId: cur.productId,
      sellerId: cur.sellerId,
      name: cur.name,
      price: cur.price,
      quantity,
    };
    if (cur.thumbnailUrl) updated.thumbnailUrl = cur.thumbnailUrl;
    items[idx] = updated;
  }

  const now = new Date();
  const { subtotal, itemCount } = recalculate(items);

  const updatedCart: Cart = {
    userId,
    items,
    subtotal,
    itemCount,
    cartVersion: existing.cartVersion + 1,
    updatedAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + CART_TTL_SECONDS,
  };

  await putCart(updatedCart, existing.cartVersion);

  logger.info('Cart item quantity updated', {
    userId,
    productId,
    quantity,
    cartVersion: updatedCart.cartVersion,
  });

  await publishCartUpdated(updatedCart);
  return updatedCart;
}

/**
 * Remove an item from the cart by productId.
 *
 * @throws ConditionalCheckFailedException on version conflict.
 * @throws Error if the product is not in the cart.
 */
export async function removeItem(
  userId: string,
  productId: string,
): Promise<Cart> {
  const existing = await dbGetCart(userId);
  if (!existing) {
    throw new Error('Cart not found');
  }

  const items = existing.items.filter((i) => i.productId !== productId);
  if (items.length === existing.items.length) {
    throw new Error(`Product ${productId} not found in cart`);
  }

  const now = new Date();
  const { subtotal, itemCount } = recalculate(items);

  const updatedCart: Cart = {
    userId,
    items,
    subtotal,
    itemCount,
    cartVersion: existing.cartVersion + 1,
    updatedAt: now.toISOString(),
    expiresAt: Math.floor(now.getTime() / 1000) + CART_TTL_SECONDS,
  };

  await putCart(updatedCart, existing.cartVersion);

  logger.info('Item removed from cart', {
    userId,
    productId,
    cartVersion: updatedCart.cartVersion,
  });

  await publishCartUpdated(updatedCart);
  return updatedCart;
}

/**
 * Validate that all cart items are available for checkout.
 * Returns a list of unavailable product IDs (empty if all items are in stock).
 *
 * Note: Actual stock validation requires product lookups which are handled
 * at the handler layer. This method validates the cart is non-empty and
 * items have valid quantities.
 */
export async function validateCheckout(
  userId: string,
): Promise<{ valid: boolean; cart: Cart | null; issues: string[] }> {
  const cart = await dbGetCart(userId);

  if (!cart || cart.items.length === 0) {
    return { valid: false, cart: null, issues: ['Cart is empty'] };
  }

  const issues: string[] = [];

  for (const item of cart.items) {
    if (item.quantity <= 0) {
      issues.push(`Invalid quantity for ${item.name}`);
    }
    if (item.price <= 0) {
      issues.push(`Invalid price for ${item.name}`);
    }
  }

  logger.info('Checkout validation', {
    userId,
    valid: issues.length === 0,
    itemCount: cart.itemCount,
  });

  return { valid: issues.length === 0, cart, issues };
}

/**
 * Clear the cart after a successful order or explicit user action.
 */
export async function clearCart(userId: string): Promise<void> {
  await deleteCart(userId);
  logger.info('Cart cleared', { userId });
}
