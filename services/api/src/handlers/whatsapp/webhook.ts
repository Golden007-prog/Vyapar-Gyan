import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { validateRequest } from 'twilio';
import { logger } from '../../utils/logger';
import { getConfig, type Config } from '../../utils/config';

const eventBridgeClient = new EventBridgeClient({});
let config: Config;

/**
 * WhatsApp Webhook Handler
 * 
 * Handles POST requests from Twilio's WhatsApp API.
 * - Validates Twilio signature for security
 * - Parses form-encoded webhook payload
 * - Transforms Twilio payload to internal event format
 * - Publishes to EventBridge for async processing
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  // Load config on first invocation
  if (!config) {
    config = await getConfig();
  }
  
  logger.info('Twilio WhatsApp webhook request received', {
    requestId,
    method: event.httpMethod,
    path: event.path,
    contentType: event.headers['content-type'] || event.headers['Content-Type'],
  });

  try {
    // Only handle POST requests
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    return await handleIncomingWebhook(event, requestId);
  } catch (error) {
    logger.error('Error processing Twilio webhook', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Return 200 to prevent Twilio from retrying
    // Errors are logged and can be investigated via CloudWatch
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'error_logged' }),
    };
  }
};

/**
 * Handle incoming Twilio WhatsApp webhook POST request
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

  // Parse form-encoded body (Twilio sends application/x-www-form-urlencoded)
  const twilioPayload = parseFormData(body);
  
  if (!twilioPayload) {
    logger.error('Failed to parse webhook body', { requestId });
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'invalid_body' }),
    };
  }

  // Verify Twilio webhook signature using parsed params
  const signature = event.headers['x-twilio-signature'] || event.headers['X-Twilio-Signature'];
  const url = reconstructUrl(event);
  
  if (!verifyTwilioSignature(url, twilioPayload, signature)) {
    logger.error('Invalid Twilio webhook signature', { requestId });
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Invalid signature' }),
    };
  }

  logger.info('Twilio webhook payload parsed', {
    requestId,
    from: twilioPayload.From,
    to: twilioPayload.To,
    messageSid: twilioPayload.SmsMessageSid || twilioPayload.MessageSid,
    messageStatus: twilioPayload.SmsStatus || twilioPayload.MessageStatus,
  });

  // Transform Twilio payload to internal WhatsApp event format
  const internalPayload = transformTwilioToWhatsAppFormat(twilioPayload, requestId);

  // Publish to EventBridge for async processing
  await publishToEventBridge(internalPayload, requestId);

  logger.info('Twilio webhook processed successfully', { requestId });
  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'received' }),
  };
}

/**
 * Reconstruct the full URL for signature validation
 */
