/**
 * User Lookup Service
 *
 * Resolves a user by phone number using DynamoDB GSI1 (PHONE#{normalized}).
 * Returns the user's ID, role, and profile — or null for unregistered numbers.
 *
 * @module user-lookup
 */

import { getUserByPhone, type UserProfile } from '../adapters/dynamodb-adapter';
import { normalizeIndianPhone } from '../utils/phone-normalize';
import { logger } from '../utils/logger';

export interface ResolvedUser {
  userId: string;
  role: 'seller' | 'customer' | 'admin';
  profile: UserProfile;
}

/**
 * Resolve a user by their phone number.
 *
 * 1. Normalize the phone via `normalizeIndianPhone()`
 * 2. Query DynamoDB GSI1 (GSI1PK = PHONE#{normalized})
 * 3. Return `{ userId, role, profile }` or `null` for unregistered
 *
 * @param phone - Raw phone number in any supported format
 * @returns Resolved user or null if not found
 */
export async function resolveUserByPhone(phone: string): Promise<ResolvedUser | null> {
  let normalized: string;
  try {
    normalized = normalizeIndianPhone(phone);
  } catch (err) {
    logger.warn('Phone normalization failed in resolveUserByPhone', {
      phone,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const profile = await getUserByPhone(normalized);

  if (!profile) {
    logger.debug('No user found for phone', { normalized });
    return null;
  }

  logger.info('User resolved by phone', {
    userId: profile.userId,
    role: profile.role,
    normalized,
  });

  return {
    userId: profile.userId,
    role: profile.role,
    profile,
  };
}
