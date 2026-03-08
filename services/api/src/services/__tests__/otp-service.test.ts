/**
 * Unit tests for OTP Service
 *
 * Validates: OTP generation, storage, verification, cooldown, and lockout logic.
 */

import { generateOTP, storeOTP, verifyOTP, checkCooldown, checkLockout } from '../otp-service';
import type { OTPRecord } from '../../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPutOTP = jest.fn();
const mockGetOTP = jest.fn();
const mockUpdateOTPFailure = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  putOTP: (...args: unknown[]) => mockPutOTP(...args),
  getOTP: (...args: unknown[]) => mockGetOTP(...args),
  updateOTPFailure: (...args: unknown[]) => mockUpdateOTPFailure(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OTP Service', () => {
  beforeEach(() => jest.clearAllMocks());

  // ---- generateOTP ----
  describe('generateOTP', () => {
    it('returns a 6-digit numeric string', () => {
      const otp = generateOTP();
      expect(otp).toMatch(/^\d{6}$/);
      expect(Number(otp)).toBeGreaterThanOrEqual(100000);
      expect(Number(otp)).toBeLessThanOrEqual(999999);
    });
  });

  // ---- storeOTP ----
  describe('storeOTP', () => {
    it('stores a hashed OTP with TTL in DynamoDB', async () => {
      mockPutOTP.mockResolvedValue(undefined);

      await storeOTP('+919876543210', '123456');

      expect(mockPutOTP).toHaveBeenCalledTimes(1);
      const stored = mockPutOTP.mock.calls[0][0] as OTPRecord;
      expect(stored.phoneNumber).toBe('+919876543210');
      // Hash should NOT be the plaintext OTP
      expect(stored.otpHash).not.toBe('123456');
      expect(stored.otpHash).toHaveLength(64); // SHA-256 hex
      expect(stored.failureCount).toBe(0);
      expect(stored.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  // ---- verifyOTP ----
  describe('verifyOTP', () => {
    it('returns valid:true for correct OTP within expiry', async () => {
      // Pre-compute the SHA-256 hash of '654321'
      const { createHash } = require('crypto');
      const hash = createHash('sha256').update('654321').digest('hex');

      mockGetOTP.mockResolvedValue({
        phoneNumber: '+919876543210',
        otpHash: hash,
        failureCount: 0,
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600, // 10 min from now
      } satisfies OTPRecord);

      const result = await verifyOTP('+919876543210', '654321');
      expect(result.valid).toBe(true);
    });

    it('returns valid:false and increments failure for wrong OTP', async () => {
      mockGetOTP.mockResolvedValue({
        phoneNumber: '+919876543210',
        otpHash: 'wrong-hash',
        failureCount: 0,
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });
      mockUpdateOTPFailure.mockResolvedValue(undefined);

      const result = await verifyOTP('+919876543210', '000000');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid OTP');
      expect(result.attemptsRemaining).toBe(2);
      expect(mockUpdateOTPFailure).toHaveBeenCalledWith('+919876543210', 1);
    });

    it('activates lockout after 3 failures', async () => {
      mockGetOTP.mockResolvedValue({
        phoneNumber: '+919876543210',
        otpHash: 'wrong-hash',
        failureCount: 2, // already 2 failures
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });
      mockUpdateOTPFailure.mockResolvedValue(undefined);

      const result = await verifyOTP('+919876543210', '000000');
      expect(result.valid).toBe(false);
      expect(result.attemptsRemaining).toBe(0);
      // Should have been called with lockoutUntil
      expect(mockUpdateOTPFailure).toHaveBeenCalledWith(
        '+919876543210',
        3,
        expect.any(String), // lockoutUntil ISO string
      );
    });

    it('returns expired when OTP TTL has passed', async () => {
      mockGetOTP.mockResolvedValue({
        phoneNumber: '+919876543210',
        otpHash: 'some-hash',
        failureCount: 0,
        createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) - 60, // expired 1 min ago
      });

      const result = await verifyOTP('+919876543210', '123456');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('OTP has expired');
    });
  });

  // ---- checkCooldown ----
  describe('checkCooldown', () => {
    it('returns 0 when no OTP exists', async () => {
      mockGetOTP.mockResolvedValue(null);
      expect(await checkCooldown('+919876543210')).toBe(0);
    });

    it('returns remaining seconds when within 60s cooldown', async () => {
      mockGetOTP.mockResolvedValue({
        phoneNumber: '+919876543210',
        otpHash: 'h',
        failureCount: 0,
        createdAt: new Date(Date.now() - 30_000).toISOString(), // 30s ago
        expiresAt: Math.floor(Date.now() / 1000) + 570,
      });

      const remaining = await checkCooldown('+919876543210');
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(30);
    });
  });

  // ---- checkLockout ----
  describe('checkLockout', () => {
    it('returns 0 when no lockout is set', async () => {
      mockGetOTP.mockResolvedValue({ phoneNumber: '+919876543210', failureCount: 1 });
      expect(await checkLockout('+919876543210')).toBe(0);
    });

    it('returns remaining seconds when locked out', async () => {
      const lockoutUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min from now
      mockGetOTP.mockResolvedValue({
        phoneNumber: '+919876543210',
        failureCount: 3,
        lockoutUntil,
      });

      const remaining = await checkLockout('+919876543210');
      expect(remaining).toBeGreaterThan(0);
    });
  });
});
