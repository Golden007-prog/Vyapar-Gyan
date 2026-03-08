/**
 * WhatsApp Status Webhook Handler
 *
 * Processes Twilio StatusCallback POST requests for delivery status tracking.
 * Updates message deliveryStatus in THREAD#{userId} MSG#{ts}#{messageId}.
 *
 * Twilio StatusCallback fields (URL-encoded):
 *   MessageSid, MessageStatus (queued|sent|delivered|read|failed),
 *   ErrorCode, ErrorMessage, To, From, AccountSid
 *
 * This handler does NOT use transformTwilioToWhatsAppFormat — it processes
 * the raw Twilio StatusCallback fields directly.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { validateRequest } from 'twilio';
import { logger } from '../../utils/logger';
import { getConfig, type Config } from '../../utils/config';
import {
  getUserByPhone,
  updateMessageDeliveryStatus,
  findMessageSortKeyBySid,
  type MessageThread,
} from '../../adapters/dynamodb-adapter';

const dynamoDBClient = new DynamoDBClient({});
let config: Config;

/** Valid Twilio delivery statuses that map to our deliveryStatus enum */
const VALID_STATUSES: Record<string, MessageThread['deliveryStatus']> = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'failed',
};

/** Map status to the timestamp field to update */
const STATUS_TIMESTAMP_MAP: Record<string, 'sentAt' | 'deliveredAt' | 'readAt' | 'failedAt'> = {
  sent: 'sentAt',
  delivered: 'deliveredAt',
  read: 'readAt',
  failed: 'failedAt',
};

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Twilio status callback received', {
    requestId,
    method: event.httpMethod,
    bodyLength: event.body?.length || 0,
  });

  try {
    if (!config) {
      config = await getConfig();
    }

    const method = event.httpMethod || (event.requestContext as any)?.http?.method;
    if (method && method !== 'POST') {
      return { statusCode: 405, body: '' };
    }

    return await handleStatusCallback(event, requestId);
  } catch (error) {
    logger.error('Error processing status callback', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Always return 200 to prevent Twilio retries
    return { statusCode: 200, body: '' };
  }
};

