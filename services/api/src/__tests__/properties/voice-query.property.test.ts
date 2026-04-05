/**
 * Property-Based Tests for Voice-Activated Financial Reports
 *
 * Uses fast-check to verify financial query pipeline invariants.
 * Each property runs at least 100 iterations.
 *
 * Properties P27–P28 defined in the design document.
 */

// Mock logger before any imports
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import * as fc from 'fast-check';
import {
  QUERY_MAP,
  RESPONSE_TEMPLATES,
  SUPPORTED_LANGUAGES,
  VALID_INTENTS,
  formatFinancialResponse,
  type FinancialIntent,
  type SupportedLanguage,
  type QueryResult,
  type TimeRange,
} from '../../services/financial-query';

// ── Generators ──────────────────────────────────────────────────────────

/** Arbitrary valid financial intent (excludes 'unknown'). */
const validIntentArb: fc.Arbitrary<FinancialIntent> = fc.constantFrom(
  ...VALID_INTENTS,
);

/** Arbitrary supported language code. */
const languageArb: fc.Arbitrary<SupportedLanguage> = fc.constantFrom(
  ...SUPPORTED_LANGUAGES,
);

/** Arbitrary time range. */
const timeRangeArb: fc.Arbitrary<TimeRange> = fc.record({
  type: fc.constantFrom('today', 'this_week', 'this_month', 'last_month', 'custom') as fc.Arbitrary<TimeRange['type']>,
  startDate: fc.constantFrom(null, '2024-01-01', '2024-06-15'),
  endDate: fc.constantFrom(null, '2024-12-31', '2024-07-15'),
});

/** Arbitrary positive amount for financial results. */
const amountArb = fc.integer({ min: 0, max: 10_000_000 });

/** Arbitrary order count. */
const countArb = fc.integer({ min: 0, max: 10_000 });

// ── Property 27: Financial query intent maps to correct DynamoDB query ──

describe('Property 27: Financial query intent maps to correct DynamoDB query', () => {
  /**
   * **Validates: Requirement 22.3**
   *
   * For any valid intent ∈ {daily_sales, weekly_revenue, monthly_revenue,
   * best_sellers, pending_orders, stock_summary}, the QUERY_MAP contains
   * a corresponding query function.
   */
  it('every valid intent has a corresponding query function in QUERY_MAP', () => {
    fc.assert(
      fc.property(validIntentArb, (intent) => {
        const queryFn = QUERY_MAP[intent];
        expect(queryFn).toBeDefined();
        expect(typeof queryFn).toBe('function');
      }),
      { numRuns: 100 },
    );
  });

  it('QUERY_MAP functions accept sellerId and timeRange parameters', () => {
    fc.assert(
      fc.property(validIntentArb, timeRangeArb, (intent, timeRange) => {
        const queryFn = QUERY_MAP[intent];
        // Verify the function signature: it should accept 2 parameters
        expect(queryFn.length).toBe(2);
        // Verify it returns a promise (async function)
        // We can't actually call it without DynamoDB, but we verify it's callable
        expect(typeof queryFn).toBe('function');
      }),
      { numRuns: 100 },
    );
  });

  it('QUERY_MAP covers exactly all valid intents', () => {
    fc.assert(
      fc.property(validIntentArb, (intent) => {
        // Every valid intent must be in QUERY_MAP
        expect(intent in QUERY_MAP).toBe(true);
      }),
      { numRuns: 100 },
    );

    // Also verify no extra keys beyond valid intents
    const queryMapKeys = Object.keys(QUERY_MAP);
    for (const key of queryMapKeys) {
      expect(VALID_INTENTS).toContain(key);
    }
  });

  it('QUERY_MAP does not contain unknown intent', () => {
    expect(QUERY_MAP['unknown']).toBeUndefined();
  });
});

// ── Property 28: Financial response formatted in detected language ──────

