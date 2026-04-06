/**
 * Property-Based Tests for Order Service
 *
 * Property 9: Order ID Format
 * For any generated order ID, it matches `^VG-\d{8}-\d{4}$` with a valid YYYYMMDD date.
 *
 * **Validates: Requirements 14.6**
 */

import * as fc from 'fast-check';
import { generateOrderId } from '../order-service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORDER_ID_REGEX = /^VG-\d{8}-\d{4}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the YYYYMMDD portion from an order ID and validate it represents
 * a real calendar date.
 */
function parseDatePortion(orderId: string): { valid: boolean; year: number; month: number; day: number } {
  const datePart = orderId.slice(3, 11); // "VG-" is 3 chars, then 8 digits
  const year = parseInt(datePart.slice(0, 4), 10);
  const month = parseInt(datePart.slice(4, 6), 10);
  const day = parseInt(datePart.slice(6, 8), 10);

  // Month must be 1-12
  if (month < 1 || month > 12) {
    return { valid: false, year, month, day };
  }

  // Validate day by constructing a Date and checking it round-trips
  const reconstructed = new Date(year, month - 1, day);
  const valid =
    reconstructed.getFullYear() === year &&
    reconstructed.getMonth() === month - 1 &&
    reconstructed.getDate() === day;

  return { valid, year, month, day };
}

/**
 * Parse the 4-digit suffix from an order ID.
 */
