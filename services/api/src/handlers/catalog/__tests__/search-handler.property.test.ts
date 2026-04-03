/**
 * Property-Based Tests for OpenSearch Search Handler
 *
 * Property 1: Search query construction correctness
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 *
 * Uses fast-check to verify that buildSearchQuery produces correct
 * OpenSearch query bodies for any combination of {q, category, seller}.
 */

import * as fc from 'fast-check';
import { buildSearchQuery } from '../search-handler';

fc.configureGlobal({ numRuns: 100 });

// ── Generators ──────────────────────────────────────────────────────────

/** Generate an optional non-empty query string */
const arbQueryString: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 '.split('')),
    { minLength: 1, maxLength: 50 },
  ),
);

/** Generate an optional category string */
const arbCategory: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    { minLength: 1, maxLength: 20 },
  ),
);

/** Generate an optional seller ID string */
const arbSeller: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 1, maxLength: 30 },
  ),
);

/** Generate a full search params tuple */
const arbSearchParams = fc.record({
  q: arbQueryString,
  category: arbCategory,
  seller: arbSeller,
});

// ── Helpers ─────────────────────────────────────────────────────────────

function hasNonEmptyQuery(q: string | undefined): boolean {
  return q !== undefined && q.trim().length > 0;
}

// =========================================================================
// Property 1: Search query construction correctness
// =========================================================================

describe('Feature: opensearch-integration, Property 1: Search query construction correctness', () => {
  /**
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
   *
   * For any valid search request parameters (query string q, optional category,
   * optional seller), the constructed OpenSearch query body SHALL contain:
   * - a multi_match clause with fields productName^3, description, tags^2 and fuzziness AUTO (when q provided)
   * - a match_all clause (when q is absent or empty)
   * - a term filter for status: "Active"
   * - conditional term filters for category and sellerId if and only if those parameters are provided
   */

  it('always produces a bool query with must and filter arrays', () => {
    fc.assert(
      fc.property(arbSearchParams, (params) => {
        const result = buildSearchQuery(params) as any;

        expect(result).toHaveProperty('query');
        expect(result.query).toHaveProperty('bool');
        expect(result.query.bool).toHaveProperty('must');
        expect(result.query.bool).toHaveProperty('filter');
        expect(Array.isArray(result.query.bool.must)).toBe(true);
        expect(Array.isArray(result.query.bool.filter)).toBe(true);
      }),
    );
  });

  it('uses multi_match with correct fields, boosts, and fuzziness when q is provided', () => {
    fc.assert(
      fc.property(arbSearchParams, (params) => {
        const result = buildSearchQuery(params) as any;
        const mustClauses = result.query.bool.must;

        if (hasNonEmptyQuery(params.q)) {
          // Req 5.1: multi_match on productName^3, description, tags^2
          const multiMatch = mustClauses.find((c: any) => c.multi_match);
          expect(multiMatch).toBeDefined();
          expect(multiMatch.multi_match.query).toBe(params.q);
          expect(multiMatch.multi_match.fields).toEqual(
            expect.arrayContaining(['productName^3', 'description', 'tags^2']),
          );
          expect(multiMatch.multi_match.fields).toHaveLength(3);

          // Req 5.2: fuzziness AUTO
          expect(multiMatch.multi_match.fuzziness).toBe('AUTO');
        }
      }),
    );
  });

  it('uses match_all when q is absent or empty', () => {
    fc.assert(
      fc.property(arbSearchParams, (params) => {
        const result = buildSearchQuery(params) as any;
        const mustClauses = result.query.bool.must;

        if (!hasNonEmptyQuery(params.q)) {
          const matchAll = mustClauses.find((c: any) => c.match_all !== undefined);
          expect(matchAll).toBeDefined();
        }
      }),
    );
  });

  it('always includes a term filter for status: "Active"', () => {
    fc.assert(
      fc.property(arbSearchParams, (params) => {
        const result = buildSearchQuery(params) as any;
        const filters = result.query.bool.filter;

        // Req 5.3: always filter to Active
        const statusFilter = filters.find(
          (f: any) => f.term && f.term.status === 'Active',
        );
        expect(statusFilter).toBeDefined();
      }),
    );
  });

  it('includes category term filter if and only if category is provided', () => {
    fc.assert(
      fc.property(arbSearchParams, (params) => {
        const result = buildSearchQuery(params) as any;
        const filters = result.query.bool.filter;

        const categoryFilter = filters.find(
          (f: any) => f.term && f.term.category !== undefined,
        );

        if (params.category) {
          // Req 5.4: category filter present with correct value
          expect(categoryFilter).toBeDefined();
          expect(categoryFilter.term.category).toBe(params.category);
        } else {
          // No category filter when not provided
          expect(categoryFilter).toBeUndefined();
        }
      }),
    );
  });

  it('includes sellerId term filter if and only if seller is provided', () => {
    fc.assert(
      fc.property(arbSearchParams, (params) => {
        const result = buildSearchQuery(params) as any;
        const filters = result.query.bool.filter;

        const sellerFilter = filters.find(
          (f: any) => f.term && f.term.sellerId !== undefined,
        );

        if (params.seller) {
          // Req 5.5: sellerId filter present with correct value
          expect(sellerFilter).toBeDefined();
          expect(sellerFilter.term.sellerId).toBe(params.seller);
        } else {
          // No seller filter when not provided
          expect(sellerFilter).toBeUndefined();
        }
      }),
    );
  });

  it('filter count equals 1 (status) + conditionals (category, seller)', () => {
    fc.assert(
      fc.property(arbSearchParams, (params) => {
        const result = buildSearchQuery(params) as any;
        const filters = result.query.bool.filter;

        let expectedCount = 1; // status: Active is always present
        if (params.category) expectedCount++;
        if (params.seller) expectedCount++;

        expect(filters).toHaveLength(expectedCount);
      }),
    );
  });

  it('must array always has exactly one clause (multi_match or match_all)', () => {
    fc.assert(
      fc.property(arbSearchParams, (params) => {
        const result = buildSearchQuery(params) as any;
        expect(result.query.bool.must).toHaveLength(1);
      }),
    );
  });
});

