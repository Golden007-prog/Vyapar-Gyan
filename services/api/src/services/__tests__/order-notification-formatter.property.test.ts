/**
 * Property-Based Tests for Order Notification Message Completeness
 *
 * Uses fast-check to verify that formatOrderNotification produces messages
 * containing required fields for every order event type and channel combination.
 *
 * **Property 10: Notification Message Completeness**
 * - For any order event and channel, formatted message contains orderId
 * - Seller notifications for order.created contain customer name, items, total, ACCEPT/REJECT instructions
 * - Customer notifications for order.confirmed contain seller name, amount, payment link
 *
 * **Validates: Requirements 4.3, 10.5, 16.1–16.7**
 */

import * as fc from 'fast-check';
import {
  formatOrderNotification,
  type OrderEventDetail,
  type OrderEventItem,
  type NotificationChannel,
  type RecipientRole,
} from '../order-notification-formatter';
import type { OrderStatus } from '../order-state-machine';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ALL_DETAIL_TYPES = [
  'order.created',
  'order.confirmed',
  'order.payment_pending',
  'order.paid',
  'order.preparing',
  'order.shipped',
  'order.delivered',
  'order.rejected',
  'order.cancelled',
  'order.expired',
  'order.payment_failed',
] as const;

const ALL_CHANNELS: NotificationChannel[] = ['whatsapp', 'web'];
const ALL_ROLES: RecipientRole[] = ['customer', 'seller'];

const arbDetailType = fc.constantFrom(...ALL_DETAIL_TYPES);
const arbChannel = fc.constantFrom(...ALL_CHANNELS);
const arbRole = fc.constantFrom(...ALL_ROLES);

const arbItem: fc.Arbitrary<OrderEventItem> = fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  quantity: fc.integer({ min: 1, max: 100 }),
  price: fc.integer({ min: 1, max: 50000 }),
});

const arbItems: fc.Arbitrary<OrderEventItem[]> = fc.array(arbItem, { minLength: 1, maxLength: 5 });

function arbOrderEvent(overrides?: Partial<OrderEventDetail>): fc.Arbitrary<OrderEventDetail> {
  return arbItems.chain((items) => {
    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return fc.record({
      orderId: fc.uuid(),
      humanReadableId: fc.tuple(
        fc.integer({ min: 2024, max: 2030 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 9999 }),
      ).map(([y, m, d, n]) =>
        `VG-${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}-${String(n).padStart(4, '0')}`,
      ),
      sellerId: fc.uuid(),
      customerId: fc.uuid(),
      items: fc.constant(items),
      subtotal: fc.constant(subtotal),
      totalAmount: fc.constant(subtotal),
      commissionRate: fc.constant(0.15),
      commissionAmount: fc.constant(Math.round(subtotal * 0.15)),
      sellerAmount: fc.constant(subtotal - Math.round(subtotal * 0.15)),
      status: fc.constantFrom(
        'pending_seller_confirmation',
        'confirmed',
        'payment_pending',
        'paid',
        'preparing',
        'shipped',
        'delivered',
        'rejected',
        'cancelled',
        'expired',
        'payment_failed',
      ) as fc.Arbitrary<OrderStatus>,
      channel: fc.constantFrom('whatsapp', 'web') as fc.Arbitrary<'whatsapp' | 'web'>,
      timestamp: fc.date().map((d) => d.toISOString()),
      paymentLinkUrl: fc.option(
        fc.webUrl().map((u) => u),
        { nil: undefined },
      ),
      rejectionReason: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
      errorDescription: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
      customerName: fc.option(
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
        { nil: undefined },
      ),
      sellerName: fc.option(
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
        { nil: undefined },
      ),
    }).map((event) => ({ ...event, ...overrides }));
  });
}

// ---------------------------------------------------------------------------
// Property 10: Notification Message Completeness
// ---------------------------------------------------------------------------

