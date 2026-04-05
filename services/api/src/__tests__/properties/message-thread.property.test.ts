/**
 * Property-Based Tests for Message Thread — Unified Channel Storage
 *
 * Uses fast-check to verify:
 *   Property 10: Message thread query returns all channels in chronological order
 *   Property 11: Message deduplication prevents duplicate storage
 *
 * Feature: next-features
 * Test file: services/api/src/__tests__/properties/message-thread.property.test.ts
 */

import * as fc from 'fast-check';

// ── Types (mirroring dynamodb-adapter MessageThread) ──────────────────

type MessageChannel = 'whatsapp' | 'web' | 'system';

interface ThreadMessage {
  userId: string;
  messageId: string;
  channel: MessageChannel;
  createdAt: string; // ISO 8601
  content: string;
  direction: 'inbound' | 'outbound';
  senderRole: 'customer' | 'seller' | 'system';
  messageType: string;
  deliveryStatus: string;
}

// ── Pure logic under test ─────────────────────────────────────────────

/**
 * Simulates the DynamoDB sort key pattern: THREAD#{userId} / MSG#{timestamp}#{messageId}
 * Messages are sorted by their SK which is timestamp-prefixed, so chronological order
 * is guaranteed regardless of channel.
 */
function buildSortKey(msg: ThreadMessage): string {
  return `MSG#${msg.createdAt}#${msg.messageId}`;
}

/**
 * Simulates querying a thread and sorting by SK (ascending = chronological).
 * This is the core behavior of queryMessages in dynamodb-adapter.ts.
 */
function queryThreadChronological(messages: ThreadMessage[]): ThreadMessage[] {
  return [...messages].sort((a, b) => {
    const skA = buildSortKey(a);
    const skB = buildSortKey(b);
    return skA.localeCompare(skB);
  });
}

/**
 * Simulates deduplication via conditional PutItem with messageId.
 * In DynamoDB, the SK includes the messageId, so a second put with the same
 * messageId and timestamp overwrites the first — resulting in exactly one record.
 */
function storeWithDeduplication(
  store: Map<string, ThreadMessage>,
  msg: ThreadMessage,
): void {
  const sk = buildSortKey(msg);
  // PutItem is idempotent — same SK overwrites, no duplicate
  store.set(sk, msg);
}

// ── Generators ────────────────────────────────────────────────────────

const channelArb: fc.Arbitrary<MessageChannel> = fc.constantFrom('whatsapp', 'web', 'system');

const directionArb = fc.constantFrom('inbound' as const, 'outbound' as const);

const senderRoleArb = fc.constantFrom('customer' as const, 'seller' as const, 'system' as const);

/**
 * Generate a timestamp within a realistic range.
 * Uses epoch millis to ensure unique, sortable ISO strings.
 */
const timestampArb = fc
  .integer({ min: 1700000000000, max: 1710000000000 })
  .map((ms) => new Date(ms).toISOString());

const messageArb: fc.Arbitrary<ThreadMessage> = fc.record({
  userId: fc.constant('user-test-123'),
  messageId: fc.uuid(),
  channel: channelArb,
  createdAt: timestampArb,
  content: fc.string({ minLength: 1, maxLength: 200 }),
  direction: directionArb,
  senderRole: senderRoleArb,
  messageType: fc.constantFrom('text', 'image', 'audio', 'system'),
  deliveryStatus: fc.constantFrom('sent', 'delivered', 'read'),
});

// ── Property Tests ────────────────────────────────────────────────────

