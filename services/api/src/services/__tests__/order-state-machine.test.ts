import {
  validateTransition,
  getValidTransitions,
  isTerminalStatus,
  requiresStockUnreservation,
  requiresStockFinalization,
  OrderStatus,
  TransitionActor,
} from '../order-state-machine';

describe('Order State Machine', () => {
  describe('validateTransition', () => {
    it('allows seller to confirm a pending order', () => {
      const result = validateTransition('pending_seller_confirmation', 'confirmed', 'seller');
      expect(result).toEqual({ valid: true, from: 'pending_seller_confirmation', to: 'confirmed' });
    });

    it('allows seller to reject a pending order', () => {
      const result = validateTransition('pending_seller_confirmation', 'rejected', 'seller');
      expect(result).toEqual({ valid: true, from: 'pending_seller_confirmation', to: 'rejected' });
    });

    it('allows customer to cancel a pending order', () => {
      const result = validateTransition('pending_seller_confirmation', 'cancelled', 'customer');
      expect(result).toEqual({ valid: true, from: 'pending_seller_confirmation', to: 'cancelled' });
    });

    it('allows system to move confirmed to payment_pending', () => {
      const result = validateTransition('confirmed', 'payment_pending', 'system');
      expect(result).toEqual({ valid: true, from: 'confirmed', to: 'payment_pending' });
    });

    it('allows webhook to mark payment_pending as paid', () => {
      const result = validateTransition('payment_pending', 'paid', 'webhook');
      expect(result).toEqual({ valid: true, from: 'payment_pending', to: 'paid' });
    });

    it('allows webhook to expire payment_pending', () => {
      const result = validateTransition('payment_pending', 'expired', 'webhook');
      expect(result).toEqual({ valid: true, from: 'payment_pending', to: 'expired' });
    });

    it('allows webhook to fail payment_pending', () => {
      const result = validateTransition('payment_pending', 'payment_failed', 'webhook');
      expect(result).toEqual({ valid: true, from: 'payment_pending', to: 'payment_failed' });
    });

    it('allows seller to move paid to preparing', () => {
      const result = validateTransition('paid', 'preparing', 'seller');
      expect(result).toEqual({ valid: true, from: 'paid', to: 'preparing' });
    });

    it('allows seller to move preparing to shipped', () => {
      const result = validateTransition('preparing', 'shipped', 'seller');
      expect(result).toEqual({ valid: true, from: 'preparing', to: 'shipped' });
    });

    it('allows seller to move shipped to delivered', () => {
      const result = validateTransition('shipped', 'delivered', 'seller');
      expect(result).toEqual({ valid: true, from: 'shipped', to: 'delivered' });
    });

    it('allows system to complete a delivered order', () => {
      const result = validateTransition('delivered', 'completed', 'system');
      expect(result).toEqual({ valid: true, from: 'delivered', to: 'completed' });
    });

    it('allows seller to complete a delivered order', () => {
      const result = validateTransition('delivered', 'completed', 'seller');
      expect(result).toEqual({ valid: true, from: 'delivered', to: 'completed' });
    });

    it('rejects customer trying to confirm an order', () => {
      const result = validateTransition('pending_seller_confirmation', 'confirmed', 'customer');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('rejects transition from terminal status', () => {
      const result = validateTransition('completed', 'paid', 'system');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('rejects skipping states (pending directly to paid)', () => {
      const result = validateTransition('pending_seller_confirmation', 'paid', 'webhook');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });
  });

  describe('getValidTransitions', () => {
    it('returns seller transitions from pending_seller_confirmation', () => {
      const transitions = getValidTransitions('pending_seller_confirmation', 'seller');
      expect(transitions).toEqual(['confirmed', 'rejected']);
    });

    it('returns customer transitions from pending_seller_confirmation', () => {
      const transitions = getValidTransitions('pending_seller_confirmation', 'customer');
      expect(transitions).toEqual(['cancelled']);
    });

    it('returns empty array for terminal status', () => {
      const transitions = getValidTransitions('completed', 'system');
      expect(transitions).toEqual([]);
    });

    it('returns empty array for actor with no valid transitions', () => {
      const transitions = getValidTransitions('paid', 'customer');
      expect(transitions).toEqual([]);
    });

    it('returns webhook transitions from payment_pending', () => {
      const transitions = getValidTransitions('payment_pending', 'webhook');
      expect(transitions).toEqual(['paid', 'expired', 'payment_failed']);
    });
  });

  describe('isTerminalStatus', () => {
    const terminalStatuses: OrderStatus[] = ['completed', 'rejected', 'cancelled', 'payment_failed', 'expired'];
    const nonTerminalStatuses: OrderStatus[] = [
      'pending_seller_confirmation', 'confirmed', 'payment_pending',
      'paid', 'preparing', 'shipped', 'delivered',
    ];

    it.each(terminalStatuses)('returns true for %s', (status) => {
      expect(isTerminalStatus(status)).toBe(true);
    });

    it.each(nonTerminalStatuses)('returns false for %s', (status) => {
      expect(isTerminalStatus(status)).toBe(false);
    });
  });

  describe('requiresStockUnreservation', () => {
    it('returns true for rejected', () => {
      expect(requiresStockUnreservation('rejected')).toBe(true);
    });

    it('returns true for cancelled', () => {
      expect(requiresStockUnreservation('cancelled')).toBe(true);
    });

    it('returns true for expired', () => {
      expect(requiresStockUnreservation('expired')).toBe(true);
    });

    it('returns false for paid', () => {
      expect(requiresStockUnreservation('paid')).toBe(false);
    });

    it('returns false for confirmed', () => {
      expect(requiresStockUnreservation('confirmed')).toBe(false);
    });
  });

  describe('requiresStockFinalization', () => {
    it('returns true for paid', () => {
      expect(requiresStockFinalization('paid')).toBe(true);
    });

    it('returns false for confirmed', () => {
      expect(requiresStockFinalization('confirmed')).toBe(false);
    });

    it('returns false for rejected', () => {
      expect(requiresStockFinalization('rejected')).toBe(false);
    });

    it('returns false for delivered', () => {
      expect(requiresStockFinalization('delivered')).toBe(false);
    });
  });
});