function reconstructUrl(event: APIGatewayProxyEvent): string {
  const host = event.headers.Host || event.headers.host || '';
  const path = event.path || '';
  const protocol = event.headers['X-Forwarded-Proto'] || 'https';
  
  // Include query string if present
  let url = `${protocol}://${host}${path}`;
  
  if (event.queryStringParameters) {
    const queryString = Object.entries(event.queryStringParameters)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value || '')}`)
      .join('&');
    
    if (queryString) {
      url += `?${queryString}`;
    }
  }
  
  return url;
}

/**
 * Verify Twilio webhook signature
 */
function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) {
    logger.warn('Missing Twilio webhook signature');
    return false;
  }

  const authToken = config.twilioAuthToken;
  if (!authToken) {
    logger.error('TWILIO_AUTH_TOKEN not configured');
    return false;
  }

  try {
    const isValid = validateRequest(authToken, signature, url, params);
    
    if (!isValid) {
      logger.warn('Twilio signature validation failed', {
        url,
        signatureProvided: signature.substring(0, 10) + '...',
      });
    }
    
    return isValid;
  } catch (error) {
    logger.error('Error validating Twilio signature', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Parse form-encoded data from Twilio webhook
 */
function parseFormData(body: string): Record<string, string> | null {
  try {
    const params: Record<string, string> = {};
    const pairs = body.split('&');
    
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value !== undefined) {
        params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
      }
    }
    
    return params;
  } catch (error) {
    logger.error('Failed to parse form data', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Transform Twilio payload to internal WhatsApp event format
 * 
 * This maintains compatibility with our existing worker.ts which expects
 * the Meta WhatsApp Cloud API format.
 * 
 * Twilio payload fields:
 * - SmsMessageSid or MessageSid: Unique message identifier
 * - From: Sender's WhatsApp number (whatsapp:+1234567890)
 * - To: Recipient's WhatsApp number (whatsapp:+1234567890)
 * - Body: Message text content
 * - NumMedia: Number of media attachments
 * - MediaUrl0, MediaContentType0: First media attachment
 * - ProfileName: Sender's WhatsApp profile name
 * - SmsStatus or MessageStatus: Message status (received, sent, delivered, read, failed)
 */
function transformTwilioToWhatsAppFormat(twilioPayload: Record<string, string>, requestId: string): any {
  // Extract phone number from whatsapp:+1234567890 format
  const fromNumber = twilioPayload.From?.replace('whatsapp:', '').replace('+', '') || '';
  const toNumber = twilioPayload.To?.replace('whatsapp:', '').replace('+', '') || '';
  const messageSid = twilioPayload.SmsMessageSid || twilioPayload.MessageSid || '';
  const body = twilioPayload.Body || '';
  const profileName = twilioPayload.ProfileName || 'Unknown';
  const timestamp = Math.floor(Date.now() / 1000).toString();

  // Determine message type
  let messageType = 'text';
  const numMedia = parseInt(twilioPayload.NumMedia || '0', 10);
  
  if (numMedia > 0) {
    const mediaContentType = twilioPayload.MediaContentType0 || '';
    if (mediaContentType.startsWith('image/')) {
      messageType = 'image';
    } else if (mediaContentType.startsWith('video/')) {
      messageType = 'video';
    } else if (mediaContentType.startsWith('audio/')) {
      messageType = 'audio';
    } else {
      messageType = 'document';
    }
  }

  // Build message object in Meta WhatsApp format
  const message: any = {
    id: messageSid,
    from: fromNumber,
    timestamp,
    type: messageType,
  };

  // Add type-specific content
  if (messageType === 'text') {
    message.text = { body };
  } else if (messageType === 'image') {
    message.image = {
      id: messageSid,
      mime_type: twilioPayload.MediaContentType0,
      url: twilioPayload.MediaUrl0,
    };
    if (body) {
      message.image.caption = body;
    }
  } else if (messageType === 'video') {
    message.video = {
      id: messageSid,
      mime_type: twilioPayload.MediaContentType0,
      url: twilioPayload.MediaUrl0,
    };
    if (body) {
      message.video.caption = body;
    }
  } else if (messageType === 'audio') {
    message.audio = {
      id: messageSid,
      mime_type: twilioPayload.MediaContentType0,
      url: twilioPayload.MediaUrl0,
    };
  } else if (messageType === 'document') {
    message.document = {
      id: messageSid,
      mime_type: twilioPayload.MediaContentType0,
      url: twilioPayload.MediaUrl0,
      filename: twilioPayload.MediaUrl0?.split('/').pop() || 'document',
    };
  }

  // Build payload in Meta WhatsApp webhook format
  const whatsappPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: toNumber,
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: toNumber,
                phone_number_id: toNumber,
              },
              contacts: [
                {
                  profile: {
                    name: profileName,
                  },
                  wa_id: fromNumber,
                },
              ],
              messages: [message],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };

  logger.debug('Transformed Twilio payload to WhatsApp format', {
    requestId,
    messageSid,
    fromNumber,
    messageType,
    hasMedia: numMedia > 0,
  });

  return whatsappPayload;
}

/**
 * Publish webhook payload to EventBridge
 */
async function publishToEventBridge(payload: any, requestId: string): Promise<void> {
  const command = new PutEventsCommand({
    Entries: [
      {
        Source: 'vyapargyan.whatsapp.twilio',
        DetailType: 'IncomingWhatsAppWebhook',
        Detail: JSON.stringify({
          payload,
          receivedAt: new Date().toISOString(),
          requestId,
          source: 'twilio',
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
