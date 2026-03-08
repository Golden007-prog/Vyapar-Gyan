/**
 * Unit tests for Session Service
 *
 * Validates: resolveOrCreateSession (new, existing, cart restore), isInactive.
 */

import type { UnifiedSession, Cart } from '../../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPutSession = jest.fn();
const mockGetSession = jest.fn();
const mockGetSessionByPhone = jest.fn();
const mockUpdateSessionState = jest.fn();
const mockGetUserByPhone = jest.fn();
const mockGetCart = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  putSession: (...args: unknown[]) => mockPutSession(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getSessionByPhone: (...args: unknown[]) => mockGetSessionByPhone(...args),
  updateSessionState: (...args: unknown[]) => mockUpdateSessionState(...args),
  getUserByPhone: (...args: unknown[]) => mockGetUserByPhone(...args),
  getCart: (...args: unknown[]) => mockGetCart(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { resolveOrCreateSession, isInactive } from '../session-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Session Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('resolveOrCreateSession', () => {
    it('returns existing active session when found by userId', async () => {
      const existing: UnifiedSession = {
        userId: 'user-1',
        state: 'browsing',
        lastActiveChannel: 'whatsapp',
        lastActivityAt: new Date().toISOString(),
        phoneNumber: '+919876543210',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 2592000,
      };
      mockGetSession.mockResolvedValue(existing);
      mockUpdateSessionState.mockResolvedValue(undefined);

      const result = await resolveOrCreateSession({ userId: 'user-1', channel: 'web' });

      expect(result.isNew).toBe(false);
      expect(result.session.userId).toBe('user-1');
      expect(result.session.lastActiveChannel).toBe('web');
      expect(mockUpdateSessionState).toHaveBeenCalledWith('user-1', 'browsing', 'web');
    });

    it('creates a new session when none exists', async () => {
      mockGetSession.mockResolvedValue(null);
      mockPutSession.mockResolvedValue(undefined);

      const result = await resolveOrCreateSession({ userId: 'user-2', channel: 'whatsapp' });

      expect(result.isNew).toBe(true);
      expect(result.session.state).toBe('greeting');
      expect(result.session.lastActiveChannel).toBe('whatsapp');
      expect(mockPutSession).toHaveBeenCalledTimes(1);
    });

    it('resolves userId from phone number via GSI1', async () => {
      mockGetUserByPhone.mockResolvedValue({ userId: 'user-3', phoneNumber: '+919876543210' });
      mockGetSession.mockResolvedValue(null);
      mockPutSession.mockResolvedValue(undefined);

      const result = await resolveOrCreateSession({
        phoneNumber: '+919876543210',
        channel: 'whatsapp',
      });

      expect(result.isNew).toBe(true);
      expect(result.session.userId).toBe('user-3');
      expect(mockGetUserByPhone).toHaveBeenCalledWith('+919876543210');
    });

    it('restores cart when returning after session closure', async () => {
      const closedSession: UnifiedSession = {
        userId: 'user-4',
        state: 'closed',
        lastActiveChannel: 'web',
        lastActivityAt: new Date(Date.now() - 48 * 3600000).toISOString(),
        phoneNumber: '+919876543210',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 2592000,
      };
      const existingCart: Cart = {
        userId: 'user-4',
        items: [{ productId: 'p1', sellerId: 's1', name: 'Widget', price: 50, quantity: 1 }],
        subtotal: 50,
        itemCount: 1,
        cartVersion: 2,
        updatedAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 604800,
      };

      mockGetSession.mockResolvedValue(closedSession);
      mockGetCart.mockResolvedValue(existingCart);
      mockPutSession.mockResolvedValue(undefined);

      const result = await resolveOrCreateSession({ userId: 'user-4', channel: 'web' });

      expect(result.isNew).toBe(true);
      expect(result.restoredCart).toBeDefined();
      expect(result.restoredCart!.itemCount).toBe(1);
    });

    it('throws when neither userId nor phone resolves', async () => {
      mockGetUserByPhone.mockResolvedValue(null);

      await expect(
        resolveOrCreateSession({ phoneNumber: '+910000000000', channel: 'whatsapp' }),
      ).rejects.toThrow('Cannot resolve session');
    });
  });

  describe('isInactive', () => {
    it('returns true when last activity > 24h ago', () => {
      const session: UnifiedSession = {
        userId: 'u1',
        state: 'browsing',
        lastActiveChannel: 'web',
        lastActivityAt: new Date(Date.now() - 25 * 3600000).toISOString(),
        phoneNumber: '+919876543210',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 2592000,
      };
      expect(isInactive(session)).toBe(true);
    });

    it('returns false when last activity < 24h ago', () => {
      const session: UnifiedSession = {
        userId: 'u1',
        state: 'browsing',
        lastActiveChannel: 'web',
        lastActivityAt: new Date(Date.now() - 3600000).toISOString(), // 1h ago
        phoneNumber: '+919876543210',
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 2592000,
      };
      expect(isInactive(session)).toBe(false);
    });
  });
});
