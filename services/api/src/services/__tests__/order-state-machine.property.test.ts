/**
 * Property-Based Tests for Order State Machine Transition Validity
 *
 * Uses fast-check to verify that validateTransition correctly accepts
 * all valid (from, to, actor) triples and rejects all invalid ones.
 *
 * **Validates: Requirements 1.3, 1.4, 1.7**
 */

import * as fc from 'fast-check';
import {
  validateTransition,
  isTerminalStatus,
  OrderStatus,
  TransitionActor,
} from '../order-state-machine';

// ---------------------------------------------------------------------------
// Known valid transitions — mirrors the TRANSITIONS table in the module
// ---------------------------------------------------------------------------

interface ValidTriple {
  from: OrderStatus;
  to: OrderStatus;
  actor: TransitionActor;
}

const VALID_TRANSITIONS: ValidTriple[] = [
  { from: 'pending_seller_confirmation', to: 'confirmed', actor: 'seller' },
  { from: 'pending_seller_confirmation', to: 'rejected', actor: 'seller' },
  { from: 'pending_seller_confirmation', to: 'cancelled', actor: 'customer' },
  { from: 'confirmed', to: 'payment_pending', actor: 'system' },
  { from: 'confirmed', to: 'cancelled', actor: 'customer' },
  { from: 'payment_pending', to: 'paid', actor: 'webhook' },
  { from: 'payment_pending', to: 'expired', actor: 'webhook' },
  { from: 'payment_pending', to: 'payment_failed', actor: 'webhook' },
  { from: 'paid', to: 'preparing', actor: 'seller' },
  { from: 'preparing', to: 'shipped', actor: 'seller' },
  { from: 'shipped', to: 'delivered', actor: 'seller' },
  { from: 'delivered', to: 'completed', actor: 'system' },
  { from: 'delivered', to: 'completed', actor: 'seller' },
];

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ALL_STATUSES: OrderStatus[] = [
  'pending_seller_confirmation',
  'confirmed',
  'payment_pending',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'completed',
  'rejected',
  'cancelled',
  'payment_failed',
  'expired',
];

const ALL_ACTORS: TransitionActor[] = ['customer', 'seller', 'system', 'webhook'];

const arbStatus: fc.Arbitrary<OrderStatus> = fc.constantFrom(...ALL_STATUSES);
const arbActor: fc.Arbitrary<TransitionActor> = fc.constantFrom(...ALL_ACTORS);

const TERMINAL_STATUSES: OrderStatus[] = ['completed', 'rejected', 'cancelled', 'payment_failed', 'expired'];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function isValidTriple(from: OrderStatus, to: OrderStatus, actor: TransitionActor): boolean {
  return VALID_TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.actor === actor,
  );
}

// ---------------------------------------------------------------------------
// Property 1: State Machine Transition Validity
// ---------------------------------------------------------------------------

describe('Property 1: State Machine Transition Validity', () => {
  /**
   * **Validates: Requirements 1.3, 1.4, 1.7**
   *
   * For any (from, to, actor) triple, validateTransition returns valid=true
   * iff the triple is in the transition table; all undefined triples return
   * valid=false with an error message.
   */
  it('validateTransition returns valid=true iff (from, to, actor) is in the transition table', () => {
    fc.assert(
      fc.property(arbStatus, arbStatus, arbActor, (from, to, actor) => {
        const result = validateTransition(from, to, actor);

        if (isValidTriple(from, to, actor)) {
          // Valid triple → must return valid=true, no error
          expect(result.valid).toBe(true);
          expect(result.from).toBe(from);
          expect(result.to).toBe(to);
          expect(result.error).toBeUndefined();
        } else {
          // Invalid triple → must return valid=false with error message
          expect(result.valid).toBe(false);
          expect(result.from).toBe(from);
          expect(result.to).toBe(to);
          expect(result.error).toBeDefined();
          expect(typeof result.error).toBe('string');
          expect(result.error!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 1.7**
   *
   * Terminal statuses have no valid outgoing transitions for any actor.
   */
  it('terminal statuses have no valid transitions for any actor', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TERMINAL_STATUSES),
        arbStatus,
        arbActor,
        (terminalFrom, to, actor) => {
          const result = validateTransition(terminalFrom, to, actor);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error!.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Validates that isTerminalStatus agrees with the transition table:
   * a status is terminal iff it has zero valid transitions for all actors.
   */
  it('isTerminalStatus returns true iff no valid transitions exist for any actor', () => {
    fc.assert(
      fc.property(arbStatus, (status) => {
        const hasAnyTransition = ALL_ACTORS.some((actor) =>
          ALL_STATUSES.some((to) => isValidTriple(status, to, actor)),
        );

        expect(isTerminalStatus(status)).toBe(!hasAnyTransition);
      }),
      { numRuns: 200 },
    );
  });
});
