/**
 * Admin Media Reprocess Handler
 *
 * POST /api/v1/admin/media/reprocess — JWT-protected (admin role)
 *
 * Reads messages from the media processing DLQ and re-enqueues them
 * to the media processing retry queue for another attempt.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { logger } from '../../utils/logger';
import { extractUserId, extractUserRole, UnauthorizedError } from '../../core/auth';
import { logAction } from '../../services/audit-service';

const sqsClient = new SQSClient({});

const ReprocessSchema = z.object({
  maxMessages: z.coerce.number().int().min(1).max(10).default(10),
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractUserId(event);
    const role = extractUserRole(event);

    if (role !== 'admin') {
      return response(403, { error: 'Forbidden', message: 'Admin access required' });
    }

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return response(400, { error: 'Invalid JSON body' });
    }

    const parsed = ReprocessSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { maxMessages } = parsed.data;

    const dlqUrl = process.env.MEDIA_DLQ_URL;
    const retryQueueUrl = process.env.MEDIA_QUEUE_URL;

    if (!dlqUrl || !retryQueueUrl) {
      logger.error('Missing queue URLs', undefined, { dlqUrl: !!dlqUrl, retryQueueUrl: !!retryQueueUrl });
      return response(500, { error: 'Queue configuration missing' });
    }

    // Receive messages from DLQ
    const receiveResult = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: 1,
      }),
    );

    const messages = receiveResult.Messages ?? [];

    if (messages.length === 0) {
      return response(200, { success: true, reprocessed: 0, message: 'No messages in DLQ' });
    }

    let reprocessed = 0;
    const errors: string[] = [];

    for (const msg of messages) {
      try {
        // Re-enqueue to the retry queue
        await sqsClient.send(
          new SendMessageCommand({
            QueueUrl: retryQueueUrl,
            MessageBody: msg.Body!,
          }),
        );

        // Delete from DLQ after successful re-enqueue
        await sqsClient.send(
          new DeleteMessageCommand({
            QueueUrl: dlqUrl,
            ReceiptHandle: msg.ReceiptHandle!,
          }),
        );

        reprocessed++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`MessageId ${msg.MessageId}: ${errMsg}`);
        logger.error('Failed to reprocess message', err, { messageId: msg.MessageId });
      }
    }

    // Audit log
    await logAction({
      actorId: userId,
      actorRole: 'admin',
      actionType: 'media_dlq_reprocess',
      resourceType: 'media_dlq',
      resourceId: 'media-processing-dlq',
      newValues: { reprocessed, errors: errors.length, maxMessages },
    });

    logger.info('Media DLQ reprocess complete', { requestId, reprocessed, errors: errors.length });

    return response(200, {
      success: true,
      reprocessed,
      failed: errors.length,
      ...(errors.length > 0 && { errors }),
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Media reprocess failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}
