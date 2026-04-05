/**
 * WebSocket sendMessage Handler
 *
 * Receives a message from a sender, stores it in both sender and recipient
 * threads in DynamoDB, pushes it to all recipient connections, and syncs
 * back to all sender connections (multi-device support).
 *
 * Delivery status lifecycle:
 *   sent → delivered (pushed to ≥1 recipient connection)
 *   sent → sent (all pushes fail — available on next sync)
 *   failed (DynamoDB write error — failure notification to sender)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 6.4, 6.5
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { SendMessagePayloadSchema, contentSchemaByType } from '../../shared/websocket-schemas';
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
// Constants
// ---------------------------------------------------------------------------

const OK_RESPONSE: APIGatewayProxyResult = { statusCode: 200, body: '' };
const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;
const PRESENCE_OFFLINE_THRESHOLD_MS = 60_000; // 60 seconds
const DEFAULT_RESPONSE_TIME = '30 minutes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up the userId and role for a connectionId from the Connection Registry.
 */
async function getUserIdForConnection(
  connectionId: string,
): Promise<{ userId: string; role: string } | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: `CONN#${connectionId}`, SK: 'META' },
      ProjectionExpression: 'userId, #r',
      ExpressionAttributeNames: { '#r': 'role' },
    }),
  );
  if (!result.Item?.userId) return undefined;
  return {
    userId: result.Item.userId as string,
    role: (result.Item.role as string) ?? 'customer',
  };
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

/**
 * Push a JSON payload to a single WebSocket connection.
 * Returns false if the connection is gone (410) or push fails.
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

// ---------------------------------------------------------------------------
// Presence helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a seller is offline based on their presence record.
 *
 * A seller is considered offline when:
 * - No presence record exists
 * - `online` is false
 * - `updatedAt` is more than 60 seconds ago relative to `now`
 *
 * Exported for property-based testing (Property 14).
 */
export function isSellerOffline(
  presenceRecord: { online?: boolean; updatedAt?: string } | undefined | null,
  now: Date,
): boolean {
  if (!presenceRecord) return true;
  if (!presenceRecord.online) return true;
  if (presenceRecord.updatedAt) {
    const updatedAtMs = new Date(presenceRecord.updatedAt).getTime();
    if (now.getTime() - updatedAtMs > PRESENCE_OFFLINE_THRESHOLD_MS) return true;
  }
  return false;
}

/**
 * Fetch the PRESENCE#{userId} STATUS record from DynamoDB.
 */
async function getPresenceRecord(
  userId: string,
): Promise<{ online?: boolean; updatedAt?: string } | undefined> {
  const result = await ddb.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: `PRESENCE#${userId}`, SK: 'STATUS' },
      ProjectionExpression: 'online, updatedAt',
    }),
  );
  return result.Item as { online?: boolean; updatedAt?: string } | undefined;
}

// ---------------------------------------------------------------------------
// Core message storage
// ---------------------------------------------------------------------------

interface StoredMessage {
  messageId: string;
  senderId: string;
  recipientId: string;
  senderRole: string;
  messageType: string;
  content: unknown;
  deliveryStatus: string;
  sentAt: string;
  createdAt: string;
  expiresAt: number;
  channel: string;
  clientMessageId?: string | undefined;
}

/**
 * Store a message item in a user's thread.
 * PK: THREAD#{userId}  SK: MSG#{timestamp}#{messageId}
 */
async function storeMessageForUser(
  userId: string,
  direction: 'outbound' | 'inbound',
  msg: StoredMessage,
  timestamp: string,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: `THREAD#${userId}`,
        SK: `MSG#${timestamp}#${msg.messageId}`,
        messageId: msg.messageId,
        senderId: msg.senderId,
        recipientId: msg.recipientId,
        direction,
        channel: msg.channel,
        senderRole: msg.senderRole,
        messageType: msg.messageType,
        content: msg.content,
        deliveryStatus: msg.deliveryStatus,
        sentAt: msg.sentAt,
        createdAt: msg.createdAt,
        expiresAt: msg.expiresAt,
        clientMessageId: msg.clientMessageId,
      },
    }),
  );
}

