/**
 * Property 12: Consent-Based Nudge Filtering
 *
 * For any customer with optedOut=true, all nudges suppressed.
 * During quiet hours (22:00–09:00 IST), all nudges suppressed.
 *
 * **Validates: Requirements 11.6**
 */

import fc from 'fast-check';
import { shouldSuppressNudge } from '../order-scheduler-service';

describe('Property 12: Consent-Based Nudge Filtering', () => {
  it('suppresses all nudges for opted-out customers regardless of time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        (hour) => {
          const customer = { optedOut: true };
          expect(shouldSuppressNudge(customer, hour)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('suppresses nudges during quiet hours (22:00–09:00 IST) regardless of consent', () => {
    // Quiet hours: hour >= 22 or hour < 9
    const quietHourArb = fc.oneof(
      fc.integer({ min: 22, max: 23 }),
      fc.integer({ min: 0, max: 8 }),
    );

    fc.assert(
      fc.property(
        fc.boolean(),
        quietHourArb,
        (optedOut, hour) => {
          const customer = { optedOut };
          expect(shouldSuppressNudge(customer, hour)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('allows nudges for opted-in customers during active hours (09:00–22:00 IST)', () => {
    // Active hours: 9 <= hour < 22
    const activeHourArb = fc.integer({ min: 9, max: 21 });

    fc.assert(
      fc.property(
        activeHourArb,
        (hour) => {
          const customer = { optedOut: false };
          expect(shouldSuppressNudge(customer, hour)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any customer and time, suppression is true iff optedOut OR quiet hours', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 23 }),
        (optedOut, hour) => {
          const customer = { optedOut };
          const isQuietHour = hour >= 22 || hour < 9;
          const expected = optedOut || isQuietHour;
          expect(shouldSuppressNudge(customer, hour)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
