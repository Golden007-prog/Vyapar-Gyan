/**
 * Unit tests for Consent Service
 *
 * Validates: checkSendPermission (opt-out, quiet hours, frequency cap),
 * handleOptOut keyword detection, recordInboundMessage.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetWhatsAppOptIn = jest.fn();
const mockPutWhatsAppOptIn = jest.fn();
const mockGetServiceWindow = jest.fn();
const mockPutServiceWindow = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  getWhatsAppOptIn: (...args: unknown[]) => mockGetWhatsAppOptIn(...args),
  putWhatsAppOptIn: (...args: unknown[]) => mockPutWhatsAppOptIn(...args),
  getServiceWindow: (...args: unknown[]) => mockGetServiceWindow(...args),
  putServiceWindow: (...args: unknown[]) => mockPutServiceWindow(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { checkSendPermission, handleOptOut, recordInboundMessage } from '../consent-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Consent Service', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  describe('checkSendPermission', () => {
    it('always allows transactional messages', async () => {
      const result = await checkSendPermission('user-1', 'transactional');
      expect(result.allowed).toBe(true);
    });

    it('blocks promotional messages when user opted out', async () => {
      mockGetWhatsAppOptIn.mockResolvedValue({ optedOut: true, suppressPromotional: true });

      const result = await checkSendPermission('user-1', 'promotional');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('opted_out');
    });

    it('blocks promotional messages when frequency cap reached (outside quiet hours)', async () => {
      mockGetWhatsAppOptIn.mockResolvedValue({ optedOut: false });

      // Set time to 14:00 UTC = 19:30 IST (outside quiet hours 22:00-09:00 IST)
      const safeTime = new Date('2025-01-15T14:00:00.000Z');
      jest.useFakeTimers({ now: safeTime });

      mockGetServiceWindow.mockResolvedValue({
        serviceWindowExpiresAt: new Date(safeTime.getTime() + 86400000).toISOString(),
        promotionalMessageCount: 3,
        lastPromotionalResetAt: safeTime.toISOString(),
      });

      const result = await checkSendPermission('user-1', 'promotional');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('frequency_cap');

      jest.useRealTimers();
    });

    it('requires template when service window expired', async () => {
      // Set time to 14:00 UTC = 19:30 IST (outside quiet hours)
      const safeTime = new Date('2025-01-15T14:00:00.000Z');
      jest.useFakeTimers({ now: safeTime });

      mockGetWhatsAppOptIn.mockResolvedValue({ optedOut: false });
      mockGetServiceWindow.mockResolvedValue({
        serviceWindowExpiresAt: new Date(safeTime.getTime() - 3600000).toISOString(), // expired 1h ago
        promotionalMessageCount: 0,
        lastPromotionalResetAt: safeTime.toISOString(),
      });

      const result = await checkSendPermission('user-1', 'promotional');
      expect(result.allowed).toBe(true);
      expect(result.requiresTemplate).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('handleOptOut', () => {
    it('detects "STOP" keyword and updates consent', async () => {
      mockGetWhatsAppOptIn.mockResolvedValue(null);
      mockPutWhatsAppOptIn.mockResolvedValue(undefined);

      const result = await handleOptOut('user-1', 'STOP');
      expect(result).toBe(true);
      expect(mockPutWhatsAppOptIn).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ optedOut: true, suppressPromotional: true }),
      );
    });

    it('detects Hindi opt-out keyword "रुको"', async () => {
      mockGetWhatsAppOptIn.mockResolvedValue(null);
      mockPutWhatsAppOptIn.mockResolvedValue(undefined);

      const result = await handleOptOut('user-1', 'रुको');
      expect(result).toBe(true);
    });

    it('returns false for non-opt-out messages', async () => {
      const result = await handleOptOut('user-1', 'Hello, I want to order');
      expect(result).toBe(false);
      expect(mockPutWhatsAppOptIn).not.toHaveBeenCalled();
    });
  });

  describe('recordInboundMessage', () => {
    it('updates service window to now + 24h', async () => {
      mockGetServiceWindow.mockResolvedValue(null);
      mockPutServiceWindow.mockResolvedValue(undefined);

      await recordInboundMessage('user-1');

      expect(mockPutServiceWindow).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          serviceWindowExpiresAt: expect.any(String),
          promotionalMessageCount: 0,
        }),
      );

      // Verify the expiry is roughly 24h from now
      const stored = mockPutServiceWindow.mock.calls[0][1];
      const expiryMs = new Date(stored.serviceWindowExpiresAt).getTime();
      const expectedMs = Date.now() + 24 * 60 * 60 * 1000;
      expect(Math.abs(expiryMs - expectedMs)).toBeLessThan(5000);
    });
  });
});
