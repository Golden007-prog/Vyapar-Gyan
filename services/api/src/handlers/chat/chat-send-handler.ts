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
    const MESSAGE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

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
      expiresAt: Math.floor(Date.now() / 1000) + MESSAGE_TTL_SECONDS,
    });

    // Publish CustomerMessageSent + message.created events for cross-channel routing
    const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? '';
    if (!EVENT_BUS_NAME) {
      logger.error('EVENT_BUS_NAME is empty — skipping EventBridge publish', undefined, {
        messageId,
        userId,
        sellerId: sellerId ?? null,
      });
    } else {
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
            {
              Source: 'vyapargyan.messaging',
              DetailType: 'message.created',
              EventBusName: EVENT_BUS_NAME,
              Detail: JSON.stringify({
                messageId,
                threadId: `THREAD#${userId}`,
                senderUserId: userId,
                senderType: 'customer',
                recipientUserId: sellerId ?? 'seller-123',
                channel: 'web',
                content,
              }),
            },
          ],
        }),
      );
    }

    logger.info('Chat message sent', { userId, messageId, requestId });

    // Trigger async bot processing for web chat messages (omnichannel)
    // Fire-and-forget: don't block the HTTP response
    processWebChatBotResponse(userId, content, sellerId ?? undefined).catch(err => {
      logger.warn('Web chat bot response processing failed', {
        userId, messageId, error: err instanceof Error ? err.message : String(err),
      });
    });

    return response(201, { messageId, createdAt });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Chat send failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

/**
 * Process web chat message through the same discovery/browsing pipeline used by WhatsApp.
 * Generates a bot response and saves it to the thread + pushes via EventBridge.
 */
async function processWebChatBotResponse(userId: string, content: string, sellerId?: string): Promise<void> {
  const { saveBotResponse } = await import('../../services/omnichannel-processor.js');
  const { resolveOrCreateSession } = await import('../../services/session-service.js');

  // Resolve or create a session for web channel
  const sessionResult = await resolveOrCreateSession({
    userId,
    phoneNumber: '',
    channel: 'web',
  });

  // For web chat, generate a simple acknowledgment bot response
  // The full discovery pipeline requires a phoneNumber for WhatsApp sending,
  // so we use a simplified processing path for web chat
  const botReply = generateWebChatBotReply(content, sessionResult.session.state);

  await saveBotResponse({
    userId,
    botReply,
    channel: 'web',
    ...(sellerId ? { sellerId } : {}),
    source: 'web',
  });
}

/**
 * Generate a simple bot reply for web chat messages.
 * This provides immediate feedback while the full AI pipeline processes asynchronously.
 */
function generateWebChatBotReply(content: string, _sessionState: string): string {
  const lower = content.toLowerCase().trim();

  if (/^(hi|hello|hey|namaste|namaskar)$/i.test(lower)) {
    return 'Welcome! How can I help you today? You can:\n\n1. Browse products\n2. Search for a product\n3. Check order status\n\nJust type what you\'re looking for!';
  }

  if (/\b(order|track|status|delivery)\b/i.test(lower)) {
    return 'I can help with your order! Please provide your order number or describe what you\'re looking for.';
  }

  return `Thanks for your message! I'm looking into "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}" for you. A store representative will get back to you shortly.`;
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
