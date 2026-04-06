/**
 * Seller Reply Handler
 *
 * POST /api/v1/seller/inbox/{userId}/reply — JWT-protected (seller role)
 *
 * Stores the seller's reply in both THREAD#{sellerId} (seller view) and
 * THREAD#{userId} (customer view), then publishes a SellerReplySent event
 * for the notification router to handle cross-channel delivery.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getConfig } from '../../utils/config';
import { putMessage, getSession, type MessageThread } from '../../adapters/dynamodb-adapter';
import { startHandoff, extendHandoff, endHandoff, shouldBypassAI } from '../../services/session-service';

const ebClient = new EventBridgeClient({});

interface ReplyBody {
  content: string;
  messageType?: 'text' | 'image' | 'product_card';
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);
    const customerUserId = event.pathParameters?.userId;

    if (!customerUserId) {
      return response(400, { error: 'Customer userId is required' });
    }

    if (!event.body) {
      return response(400, { error: 'Request body is required' });
    }

    let body: ReplyBody;
    try {
      body = JSON.parse(event.body);
    } catch {
      return response(400, { error: 'Invalid JSON body' });
    }

    if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
      return response(400, { error: 'Content is required' });
    }

    if (body.content.length > 4096) {
      return response(400, { error: 'Content exceeds 4096 character limit' });
    }

    const messageId = randomUUID();
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days
    const messageType = body.messageType || 'text';

    logger.info('Seller reply request', {
      requestId,
      sellerId,
      customerUserId,
      messageType,
    });

    // Base message fields
    const baseMessage = {
      messageId,
      direction: 'outbound' as const,
      channel: 'web' as const,
      senderRole: 'seller' as const,
      messageType,
      content: { text: body.content.trim() },
      deliveryStatus: 'sent' as const,
      sentAt: now,
      createdAt: now,
      expiresAt: ttl,
    };

    // Store in THREAD#{sellerId} — seller's inbox view
    const sellerMessage: MessageThread & { customerUserId: string } = {
      ...baseMessage,
      userId: sellerId,
      customerUserId,
    };
    await putMessage(sellerMessage as any);

    // Store in THREAD#{customerUserId} — customer's chat view
    const customerMessage: MessageThread & { sellerUserId: string } = {
      ...baseMessage,
      userId: customerUserId,
      sellerUserId: sellerId,
    };
    await putMessage(customerMessage as any);

    // --- Human Handoff Protocol (Req 10.1–10.4) ---
    // Check for /ai command to deactivate handoff
    const trimmedContent = body.content.trim();
    if (trimmedContent === '/ai') {
      await endHandoff(customerUserId);
      logger.info('Seller deactivated handoff via /ai', { sellerId, customerUserId });
    } else {
      // Activate or extend handoff on seller reply
      const session = await getSession(customerUserId);
      if (session) {
        if (session.isHumanHandoff && !shouldBypassAI(session)) {
          // Handoff expired — re-activate
          await startHandoff(customerUserId, sellerId);
        } else if (session.isHumanHandoff) {
          // Already in handoff — extend timer
          await extendHandoff(customerUserId);
        } else {
          // First seller reply — activate handoff
          await startHandoff(customerUserId, sellerId);
        }
      }
    }

    // Publish SellerReplySent event for notification router (backward compat)
    const config = await getConfig();
    await ebClient.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'vyapargyan.chat',
            DetailType: 'SellerReplySent',
            Detail: JSON.stringify({
              sellerId,
              userId: customerUserId,
              messageId,
              channel: 'web',
              messageType,
            }),
            EventBusName: config.eventBusName,
          },
        ],
      }),
    );

    // Publish message.created for omnichannel fan-out (skip /ai handoff command)
    if (trimmedContent !== '/ai') {
      try {
        await ebClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: 'vyapargyan.messaging',
                DetailType: 'message.created',
                Detail: JSON.stringify({
                  messageId,
                  threadId: `THREAD#${customerUserId}`,
                  senderUserId: sellerId,
                  senderType: 'seller',
                  recipientUserId: customerUserId,
                  channel: 'web',
                  content: body.content.trim(),
                }),
                EventBusName: config.eventBusName,
              },
            ],
          }),
        );
      } catch (err) {
        // Fire-and-forget — don't fail the reply if fan-out publish fails
        logger.error('Failed to publish message.created event', err, {
          messageId,
          sellerId,
          customerUserId,
        });
      }
    }

    logger.info('Seller reply sent', {
      sellerId,
      customerUserId,
      messageId,
    });

    return response(201, {
      messageId,
      createdAt: now,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Seller reply failed', error, { requestId });
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
