/**
 * Property-Based Tests for Cart Abandonment Nudges
 *
 * Uses fast-check to verify:
 * - P25: Cart nudge message contains correct item count and amount
 * - P26: Nudge channel selection follows preference rules
 *
 * Feature: next-features
 */

import * as fc from 'fast-check';
import {
  formatNudgeMessage,
  selectNudgeChannel,
} from '../../services/cart-abandonment-scheduler';

// ── Generators ──────────────────────────────────────────────────────────

/** Positive item count (1–999). */
const itemCountArb = fc.integer({ min: 1, max: 999 });

/** Positive cart amount in ₹ (1–10,000,000). */
const amountArb = fc.integer({ min: 1, max: 10_000_000 });

/** Nudge type: first or second. */
const nudgeTypeArb = fc.constantFrom('first' as const, 'second' as const);

// ── Property 25 Tests ───────────────────────────────────────────────────

describe('Property 25: Cart nudge message contains correct item count and amount', () => {
  /**
   * **Validates: Requirement 21.3**
   *
   * For any non-empty cart, the nudge message contains the exact item count
   * and the total cart value formatted in ₹.
   */
  it('nudge message contains exact item count for any cart', () => {
    fc.assert(
      fc.property(itemCountArb, amountArb, nudgeTypeArb, (itemCount, amount, nudgeType) => {
        const message = formatNudgeMessage(itemCount, amount, nudgeType);

        // Message must contain the exact item count as a number
        expect(message).toContain(`${itemCount}`);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 21.3**
   *
   * The nudge message contains the cart value formatted with ₹ symbol.
   */
  it('nudge message contains ₹-formatted amount for any cart value', () => {
    fc.assert(
      fc.property(itemCountArb, amountArb, nudgeTypeArb, (itemCount, amount, nudgeType) => {
        const message = formatNudgeMessage(itemCount, amount, nudgeType);
        const formattedAmount = `₹${amount.toLocaleString('en-IN')}`;

        // Message must contain the ₹-formatted amount
        expect(message).toContain(formattedAmount);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 21.3**
   *
   * First nudge message always contains "Ready to checkout?" prompt.
   */
  it('first nudge message contains checkout prompt', () => {
    fc.assert(
      fc.property(itemCountArb, amountArb, (itemCount, amount) => {
        const message = formatNudgeMessage(itemCount, amount, 'first');

        expect(message).toContain('Ready to checkout?');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 21.5**
   *
   * Second nudge message includes an incentive (free delivery).
   */
  it('second nudge message includes incentive', () => {
    fc.assert(
      fc.property(itemCountArb, amountArb, (itemCount, amount) => {
        const message = formatNudgeMessage(itemCount, amount, 'second');

        expect(message).toContain('free delivery');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 21.3**
   *
   * Singular/plural item label is correct.
   */
  it('uses singular "item" for count=1 and plural "items" for count>1', () => {
    const singleMessage = formatNudgeMessage(1, 500, 'first');
    expect(singleMessage).toContain('1 item ');

    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 999 }),
        amountArb,
        nudgeTypeArb,
        (itemCount, amount, nudgeType) => {
          const message = formatNudgeMessage(itemCount, amount, nudgeType);
          expect(message).toContain(`${itemCount} items`);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ── Property 26 Tests ───────────────────────────────────────────────────

describe('Property 26: Nudge channel selection follows preference rules', () => {
  /**
   * **Validates: Requirement 21.4**
   *
   * If the customer has an active WhatsApp session, the nudge channel
   * is 'whatsapp'. Otherwise, it is 'web'.
   */
  it('returns whatsapp when hasActiveWhatsAppSession is true, web otherwise', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasActiveSession) => {
        const channel = selectNudgeChannel(hasActiveSession);

        if (hasActiveSession) {
          expect(channel).toBe('whatsapp');
        } else {
          expect(channel).toBe('web');
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 21.4**
   *
   * The return value is always one of the two valid channels.
   */
  it('always returns a valid channel type', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasActiveSession) => {
        const channel = selectNudgeChannel(hasActiveSession);

        expect(['whatsapp', 'web']).toContain(channel);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 21.4**
   *
   * Channel selection is deterministic — same input always produces same output.
   */
  it('is deterministic for the same input', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasActiveSession) => {
        const channel1 = selectNudgeChannel(hasActiveSession);
        const channel2 = selectNudgeChannel(hasActiveSession);

        expect(channel1).toBe(channel2);
      }),
      { numRuns: 200 },
    );
  });
});
