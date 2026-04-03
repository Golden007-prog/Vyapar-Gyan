/**
 * WebSocket $default Handler
 *
 * Routes incoming WebSocket actions: heartbeat, typing, markRead, sync.
 *
 * - heartbeat: Refreshes Connection Registry TTL to now + 86400s and updates PRESENCE updatedAt
 * - typing: Broadcasts typing event to recipient's connections (excludes sender)
 * - markRead: Updates message deliveryStatus to 'read', pushes status to sender
 * - sync: Returns missed messages since lastMessageTimestamp
 *
 * Always returns { statusCode: 200, body: '' }.
 *
 * Validates: Requirements 5.1, 5.2, 13.1, 13.5, 6.3, 4.6, 14.1, 14.2
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { WebSocketActionSchema } from '../../shared/websocket-schemas';
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

function getApigwClient(): ApiGatewayManagementApiClient {
  const endpoint = process.env.WEBSOCKET_API_ENDPOINT ?? '';
  return new ApiGatewayManagementApiClient({ endpoint });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OK_RESPONSE: APIGatewayProxyResult = { statusCode: 200, body: '' };

/**
 * Look up the userId for a connectionId from the Connection Registry.
 */
async function getUserIdForConnection(connectionId: string): Promise<string | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: `CONN#${connectionId}`, SK: 'META' },
      ProjectionExpression: 'userId',
    }),
  );
  return result.Item?.userId as string | undefined;
}

/**
 * Push a JSON payload to a single WebSocket connection.
 * Returns false if the connection is gone (410).
 */
async function pushToConnection(
  apigw: ApiGatewayManagementApiClient,
  connectionId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(payload)),
      }),
    );
    return true;
  } catch (err: unknown) {
    const statusCode = (err as any)?.$metadata?.httpStatusCode;
    if (statusCode === 410) {
      // Stale connection — clean up
      logger.warn('GoneException: deleting stale connection', { connectionId });
      await ddb.send(
        new DeleteCommand({
          TableName: getTableName(),
          Key: { PK: `CONN#${connectionId}`, SK: 'META' },
        }),
      );
      return false;
    }
    logger.error('Failed to push to connection', err, { connectionId });
    return false;
  }
}

/**
 * Query all connectionIds for a given userId via GSI1.
 */
async function getConnectionsForUser(userId: string): Promise<string[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER_CONN#${userId}` },
      ProjectionExpression: 'connectionId',
    }),
  );
  return (result.Items ?? []).map((item) => item.connectionId as string);
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * heartbeat: Refresh Connection Registry expiresAt to now + 86400 and
 * update PRESENCE#{userId} updatedAt so the system can determine if the
 * user had a heartbeat within the last 60 seconds (online check).
 * Validates: Requirements 5.1, 14.1, 14.2
 */
async function handleHeartbeat(connectionId: string): Promise<void> {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const newExpiry = nowEpoch + 86400;
  const table = getTableName();

  // 1. Refresh Connection Registry TTL
  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `CONN#${connectionId}`, SK: 'META' },
      UpdateExpression: 'SET expiresAt = :exp',
      ExpressionAttributeValues: { ':exp': newExpiry },
    }),
  );

  // 2. Look up userId to update presence
  const userId = await getUserIdForConnection(connectionId);
  if (userId) {
    const now = new Date().toISOString();
    await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `PRESENCE#${userId}`, SK: 'STATUS' },
        UpdateExpression: 'SET updatedAt = :now, expiresAt = :exp',
        ExpressionAttributeValues: {
          ':now': now,
          ':exp': nowEpoch + 604800, // 7-day TTL
        },
      }),
    );

    logger.debug('Heartbeat: TTL and presence refreshed', { connectionId, userId, expiresAt: newExpiry });
  } else {
    logger.debug('Heartbeat: TTL refreshed (no userId found)', { connectionId, expiresAt: newExpiry });
  }
}

/**
 * typing: Broadcast typing event to recipient's connections, excluding sender.
 * Validates: Requirements 13.1, 13.5
 */
async function handleTyping(
  connectionId: string,
  conversationUserId: string,
  isTyping: boolean,
): Promise<void> {
  const senderId = await getUserIdForConnection(connectionId);
  if (!senderId) {
    logger.warn('typing: sender not found in Connection Registry', { connectionId });
    return;
  }

  // Get all connections for the recipient (conversationUserId)
  const recipientConnections = await getConnectionsForUser(conversationUserId);

  if (recipientConnections.length === 0) {
    logger.debug('typing: no active connections for recipient', { conversationUserId });
    return;
  }

  const apigw = getApigwClient();
  const payload = {
    type: 'typing',
    userId: senderId,
    isTyping,
  };

  // Push to all recipient connections (never back to sender's connections)
  await Promise.allSettled(
    recipientConnections
      .filter((connId) => connId !== connectionId)
      .map((connId) => pushToConnection(apigw, connId, payload)),
  );

  logger.debug('Typing event broadcast', {
    senderId,
    conversationUserId,
    isTyping,
    recipientConnectionCount: recipientConnections.length,
  });
}

