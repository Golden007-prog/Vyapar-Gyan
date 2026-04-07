/**
 * Seller Inbox Handler
 *
 * GET /api/v1/seller/inbox — JWT-protected (seller role)
 *
 * Lists conversations from THREAD#{sellerId} grouped by customer,
 * with unread count, last message preview, and channel indicator.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getBasicConfig } from '../../utils/config';
import { resolveSellerId, type MessageThread } from '../../adapters/dynamodb-adapter';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ConversationSummary {
  userId: string;
  displayName?: string;
  lastMessage: {
    content: unknown;
    messageType: string;
    direction: string;
    channel: string;
    createdAt: string;
  };
  unreadCount: number;
  channel: string;
  lastActivityAt: string;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const cognitoSub = extractUserId(event);
    const sellerId = await resolveSellerId(cognitoSub);
    const limit = Math.min(
      parseInt(event.queryStringParameters?.limit || '50', 10),
      100,
    );

    logger.info('Seller inbox request', { requestId, sellerId, limit });

    const config = getBasicConfig();

    // Query all messages in THREAD#{sellerId} — most recent first
    const res = await ddbClient.send(
      new QueryCommand({
        TableName: config.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `THREAD#${sellerId}`,
          ':prefix': 'MSG#',
        },
        ScanIndexForward: false,
        Limit: 500, // fetch enough to group conversations
      }),
    );

    const messages = (res.Items ?? []) as (MessageThread & { PK: string; SK: string })[];

    // Group messages by customer userId (stored in the message's userId or derived from senderRole)
    const conversationMap = new Map<string, ConversationSummary>();

    for (const msg of messages) {
      // Identify which customer this message belongs to.
      // Sources: customerUserId (notification router), counterpartUserId (legacy),
      // senderId (web chat inbound), content.fromUserId (WhatsApp routed).
      const customerUserId = (msg as any).customerUserId
        || (msg as any).counterpartUserId
        || (msg.direction === 'inbound' ? (msg as any).senderId : undefined)
        || (msg.direction === 'inbound' && (msg.content as any)?.fromUserId
            ? (msg.content as any).fromUserId : undefined);
      if (!customerUserId) continue;

      const existing = conversationMap.get(customerUserId);

      if (!existing) {
        conversationMap.set(customerUserId, {
          userId: customerUserId,
          lastMessage: {
            content: msg.content,
            messageType: msg.messageType,
            direction: msg.direction,
            channel: msg.channel,
            createdAt: msg.createdAt,
          },
          unreadCount: msg.direction === 'inbound' && msg.deliveryStatus !== 'read' ? 1 : 0,
          channel: msg.channel,
          lastActivityAt: msg.createdAt,
        });
      } else {
        // Count unread inbound messages
        if (msg.direction === 'inbound' && msg.deliveryStatus !== 'read') {
          existing.unreadCount += 1;
        }
      }
    }

    // Convert to array and sort by last activity
    const conversations = Array.from(conversationMap.values())
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
      .slice(0, limit);

    logger.info('Seller inbox retrieved', {
      sellerId,
      conversationCount: conversations.length,
    });

    return response(200, {
      conversations,
      total: conversations.length,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Seller inbox failed', error, { requestId });
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
