/**
 * Phone Change Handler
 *
 * POST /api/v1/account/phone/change — JWT-protected
 *
 * Two-phase flow:
 * 1. Without OTP: initiates OTP to the new phone number
 * 2. With OTP: verifies OTP, updates USER record + GSI1, updates Cognito phone_number
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { PhoneChangeSchema } from '../../shared/schemas';
import {
  getUserProfile,
  getUserByPhone,
  updateUserProfile,
} from '../../adapters/dynamodb-adapter';
import { generateOTP, storeOTP, verifyOTP, checkCooldown, checkLockout } from '../../services/otp-service';
import { twilioAdapter } from '../../adapters/twilio-adapter';
import { logAction } from '../../services/audit-service';

const cognitoClient = new CognitoIdentityProviderClient({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    // Parse and validate request body
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return response(400, { error: 'Invalid JSON body' });
    }

    const parsed = PhoneChangeSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { newPhoneNumber, otp } = parsed.data;
    const e164Phone = `+91${newPhoneNumber}`;

    // Verify user exists and is active
    const profile = await getUserProfile(userId);
    if (!profile || profile.status === 'deleted') {
      return response(404, { error: 'Profile not found' });
    }

    // Can't change to the same number
    if (profile.phoneNumber === newPhoneNumber) {
      return response(400, { error: 'New phone number is the same as current' });
    }

    // Check if new phone is already registered
    const existing = await getUserByPhone(newPhoneNumber);
    if (existing && existing.userId !== userId) {
      return response(409, { error: 'Phone number already registered to another account' });
    }

    // Phase 1: Initiate OTP (no otp field provided)
    if (!otp) {
      // Check lockout
      const lockoutRemaining = await checkLockout(newPhoneNumber);
      if (lockoutRemaining > 0) {
        return response(429, { error: 'Too many failed attempts', retryAfter: lockoutRemaining });
      }

      // Check cooldown
      const cooldownRemaining = await checkCooldown(newPhoneNumber);
      if (cooldownRemaining > 0) {
        return response(429, { error: 'Please wait before requesting another OTP', retryAfter: cooldownRemaining });
      }

      const otpCode = generateOTP();
      await storeOTP(newPhoneNumber, otpCode);

      await twilioAdapter.sendSMS(
        e164Phone,
        `Your VyaparGyan phone change verification code is ${otpCode}. Valid for 10 minutes.`,
      );

      logger.info('Phone change OTP sent', { userId, newPhoneNumber });
      return response(200, { success: true, message: 'OTP sent to new number', cooldownSeconds: 60 });
    }

    // Phase 2: Verify OTP and update phone
    const verification = await verifyOTP(newPhoneNumber, otp);
    if (!verification.valid) {
      return response(400, {
        error: verification.reason ?? 'Invalid OTP',
        attemptsRemaining: verification.attemptsRemaining,
      });
    }

    const oldPhone = profile.phoneNumber;

    // Update DynamoDB user profile — phoneNumber + GSI1PK atomically
    await updateUserProfile(userId, {
      phoneNumber: newPhoneNumber,
      phoneVerificationStatus: 'verified',
    });

    // Update Cognito phone_number attribute
    try {
      const config = await getConfig();
      await cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: config.userPoolId,
          Username: `+91${oldPhone}`,
          UserAttributes: [
            { Name: 'phone_number', Value: e164Phone },
            { Name: 'phone_number_verified', Value: 'true' },
          ],
        }),
      );
    } catch (cognitoErr) {
      logger.error('Cognito phone update failed (DDB already updated)', cognitoErr, { userId });
      // Don't fail the request — DDB is source of truth, Cognito can be reconciled
    }

    // Audit log
    await logAction({
      actorId: userId,
      actorRole: profile.role === 'admin' ? 'admin' : profile.role === 'seller' ? 'seller' : 'system',
      actionType: 'phone_changed',
      resourceType: 'user',
      resourceId: userId,
      oldValues: { phoneNumber: oldPhone },
      newValues: { phoneNumber: newPhoneNumber },
    });

    logger.info('Phone number changed', { userId, oldPhone, newPhoneNumber });

    return response(200, { success: true, message: 'Phone number updated', phoneNumber: newPhoneNumber });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Phone change failed', error, { requestId });
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
