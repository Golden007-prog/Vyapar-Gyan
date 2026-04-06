/**
 * Property-Based Tests for Seller Command Parsing (Property 11)
 *
 * Property 11: Seller Command Parsing
 * For any message matching ACCEPT/REJECT {orderId}, parser extracts correct orderId;
 * bare ACCEPT/REJECT returns null orderId.
 *
 * Uses fast-check with minimum 100 iterations.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */

import * as fc from 'fast-check';
import { parseSellerCommand } from '../states/seller-order-handler';

// ── Generators ──────────────────────────────────────────────────────────

/** Generate a VG-format order ID: VG-YYYYMMDD-NNNN */
const arbOrderId: fc.Arbitrary<string> = fc.tuple(
  fc.integer({ min: 2024, max: 2030 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }),
  fc.integer({ min: 0, max: 9999 }),
).map(([year, month, day, seq]) => {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const ssss = String(seq).padStart(4, '0');
  return `VG-${year}${mm}${dd}-${ssss}`;
});

/** Generate a free-form order ID (any non-empty string without leading/trailing whitespace) */
const arbFreeformOrderId: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_#'.split('')),
  { minLength: 1, maxLength: 30 },
);

/** Generate ACCEPT or REJECT in various casings */
const arbAction: fc.Arbitrary<string> = fc.constantFrom(
  'ACCEPT', 'accept', 'Accept', 'aCcEpT',
  'REJECT', 'reject', 'Reject', 'rEjEcT',
);

/** Generate a bare action (ACCEPT or REJECT only) */
const arbBareAction: fc.Arbitrary<string> = fc.constantFrom(
  'ACCEPT', 'accept', 'Accept', 'REJECT', 'reject', 'Reject',
);

/** Generate text that does NOT start with accept or reject */
const arbNonCommand: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdfghijklmnopqstuvwxyz0123456789 '.split('')),
  { minLength: 1, maxLength: 40 },
).filter(s => {
  const lower = s.trim().toLowerCase();
  return !lower.startsWith('accept') && !lower.startsWith('reject');
});

// ── Property Tests ──────────────────────────────────────────────────────

describe('Property 11: Seller Command Parsing', () => {
  it('extracts correct orderId for ACCEPT/REJECT {orderId} commands', () => {
    fc.assert(
      fc.property(
        arbAction,
        arbOrderId,
        (action, orderId) => {
          const input = `${action} ${orderId}`;
          const result = parseSellerCommand(input);

          expect(result).not.toBeNull();
          expect(result!.action).toBe(action.toLowerCase().startsWith('a') ? 'accept' : 'reject');
          expect(result!.orderId).toBe(orderId);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns null orderId for bare ACCEPT/REJECT commands', () => {
    fc.assert(
      fc.property(
        arbBareAction,
        (action) => {
          const result = parseSellerCommand(action);

          expect(result).not.toBeNull();
          expect(result!.action).toBe(action.toLowerCase().startsWith('a') ? 'accept' : 'reject');
          expect(result!.orderId).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('extracts correct orderId for free-form order IDs', () => {
    fc.assert(
      fc.property(
        arbAction,
        arbFreeformOrderId,
        (action, orderId) => {
          const input = `${action} ${orderId}`;
          const result = parseSellerCommand(input);

          expect(result).not.toBeNull();
          expect(result!.action).toBe(action.toLowerCase().startsWith('a') ? 'accept' : 'reject');
          expect(result!.orderId).toBe(orderId);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns null for non-command messages', () => {
    fc.assert(
      fc.property(
        arbNonCommand,
        (text) => {
          const result = parseSellerCommand(text);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('handles empty and whitespace-only input', () => {
    expect(parseSellerCommand('')).toBeNull();
    expect(parseSellerCommand('   ')).toBeNull();
    expect(parseSellerCommand('\n')).toBeNull();
  });

  it('is case-insensitive for action keyword', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('ACCEPT', 'accept', 'Accept', 'aCCEPT', 'accEPT'),
        arbOrderId,
        (action, orderId) => {
          const result = parseSellerCommand(`${action} ${orderId}`);
          expect(result).not.toBeNull();
          expect(result!.action).toBe('accept');
          expect(result!.orderId).toBe(orderId);
        },
      ),
      { numRuns: 100 },
    );

    fc.assert(
      fc.property(
        fc.constantFrom('REJECT', 'reject', 'Reject', 'rEJECT', 'rejECT'),
        arbOrderId,
        (action, orderId) => {
          const result = parseSellerCommand(`${action} ${orderId}`);
          expect(result).not.toBeNull();
          expect(result!.action).toBe('reject');
          expect(result!.orderId).toBe(orderId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('handles leading/trailing whitespace in input', () => {
    fc.assert(
      fc.property(
        arbBareAction,
        fc.constantFrom('', ' ', '  '),
        fc.constantFrom('', ' ', '  '),
        (action, leading, trailing) => {
          const input = `${leading}${action}${trailing}`;
          const result = parseSellerCommand(input);

          expect(result).not.toBeNull();
          expect(result!.action).toBe(action.toLowerCase().startsWith('a') ? 'accept' : 'reject');
          // Bare command — orderId should be null
          expect(result!.orderId).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