describe('Message Thread Properties', () => {
  /**
   * **Validates: Requirement 7.4**
   *
   * Property 10: Message thread query returns all channels in chronological order
   *
   * For any set of messages across channels (whatsapp, web, system) with varying
   * timestamps, querying the thread returns all messages sorted by timestamp
   * ascending regardless of channel.
   */
  it('P10: thread query returns all channels in chronological order', () => {
    fc.assert(
      fc.property(
        fc.array(messageArb, { minLength: 1, maxLength: 50 }),
        (messages) => {
          const result = queryThreadChronological(messages);

          // All input messages are present in the result
          expect(result.length).toBe(messages.length);

          // All three channel types that appear in input appear in output
          const inputChannels = new Set(messages.map((m) => m.channel));
          const outputChannels = new Set(result.map((m) => m.channel));
          expect(outputChannels).toEqual(inputChannels);

          // Result is sorted by createdAt (chronological ascending)
          for (let i = 1; i < result.length; i++) {
            const skPrev = buildSortKey(result[i - 1]);
            const skCurr = buildSortKey(result[i]);
            expect(skPrev <= skCurr).toBe(true);
          }

          // Every message from every channel is included (no channel filtering)
          for (const channel of ['whatsapp', 'web', 'system'] as MessageChannel[]) {
            const inputCount = messages.filter((m) => m.channel === channel).length;
            const outputCount = result.filter((m) => m.channel === channel).length;
            expect(outputCount).toBe(inputCount);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirement 7.6**
   *
   * Property 11: Message deduplication prevents duplicate storage
   *
   * For any message with a given messageId, storing it twice results in exactly
   * one record (idempotent write).
   */
  it('P11: deduplication prevents duplicate storage', () => {
    fc.assert(
      fc.property(
        messageArb,
        fc.integer({ min: 2, max: 5 }),
        (message, duplicateCount) => {
          const store = new Map<string, ThreadMessage>();

          // Store the same message multiple times
          for (let i = 0; i < duplicateCount; i++) {
            storeWithDeduplication(store, message);
          }

          // Exactly one record exists
          expect(store.size).toBe(1);

          // The stored record matches the original message
          const stored = Array.from(store.values())[0];
          expect(stored.messageId).toBe(message.messageId);
          expect(stored.channel).toBe(message.channel);
          expect(stored.createdAt).toBe(message.createdAt);
          expect(stored.content).toBe(message.content);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Additional edge case: mixed channels with identical timestamps still
   * produce a deterministic order (sorted by messageId as tiebreaker).
   */
  it('P10 edge: identical timestamps across channels produce deterministic order', () => {
    fc.assert(
      fc.property(
        timestampArb,
        fc.array(
          fc.record({
            channel: channelArb,
            messageId: fc.uuid(),
          }),
          { minLength: 2, maxLength: 10 },
        ),
        (sharedTimestamp, msgSpecs) => {
          const messages: ThreadMessage[] = msgSpecs.map((spec) => ({
            userId: 'user-test-123',
            messageId: spec.messageId,
            channel: spec.channel,
            createdAt: sharedTimestamp,
            content: 'test',
            direction: 'inbound' as const,
            senderRole: 'customer' as const,
            messageType: 'text',
            deliveryStatus: 'sent',
          }));

          const result = queryThreadChronological(messages);

          // All messages present
          expect(result.length).toBe(messages.length);

          // Still sorted (by SK which includes messageId as tiebreaker)
          for (let i = 1; i < result.length; i++) {
            const skPrev = buildSortKey(result[i - 1]);
            const skCurr = buildSortKey(result[i]);
            expect(skPrev <= skCurr).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Additional: storing messages with different messageIds but same content
   * should result in separate records (not deduplicated).
   */
  it('P11 edge: different messageIds are stored separately', () => {
    fc.assert(
      fc.property(
        fc.array(messageArb, { minLength: 2, maxLength: 10 }),
        (messages) => {
          const store = new Map<string, ThreadMessage>();

          for (const msg of messages) {
            storeWithDeduplication(store, msg);
          }

          // Each unique SK should be stored
          const uniqueSKs = new Set(messages.map(buildSortKey));
          expect(store.size).toBe(uniqueSKs.size);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ── Fan-out Types & Pure Logic ────────────────────────────────────────

type ActiveChannel = 'whatsapp' | 'web';

interface MessageCreatedEvent {
  messageId: string;
  senderUserId: string;
  senderType: 'customer' | 'seller' | 'system';
  recipientUserId: string;
  channel: ActiveChannel; // originating channel
  content: string;
}

/**
 * Pure implementation of the fan-out channel filtering logic from
 * services/api/src/handlers/messaging/fanout.ts — filterOriginatingChannel.
 *
 * Given the recipient's active channels and the originating channel,
 * returns the set of channels to push to (all active minus originator).
 */
function filterOriginatingChannel(
  activeChannels: ActiveChannel[],
  originatingChannel: string,
): ActiveChannel[] {
  return activeChannels.filter((ch) => ch !== originatingChannel);
}

// ── Fan-out Generators ────────────────────────────────────────────────

const activeChannelArb: fc.Arbitrary<ActiveChannel> = fc.constantFrom('whatsapp', 'web');

/**
 * Generate a non-empty subset of active channels for a recipient.
 */
const activeChannelsArb: fc.Arbitrary<ActiveChannel[]> = fc
  .subarray(['whatsapp', 'web'] as ActiveChannel[], { minLength: 1 })
  .map((arr) => [...new Set(arr)]);

const messageCreatedArb: fc.Arbitrary<MessageCreatedEvent> = fc.record({
  messageId: fc.uuid(),
  senderUserId: fc.uuid(),
  senderType: fc.constantFrom('customer' as const, 'seller' as const, 'system' as const),
  recipientUserId: fc.uuid(),
  channel: activeChannelArb,
  content: fc.string({ minLength: 1, maxLength: 200 }),
});

// ── Fan-out Property Tests ────────────────────────────────────────────

describe('Fan-out Properties', () => {
  /**
   * **Validates: Requirement 8.4**
   *
   * Property 12: Fan-out routes to all active channels except originator
   *
   * For any message.created event with an originating channel and a set of
   * recipient active channels, the fan-out pushes to every active channel
   * EXCEPT the originating channel (no echo).
   */
  it('P12: fan-out routes to all active channels except originator', () => {
    fc.assert(
      fc.property(
        messageCreatedArb,
        activeChannelsArb,
        (event, recipientActiveChannels) => {
          const targetChannels = filterOriginatingChannel(
            recipientActiveChannels,
            event.channel,
          );

          // 1. Originating channel is never in the target list
          expect(targetChannels).not.toContain(event.channel);

          // 2. Every active channel that is NOT the originator IS in the target list
          for (const ch of recipientActiveChannels) {
            if (ch !== event.channel) {
              expect(targetChannels).toContain(ch);
            }
          }

          // 3. Target channels are a subset of active channels
          for (const ch of targetChannels) {
            expect(recipientActiveChannels).toContain(ch);
          }

          // 4. Count check: target = active - (1 if originator is active, else 0)
          const originatorIsActive = recipientActiveChannels.includes(event.channel);
          const expectedCount = originatorIsActive
            ? recipientActiveChannels.length - 1
            : recipientActiveChannels.length;
          expect(targetChannels.length).toBe(expectedCount);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * P12 edge: when recipient has only the originating channel active,
   * fan-out produces an empty target list (no push at all).
   */
  it('P12 edge: single active channel matching originator yields empty target', () => {
    fc.assert(
      fc.property(
        activeChannelArb,
        (channel) => {
          const targetChannels = filterOriginatingChannel([channel], channel);
          expect(targetChannels).toHaveLength(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * P12 edge: when recipient has both channels active and message originates
   * from one, exactly the other channel is targeted.
   */
  it('P12 edge: both channels active, originator excluded, other targeted', () => {
    fc.assert(
      fc.property(
        activeChannelArb,
        (originChannel) => {
          const allChannels: ActiveChannel[] = ['whatsapp', 'web'];
          const targetChannels = filterOriginatingChannel(allChannels, originChannel);

          expect(targetChannels).toHaveLength(1);
          expect(targetChannels[0]).not.toBe(originChannel);

          const expected = originChannel === 'whatsapp' ? 'web' : 'whatsapp';
          expect(targetChannels[0]).toBe(expected);
        },
      ),
      { numRuns: 50 },
    );
  });
});
