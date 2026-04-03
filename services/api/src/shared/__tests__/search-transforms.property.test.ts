/**
 * Property-Based Tests for OpenSearch Search Transforms
 *
 * Uses fast-check to verify round-trip preservation of product data
 * through toOpenSearchDoc → fromOpenSearchHit conversion.
 *
 * Property 6 from the design document, minimum 100 iterations.
 */

import * as fc from 'fast-check';
import { toOpenSearchDoc, fromOpenSearchHit } from '../search-transforms';

// ── Generators ──────────────────────────────────────────────────────────

/** Generate a non-empty alphanumeric string suitable for IDs and names */
const arbNonEmptyString = (maxLen = 50): fc.Arbitrary<string> =>
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_'.split('')),
    { minLength: 1, maxLength: maxLen },
  );

/** Generate a positive price (finite, > 0) */
const arbPrice: fc.Arbitrary<number> = fc.double({
  min: 0.01,
  max: 999999.99,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Generate a random Product object with the five key fields */
const arbProduct = fc.record({
  productId: arbNonEmptyString(36),
  productName: arbNonEmptyString(100),
  price: arbPrice,
  category: arbNonEmptyString(30),
  sellerId: arbNonEmptyString(36),
});

// =========================================================================
// Property 6 – Product data round-trip preservation
// =========================================================================

describe('Feature: opensearch-integration, Property 6: Product data round-trip preservation', () => {
  /**
   * **Validates: Requirements 11.1**
   *
   * For any valid Product object with productId, productName, price,
   * category, and sellerId fields, transforming it to an OpenSearch
   * document and then formatting it back from an OpenSearch hit to a
   * SearchProductItem preserves the values of all five fields.
   */

  it('productId is preserved through round-trip', () => {
    fc.assert(
      fc.property(arbProduct, (product) => {
        const doc = toOpenSearchDoc(product);
        const result = fromOpenSearchHit(doc as unknown as Record<string, unknown>);
        expect(result.productId).toBe(product.productId);
      }),
      { numRuns: 100 },
    );
  });

  it('productName is preserved through round-trip', () => {
    fc.assert(
      fc.property(arbProduct, (product) => {
        const doc = toOpenSearchDoc(product);
        const result = fromOpenSearchHit(doc as unknown as Record<string, unknown>);
        expect(result.productName).toBe(product.productName);
      }),
      { numRuns: 100 },
    );
  });

  it('price is preserved through round-trip', () => {
    fc.assert(
      fc.property(arbProduct, (product) => {
        const doc = toOpenSearchDoc(product);
        const result = fromOpenSearchHit(doc as unknown as Record<string, unknown>);
        expect(result.price).toBe(product.price);
      }),
      { numRuns: 100 },
    );
  });

  it('category is preserved through round-trip', () => {
    fc.assert(
      fc.property(arbProduct, (product) => {
        const doc = toOpenSearchDoc(product);
        const result = fromOpenSearchHit(doc as unknown as Record<string, unknown>);
        expect(result.category).toBe(product.category);
      }),
      { numRuns: 100 },
    );
  });

  it('sellerId is preserved through round-trip', () => {
    fc.assert(
      fc.property(arbProduct, (product) => {
        const doc = toOpenSearchDoc(product);
        const result = fromOpenSearchHit(doc as unknown as Record<string, unknown>);
        expect(result.sellerId).toBe(product.sellerId);
      }),
      { numRuns: 100 },
    );
  });

  it('all five fields are preserved through round-trip simultaneously', () => {
    fc.assert(
      fc.property(arbProduct, (product) => {
        const doc = toOpenSearchDoc(product);
        const result = fromOpenSearchHit(doc as unknown as Record<string, unknown>);

        expect(result.productId).toBe(product.productId);
        expect(result.productName).toBe(product.productName);
        expect(result.price).toBe(product.price);
        expect(result.category).toBe(product.category);
        expect(result.sellerId).toBe(product.sellerId);
      }),
      { numRuns: 100 },
    );
  });
});
