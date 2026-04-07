/**
 * Seller Messages Handler
 *
 * GET /api/v1/seller/inbox/{userId}/messages — JWT-protected (seller role)
 *
 * Returns paginated messages for a specific customer conversation
 * from THREAD#{sellerId}, filtered by customerUserId.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { queryMessages, resolveSellerId } from '../../adapters/dynamodb-adapter';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const cognitoSub = extractUserId(event);
    const sellerId = await resolveSellerId(cognitoSub);
    const customerUserId = event.pathParameters?.userId;

    if (!customerUserId) {
      return response(400, { error: 'Customer userId is required' });
    }

    const limit = Math.min(
      parseInt(event.queryStringParameters?.limit || '50', 10),
      100,
    );
    const cursor = event.queryStringParameters?.cursor;
    const sinceTimestamp = event.queryStringParameters?.since;

    logger.info('Seller messages request', {
      requestId,
      sellerId,
      customerUserId,
      limit,
    });

    // Parse cursor for pagination
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf-8'),
        );
      } catch {
        // Invalid cursor — start from beginning
      }
    }

    // Query messages from THREAD#{sellerId} and filter by customerUserId
    const queryOpts: Parameters<typeof queryMessages>[0] = {
      userId: sellerId,
      limit: limit * 2, // over-fetch to account for filtering
      scanForward: true, // chronological order for chat display
    };
    if (sinceTimestamp) {
      queryOpts.sinceTimestamp = sinceTimestamp;
    }
    if (exclusiveStartKey) {
      queryOpts.exclusiveStartKey = exclusiveStartKey;
    }
    const result = await queryMessages(queryOpts);

    // Filter messages belonging to this customer conversation
    const filtered = result.messages.filter(
      (msg) => (msg as any).customerUserId === customerUserId,
    );

    const messages = filtered.slice(0, limit);

    // Build next cursor
    const nextCursor = result.lastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64url')
      : null;

    logger.info('Seller messages retrieved', {
      sellerId,
      customerUserId,
      messageCount: messages.length,
    });

    return response(200, {
      messages,
      nextCursor,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Seller messages failed', error, { requestId });
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
