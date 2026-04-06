// services/api/src/services/order-state-machine.ts

export type OrderStatus =
  | 'pending_seller_confirmation'
  | 'confirmed'
  | 'payment_pending'
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'payment_failed'
  | 'expired';

export type TransitionActor = 'customer' | 'seller' | 'system' | 'webhook';

interface TransitionRule {
  to: OrderStatus;
  actors: TransitionActor[];
}

const TRANSITIONS: Record<OrderStatus, TransitionRule[]> = {
  pending_seller_confirmation: [
    { to: 'confirmed', actors: ['seller'] },
    { to: 'rejected', actors: ['seller'] },
    { to: 'cancelled', actors: ['customer'] },
  ],
  confirmed: [
    { to: 'payment_pending', actors: ['system'] },
    { to: 'cancelled', actors: ['customer'] },
  ],
  payment_pending: [
    { to: 'paid', actors: ['webhook'] },
    { to: 'expired', actors: ['webhook'] },
    { to: 'payment_failed', actors: ['webhook'] },
  ],
  paid: [
    { to: 'preparing', actors: ['seller'] },
  ],
  preparing: [
    { to: 'shipped', actors: ['seller'] },
  ],
  shipped: [
    { to: 'delivered', actors: ['seller'] },
  ],
  delivered: [
    { to: 'completed', actors: ['system', 'seller'] },
  ],
  completed: [],
  rejected: [],
  cancelled: [],
  payment_failed: [],
  expired: [],
};

export interface TransitionResult {
  valid: boolean;
  from: OrderStatus;
  to: OrderStatus;
  error?: string;
}

/**
 * Validate whether a status transition is allowed.
 * Pure function — no side effects.
 */
export function validateTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: TransitionActor,
): TransitionResult {
  const rules = TRANSITIONS[from];
  if (!rules) {
    return { valid: false, from, to, error: `Unknown status: ${from}` };
  }

  const match = rules.find(r => r.to === to && r.actors.includes(actor));
  if (!match) {
    return {
      valid: false,
      from,
      to,
      error: `Transition ${from} → ${to} not allowed for actor ${actor}`,
    };
  }

  return { valid: true, from, to };
}

/**
 * Return all valid next statuses for a given status and actor.
 */
export function getValidTransitions(
  from: OrderStatus,
  actor: TransitionActor,
): OrderStatus[] {
  const rules = TRANSITIONS[from] || [];
  return rules
    .filter(r => r.actors.includes(actor))
    .map(r => r.to);
}

/**
 * Check if a status is terminal (no further transitions possible).
 */
export function isTerminalStatus(status: OrderStatus): boolean {
  return (TRANSITIONS[status] || []).length === 0;
}

/**
 * Check if a status requires stock unreservation on entry.
 */
export function requiresStockUnreservation(status: OrderStatus): boolean {
  return ['rejected', 'cancelled', 'expired'].includes(status);
}

/**
 * Check if a status requires stock finalization on entry.
 */
export function requiresStockFinalization(status: OrderStatus): boolean {
  return status === 'paid';
}
