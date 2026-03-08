/**
 * Chat Typing Handler
 *
 * POST /api/v1/chat/typing — JWT-protected
 *
 * Stores an ephemeral typing indicator in DynamoDB with a 10-second TTL.
 * Returns 204 No Content.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getConfig } from '../../utils/config';

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Typing indicator TTL in seconds */
const TYPING_TTL_SECONDS = 10;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    const config = await getConfig();
    const now = new Date();
    const expiresAt = Math.floor(now.getTime() / 1000) + TYPING_TTL_SECONDS;

    // Store ephemeral typing indicator with short TTL
    await docClient.send(
      new PutCommand({
        TableName: config.tableName,
        Item: {
          PK: `TYPING#${userId}`,
          SK: 'INDICATOR',
          userId,
          isTyping: true,
          updatedAt: now.toISOString(),
          expiresAt,
        },
      }),
    );

    logger.info('Typing indicator stored', { userId, requestId });

    return {
      statusCode: 204,
      headers: {},
      body: '',
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }
    logger.error('Chat typing failed', error, { requestId });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
