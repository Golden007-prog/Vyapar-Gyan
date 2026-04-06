/**
 * Fan-out Lambda — Bi-directional Message Push
 *
 * Triggered by EventBridge `message.created` events.
 * Determines the recipient's active channels and pushes the message
 * to every active channel EXCEPT the originating channel (avoids echo).
 *
 * Active channel detection:
 *   - WebSocket: query GSI1 with USER_CONN#{userId} in DynamoDB
 *   - WhatsApp:  recipient has a phone number AND an active session
 *
 * Lambda config: timeout 30s, memory 256MB
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { logger } from '../../utils/logger';
import { getUserProfile } from '../../adapters/dynamodb-adapter';
import { twilioAdapter } from '../../adapters/twilio-adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageCreatedDetail {
  messageId: string;
  threadId: string;           // e.g. "THREAD#cust-123"
  senderUserId: string;
  senderType: 'customer' | 'seller' | 'system';
  recipientUserId: string;
  channel: 'whatsapp' | 'web' | 'system';  // originating channel
  content: string;
  metadata: Record<string, unknown>;
}

/** Represents a channel the recipient is reachable on */
export type ActiveChannel = 'whatsapp' | 'web';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Determine which channels the recipient is currently active on.
 *
 * - WebSocket: query GSI1 with USER_CONN#{userId} for Connection Registry items
 * - WhatsApp: recipient has a phone number and an active session
 */
export async function getActiveChannels(
  recipientUserId: string,
  tableName: string,
): Promise<ActiveChannel[]> {
  const channels: ActiveChannel[] = [];

  // Check WebSocket connections via GSI1 (Connection Registry uses CONN#{connId} as PK,
  // USER_CONN#{userId} as GSI1PK — see send-message.ts getConnectionsForUser())
  const wsResult = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER_CONN#${recipientUserId}` },
      Limit: 1, // we only need to know if at least one exists
    }),
  );

  if (wsResult.Items && wsResult.Items.length > 0) {
    channels.push('web');
  }

  // Check WhatsApp reachability: user has phone + active session
  const profile = await getUserProfile(recipientUserId);
  if (profile?.phoneNumber) {
    // Check for active session
    const sessionResult = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `SESSION#${recipientUserId}`, SK: 'ACTIVE' },
      }),
    );
    if (sessionResult.Item) {
      channels.push('whatsapp');
    }
  }

  return channels;
}

/**
 * Filter out the originating channel to avoid echo.
 */
export function filterOriginatingChannel(
  activeChannels: ActiveChannel[],
  originatingChannel: string,
): ActiveChannel[] {
  return activeChannels.filter((ch) => ch !== originatingChannel);
}

// ---------------------------------------------------------------------------
// Channel Push Implementations
// ---------------------------------------------------------------------------

async function pushToWebSocket(
  recipientUserId: string,
  payload: Record<string, unknown>,
  tableName: string,
): Promise<void> {
  const wsEndpoint = process.env.WEBSOCKET_API_ENDPOINT;
  if (!wsEndpoint || wsEndpoint === 'PENDING_WEBSOCKET_STACK') {
    logger.error('WEBSOCKET_API_ENDPOINT not configured — cannot push to WebSocket', undefined, { recipientUserId, wsEndpoint });
    return;
  }

  // Query all active connections for this user via GSI1
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER_CONN#${recipientUserId}` },
      ProjectionExpression: 'connectionId',
    }),
  );

  if (!result.Items || result.Items.length === 0) {
    logger.info('No active WebSocket connections for recipient', { recipientUserId });
    return;
  }

  const apiClient = new ApiGatewayManagementApiClient({ endpoint: wsEndpoint });
  const message = JSON.stringify(payload);

  for (const item of result.Items) {
    const connectionId = item.connectionId as string;
    try {
      await apiClient.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(message),
        }),
      );
      logger.info('WebSocket message pushed', { recipientUserId, connectionId });
    } catch (err: any) {
      if (err.statusCode === 410) {
        logger.info('Stale WebSocket connection — ignoring', { connectionId });
      } else {
        logger.error('WebSocket push failed', err, { connectionId });
      }
    }
  }
}

async function pushToWhatsApp(
  recipientUserId: string,
  content: string,
  senderType: string,
): Promise<void> {
  const profile = await getUserProfile(recipientUserId);
  if (!profile?.phoneNumber) {
    logger.warn('No phone number for WhatsApp push — skipping', { recipientUserId });
    return;
  }

  const formattedPhone = profile.phoneNumber.startsWith('+')
    ? profile.phoneNumber
    : `+${profile.phoneNumber}`;

  const prefix = senderType === 'customer' ? 'New message from customer' : 'New message';
  const body = `${prefix}: ${content}`;

  try {
    await twilioAdapter.sendWhatsAppMessage(formattedPhone, body);
    logger.info('WhatsApp message delivered via fan-out', { recipientUserId });
  } catch (err) {
    logger.error('WhatsApp fan-out delivery failed', err, { recipientUserId });
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: EventBridgeEvent<'message.created', MessageCreatedDetail>,
): Promise<void> {
  const detail = event.detail;

  logger.info('Fan-out processing message.created', {
    messageId: detail.messageId,
    senderUserId: detail.senderUserId,
    recipientUserId: detail.recipientUserId,
    originatingChannel: detail.channel,
  });

  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    logger.error('TABLE_NAME env var not set');
    return;
  }

  try {
    // 1. Determine recipient's active channels
    const activeChannels = await getActiveChannels(detail.recipientUserId, tableName);

    // 2. Filter out originating channel to avoid echo
    const targetChannels = filterOriginatingChannel(activeChannels, detail.channel);

    logger.info('Fan-out target channels resolved', {
      messageId: detail.messageId,
      activeChannels,
      targetChannels,
      originatingChannel: detail.channel,
    });

    if (targetChannels.length === 0) {
      logger.info('No target channels for fan-out — done', { messageId: detail.messageId });
      return;
    }

    // 3. Push to each target channel
    const pushPromises: Promise<void>[] = [];

    for (const ch of targetChannels) {
      if (ch === 'web') {
        pushPromises.push(
          pushToWebSocket(
            detail.recipientUserId,
            {
              type: 'message',
              messageId: detail.messageId,
              threadId: detail.threadId,
              senderUserId: detail.senderUserId,
              senderType: detail.senderType,
              channel: detail.channel,
              content: detail.content,
              metadata: detail.metadata,
            },
            tableName,
          ),
        );
      }

      if (ch === 'whatsapp') {
        pushPromises.push(
          pushToWhatsApp(detail.recipientUserId, detail.content, detail.senderType),
        );
      }
    }

    await Promise.allSettled(pushPromises);

    logger.info('Fan-out complete', {
      messageId: detail.messageId,
      channelsPushed: targetChannels,
    });
  } catch (error) {
    logger.error('Fan-out failed', error, {
      messageId: detail.messageId,
      recipientUserId: detail.recipientUserId,
    });
  }
}
