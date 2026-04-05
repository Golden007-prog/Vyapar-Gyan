/**
 * Property-Based Tests for Customer Discovery
 *
 * Tests location input classification and store selection session transitions
 * for the Customer Discovery WhatsApp flow.
 *
 * Uses fast-check to verify invariants across randomised inputs.
 */

import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that trigger module loading
// ---------------------------------------------------------------------------

const mockUpdateSessionState = jest.fn().mockResolvedValue(undefined);

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({}) },
  QueryCommand: jest.fn(),
  PutCommand: jest.fn(),
  DeleteCommand: jest.fn(),
}));
jest.mock('../../adapters/dynamodb-adapter', () => ({
  updateSessionState: (...args: any[]) => mockUpdateSessionState(...args),
}));
jest.mock('../../services/whatsapp-sender', () => ({
  whatsappSender: { sendMessage: jest.fn().mockResolvedValue('mock-sid') },
}));
jest.mock('../../repositories/favorites', () => ({
  listFavorites: jest.fn().mockResolvedValue([]),
  addFavorite: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({ tableName: 'test-table' }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  classifyLocationInput,
  transitionToBrowsing,
} from '../../handlers/whatsapp/customer-discovery';

// ── Generators ─────────────────────────────────────────────────────────

/** Generate a valid 6-digit Indian pincode (100000–999999) */
const pincodeArb = fc.integer({ min: 100000, max: 999999 }).map(String);

/** Generate a city name (non-numeric string, at least 2 chars) */
const cityNameArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ '.split(''),
  ),
  { minLength: 2, maxLength: 30 },
).filter(s => s.trim().length >= 2 && !/^\d{6}$/.test(s.trim()));

/** Generate strings that are NOT exactly 6 digits */
const nonPincodeArb = fc.oneof(
  fc.integer({ min: 0, max: 99999 }).map(String),
  fc.integer({ min: 1000000, max: 9999999 }).map(String),
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => !/^\d{6}$/.test(s.trim())),
  cityNameArb,
);

// ── Property 8: Location input correctly classified as pincode or city ──

describe('Property 8: Location input correctly classified as pincode or city', () => {
  /**
   * **Validates: Requirements 6.3, 6.4**
   *
   * For any input: exactly 6 digits → pincode search;
   * otherwise → city name search (case-insensitive: "Mumbai" = "mumbai")
   */

  it('exactly 6 digits are classified as pincode', () => {
    fc.assert(
      fc.property(pincodeArb, (pincode) => {
        const result = classifyLocationInput(pincode);
        expect(result.type).toBe('pincode');
        expect(result.value).toBe(pincode);
      }),
      { numRuns: 100 },
    );
  });

  it('non-6-digit inputs are classified as city', () => {
    fc.assert(
      fc.property(nonPincodeArb, (input) => {
        const result = classifyLocationInput(input);
        expect(result.type).toBe('city');
        expect(result.value).toBe(input.trim().toLowerCase());
      }),
      { numRuns: 100 },
    );
  });

  it('city classification is case-insensitive', () => {
    fc.assert(
      fc.property(cityNameArb, (city) => {
        const upper = classifyLocationInput(city.toUpperCase());
        const lower = classifyLocationInput(city.toLowerCase());
        const mixed = classifyLocationInput(city);

        expect(upper.type).toBe('city');
        expect(lower.type).toBe('city');
        expect(mixed.type).toBe('city');
        expect(upper.value).toBe(lower.value);
        expect(upper.value).toBe(mixed.value);
      }),
      { numRuns: 100 },
    );
  });

  it('6-digit string with leading/trailing spaces is still pincode', () => {
    fc.assert(
      fc.property(pincodeArb, (pincode) => {
        const result = classifyLocationInput(`  ${pincode}  `);
        expect(result.type).toBe('pincode');
        expect(result.value).toBe(pincode);
      }),
      { numRuns: 50 },
    );
  });

  it('5-digit and 7-digit numbers are classified as city, not pincode', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 10000, max: 99999 }).map(String),
          fc.integer({ min: 1000000, max: 9999999 }).map(String),
        ),
        (input) => {
          const result = classifyLocationInput(input);
          expect(result.type).toBe('city');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 9: Store selection transitions session to BROWSING with correct sellerId ──

describe('Property 9: Store selection transitions session to BROWSING with correct sellerId', () => {
  /**
   * **Validates: Requirement 6.6**
   *
   * For any store selection, session state → BROWSING and session context
   * contains selected store's `sellerId`.
   */

  beforeEach(() => {
    mockUpdateSessionState.mockClear();
  });

  it('transitionToBrowsing returns browsing state with correct sellerId', () => {
    fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (userId, sellerId) => {
          const result = await transitionToBrowsing(userId, sellerId);

          // State must be 'browsing'
          expect(result.state).toBe('browsing');

          // sellerId must match the selected store
          expect(result.sellerId).toBe(sellerId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sellerId in result always matches the input sellerId', () => {
    fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (userId, sellerId) => {
          const result = await transitionToBrowsing(userId, sellerId);
          expect(result.sellerId).toStrictEqual(sellerId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('state is always "browsing" regardless of input', () => {
    fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (userId, sellerId) => {
          const result = await transitionToBrowsing(userId, sellerId);
          expect(result.state).toBe('browsing');
        },
      ),
      { numRuns: 100 },
    );
  });
});