// =========================================================================
// Property 2: Pagination calculation correctness
// =========================================================================

import { computePagination } from '../search-handler';

/** Generate a valid page number (≥ 1) */
const arbPage = fc.integer({ min: 1, max: 10000 });

/** Generate a valid size in [1, 100] */
const arbSize = fc.integer({ min: 1, max: 100 });

/** Generate an arbitrary integer for size clamping tests */
const arbAnySize = fc.integer({ min: -1000, max: 1000 });

describe('Feature: opensearch-integration, Property 2: Pagination calculation correctness', () => {
  /**
   * **Validates: Requirements 5.6**
   *
   * For any page number (≥1) and page size (1–100), the computed OpenSearch
   * `from` value SHALL equal `(page - 1) * size`, and the `size` value SHALL
   * be clamped to the range [1, 100] with a default of 20.
   */

  it('from equals (page - 1) * size for valid page and size', () => {
    fc.assert(
      fc.property(arbPage, arbSize, (page, size) => {
        const result = computePagination({ page, size });
        expect(result.from).toBe((page - 1) * size);
        expect(result.size).toBe(size);
      }),
    );
  });

  it('size is clamped to [1, 100] for any integer input', () => {
    fc.assert(
      fc.property(arbAnySize, (size) => {
        const result = computePagination({ page: 1, size });
        expect(result.size).toBeGreaterThanOrEqual(1);
        expect(result.size).toBeLessThanOrEqual(100);
      }),
    );
  });

  it('size defaults to 20 when not provided', () => {
    fc.assert(
      fc.property(arbPage, (page) => {
        const result = computePagination({ page });
        expect(result.size).toBe(20);
        expect(result.from).toBe((page - 1) * 20);
      }),
    );
  });

  it('page defaults to 1 when not provided', () => {
    fc.assert(
      fc.property(arbSize, (size) => {
        const result = computePagination({ size });
        expect(result.from).toBe(0);
        expect(result.size).toBe(size);
      }),
    );
  });

  it('from is always non-negative', () => {
    fc.assert(
      fc.property(arbPage, arbSize, (page, size) => {
        const result = computePagination({ page, size });
        expect(result.from).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('from and size are integers (no fractional values)', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 1, max: 10000, noNaN: true }),
        fc.float({ min: 1, max: 100, noNaN: true }),
        (page, size) => {
          const result = computePagination({ page, size });
          expect(Number.isInteger(result.from)).toBe(true);
          expect(Number.isInteger(result.size)).toBe(true);
        },
      ),
    );
  });
});

// =========================================================================
// Property 7: Search response schema conformance
// =========================================================================

import { formatSearchResponse } from '../search-handler';
import { SearchResponseSchema } from '../../../shared/schemas';

