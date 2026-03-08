/**
 * Account Profile Handler
 *
 * GET /api/v1/account/profile — JWT-protected
 *
 * Returns the authenticated user's profile from USER#{userId} PROFILE.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getUserProfile } from '../../adapters/dynamodb-adapter';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    const profile = await getUserProfile(userId);
    if (!profile) {
      return response(404, { error: 'Profile not found' });
    }

    // Don't return deleted profiles
    if (profile.status === 'deleted') {
      return response(404, { error: 'Profile not found' });
    }

    return response(200, {
      userId: profile.userId,
      role: profile.role,
      displayName: profile.displayName,
      phoneNumber: profile.phoneNumber,
      phoneVerificationStatus: profile.phoneVerificationStatus,
      preferredChannel: profile.preferredChannel,
      whatsappConnected: profile.whatsappConnected,
      businessName: profile.businessName,
      businessAddress: profile.businessAddress,
      gstNumber: profile.gstNumber,
      sellerStatus: profile.sellerStatus,
      status: profile.status,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Get profile failed', error, { requestId });
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
