/**
 * Property-Based Tests for Stock Check Response Formatting
 *
 * Uses fast-check to verify that formatStockResponse() produces a response
 * containing all required fields: product name, stock quantity, and last restock date.
 *
 * Feature: next-features, Property 5: Stock check response contains all required fields
 */

import * as fc from 'fast-check';
import { formatStockResponse } from '../../handlers/whatsapp/seller-copilot';
import type { ProductCandidate } from '../../utils/product-matcher';

// ── Generators ──────────────────────────────────────────────────────────

/** Arbitrary product name — non-empty alphanumeric string with spaces. */
const productNameArb = fc
  .array(
    fc.oneof(
      fc.stringOf(fc.char().filter(c => /[a-zA-Z0-9]/.test(c)), { minLength: 1, maxLength: 15 }),
      fc.constantFrom('Amul Butter', 'Tata Salt 1kg', 'Maggi Noodles', 'Parle-G', 'Red Label Tea'),
    ),
    { minLength: 1, maxLength: 1 },
  )
  .map(arr => arr[0]!);

/** Arbitrary ISO date string for stockAddedDate. */
const isoDateArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map(d => d.toISOString());

/** Arbitrary ProductCandidate with a stockAddedDate. */
const productWithDateArb: fc.Arbitrary<ProductCandidate> = fc.record({
  id: fc.uuid(),
  name: productNameArb,
  price: fc.integer({ min: 1, max: 100000 }),
  stockQuantity: fc.integer({ min: 0, max: 99999 }),
  categoryId: fc.uuid(),
  stockAddedDate: isoDateArb,
});

/** Arbitrary ProductCandidate without a stockAddedDate. */
const productWithoutDateArb: fc.Arbitrary<ProductCandidate> = fc.record({
  id: fc.uuid(),
  name: productNameArb,
  price: fc.integer({ min: 1, max: 100000 }),
  stockQuantity: fc.integer({ min: 0, max: 99999 }),
  categoryId: fc.uuid(),
});

/** Any ProductCandidate (with or without stockAddedDate). */
const productArb = fc.oneof(productWithDateArb, productWithoutDateArb);

// ── Property Tests ──────────────────────────────────────────────────────

describe('Property 5: Stock check response contains all required fields', () => {
  /**
   * **Validates: Requirement 3.3**
   *
   * For any non-empty product, the formatted response contains the product name,
   * stock quantity, and last restock date (or "N/A" if missing).
   */
  it('response contains product name for any product', () => {
    fc.assert(
      fc.property(productArb, (product) => {
        const response = formatStockResponse(product);

        // Response must contain the product name
        expect(response).toContain(product.name);
      }),
      { numRuns: 200 },
    );
  });

  it('response contains stock quantity for any product', () => {
    fc.assert(
      fc.property(productArb, (product) => {
        const response = formatStockResponse(product);

        // Response must contain the stock quantity with "units" label
        expect(response).toContain(`${product.stockQuantity} units`);
      }),
      { numRuns: 200 },
    );
  });

  it('response contains last restock date or N/A for any product', () => {
    fc.assert(
      fc.property(productArb, (product) => {
        const response = formatStockResponse(product);

        if (product.stockAddedDate) {
          // When stockAddedDate is present, response must contain a formatted date
          // The function formats using en-IN locale: e.g. "15 Jan 2024"
          const formatted = new Date(product.stockAddedDate).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          });
          expect(response).toContain(formatted);
        } else {
          // When stockAddedDate is missing, response must contain "N/A"
          expect(response).toContain('N/A');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('response contains all three required fields simultaneously for any product', () => {
    fc.assert(
      fc.property(productArb, (product) => {
        const response = formatStockResponse(product);

        // All three fields must be present in a single response
        expect(response).toContain(product.name);
        expect(response).toContain(`${product.stockQuantity} units`);

        // Restock date: either formatted date or N/A
        const hasDate = product.stockAddedDate
          ? response.includes(
              new Date(product.stockAddedDate).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }),
            )
          : response.includes('N/A');
        expect(hasDate).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
