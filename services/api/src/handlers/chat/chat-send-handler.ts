/**
 * Chat Send Handler
 *
 * POST /api/v1/chat/messages — JWT-protected
 *
 * Stores a message in THREAD#{userId} and publishes a CustomerMessageSent
 * event to EventBridge for cross-channel routing to the seller.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { SendMessageSchema } from '../../shared/schemas';
import { putMessage } from '../../adapters/dynamodb-adapter';

const ebClient = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);

    // Validate request body
    const body = JSON.parse(event.body || '{}');
    const parsed = SendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { content, messageType, sellerId, productContext } = parsed.data;
    const messageId = randomUUID();
    const createdAt = new Date().toISOString();

    // Store message in THREAD#{userId}
    await putMessage({
      userId,
      messageId,
      direction: 'inbound',
      channel: 'web',
      senderRole: 'customer',
      messageType,
      content: productContext
        ? { text: content, productContext }
        : { text: content },
      deliveryStatus: 'sent',
      createdAt,
    });

    // Publish CustomerMessageSent event for cross-channel routing
    await ebClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'vyapargyan.chat',
            DetailType: 'CustomerMessageSent',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              userId,
              messageId,
              channel: 'web',
              sellerId: sellerId ?? null,
              content,
              messageType,
              createdAt,
            }),
          },
        ],
      }),
    );

    logger.info('Chat message sent', { userId, messageId, requestId });

    return response(201, { messageId, createdAt });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Chat send failed', error, { requestId });
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
