/**
 * Property-Based Tests for OpenSearch Autocomplete Handler
 *
 * Property 3: Autocomplete query construction correctness
 * Validates: Requirements 6.1, 6.3
 *
 * Uses fast-check to verify that buildAutocompleteQuery produces correct
 * OpenSearch query bodies for any prefix string of 2 or more characters.
 */

import * as fc from 'fast-check';
import { buildAutocompleteQuery } from '../autocomplete-handler';

fc.configureGlobal({ numRuns: 100 });

// ── Generators ──────────────────────────────────────────────────────────

/** Generate a random string of length ≥ 2 (valid autocomplete prefix) */
const arbPrefix: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -'.split('')),
  { minLength: 2, maxLength: 60 },
);

// =========================================================================
// Property 3: Autocomplete query construction correctness
// =========================================================================

describe('Feature: opensearch-integration, Property 3: Autocomplete query construction correctness', () => {
  /**
   * **Validates: Requirements 6.1, 6.3**
   *
   * For any prefix string of 2 or more characters, the constructed autocomplete
   * query SHALL contain a `prefix` query on `productName.keyword` with the given
   * prefix value, and a `term` filter for `status: "Active"`.
   */

  it('always produces a bool query with must and filter arrays', () => {
    fc.assert(
      fc.property(arbPrefix, (prefix) => {
        const result = buildAutocompleteQuery(prefix) as any;

        expect(result).toHaveProperty('query');
        expect(result.query).toHaveProperty('bool');
        expect(result.query.bool).toHaveProperty('must');
        expect(result.query.bool).toHaveProperty('filter');
        expect(Array.isArray(result.query.bool.must)).toBe(true);
        expect(Array.isArray(result.query.bool.filter)).toBe(true);
      }),
    );
  });

  it('contains a prefix query on productName.keyword with the given prefix value', () => {
    fc.assert(
      fc.property(arbPrefix, (prefix) => {
        const result = buildAutocompleteQuery(prefix) as any;
        const mustClauses = result.query.bool.must;

        // Req 6.1: prefix query on productName.keyword
        const prefixClause = mustClauses.find((c: any) => c.prefix);
        expect(prefixClause).toBeDefined();
        expect(prefixClause.prefix['productName.keyword']).toBeDefined();
        expect(prefixClause.prefix['productName.keyword'].value).toBe(prefix);
      }),
    );
  });

  it('always includes a term filter for status: "Active"', () => {
    fc.assert(
      fc.property(arbPrefix, (prefix) => {
        const result = buildAutocompleteQuery(prefix) as any;
        const filters = result.query.bool.filter;

        // Req 6.3: filter to Active products only
        const statusFilter = filters.find(
          (f: any) => f.term && f.term.status === 'Active',
        );
        expect(statusFilter).toBeDefined();
      }),
    );
  });

  it('must array has exactly one clause (the prefix query)', () => {
    fc.assert(
      fc.property(arbPrefix, (prefix) => {
        const result = buildAutocompleteQuery(prefix) as any;
        expect(result.query.bool.must).toHaveLength(1);
      }),
    );
  });

  it('filter array has exactly one clause (the status filter)', () => {
    fc.assert(
      fc.property(arbPrefix, (prefix) => {
        const result = buildAutocompleteQuery(prefix) as any;
        expect(result.query.bool.filter).toHaveLength(1);
      }),
    );
  });

  it('includes _source fields for productName, category, and productId', () => {
    fc.assert(
      fc.property(arbPrefix, (prefix) => {
        const result = buildAutocompleteQuery(prefix) as any;

        expect(result._source).toBeDefined();
        expect(result._source).toEqual(
          expect.arrayContaining(['productName', 'category', 'productId']),
        );
      }),
    );
  });
});

// =========================================================================
// Property 4: Autocomplete limit clamping
// =========================================================================

import { clampLimit } from '../autocomplete-handler';

describe('Feature: opensearch-integration, Property 4: Autocomplete limit clamping', () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * For any integer limit value, the effective limit used in the autocomplete
   * query SHALL be clamped to the range [1, 10] with a default of 5 when not provided.
   */

  it('returns default 5 when limit is undefined', () => {
    expect(clampLimit(undefined)).toBe(5);
  });

  it('clamps any integer to [1, 10]', () => {
    fc.assert(
      fc.property(fc.integer(), (limit) => {
        const result = clampLimit(limit);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(10);
      }),
    );
  });

  it('preserves values already within [1, 10]', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (limit) => {
        const result = clampLimit(limit);
        expect(result).toBe(limit);
      }),
    );
  });

  it('clamps values below 1 to exactly 1', () => {
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (limit) => {
        const result = clampLimit(limit);
        expect(result).toBe(1);
      }),
    );
  });

  it('clamps values above 10 to exactly 10', () => {
    fc.assert(
      fc.property(fc.integer({ min: 11 }), (limit) => {
        const result = clampLimit(limit);
        expect(result).toBe(10);
      }),
    );
  });

  it('floors fractional values before clamping', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }), (limit) => {
        const result = clampLimit(limit);
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(10);
      }),
    );
  });
});


// =========================================================================
// Property 5: Short prefix returns empty suggestions
// =========================================================================

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// Mock the OpenSearch adapter module BEFORE importing the handler
jest.mock('../../../adapters/opensearch-adapter');

