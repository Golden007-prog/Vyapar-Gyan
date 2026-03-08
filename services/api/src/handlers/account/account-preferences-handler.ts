/**
 * Account Preferences Handler
 *
 * PUT /api/v1/account/preferences — JWT-protected
 *
 * Updates preferredChannel, displayName, and language preferences
 * on the USER#{userId} PROFILE record.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { UpdatePreferencesSchema } from '../../shared/schemas';
import { getUserProfile, updateUserProfile } from '../../adapters/dynamodb-adapter';
import { logAction } from '../../services/audit-service';

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

    const parsed = UpdatePreferencesSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { preferredChannel, displayName, language } = parsed.data;

    // At least one field must be provided
    if (!preferredChannel && !displayName && !language) {
      return response(400, { error: 'At least one preference field must be provided' });
    }

    // Verify user exists and is active
    const profile = await getUserProfile(userId);
    if (!profile || profile.status === 'deleted') {
      return response(404, { error: 'Profile not found' });
    }

    // Build update object
    const updates: Record<string, unknown> = {};
    const oldValues: Record<string, unknown> = {};

    if (preferredChannel) {
      oldValues.preferredChannel = profile.preferredChannel;
      updates.preferredChannel = preferredChannel;
    }
    if (displayName) {
      oldValues.displayName = profile.displayName;
      updates.displayName = displayName;
    }
    if (language) {
      oldValues.language = (profile as Record<string, unknown>).language;
      updates.language = language;
    }

    await updateUserProfile(userId, updates);

    // Audit log
    await logAction({
      actorId: userId,
      actorRole: profile.role === 'admin' ? 'admin' : profile.role === 'seller' ? 'seller' : 'system',
      actionType: 'preferences_updated',
      resourceType: 'user',
      resourceId: userId,
      oldValues,
      newValues: updates,
    });

    logger.info('Preferences updated', { userId, updates });

    return response(200, { success: true, updated: updates });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Update preferences failed', error, { requestId });
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
