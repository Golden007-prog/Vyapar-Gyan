/**
 * Property-Based Tests for Human Handoff Protocol
 *
 * Uses fast-check to verify that the handoff logic correctly controls
 * AI bypass based on session state and expiry time.
 *
 * Feature: next-features, Property 15: Human handoff controls AI bypass
 */

import * as fc from 'fast-check';
import { shouldBypassAI, isHandoffExpired } from '../../services/session-service';

// ── Generators ──────────────────────────────────────────────────────────

/** Generate a "now" epoch in seconds (reasonable range: 2020–2030). */
const nowEpochArb = fc.integer({ min: 1577836800, max: 1893456000 });

/** Positive offset in seconds (1 second to 2 hours). */
const positiveOffsetArb = fc.integer({ min: 1, max: 7200 });

/** Non-positive offset (0 or negative, meaning expired). */
const expiredOffsetArb = fc.integer({ min: -7200, max: 0 });

// ── Property Tests ──────────────────────────────────────────────────────

describe('Property 15: Human handoff controls AI bypass', () => {
  /**
   * **Validates: Requirement 10.2**
   *
   * For any session where isHumanHandoff=true AND handoffExpiresAt > now,
   * shouldBypassAI returns true (messages skip AI).
   */
  it('bypasses AI when handoff is active and not expired', () => {
    fc.assert(
      fc.property(nowEpochArb, positiveOffsetArb, (now, offset) => {
        const session = {
          isHumanHandoff: true as const,
          handoffExpiresAt: now + offset, // expires in the future
        };

        expect(shouldBypassAI(session, now)).toBe(true);
        expect(isHandoffExpired(session, now)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 10.4**
   *
   * When handoffExpiresAt <= now, handoff auto-resets: shouldBypassAI
   * returns false and isHandoffExpired returns true.
   */
  it('auto-resets handoff when expired (handoffExpiresAt <= now)', () => {
    fc.assert(
      fc.property(nowEpochArb, expiredOffsetArb, (now, offset) => {
        const session = {
          isHumanHandoff: true as const,
          handoffExpiresAt: now + offset, // expired or exactly now
        };

        expect(shouldBypassAI(session, now)).toBe(false);
        expect(isHandoffExpired(session, now)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 10.2, 10.4**
   *
   * When isHumanHandoff is false, AI is never bypassed regardless of
   * handoffExpiresAt value.
   */
  it('never bypasses AI when isHumanHandoff is false', () => {
    fc.assert(
      fc.property(
        nowEpochArb,
        fc.integer({ min: -7200, max: 7200 }),
        (now, offset) => {
          const session = {
            isHumanHandoff: false as const,
            handoffExpiresAt: now + offset,
          };

          expect(shouldBypassAI(session, now)).toBe(false);
          expect(isHandoffExpired(session, now)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 10.2, 10.4**
   *
   * When handoffExpiresAt is undefined/null, handoff is treated as expired.
   */
  it('treats missing handoffExpiresAt as expired', () => {
    fc.assert(
      fc.property(nowEpochArb, (now) => {
        const sessionNoExpiry = { isHumanHandoff: true as const, handoffExpiresAt: undefined };
        expect(shouldBypassAI(sessionNoExpiry, now)).toBe(false);
        expect(isHandoffExpired(sessionNoExpiry, now)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 10.2, 10.4**
   *
   * The boundary: handoffExpiresAt exactly equals now means expired.
   */
  it('treats handoffExpiresAt === now as expired (boundary)', () => {
    fc.assert(
      fc.property(nowEpochArb, (now) => {
        const session = {
          isHumanHandoff: true as const,
          handoffExpiresAt: now, // exactly now
        };

        expect(shouldBypassAI(session, now)).toBe(false);
        expect(isHandoffExpired(session, now)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