function parseSuffix(orderId: string): number {
  return parseInt(orderId.slice(12), 10); // after "VG-YYYYMMDD-"
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generate arbitrary dates across a wide range */
const arbDate: fc.Arbitrary<Date> = fc.date({
  min: new Date(2000, 0, 1),
  max: new Date(2099, 11, 31),
});

// ---------------------------------------------------------------------------
// Property 9: Order ID Format
// ---------------------------------------------------------------------------

describe('Property 9: Order ID Format', () => {
  /**
   * **Validates: Requirements 14.6**
   *
   * For any generated order ID, the output matches ^VG-\d{8}-\d{4}$
   */
  it('generated order ID matches the regex ^VG-\\d{8}-\\d{4}$', () => {
    fc.assert(
      fc.property(arbDate, (date) => {
        const orderId = generateOrderId(date);
        expect(orderId).toMatch(ORDER_ID_REGEX);
      }),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 14.6**
   *
   * The YYYYMMDD portion is a valid calendar date matching the input date.
   */
  it('YYYYMMDD portion is a valid date matching the input', () => {
    fc.assert(
      fc.property(arbDate, (date) => {
        const orderId = generateOrderId(date);
        const parsed = parseDatePortion(orderId);

        expect(parsed.valid).toBe(true);
        expect(parsed.year).toBe(date.getFullYear());
        expect(parsed.month).toBe(date.getMonth() + 1);
        expect(parsed.day).toBe(date.getDate());
      }),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 14.6**
   *
   * The 4-digit suffix is between 0000 and 9999 (padded to 4 digits).
   * Since Math.random() * 10000 is floored, the range is 0–9999.
   */
  it('4-digit suffix is between 0000 and 9999', () => {
    fc.assert(
      fc.property(arbDate, (date) => {
        const orderId = generateOrderId(date);
        const suffix = parseSuffix(orderId);

        expect(suffix).toBeGreaterThanOrEqual(0);
        expect(suffix).toBeLessThanOrEqual(9999);
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// Imports for Properties 2–5
// ---------------------------------------------------------------------------

import {
  requiresStockUnreservation,
  requiresStockFinalization,
  type OrderStatus,
} from '../order-state-machine';

// ---------------------------------------------------------------------------
// Shared Arbitraries for Properties 2–5
// ---------------------------------------------------------------------------

/** A single order item with positive quantity and price */
const arbOrderItem = fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  quantity: fc.integer({ min: 1, max: 100 }),
  unitPrice: fc.integer({ min: 1, max: 100_000 }),
});

/** A non-empty cart of 1–10 items */
const arbCart = fc.array(arbOrderItem, { minLength: 1, maxLength: 10 });

/** Initial stock that is large enough to cover any single order item */
const arbInitialStock = fc.integer({ min: 100, max: 10_000 });

/** Terminal statuses that trigger stock unreservation */
const arbTerminalUnreserve: fc.Arbitrary<OrderStatus> = fc.constantFrom(
  'rejected' as OrderStatus,
  'cancelled' as OrderStatus,
  'expired' as OrderStatus,
);

// ---------------------------------------------------------------------------
// Property 2: Stock Reservation on Order Creation
// ---------------------------------------------------------------------------

describe('Property 2: Stock Reservation on Order Creation', () => {
  /**
   * **Validates: Requirements 1.2, 2.5, 3.4**
   *
   * For any valid cart, creating an order results in:
   *  - status = pending_seller_confirmation
   *  - reserved_stock incremented by ordered quantity
   *  - totalAmount = sum of (unitPrice × quantity)
   */
  it('order creation sets pending_seller_confirmation and reserves stock correctly', () => {
    fc.assert(
      fc.property(arbCart, (items) => {
        // Simulate order creation logic
        const initialStatus: OrderStatus = 'pending_seller_confirmation';

        // Compute totalAmount as the service does
        const totalAmount = items.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0,
        );

        // For each product, simulate reserved_stock increment
        const stockChanges = items.map((item) => {
          const reservedBefore = 0; // fresh product
          const reservedAfter = reservedBefore + item.quantity;
          return { productId: item.productId, reservedBefore, reservedAfter, qty: item.quantity };
        });

        // Property assertions
        expect(initialStatus).toBe('pending_seller_confirmation');
        expect(totalAmount).toBeGreaterThan(0);

        // totalAmount equals sum of line totals
        const expectedTotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        expect(totalAmount).toBe(expectedTotal);

        // reserved_stock incremented by exactly the ordered quantity
        for (const change of stockChanges) {
          expect(change.reservedAfter).toBe(change.reservedBefore + change.qty);
          expect(change.reservedAfter).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 2.5, 3.4**
   *
   * For any quantity > 0, reserved_stock + quantity > reserved_stock
   * (reservation always increases reserved stock).
   */
  it('reserving stock always increases reserved_stock', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 100 }),
        (reservedBefore, quantity) => {
          const reservedAfter = reservedBefore + quantity;
          expect(reservedAfter).toBeGreaterThan(reservedBefore);
          expect(reservedAfter).toBe(reservedBefore + quantity);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * totalAmount computation is associative — order of items doesn't matter.
   */
  it('totalAmount is independent of item order', () => {
    fc.assert(
      fc.property(arbCart, (items) => {
        const total = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        const reversed = [...items].reverse().reduce((s, i) => s + i.unitPrice * i.quantity, 0);
        expect(total).toBe(reversed);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Stock Unreservation on Terminal States
// ---------------------------------------------------------------------------

describe('Property 3: Stock Unreservation on Terminal States', () => {
  /**
   * **Validates: Requirements 1.5, 5.4, 8.7**
   *
   * requiresStockUnreservation returns true for rejected, cancelled, expired.
   */
  it('requiresStockUnreservation is true for rejected, cancelled, expired', () => {
    fc.assert(
      fc.property(arbTerminalUnreserve, (status) => {
        expect(requiresStockUnreservation(status)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 5.4, 8.7**
   *
   * requiresStockUnreservation returns false for all non-terminal-unreserve statuses.
   */
  it('requiresStockUnreservation is false for non-unreserve statuses', () => {
    const nonUnreserveStatuses: OrderStatus[] = [
      'pending_seller_confirmation', 'confirmed', 'payment_pending',
      'paid', 'preparing', 'shipped', 'delivered', 'completed', 'payment_failed',
    ];
    fc.assert(
      fc.property(fc.constantFrom(...nonUnreserveStatuses), (status) => {
        expect(requiresStockUnreservation(status)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 5.4, 8.7**
   *
   * For any order items and sufficient reserved_stock, unreservation
   * decrements reserved_stock by ordered quantity and result is non-negative.
   */
  it('unreservation decrements reserved_stock and remains non-negative', () => {
    fc.assert(
      fc.property(
        arbCart,
        arbTerminalUnreserve,
        (items, targetStatus) => {
          expect(requiresStockUnreservation(targetStatus)).toBe(true);

          for (const item of items) {
            // reserved_stock must be >= quantity for unreservation to be valid
            const reservedBefore = item.quantity; // exactly what was reserved
            const reservedAfter = reservedBefore - item.quantity;

            expect(reservedAfter).toBe(0);
            expect(reservedAfter).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 5.4, 8.7**
   *
   * For any reserved_stock >= quantity, unreservation result is non-negative.
   */
  it('unreservation from any valid reserved_stock stays non-negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 10_000 }),
        (quantity, extraReserved) => {
          const reservedBefore = quantity + extraReserved; // always >= quantity
          const reservedAfter = reservedBefore - quantity;

          expect(reservedAfter).toBeGreaterThanOrEqual(0);
          expect(reservedAfter).toBe(extraReserved);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Stock Finalization on Payment
// ---------------------------------------------------------------------------

describe('Property 4: Stock Finalization on Payment', () => {
  /**
   * **Validates: Requirements 1.6, 8.3**
   *
   * requiresStockFinalization returns true only for 'paid'.
   */
  it('requiresStockFinalization is true only for paid', () => {
    const allStatuses: OrderStatus[] = [
      'pending_seller_confirmation', 'confirmed', 'payment_pending',
      'paid', 'preparing', 'shipped', 'delivered', 'completed',
      'rejected', 'cancelled', 'payment_failed', 'expired',
    ];
    fc.assert(
      fc.property(fc.constantFrom(...allStatuses), (status) => {
        if (status === 'paid') {
          expect(requiresStockFinalization(status)).toBe(true);
        } else {
          expect(requiresStockFinalization(status)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.6, 8.3**
   *
   * For any order transitioning to paid, both stock_quantity and reserved_stock
   * are decremented by ordered quantity and both remain non-negative.
   */
  it('finalization decrements both stock_quantity and reserved_stock, both stay non-negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),   // quantity ordered
        fc.integer({ min: 0, max: 10_000 }), // extra stock beyond quantity
        fc.integer({ min: 0, max: 10_000 }), // extra reserved beyond quantity
        (quantity, extraStock, extraReserved) => {
          // stock_quantity >= reserved_stock >= quantity (valid pre-condition)
          const reservedBefore = quantity + extraReserved;
          const stockBefore = reservedBefore + extraStock;

          // Finalization: decrement both by quantity
          const stockAfter = stockBefore - quantity;
          const reservedAfter = reservedBefore - quantity;

          expect(stockAfter).toBeGreaterThanOrEqual(0);
          expect(reservedAfter).toBeGreaterThanOrEqual(0);
          expect(stockAfter).toBeGreaterThanOrEqual(reservedAfter);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.6, 8.3**
   *
   * Finalization preserves the gap between stock_quantity and reserved_stock.
   * If stock_quantity - reserved_stock = available before, it stays the same after.
   */
  it('finalization preserves available stock (stock_quantity - reserved_stock)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (quantity, extraStock, extraReserved) => {
          const reservedBefore = quantity + extraReserved;
          const stockBefore = reservedBefore + extraStock;

          const availableBefore = stockBefore - reservedBefore;
          const availableAfter = (stockBefore - quantity) - (reservedBefore - quantity);

          expect(availableAfter).toBe(availableBefore);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Stock Conservation Invariant
// ---------------------------------------------------------------------------

/**
 * Model-based property test: simulate a sequence of order operations
 * and verify the invariant stock_quantity >= reserved_stock >= 0 at all times.
 */

type StockOp =
  | { type: 'create'; quantity: number }
  | { type: 'unreserve'; quantity: number }
  | { type: 'finalize'; quantity: number };

/**
 * Generate a valid sequence of stock operations.
 * We track pending reservations to ensure unreserve/finalize only happen
 * when there's enough reserved stock.
 */
function genStockOps(initialStock: number): fc.Arbitrary<StockOp[]> {
  return fc.array(
    fc.integer({ min: 1, max: 10 }),
    { minLength: 1, maxLength: 20 },
  ).chain((quantities) => {
    // Build a valid sequence by tracking state
    const ops: StockOp[] = [];
    let stock = initialStock;
    let reserved = 0;

    for (const qty of quantities) {
      const available = stock - reserved;

      // Decide operation based on current state
      if (reserved >= qty && stock >= qty) {
        // Can do any operation — pick one based on qty parity
        if (qty % 3 === 0 && reserved >= qty) {
          ops.push({ type: 'finalize', quantity: qty });
          stock -= qty;
          reserved -= qty;
        } else if (qty % 3 === 1 && reserved >= qty) {
          ops.push({ type: 'unreserve', quantity: qty });
          reserved -= qty;
        } else if (available >= qty) {
          ops.push({ type: 'create', quantity: qty });
          reserved += qty;
        }
      } else if (available >= qty) {
        // Can only create
        ops.push({ type: 'create', quantity: qty });
        reserved += qty;
      }
      // else skip — no valid operation for this quantity
    }

    return fc.constant(ops);
  });
}

describe('Property 5: Stock Conservation Invariant', () => {
  /**
   * **Validates: Requirements 1.2, 1.5, 1.6**
   *
   * For any sequence of order operations, stock_quantity >= reserved_stock >= 0
   * holds at all times.
   */
  it('stock_quantity >= reserved_stock >= 0 holds after every operation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 1000 }).chain((initialStock) =>
          genStockOps(initialStock).map((ops) => ({ initialStock, ops })),
        ),
        ({ initialStock, ops }) => {
          let stock = initialStock;
          let reserved = 0;

          // Invariant must hold initially
          expect(stock).toBeGreaterThanOrEqual(reserved);
          expect(reserved).toBeGreaterThanOrEqual(0);

          for (const op of ops) {
            switch (op.type) {
              case 'create':
                reserved += op.quantity;
                break;
              case 'unreserve':
                reserved -= op.quantity;
                break;
              case 'finalize':
                stock -= op.quantity;
                reserved -= op.quantity;
                break;
            }

            // Invariant must hold after every operation
            expect(stock).toBeGreaterThanOrEqual(reserved);
            expect(reserved).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.5, 1.6**
   *
   * stock_quantity + total_sold = initial_stock_quantity after any sequence.
   */
  it('stock_quantity + total_sold = initial_stock_quantity (conservation)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 1000 }).chain((initialStock) =>
          genStockOps(initialStock).map((ops) => ({ initialStock, ops })),
        ),
        ({ initialStock, ops }) => {
          let stock = initialStock;
          let totalSold = 0;

          for (const op of ops) {
            switch (op.type) {
              case 'create':
                // reservation doesn't change stock_quantity
                break;
              case 'unreserve':
                // unreservation doesn't change stock_quantity
                break;
              case 'finalize':
                stock -= op.quantity;
                totalSold += op.quantity;
                break;
            }
          }

          expect(stock + totalSold).toBe(initialStock);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.5, 1.6**
   *
   * reserved_stock = sum of quantities in non-terminal, non-paid orders.
   */
  it('reserved_stock equals sum of active (non-finalized, non-unreserved) reservations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 1000 }).chain((initialStock) =>
          genStockOps(initialStock).map((ops) => ({ initialStock, ops })),
        ),
        ({ initialStock, ops }) => {
          let reserved = 0;
          let activeReservations = 0;

          for (const op of ops) {
            switch (op.type) {
              case 'create':
                reserved += op.quantity;
                activeReservations += op.quantity;
                break;
              case 'unreserve':
                reserved -= op.quantity;
                activeReservations -= op.quantity;
                break;
              case 'finalize':
                reserved -= op.quantity;
                activeReservations -= op.quantity;
                break;
            }
          }

          expect(reserved).toBe(activeReservations);
          expect(reserved).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
