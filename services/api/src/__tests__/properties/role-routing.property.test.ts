/**
 * Property-Based Tests for Role-Based Routing
 *
 * Uses fast-check to verify that resolveRoutingFlow() exhaustively and
 * correctly maps every resolved role to the expected routing flow.
 *
 * Feature: next-features, Property 2: Role-based routing is exhaustive and correct
 */

import * as fc from 'fast-check';
import { resolveRoutingFlow } from '../../handlers/whatsapp/webhook';
import type { ResolvedUser } from '../../services/user-lookup';

// ── Mocks — webhook.ts has top-level AWS SDK imports ────────────────────

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutEventsCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutItemCommand: jest.fn(),
  UpdateItemCommand: jest.fn(),
  ConditionalCheckFailedException: class extends Error {},
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj: unknown) => obj),
}));

jest.mock('twilio', () => ({
  validateRequest: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/config', () => ({
  getWebhookConfig: jest.fn().mockResolvedValue({
    twilioAuthToken: 'test',
    tableName: 'test-table',
    eventBusName: 'test-bus',
    environment: 'dev',
  }),
}));

jest.mock('../../core/metrics', () => ({
  publishLatencyMetric: jest.fn(),
  publishCountMetric: jest.fn(),
}));

jest.mock('../../services/user-lookup', () => ({
  resolveUserByPhone: jest.fn(),
}));

// ── Generators ──────────────────────────────────────────────────────────

/** All valid roles from the ResolvedUser type. */
const validRoleArb = fc.constantFrom<ResolvedUser['role']>('seller', 'customer', 'admin');

/** A minimal ResolvedUser with a given role. */
const resolvedUserArb = (role: ResolvedUser['role']): ResolvedUser => ({
  userId: 'user-123',
  role,
  profile: { userId: 'user-123', role, phone: '9876543210' } as any,
});

/** Generates ResolvedUser | null covering all routing inputs. */
const routingInputArb: fc.Arbitrary<ResolvedUser | null> = fc.oneof(
  fc.constant(null),
  validRoleArb.map(role => resolvedUserArb(role)),
);

// ── Expected mapping ────────────────────────────────────────────────────

const EXPECTED_ROUTING: Record<string, string> = {
  seller: 'Seller_Copilot',
  customer: 'Customer_Discovery',
  admin: 'Seller_Copilot',
  null: 'Onboarding',
};

const VALID_FLOWS = new Set(Object.values(EXPECTED_ROUTING));

// ── Property Tests ──────────────────────────────────────────────────────

describe('Property 2: Role-based routing is exhaustive and correct', () => {
  /**
   * **Validates: Requirements 1.5, 1.6, 1.7**
   *
   * For any resolved role ∈ {seller, customer, admin, null}, routing maps:
   *   seller   → Seller_Copilot
   *   customer → Customer_Discovery
   *   admin    → Seller_Copilot
   *   null     → Onboarding
   * with no unhandled values.
   */
  it('maps every role to the correct routing flow', () => {
    fc.assert(
      fc.property(routingInputArb, (resolved) => {
        const flow = resolveRoutingFlow(resolved);
        const roleKey = resolved?.role ?? 'null';

        expect(flow).toBe(EXPECTED_ROUTING[roleKey]);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6, 1.7**
   *
   * The routing function always returns one of the known flow strings —
   * never undefined, empty, or an unexpected value.
   */
  it('always returns a valid routing flow string', () => {
    fc.assert(
      fc.property(routingInputArb, (resolved) => {
        const flow = resolveRoutingFlow(resolved);

        expect(typeof flow).toBe('string');
        expect(flow.length).toBeGreaterThan(0);
        expect(VALID_FLOWS.has(flow)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5, 1.6, 1.7**
   *
   * Exhaustiveness: every role in {seller, customer, admin} plus null
   * is handled — no role falls through to an unexpected default.
   */
  it('is exhaustive over all role values including null', () => {
    const allInputs: Array<ResolvedUser | null> = [
      null,
      resolvedUserArb('seller'),
      resolvedUserArb('customer'),
      resolvedUserArb('admin'),
    ];

    const results = allInputs.map(input => resolveRoutingFlow(input));

    // Each input produces a defined, non-empty result
    for (const result of results) {
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    }

    // Specific mappings
    expect(results[0]).toBe('Onboarding');         // null
    expect(results[1]).toBe('Seller_Copilot');     // seller
    expect(results[2]).toBe('Customer_Discovery'); // customer
    expect(results[3]).toBe('Seller_Copilot');     // admin
  });

  /**
   * **Validates: Requirements 1.5, 1.6, 1.7**
   *
   * Null input (unregistered user) always routes to Onboarding.
   */
  it('routes null (unregistered) to Onboarding', () => {
    fc.assert(
      fc.property(fc.constant(null), (resolved) => {
        expect(resolveRoutingFlow(resolved)).toBe('Onboarding');
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirement 1.5**
   *
   * Seller role always routes to Seller_Copilot regardless of profile data.
   */
  it('routes seller to Seller_Copilot for any profile', () => {
    fc.assert(
      fc.property(
        fc.record({
          userId: fc.uuid(),
          phone: fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 10, maxLength: 10 }),
          storeName: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        (profileData) => {
          const resolved: ResolvedUser = {
            userId: profileData.userId,
            role: 'seller',
            profile: { ...profileData, role: 'seller' } as any,
          };

          expect(resolveRoutingFlow(resolved)).toBe('Seller_Copilot');
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirement 1.6**
   *
   * Customer role always routes to Customer_Discovery regardless of profile data.
   */
  it('routes customer to Customer_Discovery for any profile', () => {
    fc.assert(
      fc.property(
        fc.record({
          userId: fc.uuid(),
          phone: fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 10, maxLength: 10 }),
        }),
        (profileData) => {
          const resolved: ResolvedUser = {
            userId: profileData.userId,
            role: 'customer',
            profile: { ...profileData, role: 'customer' } as any,
          };

          expect(resolveRoutingFlow(resolved)).toBe('Customer_Discovery');
        },
      ),
      { numRuns: 100 },
    );
  });
});