/** Generate a random mock OpenSearch hit object */
const arbHit: fc.Arbitrary<Record<string, unknown>> = fc.record({
  productId: fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 1, maxLength: 30 },
  ),
  productName: fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz '.split('')),
    { minLength: 1, maxLength: 50 },
  ),
  description: fc.string({ minLength: 0, maxLength: 100 }),
  category: fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    { minLength: 1, maxLength: 20 },
  ),
  sellerId: fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
    { minLength: 1, maxLength: 30 },
  ),
  price: fc.float({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true }),
  stockQuantity: fc.integer({ min: 0, max: 10000 }),
  imageUrls: fc.array(fc.webUrl(), { minLength: 0, maxLength: 5 }),
  createdAt: fc.date().map((d) => d.toISOString()),
});

/** Generate an array of 0 or more hits */
const arbHits = fc.array(arbHit, { minLength: 0, maxLength: 20 });

/** Generate a total count (≥ 0) */
const arbTotal = fc.integer({ min: 0, max: 100000 });

/** Generate a valid page number (≥ 1) */
const arbPageNum = fc.integer({ min: 1, max: 10000 });

/** Generate a valid page size (1–100) */
const arbPageSize = fc.integer({ min: 1, max: 100 });

describe('Feature: opensearch-integration, Property 7: Search response schema conformance', () => {
  /**
   * **Validates: Requirements 5.7, 11.2**
   *
   * For any valid search query string and any mock OpenSearch response
   * (with 0 or more hits), the Search Lambda's formatted response SHALL
   * conform to the SearchResponse Zod schema containing `items` (array),
   * `total` (non-negative integer), `page` (positive integer), and
   * `pageSize` (1–100).
   */

  it('formatted response always conforms to SearchResponseSchema', () => {
    fc.assert(
      fc.property(arbHits, arbTotal, arbPageNum, arbPageSize, (hits, total, page, pageSize) => {
        const result = formatSearchResponse(hits, total, page, pageSize);
        const parsed = SearchResponseSchema.safeParse(result);

        expect(parsed.success).toBe(true);
      }),
    );
  });

  it('items array length matches the number of input hits', () => {
    fc.assert(
      fc.property(arbHits, arbTotal, arbPageNum, arbPageSize, (hits, total, page, pageSize) => {
        const result = formatSearchResponse(hits, total, page, pageSize);

        expect(result.items).toHaveLength(hits.length);
      }),
    );
  });

  it('total is always a non-negative integer', () => {
    fc.assert(
      fc.property(arbHits, arbTotal, arbPageNum, arbPageSize, (hits, total, page, pageSize) => {
        const result = formatSearchResponse(hits, total, page, pageSize);

        expect(result.total).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result.total)).toBe(true);
      }),
    );
  });

  it('page is always a positive integer', () => {
    fc.assert(
      fc.property(arbHits, arbTotal, arbPageNum, arbPageSize, (hits, total, page, pageSize) => {
        const result = formatSearchResponse(hits, total, page, pageSize);

        expect(result.page).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(result.page)).toBe(true);
      }),
    );
  });

  it('pageSize is always in [1, 100]', () => {
    fc.assert(
      fc.property(arbHits, arbTotal, arbPageNum, arbPageSize, (hits, total, page, pageSize) => {
        const result = formatSearchResponse(hits, total, page, pageSize);

        expect(result.pageSize).toBeGreaterThanOrEqual(1);
        expect(result.pageSize).toBeLessThanOrEqual(100);
        expect(Number.isInteger(result.pageSize)).toBe(true);
      }),
    );
  });

  it('each item has all required SearchProductItem fields as correct types', () => {
    fc.assert(
      fc.property(arbHits, arbTotal, arbPageNum, arbPageSize, (hits, total, page, pageSize) => {
        const result = formatSearchResponse(hits, total, page, pageSize);

        for (const item of result.items) {
          expect(typeof item.productId).toBe('string');
          expect(typeof item.productName).toBe('string');
          expect(typeof item.description).toBe('string');
          expect(typeof item.category).toBe('string');
          expect(typeof item.sellerId).toBe('string');
          expect(typeof item.price).toBe('number');
          expect(typeof item.stockQuantity).toBe('number');
          expect(Array.isArray(item.imageUrls)).toBe(true);
          expect(typeof item.createdAt).toBe('string');
        }
      }),
    );
  });
});
