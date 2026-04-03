/**
 * Property-Based Tests for WebSocket Message Schemas
 *
 * Uses fast-check to verify rich message content schemas and message type validation.
 * Each property runs a minimum of 100 iterations with randomly generated inputs.
 *
 * Properties tested:
 * - Property 10: Rich message content serialization round-trip
 * - Property 11: Message type and content schema validation
 */

import * as fc from 'fast-check';
import {
  MessageTypeSchema,
  TextContentSchema,
  ProductCardContentSchema,
  OrderStatusContentSchema,
  AISuggestionContentSchema,
  QuickReplyContentSchema,
  contentSchemaByType,
} from '../websocket-schemas';

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Generate valid TextContent. */
const arbTextContent = fc.record({
  body: fc.string({ minLength: 1, maxLength: 200 }),
});

/** Generate valid ProductCardContent. */
const arbProductCardContent = fc.record({
  productId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  price: fc.float({ min: 0, max: 99999, noNaN: true, noDefaultInfinity: true }),
  imageUrl: fc.webUrl(),
  sellerId: fc.uuid(),
  description: fc.string({ maxLength: 500 }),
});

/** Generate valid OrderStatusContent. */
const arbOrderStatusContent = fc.record({
  orderId: fc.uuid(),
  orderNumber: fc.string({ minLength: 1, maxLength: 30 }),
  status: fc.string({ minLength: 1, maxLength: 30 }),
  items: fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 50 }),
      quantity: fc.integer({ min: 1, max: 999 }),
    }),
    { minLength: 1, maxLength: 10 },
  ),
  totalAmount: fc.float({ min: 0, max: 999999, noNaN: true, noDefaultInfinity: true }),
  updatedAt: fc.date().map((d) => d.toISOString()),
});

/** Generate valid AISuggestionContent. */
const arbAISuggestionContent = fc.record({
  suggestionId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  body: fc.string({ minLength: 1, maxLength: 500 }),
  actionType: fc.string({ minLength: 1, maxLength: 50 }),
  actionPayload: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  ),
});

/** Generate valid QuickReplyContent. */
const arbQuickReplyContent = fc.record({
  prompt: fc.string({ minLength: 1, maxLength: 200 }),
  options: fc.array(
    fc.record({
      label: fc.string({ minLength: 1, maxLength: 50 }),
      value: fc.string({ minLength: 1, maxLength: 50 }),
    }),
    { minLength: 1, maxLength: 8 },
  ),
});

/** Map of messageType to its arbitrary generator. */
const contentArbitraryByType: Record<string, fc.Arbitrary<unknown>> = {
  text: arbTextContent,
  product_card: arbProductCardContent,
  order_status: arbOrderStatusContent,
  ai_suggestion: arbAISuggestionContent,
  quick_reply: arbQuickReplyContent,
};

/** All message types that have content schemas. */
const typesWithSchemas = Object.keys(contentSchemaByType);

/** All valid MessageType enum values. */
const allMessageTypes = MessageTypeSchema.options;

// =========================================================================
// Property 10: Rich message content serialization round-trip
// =========================================================================

describe('Property 10: Rich message content serialization round-trip', () => {
  /**
   * **Validates: Requirements 12.3**
   *
   * For any valid Rich_Message object (of type text, product_card,
   * order_status, ai_suggestion, or quick_reply), serializing the
   * content field to JSON and deserializing it back should produce
   * a deeply equal object.
   */

  it.each(typesWithSchemas)(
    'round-trip for %s content',
    (messageType) => {
      const arb = contentArbitraryByType[messageType]!;
      const schema = contentSchemaByType[messageType]!;

      fc.assert(
        fc.property(arb, (content) => {
          // Validate the generated content passes schema
          const parsed = schema.parse(content);

          // Serialize to JSON and deserialize back
          const serialized = JSON.stringify(parsed);
          const deserialized = JSON.parse(serialized);

          // Round-trip should produce deeply equal object
          expect(deserialized).toEqual(parsed);

          // Deserialized should also pass schema validation
          const reparsed = schema.parse(deserialized);
          expect(reparsed).toEqual(parsed);
        }),
        { numRuns: 100 },
      );
    },
  );
});

