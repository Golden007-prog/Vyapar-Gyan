/**
 * OTP Service
 *
 * Handles OTP generation, storage, verification, cooldown, and lockout logic.
 * OTPs are stored as SHA-256 hashes in DynamoDB with 10-minute TTL.
 *
 * Security:
 * - Cryptographically random 6-digit OTP via crypto.randomInt
 * - SHA-256 hash stored (never plaintext)
 * - 60-second cooldown between resend requests
 * - 3-failure lockout for 1 hour
 */

import { randomInt, createHash } from 'crypto';
import { logger } from '../utils/logger';
import {
  putOTP,
  getOTP,
  updateOTPFailure,
  type OTPRecord,
} from '../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OTP_TTL_MINUTES = 10;
const COOLDOWN_SECONDS = 60;
const MAX_FAILURES = 3;
const LOCKOUT_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hash of a plaintext OTP string. */
function hashOTP(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random 6-digit OTP.
 * Uses crypto.randomInt for uniform distribution in [100000, 999999].
 */
export function generateOTP(): string {
  return String(randomInt(100000, 1000000));
}

/**
 * Store an OTP for a phone number.
 * The OTP is SHA-256 hashed before persistence. Previous OTP for the same
 * phone is overwritten (PK: OTP#{phone}, SK: LATEST).
 */
export async function storeOTP(phoneNumber: string, otp: string): Promise<void> {
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + OTP_TTL_MINUTES * 60;

  const record: OTPRecord = {
    phoneNumber,
    otpHash: hashOTP(otp),
    failureCount: 0,
    createdAt: now.toISOString(),
    expiresAt,
  };

  await putOTP(record);
  logger.info('OTP stored', { phoneNumber, expiresAt });
}

/**
 * Verify a submitted OTP against the stored hash.
 *
 * Returns `{ valid: true }` on success, or `{ valid: false, reason, attemptsRemaining? }`
 * on failure. Increments the failure counter and sets lockout after 3 failures.
 */
export async function verifyOTP(
  phoneNumber: string,
  otp: string,
): Promise<{ valid: boolean; reason?: string; attemptsRemaining?: number }> {
  const record = await getOTP(phoneNumber);

  if (!record) {
    return { valid: false, reason: 'No OTP found for this phone number' };
  }

  // Check lockout
  if (record.lockoutUntil) {
    const lockoutEnd = new Date(record.lockoutUntil).getTime();
    if (Date.now() < lockoutEnd) {
      return { valid: false, reason: 'Account locked due to too many failed attempts' };
    }
  }

  // Check expiry
  const nowEpoch = Math.floor(Date.now() / 1000);
  if (nowEpoch >= record.expiresAt) {
    return { valid: false, reason: 'OTP has expired' };
  }

  // Compare hashes
  if (hashOTP(otp) !== record.otpHash) {
    const newFailureCount = record.failureCount + 1;
    const attemptsRemaining = MAX_FAILURES - newFailureCount;

    if (newFailureCount >= MAX_FAILURES) {
      // Set lockout
      const lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
      await updateOTPFailure(phoneNumber, newFailureCount, lockoutUntil);
      logger.warn('OTP lockout activated', { phoneNumber, failureCount: newFailureCount });
      return { valid: false, reason: 'Too many failed attempts. Locked for 1 hour.', attemptsRemaining: 0 };
    }

    await updateOTPFailure(phoneNumber, newFailureCount);
    logger.warn('OTP verification failed', { phoneNumber, failureCount: newFailureCount });
    return { valid: false, reason: 'Invalid OTP', attemptsRemaining };
  }

  logger.info('OTP verified successfully', { phoneNumber });
  return { valid: true };
}

/**
 * Check if a cooldown is active for the given phone number.
 * Returns the remaining seconds if within cooldown, or 0 if clear.
 */
export async function checkCooldown(phoneNumber: string): Promise<number> {
  const record = await getOTP(phoneNumber);
  if (!record) return 0;

  const createdMs = new Date(record.createdAt).getTime();
  const elapsedMs = Date.now() - createdMs;
  const remainingMs = COOLDOWN_SECONDS * 1000 - elapsedMs;

  if (remainingMs > 0) {
    return Math.ceil(remainingMs / 1000);
  }
  return 0;
}

/**
 * Check if the phone number is currently locked out.
 * Returns the remaining seconds until lockout expires, or 0 if not locked.
 */
export async function checkLockout(phoneNumber: string): Promise<number> {
  const record = await getOTP(phoneNumber);
  if (!record?.lockoutUntil) return 0;

  const lockoutEnd = new Date(record.lockoutUntil).getTime();
  const remainingMs = lockoutEnd - Date.now();

  if (remainingMs > 0) {
    return Math.ceil(remainingMs / 1000);
  }
  return 0;
}