// Mock the logger to suppress output during tests
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { handler } from '../autocomplete-handler';
import { OpenSearchAdapter } from '../../../adapters/opensearch-adapter';

/** Generate a random single-character string (length exactly 1) */
const arbShortPrefix: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
  { minLength: 1, maxLength: 1 },
);

/**
 * Build a minimal mock APIGatewayProxyEventV2 with the given query string parameters.
 */
function makeMockEvent(queryStringParameters: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'GET /api/v1/autocomplete',
    rawPath: '/api/v1/autocomplete',
    rawQueryString: Object.entries(queryStringParameters)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&'),
    headers: {},
    queryStringParameters,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path: '/api/v1/autocomplete',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-request-id',
      routeKey: 'GET /api/v1/autocomplete',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

describe('Feature: opensearch-integration, Property 5: Short prefix returns empty suggestions', () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * For any string of length 0 or 1, the autocomplete handler SHALL return
   * an empty `suggestions` array without querying OpenSearch.
   */

  const mockSearch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockReset();
    (OpenSearchAdapter as jest.MockedClass<typeof OpenSearchAdapter>).mockImplementation(
      () => ({ search: mockSearch, suggest: jest.fn() } as any),
    );
  });

  it('returns empty suggestions for any single-character prefix without calling OpenSearch', () => {
    fc.assert(
      fc.asyncProperty(arbShortPrefix, async (prefix) => {
        const event = makeMockEvent({ q: prefix });
        const result = await handler(event);

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body as string);
        expect(body).toEqual({ suggestions: [] });

        // OpenSearch adapter should NOT have been called
        expect(mockSearch).not.toHaveBeenCalled();
      }),
    );
  });

  it('returns 400 or empty suggestions for empty string prefix (fails Zod min(1) validation)', async () => {
    const event = makeMockEvent({ q: '' });
    const result = await handler(event);

    // Empty string fails AutocompleteQuerySchema (q: z.string().min(1))
    expect(result.statusCode).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});


// =========================================================================
// Property 8: Autocomplete response schema conformance
// =========================================================================

import { formatAutocompleteResponse } from '../autocomplete-handler';
import { AutocompleteResponseSchema } from '../../../shared/schemas';

/** Generate a single mock OpenSearch hit with random product fields */
const arbOpenSearchHit: fc.Arbitrary<Record<string, unknown>> = fc.record({
  productName: fc.string({ minLength: 1, maxLength: 80 }),
  category: fc.string({ minLength: 1, maxLength: 40 }),
  productId: fc.string({ minLength: 1, maxLength: 40 }),
});

/** Generate an array of 0+ mock OpenSearch hits */
const arbHitArray: fc.Arbitrary<Record<string, unknown>[]> = fc.array(arbOpenSearchHit, {
  minLength: 0,
  maxLength: 20,
});

describe('Feature: opensearch-integration, Property 8: Autocomplete response schema conformance', () => {
  /**
   * **Validates: Requirements 6.4, 11.3**
   *
   * For any valid autocomplete prefix string of 2 or more characters and any
   * mock OpenSearch response, the formatted response SHALL conform to the
   * AutocompleteResponse Zod schema containing a `suggestions` array where
   * each element has `name`, `category`, and `productId` string fields.
   */

  it('formatted response always conforms to AutocompleteResponseSchema', () => {
    fc.assert(
      fc.property(arbPrefix, arbHitArray, (_prefix, hits) => {
        const response = formatAutocompleteResponse(hits);
        const parsed = AutocompleteResponseSchema.safeParse(response);

        expect(parsed.success).toBe(true);
      }),
    );
  });

  it('suggestions array length matches the number of input hits', () => {
    fc.assert(
      fc.property(arbPrefix, arbHitArray, (_prefix, hits) => {
        const response = formatAutocompleteResponse(hits);

        expect(response.suggestions).toHaveLength(hits.length);
      }),
    );
  });

  it('each suggestion has name, category, and productId string fields', () => {
    fc.assert(
      fc.property(arbPrefix, arbHitArray, (_prefix, hits) => {
        const response = formatAutocompleteResponse(hits);

        for (const suggestion of response.suggestions) {
          expect(typeof suggestion.name).toBe('string');
          expect(typeof suggestion.category).toBe('string');
          expect(typeof suggestion.productId).toBe('string');
        }
      }),
    );
  });

  it('preserves product data from OpenSearch hits into suggestion fields', () => {
    fc.assert(
      fc.property(arbPrefix, arbHitArray, (_prefix, hits) => {
        const response = formatAutocompleteResponse(hits);

        hits.forEach((hit, i) => {
          expect(response.suggestions[i].name).toBe(String(hit.productName ?? ''));
          expect(response.suggestions[i].category).toBe(String(hit.category ?? ''));
          expect(response.suggestions[i].productId).toBe(String(hit.productId ?? ''));
        });
      }),
    );
  });

  it('returns valid schema for empty hit array', () => {
    const response = formatAutocompleteResponse([]);
    const parsed = AutocompleteResponseSchema.safeParse(response);

    expect(parsed.success).toBe(true);
    expect(response.suggestions).toHaveLength(0);
  });
});
