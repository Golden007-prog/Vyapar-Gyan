/**
 * Account Delete Handler
 *
 * DELETE /api/v1/account — JWT-protected
 *
 * Soft-deletes the user account:
 * - Sets status=deleted, deletedAt timestamp
 * - Disables the Cognito user (revokes access)
 * - PII is cleared after a 30-day grace period (by a scheduled worker)
 * - Logs the deletion to audit trail
 *
 * Order history is preserved with anonymized fields for 7-year compliance.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getUserProfile, updateUserProfile } from '../../adapters/dynamodb-adapter';
import { logAction } from '../../services/audit-service';

const cognitoClient = new CognitoIdentityProviderClient({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    const profile = await getUserProfile(userId);
    if (!profile || profile.status === 'deleted') {
      return response(404, { error: 'Profile not found' });
    }

    const now = new Date().toISOString();

    // Soft-delete: mark as deleted with timestamp
    await updateUserProfile(userId, {
      status: 'deleted',
      deletedAt: now,
    });

    // Disable Cognito user to revoke all tokens
    try {
      const config = await getConfig();
      await cognitoClient.send(
        new AdminDisableUserCommand({
          UserPoolId: config.userPoolId,
          Username: `+91${profile.phoneNumber}`,
        }),
      );
    } catch (cognitoErr) {
      // Log but don't fail — DDB is source of truth
      logger.error('Cognito disable failed (DDB already soft-deleted)', cognitoErr, { userId });
    }

    // Audit log
    await logAction({
      actorId: userId,
      actorRole: profile.role === 'admin' ? 'admin' : profile.role === 'seller' ? 'seller' : 'system',
      actionType: 'account_deleted',
      resourceType: 'user',
      resourceId: userId,
      oldValues: { status: profile.status, displayName: profile.displayName },
      newValues: { status: 'deleted', deletedAt: now },
      metadata: {
        piiClearAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        note: 'PII will be anonymized after 30-day grace period',
      },
    });

    logger.info('Account soft-deleted', { userId });

    return response(200, {
      success: true,
      message: 'Account scheduled for deletion. You have 30 days to reactivate.',
      deletedAt: now,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Account delete failed', error, { requestId });
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
