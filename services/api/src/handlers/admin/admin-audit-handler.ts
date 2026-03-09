/**
 * Admin Audit Handler
 *
 * GET /api/v1/admin/audit — JWT-protected (admin role)
 *
 * Query audit logs by actor (GSI1: ACTOR#{actorId}) or by resource
 * (GSI2: RESOURCE#{type}#{id}), with date range filters and cursor-based pagination.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { extractUserId, extractUserRole, UnauthorizedError } from '../../core/auth';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const AuditQuerySchema = z.object({
  actorId: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    extractUserId(event); // validate auth token
    const role = extractUserRole(event);

    if (role !== 'admin') {
      return response(403, { error: 'Forbidden', message: 'Admin access required' });
    }

    // Parse query parameters
    const parsed = AuditQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { actorId, resourceType, resourceId, startDate, endDate, limit, cursor } = parsed.data;

    // Must provide either actorId or (resourceType + resourceId)
    if (!actorId && (!resourceType || !resourceId)) {
      return response(400, { error: 'Provide actorId or both resourceType and resourceId' });
    }

    const tableName = process.env.TABLE_NAME!;
    let exclusiveStartKey: Record<string, unknown> | undefined;

    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
      } catch {
        return response(400, { error: 'Invalid cursor' });
      }
    }

    // Build date range key condition
    const skStart = startDate ? `TS#${startDate}` : undefined;
    const skEnd = endDate ? `TS#${endDate}` : undefined;

    let keyCondition: string;
    const exprValues: Record<string, unknown> = {};
    const exprNames: Record<string, string> = {};
    let indexName: string;

    if (actorId) {
      // Query by actor — GSI1
      indexName = 'GSI1';
      exprValues[':pk'] = `ACTOR#${actorId}`;
      exprNames['#pk'] = 'GSI1PK';
      exprNames['#sk'] = 'GSI1SK';
      keyCondition = '#pk = :pk';
    } else {
      // Query by resource — GSI2
      indexName = 'GSI2';
      exprValues[':pk'] = `RESOURCE#${resourceType}#${resourceId}`;
      exprNames['#pk'] = 'GSI2PK';
      exprNames['#sk'] = 'GSI2SK';
      keyCondition = '#pk = :pk';
    }

    // Add date range to sort key condition
    if (skStart && skEnd) {
      keyCondition += ' AND #sk BETWEEN :skStart AND :skEnd';
      exprValues[':skStart'] = skStart;
      exprValues[':skEnd'] = skEnd;
    } else if (skStart) {
      keyCondition += ' AND #sk >= :skStart';
      exprValues[':skStart'] = skStart;
    } else if (skEnd) {
      keyCondition += ' AND #sk <= :skEnd';
      exprValues[':skEnd'] = skEnd;
    }

    const result = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        Limit: limit,
        ScanIndexForward: false, // newest first
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      }),
    );

    const items = (result.Items ?? []).map(stripKeys);

    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url')
      : null;

    logger.info('Audit logs queried', { requestId, count: items.length, actorId, resourceType, resourceId });

    return response(200, { auditLogs: items, nextCursor });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Admin audit query failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove DynamoDB key attributes from the response payload */
function stripKeys(item: Record<string, unknown>): Record<string, unknown> {
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...rest } = item;
  return rest;
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
