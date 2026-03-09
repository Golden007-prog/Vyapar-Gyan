/**
 * Register Handler
 *
 * POST /api/v1/auth/register
 *
 * Creates a Cognito user with role group, creates USER#{userId} PROFILE in
 * DynamoDB with GSI1 PHONE#{phone} and GSI2 ROLE#{role}, checks for duplicate
 * phone via GSI1, and sends a welcome WhatsApp template via Twilio.
 * Unauthenticated endpoint.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { RegisterSchema } from '../../shared/schemas';
import {
  createUserProfile,
  getUserByPhone,
  type UserProfile,
} from '../../adapters/dynamodb-adapter';
import { twilioAdapter } from '../../adapters/twilio-adapter';

const cognitoClient = new CognitoIdentityProviderClient({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;
  logger.info('Register request', { requestId });

  try {
    // Parse & validate
    const body = JSON.parse(event.body || '{}');
    const parsed = RegisterSchema.safeParse(body);

    if (!parsed.success) {
      return response(400, {
        error: 'Validation failed',
        details: parsed.error.issues.map(i => i.message),
      });
    }

    const { role, phoneNumber, displayName, password, businessName, businessAddress, gstNumber } =
      parsed.data;
    const e164Phone = `+91${phoneNumber}`;

    // Check duplicate via GSI1 PHONE#{phone}
    const existing = await getUserByPhone(phoneNumber);
    if (existing) {
      logger.warn('Duplicate registration attempt', { phoneNumber });
      return response(409, { error: 'Phone number already registered' });
    }

    // Create Cognito user
    const config = await getConfig();
    const userPoolId = config.userPoolId;

    const createUserRes = await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: e164Phone,
        UserAttributes: [
          { Name: 'phone_number', Value: e164Phone },
          { Name: 'phone_number_verified', Value: 'true' },
          { Name: 'name', Value: displayName },
        ],
        MessageAction: MessageActionType.SUPPRESS, // Don't send Cognito welcome email
      }),
    );

    const cognitoUserId = createUserRes.User?.Username;
    const cognitoSub =
      createUserRes.User?.Attributes?.find(a => a.Name === 'sub')?.Value ?? cognitoUserId;

    if (!cognitoSub) {
      throw new Error('Failed to get Cognito user sub');
    }

    // Set permanent password (skip force-change flow)
    await cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: e164Phone,
        Password: password,
        Permanent: true,
      }),
    );

    // Add user to role group
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: e164Phone,
        GroupName: role,
      }),
    );

    // Create DynamoDB user profile
    const now = new Date().toISOString();
    const profile: UserProfile = {
      userId: cognitoSub,
      role,
      displayName,
      phoneNumber,
      phoneVerificationStatus: 'unverified',
      preferredChannel: 'web',
      whatsappConnected: false,
      cognitoId: cognitoSub,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    if (role === 'seller') {
      (profile as any).businessName = businessName;
      (profile as any).businessAddress = businessAddress;
      (profile as any).gstNumber = gstNumber;
      (profile as any).sellerStatus = 'pending_approval';
    }

    await createUserProfile(profile);
    logger.info('User profile created in DynamoDB', { userId: cognitoSub, role });

    // Send welcome WhatsApp template (best-effort, don't fail registration)
    try {
      await twilioAdapter.sendWhatsAppMessage(
        e164Phone,
        `Welcome to VyaparGyan, ${displayName}! 🎉 Your ${role} account has been created. ${role === 'seller' ? 'Your account is pending admin approval.' : 'Start shopping now!'}`,
      );
    } catch (welcomeErr) {
      logger.warn('Welcome message failed (non-blocking)', {
        userId: cognitoSub,
        error: welcomeErr instanceof Error ? welcomeErr.message : String(welcomeErr),
      });
    }

    return response(201, {
      success: true,
      userId: cognitoSub,
      role,
    });
  } catch (error) {
    // Handle Cognito-specific errors
    const errorName = (error as any)?.name;
    if (errorName === 'UsernameExistsException') {
      return response(409, { error: 'Phone number already registered' });
    }

    logger.error('Registration failed', error, { requestId });
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
