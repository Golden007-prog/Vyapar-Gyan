/**
 * OTP Verify Handler
 *
 * POST /api/v1/auth/otp/verify
 *
 * Validates submitted OTP against stored SHA-256 hash, updates USER#{userId}
 * phoneVerificationStatus on success, increments failure counter on invalid,
 * and sets lockout after 3 failures.
 * Unauthenticated endpoint.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { VerifyOTPSchema } from '../../shared/schemas';
import { verifyOTP } from '../../services/otp-service';
import { getUserByPhone, updateUserProfile } from '../../adapters/dynamodb-adapter';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;
  logger.info('OTP verify request', { requestId });

  try {
    // Parse & validate
    const body = JSON.parse(event.body || '{}');
    const parsed = VerifyOTPSchema.safeParse(body);

    if (!parsed.success) {
      return response(400, {
        error: 'Validation failed',
        details: parsed.error.issues.map(i => i.message),
      });
    }

    const { phoneNumber, otp, userId: providedUserId } = parsed.data;

    // Verify OTP (handles hash compare, expiry, failure counting, lockout)
    const result = await verifyOTP(phoneNumber, otp);

    if (!result.valid) {
      const statusCode = result.reason?.includes('locked') ? 429 : 400;
      return response(statusCode, {
        error: result.reason ?? 'Invalid OTP',
        ...(result.attemptsRemaining !== undefined && {
          attemptsRemaining: result.attemptsRemaining,
        }),
      });
    }

    // OTP valid — resolve user and update phoneVerificationStatus
    let userId = providedUserId;

    if (!userId) {
      const user = await getUserByPhone(phoneNumber);
      userId = user?.userId;
    }

    if (userId) {
      await updateUserProfile(userId, { phoneVerificationStatus: 'verified' });
      logger.info('Phone verification status updated', { userId, phoneNumber });
    }

    return response(200, {
      success: true,
      verified: true,
      ...(userId && { userId }),
    });
  } catch (error) {
    logger.error('OTP verify failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
