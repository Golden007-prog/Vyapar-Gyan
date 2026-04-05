/**
 * Property-Based Tests for Gemini Intent Extraction
 *
 * Uses fast-check to verify:
 * - P13: Store intent routes session to correct seller
 * - P14: Intent extraction response conforms to schema
 *
 * Feature: next-features
 */

import * as fc from 'fast-check';
import {
  validateIntentResponse,
  resolveIntentRouting,
  SUPPORTED_LANGUAGE_CODES,
  type IntentExtractionResult,
  type SellerMatch,
  type SupportedLanguageCode,
} from '../../services/intent-extraction';

// ── Generators ──────────────────────────────────────────────────────────

/** Arbitrary supported language code. */
const languageCodeArb: fc.Arbitrary<SupportedLanguageCode> = fc.constantFrom(
  ...SUPPORTED_LANGUAGE_CODES,
);

/** Arbitrary valid product action. */
const productActionArb = fc.constantFrom('search', 'buy', 'check_price', null);

/** Arbitrary product intent (all fields nullable). */
const productIntentArb = fc.record({
  name: fc.oneof(
    fc.constant(null),
    fc.string({ minLength: 1, maxLength: 80 }).filter(s => s.trim().length > 0),
  ),
  quantity: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 1000 })),
  action: productActionArb,
});

/** Arbitrary store intent (name nullable). */
const storeIntentArb = fc.record({
  name: fc.oneof(
    fc.constant(null),
    fc.string({ minLength: 1, maxLength: 80 }).filter(s => s.trim().length > 0),
  ),
});

/** Arbitrary well-formed IntentExtractionResult. */
const intentResultArb: fc.Arbitrary<IntentExtractionResult> = fc.record({
  product: productIntentArb,
  store: storeIntentArb,
  language: languageCodeArb,
});

/** Arbitrary seller match. */
const sellerMatchArb: fc.Arbitrary<SellerMatch> = fc.record({
  sellerId: fc.uuid(),
  storeName: fc.string({ minLength: 1, maxLength: 80 }).filter(s => s.trim().length > 0),
});

/** Arbitrary nullable seller match. */
const nullableSellerMatchArb: fc.Arbitrary<SellerMatch | null> = fc.oneof(
  fc.constant(null),
  sellerMatchArb,
);

/**
 * Arbitrary raw Gemini response object — may have messy/missing fields.
 * Used to test that validateIntentResponse handles any shape gracefully.
 */
const rawGeminiResponseArb = fc.oneof(
  // Well-formed response
  fc.record({
    product: fc.record({
      name: fc.oneof(fc.constant(null), fc.string({ minLength: 0, maxLength: 80 })),
      quantity: fc.oneof(fc.constant(null), fc.integer({ min: -5, max: 1000 })),
      action: fc.oneof(
        fc.constant(null),
        fc.constantFrom('search', 'buy', 'check_price'),
        fc.string({ minLength: 0, maxLength: 20 }), // invalid actions
      ),
    }),
    store: fc.record({
      name: fc.oneof(fc.constant(null), fc.string({ minLength: 0, maxLength: 80 })),
    }),
    language: fc.oneof(
      fc.constantFrom('en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn'),
      fc.string({ minLength: 0, maxLength: 10 }), // invalid language codes
    ),
  }),
  // Partially missing fields
  fc.record({
    product: fc.oneof(fc.constant(null), fc.constant(undefined), fc.record({
      name: fc.oneof(fc.constant(null), fc.string()),
    })),
    language: fc.oneof(fc.constant(undefined), fc.string()),
  }),
  // Completely empty / wrong type
  fc.oneof(
    fc.constant({}),
    fc.constant(null),
    fc.constant(42),
    fc.constant('not an object'),
  ),
);

// ── Property Tests ──────────────────────────────────────────────────────

