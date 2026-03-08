/**
 * Scheduled Message Worker
 *
 * EventBridge scheduled worker — cron 09:01 IST (03:31 UTC) daily.
 * Processes deferred quiet-hours messages from the scheduled-messages SQS queue.
 * Messages that were blocked during quiet hours (22:00–09:00 IST) are queued
 * and delivered at 09:01 IST when quiet hours end.
 *
 * The worker is triggered by EventBridge schedule, then pulls messages from
 * the SQS queue and sends them via TwilioAdapter with a final consent re-check.
 *
 * Lambda config: timeout 60s, memory 256MB
 */

import type { ScheduledEvent } from 'aws-lambda';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { logger } from '../../utils/logger';
import { getUserProfile } from '../../adapters/dynamodb-adapter';
import { checkSendPermission } from '../../services/consent-service';
import { incrementPromotionalCount } from '../../services/consent-service';
import { TwilioAdapter } from '../../adapters/twilio-adapter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max messages to process per invocation */
const MAX_MESSAGES_PER_RUN = 50;

/** SQS receive batch size */
const BATCH_SIZE = 10;

/** SQS wait time for long polling (seconds) */
const WAIT_TIME_SECONDS = 5;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const sqsClient = new SQSClient({});
const twilioAdapter = new TwilioAdapter();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DeferredMessage {
  userId: string;
  phoneNumber: string;
  messageText: string;
  messageType: 'transactional' | 'promotional';
  originalTimestamp: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: ScheduledEvent): Promise<void> {
  logger.info('Scheduled message worker started', { time: event.time });

  const queueUrl = process.env.SCHEDULED_MESSAGES_QUEUE_URL;
  if (!queueUrl) {
    logger.error('SCHEDULED_MESSAGES_QUEUE_URL not configured');
    return;
  }

  let totalProcessed = 0;
  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    // Pull messages in batches until queue is empty or we hit the limit
    while (totalProcessed < MAX_MESSAGES_PER_RUN) {
      const response = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: BATCH_SIZE,
          WaitTimeSeconds: WAIT_TIME_SECONDS,
          VisibilityTimeout: 30,
        }),
      );

      const messages = response.Messages ?? [];
      if (messages.length === 0) {
        logger.info('No more messages in queue');
        break;
      }

      for (const sqsMessage of messages) {
        totalProcessed++;

        let deferred: DeferredMessage;
        try {
          deferred = JSON.parse(sqsMessage.Body ?? '{}') as DeferredMessage;
        } catch {
          logger.error('Failed to parse deferred message', undefined, {
            body: sqsMessage.Body,
          });
          // Delete unparseable messages to prevent infinite retries
          await deleteMessage(queueUrl, sqsMessage.ReceiptHandle!);
          continue;
        }

        try {
          const sent = await processMessage(deferred);
          if (sent) {
            sentCount++;
          } else {
            skippedCount++;
          }
        } catch (error) {
          logger.error('Failed to process deferred message', error, {
            userId: deferred.userId,
          });
          errorCount++;
          // Don't delete — let SQS retry or move to DLQ
          continue;
        }

        // Delete successfully processed message from queue
        await deleteMessage(queueUrl, sqsMessage.ReceiptHandle!);
      }
    }

    logger.info('Scheduled message worker completed', {
      totalProcessed,
      sentCount,
      skippedCount,
      errorCount,
    });
  } catch (error) {
    logger.error('Scheduled message worker failed', error);
  }
}

// ---------------------------------------------------------------------------
// Process a single deferred message
// ---------------------------------------------------------------------------

async function processMessage(deferred: DeferredMessage): Promise<boolean> {
  // Re-check consent before sending (user may have opted out since queueing)
  const permission = await checkSendPermission(
    deferred.userId,
    deferred.messageType,
  );

  if (!permission.allowed) {
    logger.info('Deferred message blocked by consent re-check', {
      userId: deferred.userId,
      reason: permission.reason,
    });
    return false;
  }

  // Resolve phone number — prefer the one stored in the message, fall back to profile
  let phoneNumber = deferred.phoneNumber;
  if (!phoneNumber) {
    const user = await getUserProfile(deferred.userId);
    phoneNumber = user?.phoneNumber ?? '';
  }

  if (!phoneNumber) {
    logger.debug('No phone number for deferred message', {
      userId: deferred.userId,
    });
    return false;
  }

  await twilioAdapter.sendWhatsAppMessage(phoneNumber, deferred.messageText);

  // Increment promotional counter if applicable
  if (deferred.messageType === 'promotional') {
    await incrementPromotionalCount(deferred.userId);
  }

  logger.info('Deferred message sent', {
    userId: deferred.userId,
    messageType: deferred.messageType,
    originalTimestamp: deferred.originalTimestamp,
  });

  return true;
}

// ---------------------------------------------------------------------------
// SQS helpers
// ---------------------------------------------------------------------------

async function deleteMessage(
  queueUrl: string,
  receiptHandle: string,
): Promise<void> {
  try {
    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  } catch (error) {
    logger.error('Failed to delete SQS message', error, { queueUrl });
  }
}
