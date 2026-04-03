/**
 * WebSocket $disconnect Handler
 *
 * Cleans up the Connection Registry item for the disconnected client and
 * updates the user's PRESENCE record. If no connections remain, marks the
 * user as offline with a lastSeen timestamp.
 *
 * Always returns 200 (best-effort cleanup — stale items are caught by TTL).
 *
 * Validates: Requirements 2.3, 14.1, 14.2
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Clients (singleton, reused across warm invocations)
// ---------------------------------------------------------------------------

const rawDdb = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(rawDdb, {
  marshallOptions: { removeUndefinedValues: true },
});

function getTableName(): string {
  return process.env.TABLE_NAME ?? '';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId;
  const table = getTableName();

  try {
    // 1. Read Connection Registry item to get userId
    const getResult = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { PK: `CONN#${connectionId}`, SK: 'META' },
      }),
    );

    const connItem = getResult.Item;
    if (!connItem) {
      logger.warn('WebSocket disconnect: connection item not found (may have expired via TTL)', {
        connectionId,
      });
      return { statusCode: 200, body: 'OK' };
    }

    const userId = connItem.userId as string;

    // 2. Delete the connection item
    await ddb.send(
      new DeleteCommand({
        TableName: table,
        Key: { PK: `CONN#${connectionId}`, SK: 'META' },
      }),
    );

    // 3. Query GSI1 for remaining connections of this user
    const queryResult = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `USER_CONN#${userId}`,
        },
        Select: 'COUNT',
      }),
    );

    const remainingConnections = queryResult.Count ?? 0;
    const now = new Date().toISOString();

    if (remainingConnections === 0) {
      // 4a. No connections remain — mark user offline
      await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: `PRESENCE#${userId}`, SK: 'STATUS' },
          UpdateExpression:
            'SET #online = :false, lastSeen = :now, connectionCount = :zero, updatedAt = :now, userId = :uid, expiresAt = :exp',
          ExpressionAttributeNames: { '#online': 'online' },
          ExpressionAttributeValues: {
            ':false': false,
            ':now': now,
            ':zero': 0,
            ':uid': userId,
            ':exp': Math.floor(Date.now() / 1000) + 604800, // 7-day TTL
          },
        }),
      );

      logger.info('WebSocket disconnected, user now offline', {
        connectionId,
        userId,
        remainingConnections: 0,
      });
    } else {
      // 4b. Other connections remain — decrement connectionCount
      await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: `PRESENCE#${userId}`, SK: 'STATUS' },
          UpdateExpression:
            'SET updatedAt = :now, expiresAt = :exp ADD connectionCount :minusOne',
          ExpressionAttributeValues: {
            ':now': now,
            ':exp': Math.floor(Date.now() / 1000) + 604800, // 7-day TTL
            ':minusOne': -1,
          },
        }),
      );

      logger.info('WebSocket disconnected, user still online', {
        connectionId,
        userId,
        remainingConnections,
      });
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err: unknown) {
    // Best effort — always return 200, rely on TTL for cleanup
    logger.error('WebSocket disconnect cleanup failed', err, { connectionId });
    return { statusCode: 200, body: 'OK' };
  }
};
