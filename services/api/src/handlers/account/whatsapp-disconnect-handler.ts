/**
 * WhatsApp Disconnect Handler
 *
 * POST /api/v1/account/whatsapp/disconnect — JWT-protected
 *
 * Sets whatsappConnected=false, updates preferredChannel to web,
 * and preserves all message history (no data deletion).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getUserProfile, updateUserProfile } from '../../adapters/dynamodb-adapter';
import { logAction } from '../../services/audit-service';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    const profile = await getUserProfile(userId);
    if (!profile || profile.status === 'deleted') {
      return response(404, { error: 'Profile not found' });
    }

    if (!profile.whatsappConnected) {
      return response(400, { error: 'WhatsApp is not connected' });
    }

    const oldValues = {
      whatsappConnected: profile.whatsappConnected,
      preferredChannel: profile.preferredChannel,
    };

    // Update profile: disconnect WhatsApp, switch to web channel
    await updateUserProfile(userId, {
      whatsappConnected: false,
      preferredChannel: 'web',
    });

    // Audit log — message history is preserved (no deletion)
    await logAction({
      actorId: userId,
      actorRole: profile.role === 'admin' ? 'admin' : profile.role === 'seller' ? 'seller' : 'system',
      actionType: 'whatsapp_disconnected',
      resourceType: 'user',
      resourceId: userId,
      oldValues,
      newValues: { whatsappConnected: false, preferredChannel: 'web' },
    });

    logger.info('WhatsApp disconnected', { userId });

    return response(200, {
      success: true,
      message: 'WhatsApp disconnected. You can continue using web chat.',
      preferredChannel: 'web',
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('WhatsApp disconnect failed', error, { requestId });
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
