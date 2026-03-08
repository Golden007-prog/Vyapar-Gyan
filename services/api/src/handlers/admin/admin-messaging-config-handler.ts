/**
 * Admin Messaging Config Handler
 *
 * GET  /api/v1/admin/messaging/config — JWT-protected (admin role)
 * PUT  /api/v1/admin/messaging/config — JWT-protected (admin role)
 *
 * Manages platform-wide messaging configuration: quiet hours, frequency caps,
 * and template registry settings. Stored as a single CONFIG#MESSAGING item.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { extractUserId, extractUserRole, UnauthorizedError } from '../../core/auth';
import { logAction } from '../../services/audit-service';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ---------------------------------------------------------------------------
// Defaults & Validation
// ---------------------------------------------------------------------------

const CONFIG_PK = 'CONFIG#MESSAGING';
const CONFIG_SK = 'SETTINGS';

const DEFAULT_CONFIG: MessagingConfig = {
  quietHours: { startHour: 22, endHour: 9, timezone: 'Asia/Kolkata' },
  frequencyCap: { maxPromotionalPerDay: 3, windowHours: 24 },
  templateDefaults: { defaultLanguage: 'en', requireApproval: true },
};

interface MessagingConfig {
  quietHours: { startHour: number; endHour: number; timezone: string };
  frequencyCap: { maxPromotionalPerDay: number; windowHours: number };
  templateDefaults: { defaultLanguage: string; requireApproval: boolean };
}

const MessagingConfigSchema = z.object({
  quietHours: z.object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
    timezone: z.string().min(1),
  }).optional(),
  frequencyCap: z.object({
    maxPromotionalPerDay: z.number().int().min(1).max(50),
    windowHours: z.number().int().min(1).max(168),
  }).optional(),
  templateDefaults: z.object({
    defaultLanguage: z.string().min(2).max(5),
    requireApproval: z.boolean(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);
    const role = extractUserRole(event);

    if (role !== 'admin') {
      return response(403, { error: 'Forbidden', message: 'Admin access required' });
    }

    const method = event.requestContext.http.method.toUpperCase();
    const tableName = process.env.TABLE_NAME!;

    if (method === 'GET') {
      return await handleGet(tableName);
    }

    if (method === 'PUT') {
      return await handlePut(event, tableName, userId, requestId);
    }

    return response(405, { error: 'Method not allowed' });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Messaging config handler failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// GET — return current config (or defaults)
// ---------------------------------------------------------------------------

async function handleGet(tableName: string): Promise<APIGatewayProxyResultV2> {
  const result = await ddbClient.send(
    new GetCommand({ TableName: tableName, Key: { PK: CONFIG_PK, SK: CONFIG_SK } }),
  );

  if (!result.Item) {
    return response(200, { config: DEFAULT_CONFIG });
  }

  const { PK, SK, ...config } = result.Item;
  return response(200, { config });
}

// ---------------------------------------------------------------------------
// PUT — merge updates into existing config
// ---------------------------------------------------------------------------

async function handlePut(
  event: APIGatewayProxyEventV2,
  tableName: string,
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }

  const parsed = MessagingConfigSchema.safeParse(body);
  if (!parsed.success) {
    return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
  }

  const updates = parsed.data;

  if (!updates.quietHours && !updates.frequencyCap && !updates.templateDefaults) {
    return response(400, { error: 'At least one config section must be provided' });
  }

  // Read current config
  const existing = await ddbClient.send(
    new GetCommand({ TableName: tableName, Key: { PK: CONFIG_PK, SK: CONFIG_SK } }),
  );

  const oldConfig: MessagingConfig = existing.Item
    ? { quietHours: existing.Item.quietHours, frequencyCap: existing.Item.frequencyCap, templateDefaults: existing.Item.templateDefaults }
    : { ...DEFAULT_CONFIG };

  // Merge
  const merged: MessagingConfig = {
    quietHours: updates.quietHours ?? oldConfig.quietHours,
    frequencyCap: updates.frequencyCap ?? oldConfig.frequencyCap,
    templateDefaults: updates.templateDefaults ?? oldConfig.templateDefaults,
  };

  const now = new Date().toISOString();

  await ddbClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: CONFIG_PK,
        SK: CONFIG_SK,
        ...merged,
        updatedAt: now,
        updatedBy: userId,
      },
    }),
  );

  // Audit log
  await logAction({
    actorId: userId,
    actorRole: 'admin',
    actionType: 'messaging_config_updated',
    resourceType: 'messaging_config',
    resourceId: 'global',
    oldValues: oldConfig as unknown as Record<string, unknown>,
    newValues: merged as unknown as Record<string, unknown>,
  });

  logger.info('Messaging config updated', { requestId, userId });

  return response(200, { success: true, config: merged });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