/**
 * Update deliveryStatus and deliveredAt on both sender and recipient threads.
 */
async function updateDeliveryStatus(
  senderId: string,
  recipientId: string,
  sk: string,
  status: string,
  timestampField: string,
  timestampValue: string,
): Promise<void> {
  const table = getTableName();
  const updates = [
    { PK: `THREAD#${senderId}`, SK: sk },
    { PK: `THREAD#${recipientId}`, SK: sk },
  ];

  await Promise.allSettled(
    updates.map((key) =>
      ddb.send(
        new UpdateCommand({
          TableName: table,
          Key: key,
          UpdateExpression: `SET deliveryStatus = :status, ${timestampField} = :ts`,
          ExpressionAttributeValues: { ':status': status, ':ts': timestampValue },
        }),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId;

  // 1. Parse body
  if (!event.body) {
    logger.warn('sendMessage: empty body', { connectionId });
    return OK_RESPONSE;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    logger.warn('sendMessage: invalid JSON body', { connectionId });
    return OK_RESPONSE;
  }

  // 2. Validate payload schema
  const validation = SendMessagePayloadSchema.safeParse(parsed);
  if (!validation.success) {
    logger.warn('sendMessage: invalid payload', {
      connectionId,
      errors: validation.error.issues,
    });
    return OK_RESPONSE;
  }

  const { recipientId, messageType, content, clientMessageId } = validation.data;

  // 3. Validate content against messageType-specific schema (if one exists)
  const contentSchema = contentSchemaByType[messageType];
  if (contentSchema) {
    const contentValidation = contentSchema.safeParse(content);
    if (!contentValidation.success) {
      logger.warn('sendMessage: content does not match messageType schema', {
        connectionId,
        messageType,
        errors: contentValidation.error.issues,
      });
      return OK_RESPONSE;
    }
  }

  // 4. Look up sender from Connection Registry
  const senderInfo = await getUserIdForConnection(connectionId!);
  if (!senderInfo) {
    logger.warn('sendMessage: sender not found in Connection Registry', { connectionId });
    return OK_RESPONSE;
  }

  const { userId: senderId, role: senderRole } = senderInfo;
  const messageId = randomUUID();
  const now = new Date();
  const timestamp = now.toISOString();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const sk = `MSG#${timestamp}#${messageId}`;

  const msg: StoredMessage = {
    messageId,
    senderId,
    recipientId,
    senderRole,
    messageType,
    content,
    deliveryStatus: 'sent',
    sentAt: timestamp,
    createdAt: timestamp,
    expiresAt: nowEpoch + NINETY_DAYS_SECONDS,
    channel: 'web',
    clientMessageId,
  };

  // 5. Store message in both threads
  try {
    await Promise.all([
      storeMessageForUser(senderId, 'outbound', msg, timestamp),
      storeMessageForUser(recipientId, 'inbound', msg, timestamp),
    ]);

    logger.info('Message stored in dual threads', { messageId, senderId, recipientId });
  } catch (err: unknown) {
    // DynamoDB write failure → mark as failed, notify sender
    logger.error('sendMessage: DynamoDB write failed', err, { messageId, senderId, recipientId });

    const apigw = getApigwClient();
    const senderConnections = await getConnectionsForUser(senderId);
    const failPayload = {
      type: 'messageStatus',
      messageId,
      clientMessageId,
      deliveryStatus: 'failed',
      failedAt: timestamp,
      errorCode: 'STORE_FAILED',
    };

    await Promise.allSettled(
      senderConnections.map((connId) => pushToConnection(apigw, connId, failPayload)),
    );

    return OK_RESPONSE;
  }

  // 6. Auto-reply if customer is messaging an offline seller (Req 14.3, 14.4)
  const apigw = getApigwClient();

  if (senderRole === 'customer') {
    try {
      const presenceRecord = await getPresenceRecord(recipientId);
      if (isSellerOffline(presenceRecord, now)) {
        const autoReplyId = randomUUID();
        const autoReplyTimestamp = new Date().toISOString();
        const autoReplyEpoch = Math.floor(Date.now() / 1000);
        const autoReplyBody = `The seller is currently offline. Expected response time: ${DEFAULT_RESPONSE_TIME}.`;

        const autoReplyMsg: StoredMessage = {
          messageId: autoReplyId,
          senderId: 'system',
          recipientId: senderId,
          senderRole: 'system',
          messageType: 'system',
          content: { body: autoReplyBody },
          deliveryStatus: 'sent',
          sentAt: autoReplyTimestamp,
          createdAt: autoReplyTimestamp,
          expiresAt: autoReplyEpoch + NINETY_DAYS_SECONDS,
          channel: 'system',
        };

        // Store auto-reply in customer's thread only
        await storeMessageForUser(senderId, 'inbound', autoReplyMsg, autoReplyTimestamp);

        // Push auto-reply to all sender (customer) connections
        const autoReplySenderConns = await getConnectionsForUser(senderId);
        if (autoReplySenderConns.length > 0) {
          const autoReplyPayload = {
            type: 'message',
            messageId: autoReplyId,
            senderId: 'system',
            recipientId: senderId,
            senderRole: 'system',
            messageType: 'system',
            content: { body: autoReplyBody },
            deliveryStatus: 'sent',
            sentAt: autoReplyTimestamp,
            channel: 'system',
          };

          await Promise.allSettled(
            autoReplySenderConns.map((connId) => pushToConnection(apigw, connId, autoReplyPayload)),
          );
        }

        logger.info('Auto-reply sent for offline seller', {
          messageId: autoReplyId,
          senderId,
          recipientId,
        });
      }
    } catch (err: unknown) {
      // Auto-reply is best-effort; don't fail the original message flow
      logger.error('sendMessage: auto-reply failed', err, { senderId, recipientId });
    }
  }

  // 6b. Build the message payload to push to connections
  const messagePayload = {
    type: 'message',
    messageId,
    clientMessageId,
    senderId,
    recipientId,
    senderRole,
    messageType,
    content,
    deliveryStatus: 'sent',
    sentAt: timestamp,
    channel: 'web',
  };

  // 7. Push to all recipient connections
  const recipientConnections = await getConnectionsForUser(recipientId);
  let deliveredToRecipient = false;

  if (recipientConnections.length > 0) {
    const results = await Promise.allSettled(
      recipientConnections.map((connId) => pushToConnection(apigw, connId, messagePayload)),
    );

    deliveredToRecipient = results.some(
      (r) => r.status === 'fulfilled' && r.value === true,
    );
  }

  // 8. Update delivery status if pushed to ≥1 recipient connection
  if (deliveredToRecipient) {
    const deliveredAt = new Date().toISOString();
    await updateDeliveryStatus(senderId, recipientId, sk, 'delivered', 'deliveredAt', deliveredAt);

    logger.info('Message delivered to recipient', { messageId, recipientId });

    // Push status update to sender connections
    const senderConnections = await getConnectionsForUser(senderId);
    const statusPayload = {
      type: 'messageStatus',
      messageId,
      clientMessageId,
      deliveryStatus: 'delivered',
      deliveredAt,
    };

    await Promise.allSettled(
      senderConnections.map((connId) => pushToConnection(apigw, connId, statusPayload)),
    );
  } else {
    // All pushes failed or no connections — leave as 'sent'
    logger.info('Message not delivered (no active recipient connections or all pushes failed)', {
      messageId,
      recipientId,
      recipientConnectionCount: recipientConnections.length,
    });
  }

  // 9. Push message to all sender connections (multi-device sync)
  const senderConnections = await getConnectionsForUser(senderId);
  if (senderConnections.length > 0) {
    const senderPayload = {
      ...messagePayload,
      deliveryStatus: deliveredToRecipient ? 'delivered' : 'sent',
    };

    await Promise.allSettled(
      senderConnections.map((connId) => pushToConnection(apigw, connId, senderPayload)),
    );
  }

  return OK_RESPONSE;
};