describe('Property 10: Notification Message Completeness', () => {
  /**
   * **Validates: Requirements 10.5, 16.1–16.7**
   *
   * For any order event and channel, the formatted message body contains
   * the human-readable orderId.
   */
  it('formatted message always contains the human-readable orderId', () => {
    fc.assert(
      fc.property(
        arbDetailType,
        arbOrderEvent(),
        arbChannel,
        arbRole,
        (detailType, event, channel, role) => {
          const result = formatOrderNotification(detailType, event, channel, role);

          // Body must contain the human-readable order ID
          expect(result.body).toContain(event.humanReadableId);
          expect(result.channel).toBe(channel);
          expect(result.recipientRole).toBe(role);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.3, 16.1**
   *
   * Seller notifications for order.created contain:
   * - customer name (or customerId fallback)
   * - at least one item name
   * - total amount
   * - ACCEPT/REJECT instructions
   */
  it('seller order.created notifications contain customer name, items, total, and ACCEPT/REJECT', () => {
    fc.assert(
      fc.property(
        arbOrderEvent({ customerName: 'TestCustomer' }),
        arbChannel,
        (event, channel) => {
          const result = formatOrderNotification('order.created', event, channel, 'seller');

          // Must contain customer name
          expect(result.body).toContain('TestCustomer');

          if (channel === 'whatsapp') {
            // WhatsApp: must contain at least one item name
            const hasItem = event.items.some((item) => result.body.includes(item.name));
            expect(hasItem).toBe(true);

            // Must contain total amount (formatted as ₹)
            expect(result.body).toMatch(/₹/);

            // Must contain ACCEPT/REJECT instructions
            expect(result.body.toUpperCase()).toContain('ACCEPT');
            expect(result.body.toUpperCase()).toContain('REJECT');
          } else {
            // Web: must have structured payload with action
            expect(result.payload).toBeDefined();
            expect(result.payload!.type).toBe('order_update');
            expect(result.payload!.orderId).toBe(event.orderId);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 16.2, 16.3**
   *
   * Customer notifications for order.confirmed contain:
   * - seller name (or fallback)
   * - amount (₹ symbol)
   * - payment link (when provided)
   */
  it('customer order.confirmed notifications contain seller name, amount, and payment link', () => {
    fc.assert(
      fc.property(
        arbOrderEvent({
          sellerName: 'TestSeller',
          paymentLinkUrl: 'https://rzp.io/test-link',
        }),
        arbChannel,
        (event, channel) => {
          const result = formatOrderNotification('order.confirmed', event, channel, 'customer');

          if (channel === 'whatsapp') {
            // Must contain seller name
            expect(result.body).toContain('TestSeller');

            // Must contain amount
            expect(result.body).toMatch(/₹/);

            // Must contain payment link
            expect(result.body).toContain('https://rzp.io/test-link');
          } else {
            // Web: structured payload with action
            expect(result.payload).toBeDefined();
            expect(result.payload!.type).toBe('order_update');
            expect(result.payload!.title).toBeDefined();
            expect(result.payload!.actionLabel).toBeDefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 16.4–16.7**
   *
   * Web notifications always include a structured payload with
   * type, orderId, status, title, and message.
   */
  it('web notifications always include structured payload', () => {
    fc.assert(
      fc.property(
        arbDetailType,
        arbOrderEvent(),
        arbRole,
        (detailType, event, role) => {
          const result = formatOrderNotification(detailType, event, 'web', role);

          expect(result.payload).toBeDefined();
          expect(result.payload!.type).toBe('order_update');
          expect(result.payload!.orderId).toBe(event.orderId);
          expect(result.payload!.humanReadableId).toBe(event.humanReadableId);
          expect(result.payload!.title).toBeDefined();
          expect(typeof result.payload!.title).toBe('string');
          expect(result.payload!.title.length).toBeGreaterThan(0);
          expect(result.payload!.message).toBeDefined();
          expect(typeof result.payload!.message).toBe('string');
          expect(result.payload!.message.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});