// =========================================================================
// Property 11: Message type and content schema validation
// =========================================================================

describe('Property 11: Message type and content schema validation', () => {
  /**
   * **Validates: Requirements 12.1, 12.2, 9.1, 10.1, 11.1, 11.3**
   *
   * For any messageType paired with conforming content, validation should
   * pass. For invalid types or missing fields, validation should fail.
   */

  it('valid messageType values are accepted by MessageTypeSchema', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allMessageTypes),
        (messageType) => {
          const result = MessageTypeSchema.safeParse(messageType);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('invalid messageType values are rejected by MessageTypeSchema', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => !(allMessageTypes as readonly string[]).includes(s),
        ),
        (invalidType) => {
          const result = MessageTypeSchema.safeParse(invalidType);
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it.each(typesWithSchemas)(
    'correct content validates for %s',
    (messageType) => {
      const arb = contentArbitraryByType[messageType]!;
      const schema = contentSchemaByType[messageType]!;

      fc.assert(
        fc.property(arb, (content) => {
          const result = schema.safeParse(content);
          expect(result.success).toBe(true);
        }),
        { numRuns: 100 },
      );
    },
  );

  it('wrong schema rejects wrong content type (strict mode)', () => {
    // Use .strict() to reject extra keys — this tests that each content type
    // has a distinct shape. Without strict, Zod allows extra keys by default,
    // so a superset object (e.g. ai_suggestion with body) could pass TextContentSchema.
    const strictSchemaByType: Record<string, import('zod').ZodTypeAny> = {
      text: TextContentSchema.strict(),
      product_card: ProductCardContentSchema.strict(),
      order_status: OrderStatusContentSchema.strict(),
      ai_suggestion: AISuggestionContentSchema.strict(),
      quick_reply: QuickReplyContentSchema.strict(),
    };

    const typePairs = typesWithSchemas.flatMap((type) =>
      typesWithSchemas
        .filter((other) => other !== type)
        .map((other) => ({ schemaType: type, contentType: other })),
    );

    fc.assert(
      fc.property(
        fc.constantFrom(...typePairs),
        (pair) => {
          const schema = strictSchemaByType[pair.schemaType]!;
          const wrongContent = buildMinimalContent(pair.contentType);

          const result = schema.safeParse(wrongContent);
          // With strict schemas, wrong content type should always fail
          // because it either has missing required fields or extra unrecognized fields
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('content with missing required fields fails validation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...typesWithSchemas),
        (messageType) => {
          const schema = contentSchemaByType[messageType]!;

          // Empty object should fail for all types
          const emptyResult = schema.safeParse({});
          expect(emptyResult.success).toBe(false);

          // null should fail
          const nullResult = schema.safeParse(null);
          expect(nullResult.success).toBe(false);

          // undefined should fail
          const undefinedResult = schema.safeParse(undefined);
          expect(undefinedResult.success).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid content object for a given messageType.
 * Used to test cross-type validation rejection.
 */
function buildMinimalContent(messageType: string): Record<string, unknown> {
  switch (messageType) {
    case 'text':
      return { body: 'hello' };
    case 'product_card':
      return {
        productId: 'p1',
        name: 'Product',
        price: 100,
        imageUrl: 'https://example.com/img.jpg',
        sellerId: 's1',
        description: 'A product',
      };
    case 'order_status':
      return {
        orderId: 'o1',
        orderNumber: 'ORD-001',
        status: 'shipped',
        items: [{ name: 'Item', quantity: 1 }],
        totalAmount: 500,
        updatedAt: new Date().toISOString(),
      };
    case 'ai_suggestion':
      return {
        suggestionId: 'sg1',
        title: 'Suggestion',
        body: 'Do this',
        actionType: 'approve',
        actionPayload: {},
      };
    case 'quick_reply':
      return {
        prompt: 'Choose one',
        options: [{ label: 'Yes', value: 'yes' }],
      };
    default:
      return {};
  }
}