async function handleStatusCallback(
  event: APIGatewayProxyEvent,
  requestId: string,
): Promise<APIGatewayProxyResult> {
  const body = event.body;
  if (!body) {
    logger.warn('Empty status callback body', { requestId });
    return { statusCode: 200, body: '' };
  }

  // Decode base64 if needed
  const decodedBody = event.isBase64Encoded
    ? Buffer.from(body, 'base64').toString('utf-8')
    : body;

  // Parse URL-encoded form data
  const params = parseFormData(decodedBody);
  if (!params) {
    logger.error('Failed to parse status callback body', { requestId });
    return { statusCode: 200, body: '' };
  }

  // Verify Twilio signature
  const signature =
    event.headers['x-twilio-signature'] || event.headers['X-Twilio-Signature'];
  const url = reconstructUrl(event);

  if (!verifyTwilioSignature(url, params, signature)) {
    logger.error('Invalid Twilio signature on status callback', { requestId });
    return { statusCode: 403, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  // Extract StatusCallback fields
  const messageSid = params.MessageSid;
  const messageStatus = params.MessageStatus;
  const errorCode = params.ErrorCode;
  const errorMessage = params.ErrorMessage;
  const toRaw = params.To || '';

  logger.info('Status callback parsed', {
    requestId,
    messageSid,
    messageStatus,
    errorCode,
    errorMessage,
    to: toRaw,
  });

  if (!messageSid || !messageStatus) {
    logger.warn('Missing required fields in status callback', { requestId });
    return { statusCode: 200, body: '' };
  }

  // Map Twilio status to our deliveryStatus enum
  const deliveryStatus = VALID_STATUSES[messageStatus.toLowerCase()];
  if (!deliveryStatus) {
    logger.warn('Unknown Twilio message status', { requestId, messageStatus });
    return { statusCode: 200, body: '' };
  }

  // Idempotency check: IDEMPOTENCY#{messageSid}#{status}
  const isNew = await acquireStatusIdempotency(messageSid, deliveryStatus, requestId);
  if (!isNew) {
    logger.info('Duplicate status callback, skipping', { requestId, messageSid, deliveryStatus });
    return { statusCode: 200, body: '' };
  }

  // Resolve userId from the To phone number
  // To is in format "whatsapp:+919876543210" or "+919876543210"
  const phone = toRaw.replace('whatsapp:', '');
  if (!phone) {
    logger.warn('Cannot resolve userId — empty phone', { requestId });
    return { statusCode: 200, body: '' };
  }

  const user = await getUserByPhone(phone);
  if (!user) {
    logger.warn('No user found for phone in status callback', { requestId, phone });
    return { statusCode: 200, body: '' };
  }

  // Find the message sort key in the THREAD
  const sortKey = await findMessageSortKeyBySid(user.userId, messageSid);
  if (!sortKey) {
    logger.warn('Message not found in THREAD for status update', {
      requestId,
      userId: user.userId,
      messageSid,
    });
    return { statusCode: 200, body: '' };
  }

  // Update delivery status
  const timestampField = STATUS_TIMESTAMP_MAP[deliveryStatus];
  const errCode = deliveryStatus === 'failed' ? (errorCode || errorMessage) : undefined;

  await updateMessageDeliveryStatus(
    user.userId,
    sortKey,
    deliveryStatus,
    timestampField,
    errCode,
  );

  logger.info('Message delivery status updated', {
    requestId,
    userId: user.userId,
    messageSid,
    deliveryStatus,
  });

  return { statusCode: 200, body: '' };
}

/**
 * Idempotency check using DDB conditional write.
 * Key: IDEMPOTENCY#{messageSid}#{status} to allow status progression.
 */
async function acquireStatusIdempotency(
  messageSid: string,
  status: string,
  requestId: string,
): Promise<boolean> {
  const table = config.tableName;
  const now = Math.floor(Date.now() / 1000);
  const item = {
    PK: `IDEMPOTENCY#${messageSid}#${status}`,
    SK: 'STATUS_CALLBACK',
    messageSid,
    status,
    processedAt: new Date().toISOString(),
    expiresAt: now + 86400, // 24h TTL
  };

  try {
    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: table,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    logger.error('Error in status idempotency check', {
      requestId,
      messageSid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Reconstruct the full URL for Twilio signature validation (same pattern as webhook.ts) */
function reconstructUrl(event: APIGatewayProxyEvent): string {
  const host = event.headers.Host || event.headers.host || '';
  const path =
    event.path || (event as any).rawPath || (event.requestContext as any)?.http?.path || '';
  const protocol =
    event.headers['X-Forwarded-Proto'] || event.headers['x-forwarded-proto'] || 'https';

  let url = `${protocol}://${host}${path}`;

  if (event.queryStringParameters) {
    const qs = Object.entries(event.queryStringParameters)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v || '')}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  return url;
}

/** Verify Twilio webhook signature (same pattern as webhook.ts) */
function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  // Dev bypass
  if (config.environment === 'dev') {
    logger.warn('Twilio signature validation BYPASSED in dev environment');
    return true;
  }

  if (!signature) {
    logger.warn('Missing Twilio signature header on status callback');
    return false;
  }

  const authToken = config.twilioAuthToken;
  if (!authToken) {
    logger.error('TWILIO_AUTH_TOKEN not configured');
    return false;
  }

  try {
    return validateRequest(authToken, signature, url, params);
  } catch (error) {
    logger.error('Error validating Twilio signature', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Parse URL-encoded form data */
function parseFormData(body: string): Record<string, string> | null {
  try {
    const params: Record<string, string> = {};
    for (const pair of body.split('&')) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) {
        params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
      }
    }
    return params;
  } catch {
    return null;
  }
}
