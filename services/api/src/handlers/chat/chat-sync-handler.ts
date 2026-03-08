/**
 * Chat Sync Handler
 *
 * GET /api/v1/chat/sync — JWT-protected
 *
 * Poll endpoint returning new messages since lastSyncTimestamp,
 * cart state (if cartVersion differs), and typing indicators.
 * Returns 304 if no updates. ETag header derived from cartVersion.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { SyncQuerySchema } from '../../shared/schemas';
import { queryMessages, getCart } from '../../adapters/dynamodb-adapter';
import type { Cart, MessageThread } from '../../adapters/dynamodb-adapter';
import { publishLatencyMetric } from '../../core/metrics';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const startTime = Date.now();
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    // Validate query params
    const parsed = SyncQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { lastSyncTimestamp, cartVersion: clientCartVersion } = parsed.data;

    // Query new messages since lastSyncTimestamp
    let messages: MessageThread[] = [];
    if (lastSyncTimestamp) {
      const result = await queryMessages({
        userId,
        sinceTimestamp: lastSyncTimestamp,
        scanForward: false,
      });
      messages = result.messages;
    }

    // Get cart state — only return if version differs from client's
    let cartState: Cart | null = null;
    const cart = await getCart(userId);
    const currentCartVersion = cart?.cartVersion ?? 0;

    if (clientCartVersion !== undefined && clientCartVersion === currentCartVersion && messages.length === 0) {
      // No updates — return 304
      return {
        statusCode: 304,
        headers: {
          'ETag': `"${currentCartVersion}"`,
          'Cache-Control': 'no-cache',
        },
        body: '',
      };
    }

    // Only include cart if version differs
    if (clientCartVersion === undefined || clientCartVersion !== currentCartVersion) {
      cartState = cart;
    }

    // Typing indicators are ephemeral — in a full implementation these would
    // be read from DynamoDB TYPING#{userId} items with short TTL. For now
    // return an empty array since the typing-handler stores them separately.
    const typingIndicators: unknown[] = [];

    const now = new Date().toISOString();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'ETag': `"${currentCartVersion}"`,
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        messages,
        cartState,
        typingIndicators,
        lastSyncTimestamp: now,
        cartVersion: currentCartVersion,
      }),
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Chat sync failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  } finally {
    const elapsed = Date.now() - startTime;
    publishLatencyMetric('CartSyncLatency', elapsed);
    publishLatencyMetric('PollResponseLatency', elapsed);
  }
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