describe('Property 13: Store intent routes session to correct seller', () => {
  /**
   * **Validates: Requirement 9.2**
   *
   * For any detected store name matching a seller, session routes to that
   * seller's catalog context with correct sellerId.
   */
  it('routes to matched seller when store intent is detected and seller exists', () => {
    fc.assert(
      fc.property(
        intentResultArb.filter(i => i.store.name !== null),
        sellerMatchArb,
        (intent, seller) => {
          const result = resolveIntentRouting(intent, seller);

          expect(result.routing.type).toBe('store_match');
          expect(result.routing.seller).toBeDefined();
          expect(result.routing.seller!.sellerId).toBe(seller.sellerId);
          expect(result.routing.seller!.storeName).toBe(seller.storeName);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 9.2**
   *
   * When store intent is detected but no seller match is found,
   * falls back to product search or no_intent.
   */
  it('falls back when store intent detected but no seller match', () => {
    fc.assert(
      fc.property(
        intentResultArb.filter(i => i.store.name !== null),
        (intent) => {
          const result = resolveIntentRouting(intent, null);

          // Should NOT be store_match since no seller was found
          expect(result.routing.type).not.toBe('store_match');
          expect(result.routing.seller).toBeUndefined();

          // If product name exists, should be product_search; otherwise no_intent
          if (intent.product.name) {
            expect(result.routing.type).toBe('product_search');
          } else {
            expect(result.routing.type).toBe('no_intent');
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 9.3**
   *
   * Product intent without store → search all sellers.
   */
  it('routes to product_search when product intent exists without store', () => {
    fc.assert(
      fc.property(
        intentResultArb.filter(i => i.store.name === null && i.product.name !== null),
        (intent) => {
          const result = resolveIntentRouting(intent, null);

          expect(result.routing.type).toBe('product_search');
          expect(result.routing.searchQuery).toBe(intent.product.name);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 9.2**
   *
   * The intent result is always preserved in the routing result.
   */
  it('preserves the original intent in the routing result', () => {
    fc.assert(
      fc.property(intentResultArb, nullableSellerMatchArb, (intent, seller) => {
        const result = resolveIntentRouting(intent, seller);

        expect(result.intent).toEqual(intent);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 9.2**
   *
   * No intent (both product and store null) → no_intent routing.
   */
  it('returns no_intent when both product and store are null', () => {
    fc.assert(
      fc.property(languageCodeArb, (lang) => {
        const intent: IntentExtractionResult = {
          product: { name: null, quantity: null, action: null },
          store: { name: null },
          language: lang,
        };
        const result = resolveIntentRouting(intent, null);

        expect(result.routing.type).toBe('no_intent');
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 14: Intent extraction response conforms to schema', () => {
  /**
   * **Validates: Requirement 9.6**
   *
   * For any Gemini intent extraction JSON response, parsed result contains:
   * product (name, quantity, action — each nullable), store (name — nullable),
   * language (one of 8 supported codes).
   */
  it('validates any raw response into a conforming IntentExtractionResult', () => {
    fc.assert(
      fc.property(rawGeminiResponseArb, (raw) => {
        const result = validateIntentResponse(raw);

        // product must exist with correct shape
        expect(result.product).toBeDefined();
        expect(result.product.name === null || typeof result.product.name === 'string').toBe(true);
        expect(result.product.quantity === null || typeof result.product.quantity === 'number').toBe(true);
        expect(
          result.product.action === null ||
          ['search', 'buy', 'check_price'].includes(result.product.action),
        ).toBe(true);

        // store must exist with correct shape
        expect(result.store).toBeDefined();
        expect(result.store.name === null || typeof result.store.name === 'string').toBe(true);

        // language must be one of the 8 supported codes
        expect(SUPPORTED_LANGUAGE_CODES).toContain(result.language);
      }),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirement 9.6**
   *
   * Well-formed responses preserve their values through validation.
   */
  it('preserves valid values from well-formed responses', () => {
    fc.assert(
      fc.property(intentResultArb, (intent) => {
        // Construct a raw object matching the intent
        const raw = {
          product: {
            name: intent.product.name,
            quantity: intent.product.quantity,
            action: intent.product.action,
          },
          store: { name: intent.store.name },
          language: intent.language,
        };

        const result = validateIntentResponse(raw);

        // Values are preserved (names are trimmed by the validator)
        const expectedProductName = intent.product.name?.trim() || null;
        const expectedStoreName = intent.store.name?.trim() || null;
        expect(result.product.name).toBe(
          expectedProductName && expectedProductName.length > 0 ? expectedProductName : null,
        );
        expect(result.product.quantity).toBe(intent.product.quantity);
        expect(result.product.action).toBe(intent.product.action);
        expect(result.store.name).toBe(
          expectedStoreName && expectedStoreName.length > 0 ? expectedStoreName : null,
        );
        expect(result.language).toBe(intent.language);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 9.6**
   *
   * Invalid language codes default to 'en'.
   */
  it('defaults to en for invalid language codes', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter(
          s => !(SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(s.toLowerCase()),
        ),
        (invalidLang) => {
          const raw = {
            product: { name: null, quantity: null, action: null },
            store: { name: null },
            language: invalidLang,
          };

          const result = validateIntentResponse(raw);
          expect(result.language).toBe('en');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 9.6**
   *
   * Negative or zero quantities are normalized to null.
   */
  it('normalizes invalid quantities to null', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 0 }),
        (invalidQty) => {
          const raw = {
            product: { name: 'test', quantity: invalidQty, action: 'search' },
            store: { name: null },
            language: 'en',
          };

          const result = validateIntentResponse(raw);
          expect(result.product.quantity).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirement 9.6**
   *
   * Invalid action strings are normalized to null.
   */
  it('normalizes invalid actions to null', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(
          s => !['search', 'buy', 'check_price'].includes(s),
        ),
        (invalidAction) => {
          const raw = {
            product: { name: 'test', quantity: 1, action: invalidAction },
            store: { name: null },
            language: 'en',
          };

          const result = validateIntentResponse(raw);
          expect(result.product.action).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
