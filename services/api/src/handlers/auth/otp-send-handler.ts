/**
 * OTP Send Handler
 *
 * POST /api/v1/auth/otp/send
 *
 * Validates Indian mobile number, checks cooldown/lockout, generates OTP,
 * stores hashed OTP in DynamoDB, and sends via Twilio SMS.
 * Unauthenticated endpoint.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { SendOTPSchema } from '../../shared/schemas';
import { generateOTP, storeOTP, checkCooldown, checkLockout } from '../../services/otp-service';
import { twilioAdapter } from '../../adapters/twilio-adapter';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;
  logger.info('OTP send request', { requestId });

  try {
    // Parse & validate request body
    const body = JSON.parse(event.body || '{}');
    const parsed = SendOTPSchema.safeParse(body);

    if (!parsed.success) {
      return response(400, {
        error: 'Validation failed',
        details: parsed.error.issues.map(i => i.message),
      });
    }

    const { phoneNumber } = parsed.data;
    const e164Phone = `+91${phoneNumber}`;

    // Check lockout (3 failures → 1h lock)
    const lockoutRemaining = await checkLockout(phoneNumber);
    if (lockoutRemaining > 0) {
      logger.warn('OTP send blocked by lockout', { phoneNumber, lockoutRemaining });
      return response(429, {
        error: 'Too many failed attempts',
        retryAfter: lockoutRemaining,
      });
    }

    // Check cooldown (60s between resends)
    const cooldownRemaining = await checkCooldown(phoneNumber);
    if (cooldownRemaining > 0) {
      logger.info('OTP send blocked by cooldown', { phoneNumber, cooldownRemaining });
      return response(429, {
        error: 'Please wait before requesting another OTP',
        retryAfter: cooldownRemaining,
      });
    }

    // Generate, store, and send
    const otp = generateOTP();
    await storeOTP(phoneNumber, otp);

    await twilioAdapter.sendSMS(
      e164Phone,
      `Your VyaparGyan verification code is ${otp}. Valid for 10 minutes. Do not share this code.`,
    );

    logger.info('OTP sent successfully', { phoneNumber });

    return response(200, {
      success: true,
      message: 'OTP sent',
      cooldownSeconds: 60,
    });
  } catch (error) {
    logger.error('OTP send failed', error, { requestId });
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
