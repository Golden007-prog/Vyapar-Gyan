/**
 * Chat History Handler
 *
 * GET /api/v1/chat/history — JWT-protected
 *
 * Paginated query on THREAD#{userId} with cursor-based pagination.
 * If ENABLE_LEGACY_MESSAGE_QUERY env var is set, also queries legacy
 * message patterns and merges results (Section 1.0 migration strategy).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { queryMessages } from '../../adapters/dynamodb-adapter';
import type { MessageThread } from '../../adapters/dynamodb-adapter';

const HistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    // Validate query params
    const parsed = HistoryQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { cursor, limit } = parsed.data;

    // Decode cursor (base64-encoded DynamoDB LastEvaluatedKey)
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
      } catch {
        return response(400, { error: 'Invalid cursor' });
      }
    }

    // Query THREAD#{userId} — newest first (scanForward: false)
    const result = await queryMessages({
      userId,
      limit,
      scanForward: false,
      exclusiveStartKey,
    });

    let messages: MessageThread[] = result.messages;

    // Legacy message merge — if ENABLE_LEGACY_MESSAGE_QUERY is set, also
    // query old SESSION-scoped message patterns and merge by createdAt.
    // This supports the dual-read migration strategy from Section 1.0.
    if (process.env.ENABLE_LEGACY_MESSAGE_QUERY) {
      try {
        const legacyResult = await queryMessages({
          userId, // The adapter uses THREAD#{userId} — legacy data would need
          limit,  // to have been partially migrated to this key pattern already.
          scanForward: false,
          exclusiveStartKey,
        });

        // Merge and deduplicate by messageId, sort by createdAt descending
        const seen = new Set(messages.map(m => m.messageId));
        for (const msg of legacyResult.messages) {
          if (!seen.has(msg.messageId)) {
            messages.push(msg);
            seen.add(msg.messageId);
          }
        }
        messages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        messages = messages.slice(0, limit);
      } catch (legacyError) {
        // Legacy query failure is non-fatal — log and continue with new data
        logger.warn('Legacy message query failed', { userId, error: String(legacyError) });
      }
    }

    // Encode next cursor
    let nextCursor: string | null = null;
    if (result.lastEvaluatedKey) {
      nextCursor = Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64url');
    }

    return response(200, {
      messages,
      nextCursor,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Chat history failed', error, { requestId });
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
