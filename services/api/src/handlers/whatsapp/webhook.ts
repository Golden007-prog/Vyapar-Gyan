import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { getConfig, type Config } from '../../utils/config';

const eventBridgeClient = new EventBridgeClient({});
let config: Config;

/**
 * WhatsApp Webhook Handler
 * 
 * Handles both GET (verification) and POST (incoming messages) requests from Meta's WhatsApp Cloud API.
 * 
 * GET: Responds to Meta's webhook verification challenge
 * POST: Validates signature, drops raw payload to EventBridge, returns 200 OK immediately
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  // Load config on first invocation
  if (!config) {
    config = await getConfig();
  }
  
  logger.info('WhatsApp webhook request received', {
    requestId,
    method: event.httpMethod,
    path: event.path,
  });

  try {
    // Handle GET request for webhook verification
    if (event.httpMethod === 'GET') {
      return handleVerification(event);
    }

    // Handle POST request for incoming webhooks
    if (event.httpMethod === 'POST') {
      return await handleIncomingWebhook(event, requestId);
    }

    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    logger.error('Error processing WhatsApp webhook', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Always return 200 to prevent Meta from retrying
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'error_logged' }),
    };
  }
};

/**
 * Handle Meta's webhook verification challenge
 */
function handleVerification(event: APIGatewayProxyEvent): APIGatewayProxyResult {
  const mode = event.queryStringParameters?.['hub.mode'];
  const token = event.queryStringParameters?.['hub.verify_token'];
  const challenge = event.queryStringParameters?.['hub.challenge'];

  logger.info('Webhook verification request', { mode, token: token ? '***' : undefined });

  if (mode === 'subscribe' && token === config.whatsappVerifyToken) {
    logger.info('Webhook verification successful');
    return {
      statusCode: 200,
      body: challenge || '',
    };
  }

  logger.warn('Webhook verification failed', { mode, tokenMatch: token === config.whatsappVerifyToken });
  return {
    statusCode: 403,
    body: JSON.stringify({ error: 'Verification failed' }),
  };
}

/**
 * Handle incoming WhatsApp webhook POST request
 */
async function handleIncomingWebhook(
  event: APIGatewayProxyEvent,
  requestId: string
): Promise<APIGatewayProxyResult> {
  const body = event.body;
  
  if (!body) {
    logger.warn('Empty webhook body received');
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ignored' }),
    };
  }

  // Verify webhook signature
  const signature = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];
  if (!verifySignature(body, signature)) {
    logger.error('Invalid webhook signature', { requestId });
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'invalid_signature' }),
    };
  }

  // Parse and validate payload
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    logger.error('Failed to parse webhook body', { requestId, error });
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'invalid_json' }),
    };
  }

  // Validate it's from a WhatsApp business account
  if (payload.object !== 'whatsapp_business_account') {
    logger.warn('Non-WhatsApp business account webhook received', {
      requestId,
      object: payload.object,
    });
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ignored' }),
    };
  }

  // Drop raw payload to EventBridge
  await publishToEventBridge(payload, requestId);

  logger.info('WhatsApp webhook processed successfully', { requestId });
  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'received' }),
  };
}

/**
 * Verify webhook signature using app secret
 */
function verifySignature(body: string, signature: string | undefined): boolean {
  if (!signature) {
    logger.warn('Missing webhook signature');
    return false;
  }

  const appSecret = config.whatsappAppSecret;
  if (!appSecret) {
    logger.error('WHATSAPP_APP_SECRET not configured');
    return false;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(body)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Publish webhook payload to EventBridge
 */
async function publishToEventBridge(payload: any, requestId: string): Promise<void> {
  const command = new PutEventsCommand({
    Entries: [
      {
        Source: 'vyapargyan.whatsapp',
        DetailType: 'IncomingWhatsAppWebhook',
        Detail: JSON.stringify({
          payload,
          receivedAt: new Date().toISOString(),
          requestId,
        }),
        EventBusName: config.eventBusName || 'default',
      },
    ],
  });

  const response = await eventBridgeClient.send(command);
  
  if (response.FailedEntryCount && response.FailedEntryCount > 0) {
    logger.error('Failed to publish to EventBridge', {
      requestId,
      failedCount: response.FailedEntryCount,
      entries: response.Entries,
    });
    throw new Error('Failed to publish event to EventBridge');
  }

  logger.info('Event published to EventBridge', { requestId });
}
