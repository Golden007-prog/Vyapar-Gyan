/**
 * Property-Based Tests for Inventory Formatting
 *
 * Tests that extracted inventory items are formatted as a numbered list
 * with name, price, and quantity for each item.
 *
 * Uses fast-check to verify invariants across randomised inputs.
 */

import * as fc from 'fast-check';
import {
  formatInventoryList,
  type InventoryItem,
} from '../../handlers/whatsapp/inventory-upload';

// ── Generators ─────────────────────────────────────────────────────────

/** Generate a valid InventoryItem for testing */
const inventoryItemArb: fc.Arbitrary<InventoryItem> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
  price: fc.integer({ min: 1, max: 99999 }),
  quantity: fc.integer({ min: 1, max: 9999 }),
  category: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
});

// ── Property 17: Inventory extraction formatted as numbered list ──

describe('Property 17: Inventory extraction formatted as numbered list', () => {
  /**
   * **Validates: Requirement 11.4**
   *
   * For any non-empty extracted items list, formatted message contains
   * sequentially numbered entry for each item with name, price, and quantity.
   */

  it('empty list returns "No items" message', () => {
    const result = formatInventoryList([]);
    expect(result).toContain('No items were extracted');
  });

  it('non-empty list contains sequential numbered entries', () => {
    fc.assert(
      fc.property(
        fc.array(inventoryItemArb, { minLength: 1, maxLength: 20 }),
        (items) => {
          const result = formatInventoryList(items);

          // Must NOT be the empty message
          expect(result).not.toContain('No items were extracted');

          // Each item should have a numbered entry
          items.forEach((_, i) => {
            expect(result).toContain(`*${i + 1}.*`);
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('each entry contains the item name', () => {
    fc.assert(
      fc.property(
        fc.array(inventoryItemArb, { minLength: 1, maxLength: 10 }),
        (items) => {
          const result = formatInventoryList(items);

          items.forEach((item) => {
            expect(result).toContain(item.name);
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('each entry contains price with ₹ symbol', () => {
    fc.assert(
      fc.property(
        fc.array(inventoryItemArb, { minLength: 1, maxLength: 10 }),
        (items) => {
          const result = formatInventoryList(items);

          items.forEach((item) => {
            expect(result).toContain(`₹${item.price}`);
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('each entry contains quantity', () => {
    fc.assert(
      fc.property(
        fc.array(inventoryItemArb, { minLength: 1, maxLength: 10 }),
        (items) => {
          const result = formatInventoryList(items);

          items.forEach((item) => {
            expect(result).toContain(`Qty: ${item.quantity}`);
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('numbered entries are sequential starting from 1', () => {
    fc.assert(
      fc.property(
        fc.array(inventoryItemArb, { minLength: 1, maxLength: 15 }),
        (items) => {
          const result = formatInventoryList(items);

          // Check that numbers appear in order
          let lastIndex = 0;
          for (let i = 1; i <= items.length; i++) {
            const marker = `*${i}.*`;
            const pos = result.indexOf(marker, lastIndex);
            expect(pos).toBeGreaterThan(lastIndex > 0 ? lastIndex : -1);
            lastIndex = pos;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('contains confirmation and edit instructions', () => {
    fc.assert(
      fc.property(
        fc.array(inventoryItemArb, { minLength: 1, maxLength: 5 }),
        (items) => {
          const result = formatInventoryList(items);

          expect(result).toContain('looks good');
          expect(result).toContain('change item');
          expect(result).toContain('cancel');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('contains item count in header', () => {
    fc.assert(
      fc.property(
        fc.array(inventoryItemArb, { minLength: 1, maxLength: 20 }),
        (items) => {
          const result = formatInventoryList(items);
          expect(result).toContain(`${items.length} items`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('items with category include category in output', () => {
    const itemWithCategory: InventoryItem = {
      name: 'Test Product',
      price: 100,
      quantity: 5,
      category: 'Groceries',
    };

    const result = formatInventoryList([itemWithCategory]);
    expect(result).toContain('Category: Groceries');
  });
});
