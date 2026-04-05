/**
 * Property-Based Tests for Phone Normalization
 *
 * Uses fast-check to verify that normalizeIndianPhone() produces valid
 * 10-digit output for any Indian phone number in supported formats,
 * and throws for invalid input.
 *
 * Feature: next-features, Property 1: Phone normalization produces valid 10-digit output
 */

import * as fc from 'fast-check';
import { normalizeIndianPhone } from '../../utils/phone-normalize';

// ── Generators ──────────────────────────────────────────────────────────

/** Valid 10-digit Indian phone number (starts with 6-9). */
const baseDigitsArb = fc.integer({ min: 6000000000, max: 9999999999 });

/**
 * indianPhoneArb — generates valid Indian phone numbers in various formats:
 * +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX
 */
const indianPhoneArb = fc.oneof(
  baseDigitsArb.map(n => `+91${n}`),
  baseDigitsArb.map(n => `91${n}`),
  baseDigitsArb.map(n => `0${n}`),
  baseDigitsArb.map(n => `${n}`),
);

/** Inserts random spaces and dashes into a phone string. */
const withFormattingArb = indianPhoneArb.chain(phone =>
  fc.array(
    fc.record({
      pos: fc.integer({ min: 0, max: phone.length }),
      char: fc.constantFrom(' ', '-', '  ', ' - '),
    }),
    { minLength: 0, maxLength: 4 },
  ).map(insertions => {
    // Sort insertions by position descending so indices stay valid
    const sorted = [...insertions].sort((a, b) => b.pos - a.pos);
    let result = phone;
    for (const { pos, char } of sorted) {
      const clampedPos = Math.min(pos, result.length);
      result = result.slice(0, clampedPos) + char + result.slice(clampedPos);
    }
    return result;
  }),
);

/** Invalid phone inputs that should cause normalizeIndianPhone to throw. */
const invalidPhoneArb = fc.oneof(
  // Too few digits
  fc.integer({ min: 100000, max: 999999 }).map(n => `${n}`),
  // Starts with 0-5 (not valid Indian mobile first digit)
  fc.integer({ min: 1000000000, max: 5999999999 }).map(n => `${n}`),
  // Too many digits (13+)
  fc.integer({ min: 6000000000, max: 9999999999 }).map(n => `+91${n}9`),
  // Empty-ish strings
  fc.constantFrom('', '   ', '---', '()'),
);

// ── Property Tests ──────────────────────────────────────────────────────

describe('Property 1: Phone normalization produces valid 10-digit output', () => {
  /**
   * **Validates: Requirement 1.1**
   *
   * For any Indian phone in formats (+91XXXXXXXXXX, 91XXXXXXXXXX,
   * 0XXXXXXXXXX, XXXXXXXXXX), normalizeIndianPhone() returns exactly
   * 10 digits starting with 6-9.
   */
  it('returns exactly 10 digits starting with 6-9 for any valid Indian phone format', () => {
    fc.assert(
      fc.property(indianPhoneArb, (phone) => {
        const result = normalizeIndianPhone(phone);

        // Must be exactly 10 digits
        expect(result).toHaveLength(10);

        // Must be all digits
        expect(result).toMatch(/^\d{10}$/);

        // Must start with 6-9
        expect(Number(result[0])).toBeGreaterThanOrEqual(6);
        expect(Number(result[0])).toBeLessThanOrEqual(9);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 1.1**
   *
   * Phone numbers with spaces and dashes still normalize correctly.
   */
  it('handles spaces and dashes in any position and still produces valid 10-digit output', () => {
    fc.assert(
      fc.property(withFormattingArb, (phone) => {
        const result = normalizeIndianPhone(phone);

        expect(result).toHaveLength(10);
        expect(result).toMatch(/^[6-9]\d{9}$/);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 1.1**
   *
   * All supported formats normalize to the same 10-digit number.
   */
  it('all formats of the same number normalize to identical output', () => {
    fc.assert(
      fc.property(baseDigitsArb, (digits) => {
        const formats = [
          `+91${digits}`,
          `91${digits}`,
          `0${digits}`,
          `${digits}`,
        ];

        const results = formats.map(f => normalizeIndianPhone(f));

        // All formats should produce the same result
        const expected = `${digits}`;
        for (const result of results) {
          expect(result).toBe(expected);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 1.1**
   *
   * Invalid inputs cause normalizeIndianPhone to throw.
   */
  it('throws for invalid phone inputs', () => {
    fc.assert(
      fc.property(invalidPhoneArb, (phone) => {
        expect(() => normalizeIndianPhone(phone)).toThrow();
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 3 Imports ──────────────────────────────────────────────────

import { buildRegistrationLink } from '../../handlers/whatsapp/states/onboarding-handler';

// ── Property 3 Tests ────────────────────────────────────────────────────

describe('Property 3: Registration link contains correct query parameters', () => {
  /**
   * **Validates: Requirement 2.2**
   *
   * For any normalized phone, the registration link contains
   * `?ref=whatsapp&phone={phone}` with exact URL-encoded phone value.
   */
  it('registration link contains ?ref=whatsapp&phone={encodedPhone} for any normalized 10-digit phone', () => {
    fc.assert(
      fc.property(baseDigitsArb, (digits) => {
        const phone = `${digits}`;
        const link = buildRegistrationLink(phone);

        // Link must contain the ref=whatsapp query parameter
        const url = new URL(link);
        expect(url.searchParams.get('ref')).toBe('whatsapp');

        // Link must contain the phone query parameter with exact value
        expect(url.searchParams.get('phone')).toBe(phone);

        // Path must be /register
        expect(url.pathname).toBe('/register');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirement 2.2**
   *
   * For phones with a "+" prefix (e.g. international numbers),
   * the "+" is URL-encoded as %2B in the registration link.
   */
  it('URL-encodes the "+" in phone numbers with country code prefix', () => {
    fc.assert(
      fc.property(baseDigitsArb, (digits) => {
        const phone = `+91${digits}`;
        const link = buildRegistrationLink(phone);

        // The raw link string must contain the encoded "+" as %2B
        expect(link).toContain(`phone=%2B91${digits}`);

        // Parsing the URL should decode it back to the original phone
        const url = new URL(link);
        expect(url.searchParams.get('phone')).toBe(phone);
      }),
      { numRuns: 200 },
    );
  });
});

// ── Property 4 Imports ──────────────────────────────────────────────────

import { computeOnboardingTTL } from '../../services/session-service';

// ── Property 4 Tests ────────────────────────────────────────────────────

describe('Property 4: Onboarding session TTL is exactly 24 hours', () => {
  /**
   * **Validates: Requirement 2.4**
   *
   * For any session creation timestamp (milliseconds), the computed TTL
   * equals floor(createdAt / 1000) + 86400.
   */
  it('TTL equals floor(createdAtMs / 1000) + 86400 for any creation timestamp', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800_000 }), // 0 to ~2100-01-01 in ms
        (createdAtMs) => {
          const ttl = computeOnboardingTTL(createdAtMs);
          const expected = Math.floor(createdAtMs / 1000) + 86400;

          expect(ttl).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirement 2.4**
   *
   * The TTL is always exactly 86400 seconds (24 hours) after the
   * creation timestamp's epoch-second value.
   */
  it('TTL is always exactly 86400 seconds ahead of the epoch-second creation time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        (createdAtMs) => {
          const ttl = computeOnboardingTTL(createdAtMs);
          const createdAtSec = Math.floor(createdAtMs / 1000);

          expect(ttl - createdAtSec).toBe(86400);
        },
      ),
      { numRuns: 500 },
    );
  });
});
