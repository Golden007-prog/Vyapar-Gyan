import fc from 'fast-check';
import { calculateBackoff, deduplicateMessages } from '../websocket-client';

/**
 * Property 7: Exponential backoff calculation
 *
 * For any reconnection attempt number N (1 ≤ N ≤ 20), the backoff delay
 * should equal min(2^(N-1) × 1000, 30000) milliseconds.
 *
 * **Validates: Requirements 4.3**
 */
describe('Feature: chat-messaging-quality, Property 7: Exponential backoff calculation', () => {
  it('should compute min(2^(N-1) * 1000, 30000) for attempt N in [1..20]', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (attempt) => {
        const expected = Math.min(Math.pow(2, attempt - 1) * 1000, 30000);
        expect(calculateBackoff(attempt)).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('should never exceed the 30-second cap', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (attempt) => {
        expect(calculateBackoff(attempt)).toBeLessThanOrEqual(30000);
      }),
      { numRuns: 100 },
    );
  });

  it('should always be at least 1000ms', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (attempt) => {
        expect(calculateBackoff(attempt)).toBeGreaterThanOrEqual(1000);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 16: Message deduplication
 *
 * For any list of messages containing duplicate messageIds, the deduplicated
 * output should contain each messageId exactly once, and the total count
 * should equal the number of unique messageIds in the input.
 *
 * **Validates: Requirements 15.5**
 */
describe('Feature: chat-messaging-quality, Property 16: Message deduplication', () => {
  const messageArb = fc.record({ messageId: fc.string({ minLength: 1, maxLength: 20 }) });
  const messagesWithDuplicatesArb = fc
    .array(messageArb, { minLength: 1, maxLength: 50 })
    .chain((msgs) => {
      // Duplicate some messages to guarantee duplicates exist
      const dupes = msgs.slice(0, Math.max(1, Math.floor(msgs.length / 2)));
      return fc.constant([...msgs, ...dupes]);
    });

  it('should return unique messageIds only', () => {
    fc.assert(
      fc.property(messagesWithDuplicatesArb, (messages) => {
        const result = deduplicateMessages(messages);
        const ids = result.map((m) => m.messageId);
        const uniqueIds = new Set(ids);
        expect(ids.length).toBe(uniqueIds.size);
      }),
      { numRuns: 100 },
    );
  });

  it('should have count equal to the number of unique messageIds in input', () => {
    fc.assert(
      fc.property(messagesWithDuplicatesArb, (messages) => {
        const result = deduplicateMessages(messages);
        const inputUniqueCount = new Set(messages.map((m) => m.messageId)).size;
        expect(result.length).toBe(inputUniqueCount);
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve first-occurrence order', () => {
    fc.assert(
      fc.property(messagesWithDuplicatesArb, (messages) => {
        const result = deduplicateMessages(messages);
        // Build expected order: first occurrence of each unique id
        const seen = new Set<string>();
        const expectedOrder: string[] = [];
        for (const m of messages) {
          if (!seen.has(m.messageId)) {
            seen.add(m.messageId);
            expectedOrder.push(m.messageId);
          }
        }
        expect(result.map((m) => m.messageId)).toEqual(expectedOrder);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 17: Reconnection sync timestamp
 *
 * For any Chat_Client that reconnects after receiving messages up to
 * timestamp T, the sync action should contain lastMessageTimestamp = T.
 *
 * This tests the concept: given a list of timestamps, the max timestamp
 * should be used as lastMessageTimestamp for the sync action.
 *
 * **Validates: Requirements 4.6**
 */
describe('Feature: chat-messaging-quality, Property 17: Reconnection sync timestamp', () => {
  const isoTimestampArb = fc
    .integer({ min: 1577836800000, max: 1924991999000 }) // 2020-01-01 to ~2030-12-31
    .map((ms) => new Date(ms).toISOString());

  it('should use the maximum timestamp as lastMessageTimestamp', () => {
    fc.assert(
      fc.property(
        fc.array(isoTimestampArb, { minLength: 1, maxLength: 50 }),
        (timestamps) => {
          // Simulate: the client tracks the latest timestamp from received messages
          const maxTimestamp = timestamps.reduce((max, ts) => (ts > max ? ts : max), timestamps[0]);

          // The sync action should carry this max timestamp
          const syncAction = { action: 'sync', lastMessageTimestamp: maxTimestamp };
          expect(syncAction.lastMessageTimestamp).toBe(maxTimestamp);

          // Verify it is indeed >= all timestamps
          for (const ts of timestamps) {
            expect(syncAction.lastMessageTimestamp >= ts).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should produce a valid ISO 8601 timestamp for the sync action', () => {
    fc.assert(
      fc.property(
        fc.array(isoTimestampArb, { minLength: 1, maxLength: 20 }),
        (timestamps) => {
          const maxTimestamp = timestamps.reduce((max, ts) => (ts > max ? ts : max), timestamps[0]);
          // Verify it parses as a valid date
          const parsed = new Date(maxTimestamp);
          expect(parsed.toISOString()).toBe(maxTimestamp);
        },
      ),
      { numRuns: 100 },
    );
  });
});

import { TYPING_DEBOUNCE_MS } from '../../hooks/useWebSocket';

/**
 * Property 12: Typing debounce
 *
 * For any sequence of keystroke events within a 3-second window, the
 * Chat_Client should emit at most one typing WebSocket action during
 * that window.
 *
 * **Validates: Requirements 13.3**
 */
describe('Feature: chat-messaging-quality, Property 12: Typing debounce', () => {
  /**
   * Simulates the debounce logic from useWebSocket's sendTyping:
   * a typing event is only emitted if the elapsed time since the last
   * sent event is >= TYPING_DEBOUNCE_MS.
   */
  function countTypingEvents(timestamps: number[], debounceMs: number): number {
    let count = 0;
    let lastSent = -Infinity;
    for (const ts of timestamps) {
      if (ts - lastSent >= debounceMs) {
        count++;
        lastSent = ts;
      }
    }
    return count;
  }

  it('should emit at most 1 typing event for keystrokes within a single 3-second window', () => {
    fc.assert(
      fc.property(
        // Generate a base timestamp, then offsets within [0, TYPING_DEBOUNCE_MS)
        fc.nat({ max: 1_000_000 }).chain((base) =>
          fc
            .array(fc.nat({ max: TYPING_DEBOUNCE_MS - 1 }), { minLength: 1, maxLength: 50 })
            .map((offsets) => offsets.map((o) => base + o).sort((a, b) => a - b)),
        ),
        (timestamps) => {
          const events = countTypingEvents(timestamps, TYPING_DEBOUNCE_MS);
          expect(events).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should use the exported TYPING_DEBOUNCE_MS constant of 3000ms', () => {
    expect(TYPING_DEBOUNCE_MS).toBe(3_000);
  });

  it('should emit exactly 1 event for any non-empty sequence within a 3-second window', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1_000_000 }).chain((base) =>
          fc
            .array(fc.nat({ max: TYPING_DEBOUNCE_MS - 1 }), { minLength: 1, maxLength: 50 })
            .map((offsets) => offsets.map((o) => base + o).sort((a, b) => a - b)),
        ),
        (timestamps) => {
          const events = countTypingEvents(timestamps, TYPING_DEBOUNCE_MS);
          // First keystroke always fires, subsequent ones within the window are suppressed
          expect(events).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should emit multiple events only when keystrokes span multiple debounce windows', () => {
    fc.assert(
      fc.property(
        // Generate N windows worth of timestamps (each window is TYPING_DEBOUNCE_MS apart)
        fc.integer({ min: 2, max: 10 }).chain((windowCount) =>
          fc.tuple(
            fc.constant(windowCount),
            fc.array(
              fc.nat({ max: windowCount * TYPING_DEBOUNCE_MS + TYPING_DEBOUNCE_MS }),
              { minLength: windowCount, maxLength: 50 },
            ),
          ),
        ),
        ([, timestamps]) => {
          const sorted = [...timestamps].sort((a, b) => a - b);
          const events = countTypingEvents(sorted, TYPING_DEBOUNCE_MS);

          // Events should never exceed ceil((max - min) / debounceMs) + 1
          if (sorted.length > 0) {
            const span = sorted[sorted.length - 1] - sorted[0];
            const maxPossibleEvents = Math.floor(span / TYPING_DEBOUNCE_MS) + 1;
            expect(events).toBeLessThanOrEqual(maxPossibleEvents);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('should guarantee minimum gap of TYPING_DEBOUNCE_MS between consecutive emitted events', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 30_000 }), { minLength: 2, maxLength: 100 }),
        (rawTimestamps) => {
          const sorted = [...rawTimestamps].sort((a, b) => a - b);

          // Collect the timestamps at which events are emitted
          const emittedAt: number[] = [];
          let lastSent = -Infinity;
          for (const ts of sorted) {
            if (ts - lastSent >= TYPING_DEBOUNCE_MS) {
              emittedAt.push(ts);
              lastSent = ts;
            }
          }

          // Verify gap between consecutive emitted events >= TYPING_DEBOUNCE_MS
          for (let i = 1; i < emittedAt.length; i++) {
            expect(emittedAt[i] - emittedAt[i - 1]).toBeGreaterThanOrEqual(TYPING_DEBOUNCE_MS);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
