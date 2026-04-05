/**
 * Property-Based Tests for Payment Message Formatting
 *
 * Validates that the WhatsApp payment message contains all item names,
 * quantities, total in ₹ format, and the payment link URL.
 *
 * Uses fast-check to verify invariants across randomised inputs.
 */

import * as fc from 'fast-check';
import { formatPaymentMessage } from '../../services/payment-link';
import type { OrderItem } from '../../services/order-service';

// ── Generators ─────────────────────────────────────────────────────────

/** Generate a valid OrderItem */
const orderItemArb: fc.Arbitrary<OrderItem> = fc.record({
  productId: fc.uuid(),
  sellerId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
  price: fc.integer({ min: 1, max: 99999 }),
  quantity: fc.integer({ min: 1, max: 100 }),
});

/** Generate a minimal order object with items and total */
const orderArb = fc.array(orderItemArb, { minLength: 1, maxLength: 15 }).map((items) => {
  const totalAmount = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return {
    orderId: `VG-20250101-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`,
    items,
    totalAmount,
  };
});

/** Generate a plausible payment link URL */
const paymentLinkUrlArb = fc
  .webUrl({ withFragments: false, withQueryParameters: false })
  .map((url) => url.replace(/^http:/, 'https:'));

// ── Property 24: Payment message contains order summary and link ──

describe('Property 24: Payment message contains order summary and link', () => {
  /**
   * **Validates: Requirement 20.2**
   *
   * For any order with items, quantities, and total, formatted WhatsApp
   * message contains all item names, quantities, total in ₹ format, and
   * payment link URL.
   */

  it('message contains every item name', () => {
    fc.assert(
      fc.property(orderArb, paymentLinkUrlArb, (order, url) => {
        const msg = formatPaymentMessage(order, url);
        order.items.forEach((item) => {
          expect(msg).toContain(item.name);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('message contains every item quantity', () => {
    fc.assert(
      fc.property(orderArb, paymentLinkUrlArb, (order, url) => {
        const msg = formatPaymentMessage(order, url);
        order.items.forEach((item) => {
          expect(msg).toContain(`× ${item.quantity}`);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('message contains total in ₹ format', () => {
    fc.assert(
      fc.property(orderArb, paymentLinkUrlArb, (order, url) => {
        const msg = formatPaymentMessage(order, url);
        expect(msg).toContain(`₹${order.totalAmount}`);
      }),
      { numRuns: 100 },
    );
  });

  it('message contains the payment link URL', () => {
    fc.assert(
      fc.property(orderArb, paymentLinkUrlArb, (order, url) => {
        const msg = formatPaymentMessage(order, url);
        expect(msg).toContain(url);
      }),
      { numRuns: 100 },
    );
  });

  it('message contains line-item subtotals in ₹ format', () => {
    fc.assert(
      fc.property(orderArb, paymentLinkUrlArb, (order, url) => {
        const msg = formatPaymentMessage(order, url);
        order.items.forEach((item) => {
          expect(msg).toContain(`₹${item.price * item.quantity}`);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('items are numbered sequentially starting from 1', () => {
    fc.assert(
      fc.property(orderArb, paymentLinkUrlArb, (order, url) => {
        const msg = formatPaymentMessage(order, url);
        let lastPos = 0;
        for (let i = 1; i <= order.items.length; i++) {
          const marker = `${i}. `;
          const pos = msg.indexOf(marker, lastPos);
          expect(pos).toBeGreaterThanOrEqual(lastPos);
          lastPos = pos + 1;
        }
      }),
      { numRuns: 100 },
    );
  });
});
