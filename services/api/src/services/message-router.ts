/**
 * Message Router Service
 *
 * Stores a message in DynamoDB and publishes a `message.created` event
 * to EventBridge for async fan-out to active channels.
 *
 * Deduplication: uses messageId as an idempotency key — if a message
 * with the same PK/SK already exists the DynamoDB PutItem is idempotent
 * (overwrites with identical data).
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { putMessage } from '../adapters/dynamodb-adapter';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteMessageParams {
  messageId: string;
  threadId: string;          // e.g. "cust-123" (userId portion, without THREAD# prefix)
  senderUserId: string;
  senderType: 'customer' | 'seller' | 'system';
  recipientUserId: string;
  channel: 'whatsapp' | 'web' | 'system';
  content: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const ebClient = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// In-memory deduplication set (per Lambda invocation)
// ---------------------------------------------------------------------------

const processedIds = new Set<string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store message in DynamoDB, then publish `message.created` to EventBridge.
 * Returns immediately — fan-out is handled asynchronously by the fan-out Lambda.
 */
export async function routeMessage(params: RouteMessageParams): Promise<void> {
  const {
    messageId,
    threadId,
    senderUserId,
    senderType,
    recipientUserId,
    channel,
    content,
    messageType = 'text',
    metadata,
  } = params;

  // Deduplication: skip if already processed in this invocation
  if (processedIds.has(messageId)) {
    logger.info('Duplicate messageId skipped (in-memory dedup)', { messageId });
    return;
  }
  processedIds.add(messageId);

  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60; // 30 days

  // 1. Store message in DynamoDB (THREAD#{threadId} / MSG#{ts}#{id})
  await putMessage({
    userId: threadId,
    messageId,
    direction: senderType === 'customer' ? 'inbound' : 'outbound',
    channel,
    senderRole: senderType,
    messageType: messageType as any,
    content: { text: content, ...(metadata ?? {}) },
    deliveryStatus: 'sent',
    createdAt: now.toISOString(),
    expiresAt: ttl,
  });

  logger.info('Message stored in DynamoDB', { messageId, threadId, channel });

  // 2. Publish message.created event to EventBridge
  const eventBusName = process.env.EVENT_BUS_NAME || 'default';

  await ebClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'vyapargyan.messaging',
          DetailType: 'message.created',
          EventBusName: eventBusName,
          Detail: JSON.stringify({
            messageId,
            threadId: `THREAD#${threadId}`,
            senderUserId,
            senderType,
            recipientUserId,
            channel,
            content,
            metadata: metadata ?? {},
          }),
        },
      ],
    }),
  );

  logger.info('message.created event published', { messageId, recipientUserId, channel });
}