describe('Property 28: Financial response formatted in detected language', () => {
  /**
   * **Validates: Requirements 22.4, 22.6**
   *
   * For any query result and detected language ∈ {en, hi, ta, te, mr, bn, gu, kn},
   * the formatted response uses the correct language template and contains
   * numeric values from the query result.
   */

  it('daily_sales response contains amount and count in any language', () => {
    fc.assert(
      fc.property(languageArb, amountArb, countArb, (lang, amount, count) => {
        const result: QueryResult = { amount, count };
        const response = formatFinancialResponse('daily_sales', lang, result);

        // Response must be a non-empty string
        expect(response.length).toBeGreaterThan(0);

        // Response must contain the formatted amount
        const formattedAmount = amount.toLocaleString('en-IN');
        expect(response).toContain(formattedAmount);

        // Response must contain the count
        const formattedCount = count.toLocaleString('en-IN');
        expect(response).toContain(formattedCount);
      }),
      { numRuns: 200 },
    );
  });

  it('weekly_revenue response contains amount, count, and avg in any language', () => {
    fc.assert(
      fc.property(languageArb, amountArb, countArb, (lang, amount, count) => {
        const avg = count > 0 ? Math.round(amount / count) : 0;
        const result: QueryResult = { amount, count, avg };
        const response = formatFinancialResponse('weekly_revenue', lang, result);

        expect(response.length).toBeGreaterThan(0);
        expect(response).toContain(amount.toLocaleString('en-IN'));
        expect(response).toContain(count.toLocaleString('en-IN'));
        expect(response).toContain(avg.toLocaleString('en-IN'));
      }),
      { numRuns: 200 },
    );
  });

  it('monthly_revenue response contains amount, count, commission, and net in any language', () => {
    fc.assert(
      fc.property(languageArb, amountArb, countArb, (lang, amount, count) => {
        const commission = Math.round(amount * 0.15);
        const net = amount - commission;
        const result: QueryResult = { amount, count, commission, net };
        const response = formatFinancialResponse('monthly_revenue', lang, result);

        expect(response.length).toBeGreaterThan(0);
        expect(response).toContain(amount.toLocaleString('en-IN'));
        expect(response).toContain(count.toLocaleString('en-IN'));
        expect(response).toContain(commission.toLocaleString('en-IN'));
        expect(response).toContain(net.toLocaleString('en-IN'));
      }),
      { numRuns: 200 },
    );
  });

  it('pending_orders response contains count and amount in any language', () => {
    fc.assert(
      fc.property(languageArb, amountArb, countArb, (lang, amount, count) => {
        const result: QueryResult = { count, amount };
        const response = formatFinancialResponse('pending_orders', lang, result);

        expect(response.length).toBeGreaterThan(0);
        expect(response).toContain(count.toLocaleString('en-IN'));
        expect(response).toContain(amount.toLocaleString('en-IN'));
      }),
      { numRuns: 200 },
    );
  });

  it('stock_summary response contains all stock metrics in any language', () => {
    fc.assert(
      fc.property(
        languageArb,
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        amountArb,
        (lang, totalProducts, lowStock, outOfStock, totalValue) => {
          const result: QueryResult = { totalProducts, lowStock, outOfStock, totalValue };
          const response = formatFinancialResponse('stock_summary', lang, result);

          expect(response.length).toBeGreaterThan(0);
          expect(response).toContain(totalProducts.toLocaleString('en-IN'));
          expect(response).toContain(lowStock.toLocaleString('en-IN'));
          expect(response).toContain(outOfStock.toLocaleString('en-IN'));
          expect(response).toContain(totalValue.toLocaleString('en-IN'));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('every valid intent has templates for all 8 supported languages', () => {
    fc.assert(
      fc.property(validIntentArb, languageArb, (intent, lang) => {
        const templates = RESPONSE_TEMPLATES[intent];
        expect(templates).toBeDefined();
        expect(templates[lang]).toBeDefined();
        expect(typeof templates[lang]).toBe('string');
        expect(templates[lang].length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it('unknown intent returns a helpful message in any language', () => {
    fc.assert(
      fc.property(languageArb, (lang) => {
        const response = formatFinancialResponse('unknown', lang, {});
        expect(response.length).toBeGreaterThan(0);
        // The unknown template should exist for all languages
        expect(RESPONSE_TEMPLATES.unknown[lang]).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it('response uses correct language template (not English) when non-English language specified', () => {
    fc.assert(
      fc.property(
        validIntentArb,
        fc.constantFrom('hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn') as fc.Arbitrary<SupportedLanguage>,
        amountArb,
        countArb,
        (intent, lang, amount, count) => {
          // Build a result that works for any intent
          const result: QueryResult = {
            amount, count, avg: 0, commission: 0, net: 0,
            totalProducts: count, lowStock: 0, outOfStock: 0, totalValue: amount,
            products: 'test',
          };
          const response = formatFinancialResponse(intent, lang, result);
          const enResponse = formatFinancialResponse(intent, 'en', result);

          // Non-English response should differ from English (different script)
          // unless the template happens to be identical (unlikely for different scripts)
          if (RESPONSE_TEMPLATES[intent][lang] !== RESPONSE_TEMPLATES[intent].en) {
            expect(response).not.toBe(enResponse);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
