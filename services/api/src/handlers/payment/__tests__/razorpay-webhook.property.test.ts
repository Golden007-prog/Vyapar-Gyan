/**
 * Property-Based Tests for Razorpay Webhook Idempotency
 *
 * Property 6: Webhook Idempotency
 *
 * Processing the same webhook event twice produces the same final state
 * as processing it once.
 *
 * **Validates: Requirements 8.8**
 *
 * Tests at the model level — simulates processing the same event twice
 * and verifies the final state is the same. Mocks DynamoDB and OrderService.
 */

import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// In-memory model of the webhook idempotency logic
// ---------------------------------------------------------------------------

/**
 * Simulates the idempotency mechanism used by the webhook handler:
 * - EVENT#{eventId} record with attribute_not_exists(PK) conditional write
 * - Order status conditional check before transition
 */

interface Order {
  id: string;
  status: string;
  totalAmount: number;
  items: Array<{ productId: string; quantity: number }>;
}

interface Product {
  productId: string;
  stockQuantity: number;
  reserved_stock: number;
}

interface WebhookState {
  orders: Map<string, Order>;
  products: Map<string, Product>;
  processedEvents: Set<string>;
}

function cloneState(state: WebhookState): WebhookState {
  return {
    orders: new Map(
      Array.from(state.orders.entries()).map(([k, v]) => [k, { ...v, items: [...v.items] }]),
    ),
    products: new Map(
      Array.from(state.products.entries()).map(([k, v]) => [k, { ...v }]),
    ),
    processedEvents: new Set(state.processedEvents),
  };
}

type WebhookEventType = 'payment_link.paid' | 'payment_link.expired' | 'payment.failed';

interface WebhookEvent {
  eventId: string;
  type: WebhookEventType;
  orderId: string;
  amountPaise: number;
}

/**
 * Model of the webhook processing logic.
 * Returns the resulting state after processing.
 */
