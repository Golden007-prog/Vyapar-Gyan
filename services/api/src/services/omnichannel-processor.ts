/**
 * Omnichannel Message Processor
 *
 * Shared processing logic for customer messages from any channel (web or WhatsApp).
 * Routes messages through the same discovery/browsing/intent pipeline so bot responses
 * are consistent regardless of originating channel.
 *
 * Used by:
 * - chat-send-handler.ts (web chat messages)
 * - worker.ts (WhatsApp messages — already has inline processing)
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { putMessage } from '../adapters/dynamodb-adapter';
import { logger } from '../utils/logger';

const ebClient = new EventBridgeClient({});

export interface OmnichannelMessage {
  userId: string;
  messageId: string;
  content: string;
  channel: 'web' | 'whatsapp';
  sellerId?: string;
  source: 'web' | 'whatsapp';
}

/**
 * Save a bot response to the customer's thread and push via EventBridge for fan-out.
 * This ensures bot replies appear in BOTH web chat and WhatsApp.
 */
export async function saveBotResponse(params: {
  userId: string;
  botReply: string;
  channel: 'web' | 'whatsapp';
  sellerId?: string;
  source: 'web' | 'whatsapp';
}): Promise<void> {
  const { userId, botReply, channel, sellerId, source } = params;
  const messageId = `bot-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();
  const TTL = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  // Store bot response in thread
  await putMessage({
    userId,
    messageId,
    direction: 'outbound',
    channel,
    senderRole: 'system',
    messageType: 'text',
    content: { text: botReply, source, forwardedFrom: source },
    deliveryStatus: 'sent',
    createdAt: now,
    expiresAt: TTL,
  });

  // Publish message.created for fan-out to other channels
  const eventBusName = process.env.EVENT_BUS_NAME ?? '';
  if (eventBusName) {
    try {
      await ebClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'vyapargyan.messaging',
              DetailType: 'message.created',
              EventBusName: eventBusName,
              Detail: JSON.stringify({
                messageId,
                threadId: `THREAD#${userId}`,
                senderUserId: sellerId || 'system',
                senderType: 'system',
                recipientUserId: userId,
                channel,
                content: botReply,
                metadata: { source, forwardedFrom: source, type: 'bot_response' },
              }),
            },
          ],
        }),
      );
    } catch (err) {
      logger.error('Failed to publish bot response event', err, { userId, messageId });
    }
  }
}