/**
 * markRead: Update message deliveryStatus to 'read', push status to sender.
 * Validates: Requirement 6.3
 */
async function handleMarkRead(connectionId: string, messageId: string): Promise<void> {
  const readerId = await getUserIdForConnection(connectionId);
  if (!readerId) {
    logger.warn('markRead: reader not found in Connection Registry', { connectionId });
    return;
  }

  const table = getTableName();
  const now = new Date().toISOString();

  // Find the message in the reader's thread to get the sender info
  const threadQuery = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'messageId = :mid',
      ExpressionAttributeValues: {
        ':pk': `THREAD#${readerId}`,
        ':skPrefix': 'MSG#',
        ':mid': messageId,
      },
    }),
  );

  const msgItem = threadQuery.Items?.[0];
  if (!msgItem) {
    logger.warn('markRead: message not found in reader thread', { readerId, messageId });
    return;
  }

  const senderId = msgItem.senderId as string | undefined;
  const msgSK = msgItem.SK as string;

  // Update deliveryStatus to 'read' in reader's thread
  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: `THREAD#${readerId}`, SK: msgSK },
      UpdateExpression: 'SET deliveryStatus = :status, readAt = :now',
      ExpressionAttributeValues: { ':status': 'read', ':now': now },
    }),
  );

  // Also update in sender's thread if we know the sender
  if (senderId && senderId !== readerId) {
    // Find the same message in sender's thread
    const senderQuery = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'messageId = :mid',
        ExpressionAttributeValues: {
          ':pk': `THREAD#${senderId}`,
          ':skPrefix': 'MSG#',
          ':mid': messageId,
        },
      }),
    );

    const senderMsgItem = senderQuery.Items?.[0];
    if (senderMsgItem) {
      await ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: `THREAD#${senderId}`, SK: senderMsgItem.SK as string },
          UpdateExpression: 'SET deliveryStatus = :status, readAt = :now',
          ExpressionAttributeValues: { ':status': 'read', ':now': now },
        }),
      );
    }

    // Push status update to sender's connections
    const senderConnections = await getConnectionsForUser(senderId);
    if (senderConnections.length > 0) {
      const apigw = getApigwClient();
      const statusPayload = {
        type: 'statusUpdate',
        messageId,
        deliveryStatus: 'read',
        readAt: now,
      };

      await Promise.allSettled(
        senderConnections.map((connId) => pushToConnection(apigw, connId, statusPayload)),
      );
    }
  }

  logger.info('Message marked as read', { readerId, messageId });
}

/**
 * sync: Query messages since lastMessageTimestamp, return to requesting connection.
 * Validates: Requirement 4.6
 */
async function handleSync(connectionId: string, lastMessageTimestamp: string): Promise<void> {
  const userId = await getUserIdForConnection(connectionId);
  if (!userId) {
    logger.warn('sync: user not found in Connection Registry', { connectionId });
    return;
  }

  const table = getTableName();

  // Query THREAD#{userId} items with SK > MSG#{lastMessageTimestamp}
  const result = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND SK > :sk',
      ExpressionAttributeValues: {
        ':pk': `THREAD#${userId}`,
        ':sk': `MSG#${lastMessageTimestamp}`,
      },
      ScanIndexForward: true,
    }),
  );

  const messages = result.Items ?? [];

  if (messages.length === 0) {
    logger.debug('sync: no missed messages', { userId, lastMessageTimestamp });
    return;
  }

  // Push missed messages back to the requesting connection
  const apigw = getApigwClient();
  const syncPayload = {
    type: 'sync',
    messages,
  };

  await pushToConnection(apigw, connectionId, syncPayload);

  logger.info('Sync completed', {
    userId,
    lastMessageTimestamp,
    messageCount: messages.length,
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId;

  if (!event.body) {
    logger.warn('Default handler: empty body', { connectionId });
    return OK_RESPONSE;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    logger.warn('Default handler: invalid JSON body', { connectionId });
    return OK_RESPONSE;
  }

  const validation = WebSocketActionSchema.safeParse(parsed);
  if (!validation.success) {
    logger.warn('Default handler: invalid action payload', {
      connectionId,
      errors: validation.error.issues,
    });
    return OK_RESPONSE;
  }

  const action = validation.data;

  try {
    switch (action.action) {
      case 'heartbeat':
        await handleHeartbeat(connectionId!);
        break;

      case 'typing':
        await handleTyping(connectionId!, action.conversationUserId, action.isTyping);
        break;

      case 'markRead':
        await handleMarkRead(connectionId!, action.messageId);
        break;

      case 'sync':
        await handleSync(connectionId!, action.lastMessageTimestamp);
        break;
    }
  } catch (err: unknown) {
    logger.error('Default handler action failed', err, {
      connectionId,
      action: action.action,
    });
  }

  return OK_RESPONSE;
};