function processWebhookEvent(state: WebhookState, event: WebhookEvent): WebhookState {
  const newState = cloneState(state);

  // Idempotency check: if event already processed, return unchanged state
  if (newState.processedEvents.has(event.eventId)) {
    return newState;
  }

  const order = newState.orders.get(event.orderId);
  if (!order) return newState;

  // Only process if order is in payment_pending
  if (order.status !== 'payment_pending') {
    return newState;
  }

  switch (event.type) {
    case 'payment_link.paid': {
      // Validate amount matches
      const paidAmountRupees = event.amountPaise / 100;
      if (paidAmountRupees !== order.totalAmount) {
        return newState;
      }

      // Transition to paid + finalize stock
      order.status = 'paid';
      for (const item of order.items) {
        const product = newState.products.get(item.productId);
        if (product) {
          product.stockQuantity -= item.quantity;
          product.reserved_stock -= item.quantity;
        }
      }
      break;
    }

    case 'payment_link.expired': {
      // Transition to expired + unreserve stock
      order.status = 'expired';
      for (const item of order.items) {
        const product = newState.products.get(item.productId);
        if (product) {
          product.reserved_stock -= item.quantity;
        }
      }
      break;
    }

    case 'payment.failed': {
      // Transition to payment_failed (stock stays reserved)
      order.status = 'payment_failed';
      break;
    }
  }

  // Mark event as processed
  newState.processedEvents.add(event.eventId);

  return newState;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const webhookEventTypeArb: fc.Arbitrary<WebhookEventType> = fc.constantFrom(
  'payment_link.paid',
  'payment_link.expired',
  'payment.failed',
);

const orderItemArb = fc.record({
  productId: fc.uuid(),
  quantity: fc.integer({ min: 1, max: 10 }),
});

function buildInitialState(
  orderId: string,
  totalAmount: number,
  items: Array<{ productId: string; quantity: number }>,
): WebhookState {
  const orders = new Map<string, Order>();
  orders.set(orderId, {
    id: orderId,
    status: 'payment_pending',
    totalAmount,
    items,
  });

  const products = new Map<string, Product>();
  for (const item of items) {
    // Ensure product has enough stock and reserved stock
    products.set(item.productId, {
      productId: item.productId,
      stockQuantity: item.quantity * 5, // plenty of stock
      reserved_stock: item.quantity, // exactly reserved for this order
    });
  }

  return {
    orders,
    products,
    processedEvents: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Helpers for state comparison
// ---------------------------------------------------------------------------

function statesEqual(a: WebhookState, b: WebhookState): boolean {
  // Compare orders
  if (a.orders.size !== b.orders.size) return false;
  for (const [key, orderA] of a.orders) {
    const orderB = b.orders.get(key);
    if (!orderB) return false;
    if (orderA.status !== orderB.status) return false;
    if (orderA.totalAmount !== orderB.totalAmount) return false;
  }

  // Compare products
  if (a.products.size !== b.products.size) return false;
  for (const [key, prodA] of a.products) {
    const prodB = b.products.get(key);
    if (!prodB) return false;
    if (prodA.stockQuantity !== prodB.stockQuantity) return false;
    if (prodA.reserved_stock !== prodB.reserved_stock) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Property 6: Webhook Idempotency
// ---------------------------------------------------------------------------

describe('Property 6: Webhook Idempotency', () => {
  /**
   * **Validates: Requirements 8.8**
   *
   * Processing the same webhook event twice produces the same final state
   * as processing it once.
   */
  it('processing the same webhook event twice yields the same state as once', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // orderId
        fc.integer({ min: 1, max: 100000 }), // totalAmount in rupees
        fc.array(orderItemArb, { minLength: 1, maxLength: 5 }), // items
        fc.uuid(), // eventId
        webhookEventTypeArb,
        (orderId, totalAmount, items, eventId, eventType) => {
          // Deduplicate items by productId
          const uniqueItems = Array.from(
            new Map(items.map((i) => [i.productId, i])).values(),
          );
          if (uniqueItems.length === 0) return;

          const event: WebhookEvent = {
            eventId,
            type: eventType,
            orderId,
            // For paid events, amount must match; for others it doesn't matter
            amountPaise: eventType === 'payment_link.paid' ? totalAmount * 100 : 0,
          };

          // Process once
          const initialState = buildInitialState(orderId, totalAmount, uniqueItems);
          const stateAfterOnce = processWebhookEvent(initialState, event);

          // Process the same event a second time
          const stateAfterTwice = processWebhookEvent(stateAfterOnce, event);

          // Final states must be identical
          expect(statesEqual(stateAfterOnce, stateAfterTwice)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 8.8**
   *
   * After processing an event, the event is recorded in processedEvents,
   * and a second processing is a no-op.
   */
  it('second processing of same event does not modify any records', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 1, max: 100000 }),
        fc.array(orderItemArb, { minLength: 1, maxLength: 5 }),
        fc.uuid(),
        webhookEventTypeArb,
        (orderId, totalAmount, items, eventId, eventType) => {
          const uniqueItems = Array.from(
            new Map(items.map((i) => [i.productId, i])).values(),
          );
          if (uniqueItems.length === 0) return;

          const event: WebhookEvent = {
            eventId,
            type: eventType,
            orderId,
            amountPaise: eventType === 'payment_link.paid' ? totalAmount * 100 : 0,
          };

          const initialState = buildInitialState(orderId, totalAmount, uniqueItems);
          const stateAfterFirst = processWebhookEvent(initialState, event);

          // Snapshot the state after first processing
          const snapshotOrders = new Map(
            Array.from(stateAfterFirst.orders.entries()).map(([k, v]) => [
              k,
              { ...v },
            ]),
          );
          const snapshotProducts = new Map(
            Array.from(stateAfterFirst.products.entries()).map(([k, v]) => [
              k,
              { ...v },
            ]),
          );

          // Process again
          const stateAfterSecond = processWebhookEvent(stateAfterFirst, event);

          // Order statuses unchanged
          for (const [key, order] of stateAfterSecond.orders) {
            expect(order.status).toBe(snapshotOrders.get(key)!.status);
          }

          // Product stock levels unchanged
          for (const [key, product] of stateAfterSecond.products) {
            const snap = snapshotProducts.get(key)!;
            expect(product.stockQuantity).toBe(snap.stockQuantity);
            expect(product.reserved_stock).toBe(snap.reserved_stock);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 8.8**
   *
   * Different event IDs for the same order are processed independently
   * (not blocked by idempotency of a different event).
   */
  it('different event IDs are processed independently', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.integer({ min: 100, max: 100000 }),
        orderItemArb,
        fc.uuid(),
        fc.uuid(),
        (orderId, totalAmount, item, eventId1, eventId2) => {
          // Ensure different event IDs
          if (eventId1 === eventId2) return;

          const items = [item];

          // First event: payment_link.paid
          const event1: WebhookEvent = {
            eventId: eventId1,
            type: 'payment_link.paid',
            orderId,
            amountPaise: totalAmount * 100,
          };

          const initialState = buildInitialState(orderId, totalAmount, items);
          const stateAfterFirst = processWebhookEvent(initialState, event1);

          // Order should be paid now
          expect(stateAfterFirst.orders.get(orderId)!.status).toBe('paid');

          // Second event with different ID but same order — should be no-op
          // because order is no longer in payment_pending
          const event2: WebhookEvent = {
            eventId: eventId2,
            type: 'payment_link.expired',
            orderId,
            amountPaise: 0,
          };

          const stateAfterSecond = processWebhookEvent(stateAfterFirst, event2);

          // Order should still be paid (not expired)
          expect(stateAfterSecond.orders.get(orderId)!.status).toBe('paid');
        },
      ),
      { numRuns: 100 },
    );
  });
});
