import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { validateRequest } from 'twilio';
import { logger } from '../../utils/logger';
import { getWebhookConfig, type WebhookConfig } from '../../utils/config';
import { publishLatencyMetric, publishCountMetric } from '../../core/metrics';

const eventBridgeClient = new EventBridgeClient({});
const dynamoDBClient = new DynamoDBClient({});
let config: WebhookConfig;

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
  const startTime = Date.now();
  const requestId = event.requestContext.requestId;
  
  logger.info('Twilio WhatsApp webhook request received', {
    requestId,
    method: event.httpMethod,
    path: event.path,
    contentType: event.headers['content-type'] || event.headers['Content-Type'],
    bodyLength: event.body?.length || 0,
    isBase64Encoded: event.isBase64Encoded,
  });

  try {
    // Load config on first invocation
    if (!config) {
      logger.info('Loading configuration from Secrets Manager and SSM', { requestId });
      try {
        config = await getWebhookConfig();
        logger.info('Configuration loaded successfully (webhook-only config)', { requestId });
      } catch (configError) {
        const cfgErrMsg = configError instanceof Error
          ? configError.message
          : (typeof configError === 'object' ? JSON.stringify(configError) : String(configError));
        logger.error('FATAL: Failed to load configuration', {
          requestId,
          error: cfgErrMsg,
          stack: configError instanceof Error ? configError.stack : undefined,
        });
        throw configError;
      }
    }

    // Check HTTP method - support both API Gateway v1 (httpMethod) and v2 (requestContext.http.method)
    const method = event.httpMethod || (event.requestContext as any)?.http?.method;
    
    logger.info('HTTP method detected', { requestId, method, hasHttpMethod: !!event.httpMethod, hasRequestContextMethod: !!(event.requestContext as any)?.http?.method });
    
    // Only handle POST requests
    if (method && method !== 'POST') {
      logger.warn('Non-POST request received', { requestId, method });
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    return await handleIncomingWebhook(event, requestId);
  } catch (error) {
    const errMsg = error instanceof Error
      ? error.message
      : (typeof error === 'object' ? JSON.stringify(error) : String(error));
    logger.error('FATAL: Error processing Twilio webhook', {
      requestId,
      error: errMsg,
      stack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : 'Unknown',
    });

    // Return 200 to prevent Twilio from retrying
    // Errors are logged and can be investigated via CloudWatch
    // IMPORTANT: Return empty TwiML, never JSON — Twilio can echo JSON as a message
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    };
  } finally {
    publishLatencyMetric('WhatsAppWebhookLatency', Date.now() - startTime, { Channel: 'whatsapp' });
    publishCountMetric('MessagesReceived', 1, { Channel: 'whatsapp' });
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
  
  logger.info('Processing webhook body', {
    requestId,
    hasBody: !!body,
    bodyLength: body?.length || 0,
    isBase64Encoded: event.isBase64Encoded,
  });
  
  if (!body) {
    logger.warn('Empty webhook body received', { requestId });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    };
  }

  // Decode base64 if needed
  const decodedBody = event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body;
  
  logger.info('Body decoded', {
    requestId,
    decodedLength: decodedBody.length,
    preview: decodedBody.substring(0, 100),
  });

  // Parse form-encoded body (Twilio sends application/x-www-form-urlencoded)
  const twilioPayload = parseFormData(decodedBody);
  
  if (!twilioPayload) {
    logger.error('FATAL: Failed to parse webhook body', { 
      requestId,
      bodyPreview: decodedBody.substring(0, 200),
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/xml' },
      body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    };
  }

  // ── Forensic logging: capture ALL Twilio fields relevant to voice/media detection ──
  const numMedia = parseInt(twilioPayload.NumMedia || '0', 10);
  logger.info('Twilio webhook payload parsed successfully', {
    requestId,
    from: twilioPayload.From,
    to: twilioPayload.To,
    messageSid: twilioPayload.SmsMessageSid || twilioPayload.MessageSid,
    messageStatus: twilioPayload.SmsStatus || twilioPayload.MessageStatus,
    bodyPreview: twilioPayload.Body?.substring(0, 50),
    // Voice/media forensic fields
    numMedia,
    mediaContentType0: twilioPayload.MediaContentType0 || null,
    mediaUrl0: twilioPayload.MediaUrl0?.substring(0, 80) || null,
    messageType: twilioPayload.MessageType || null,
    profileName: twilioPayload.ProfileName || null,
    waId: twilioPayload.WaId || null,
  });

  // Classify message type for logging
  let classifiedType = 'text';
  if (numMedia > 0) {
    const ct = twilioPayload.MediaContentType0 || '';
    if (ct.startsWith('audio/')) classifiedType = 'audio/voice';
    else if (ct.startsWith('image/')) classifiedType = 'image';
    else if (ct.startsWith('video/')) classifiedType = 'video';
    else classifiedType = 'unsupported_media';
  }
  logger.info('Webhook message classified', { requestId, classifiedType, numMedia });

  // Verify Twilio webhook signature using parsed params
  const signature = event.headers['x-twilio-signature'] || event.headers['X-Twilio-Signature'];
  const url = reconstructUrl(event);
  
  logger.info('Verifying Twilio signature', {
    requestId,
    hasSignature: !!signature,
    url,
    authTokenConfigured: !!config.twilioAuthToken,
  });
  
  if (!verifyTwilioSignature(url, twilioPayload, signature)) {
    logger.error('FATAL: Invalid Twilio webhook signature', { 
      requestId,
      url,
      hasSignature: !!signature,
      authTokenConfigured: !!config.twilioAuthToken,
    });
    return {
      statusCode: 403,
      body: JSON.stringify({ error: 'Invalid signature' }),
    };
  }

  logger.info('Twilio signature verified successfully', { requestId });

  // Idempotency check — prevent duplicate webhook processing (Req 13)
  const messageSid = twilioPayload.MessageSid || twilioPayload.SmsMessageSid;
  if (messageSid) {
    const isNew = await acquireIdempotency(messageSid, requestId);
    if (!isNew) {
      logger.info('Duplicate webhook, skipping', { requestId, messageSid });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/xml' },
        body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      };
    }
  }

  // Transform Twilio payload to internal WhatsApp event format
  const internalPayload = transformTwilioToWhatsAppFormat(twilioPayload, requestId);

  logger.info('Payload transformed, publishing to EventBridge', { requestId });

  // Publish to EventBridge for async processing
  await publishToEventBridge(internalPayload, requestId);

  logger.info('Twilio webhook processed successfully', { requestId });
  
  // Return empty TwiML response to prevent echo
  // Twilio expects TwiML XML or empty response, not JSON
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/xml',
    },
    body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  };
}

/**
 * Reconstruct the full URL for signature validation
 */
function reconstructUrl(event: APIGatewayProxyEvent): string {
  const host = event.headers.Host || event.headers.host || '';
  
  // Support both API Gateway v1 (event.path) and v2 (event.rawPath or event.requestContext.http.path)
  const path = event.path || (event as any).rawPath || (event.requestContext as any)?.http?.path || '';
  
  const protocol = event.headers['X-Forwarded-Proto'] || event.headers['x-forwarded-proto'] || 'https';
  
  // Build base URL with path
  let url = `${protocol}://${host}${path}`;
  
  // Include query string if present
  if (event.queryStringParameters) {
    const queryString = Object.entries(event.queryStringParameters)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value || '')}`)
      .join('&');
    
    if (queryString) {
      url += `?${queryString}`;
    }
  }
  
  logger.info('Reconstructed URL for signature validation', {
    url,
    host,
    path,
    protocol,
    hasQueryParams: !!event.queryStringParameters,
  });
  
  return url;
}

/**
 * Verify Twilio webhook signature
 */
function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | undefined): boolean {
  // HACKATHON BYPASS: Skip signature validation in dev environment
  if (config.environment === 'dev') {
    logger.warn('⚠️  SECURITY WARNING: Twilio signature validation BYPASSED in dev environment', {
      environment: config.environment,
    });
    return true;
  }
  
  if (!signature) {
    logger.warn('Missing Twilio webhook signature header');
    return false;
  }

  const authToken = config.twilioAuthToken;
  if (!authToken) {
    logger.error('FATAL: TWILIO_AUTH_TOKEN not configured in Secrets Manager');
    return false;
  }

  try {
    const isValid = validateRequest(authToken, signature, url, params);
    
    if (!isValid) {
      logger.warn('Twilio signature validation failed', {
        url,
        signatureProvided: signature.substring(0, 10) + '...',
        paramsCount: Object.keys(params).length,
      });
    } else {
      logger.info('Twilio signature validation succeeded');
    }
    
    return isValid;
  } catch (error) {
    logger.error('FATAL: Error validating Twilio signature', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
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
export function transformTwilioToWhatsAppFormat(twilioPayload: Record<string, string>, requestId: string): any {
  // Extract phone number from whatsapp:+1234567890 format
  // IMPORTANT: Keep the + prefix to match database format (+918927049085)
  const fromNumber = twilioPayload.From?.replace('whatsapp:', '') || '';
  const toNumber = twilioPayload.To?.replace('whatsapp:', '') || '';
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
    logger.info('Audio message transformed', {
      requestId,
      hasMediaUrl0: !!twilioPayload.MediaUrl0,
      mediaContentType: twilioPayload.MediaContentType0,
      mediaUrl0Preview: twilioPayload.MediaUrl0?.substring(0, 60),
    });
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
 * Acquire idempotency lock for a webhook message using DDB conditional write.
 * PK: IDEMPOTENCY#{messageSid}, SK: WEBHOOK
 * ConditionExpression: attribute_not_exists(PK)
 * Returns true if this is the first time we've seen this messageSid.
 */
async function acquireIdempotency(messageSid: string, requestId: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const item = {
    PK: `IDEMPOTENCY#${messageSid}`,
    SK: 'WEBHOOK',
    messageSid,
    processedAt: new Date().toISOString(),
    expiresAt: now + 86400, // 24h TTL
  };

  try {
    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: config.tableName,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    logger.error('Error in webhook idempotency check', {
      requestId,
      messageSid,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Publish webhook payload to EventBridge
 * 
 * Enhanced to include user role information for downstream routing.
 * If the phone number belongs to a registered seller/admin, the event
 * will include userRole and userId for seller-specific handling.
 */
async function publishToEventBridge(payload: any, requestId: string): Promise<void> {
  // Extract phone number from the first message
  const phoneNumber = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
  
  let userRole: string | undefined;
  let userId: string | undefined;
  
  // Unified role resolution: always use DB lookup (no hardcoded overrides)
  // The worker also does getUserByPhone — both must agree on the same source of truth
  if (phoneNumber) {
    // Normal flow: Check if this phone number belongs to a registered user (seller/admin)
    try {
      const { UserRepository } = await import('../../repositories/user-repository.js');
      const userRepo = new UserRepository();
      const user = await userRepo.getUserByPhone(phoneNumber);
      
      if (user && (user.role === 'seller' || user.role === 'admin')) {
        userRole = user.role;
        userId = user.id;
        
        logger.info('Detected registered user in WhatsApp message', {
          requestId,
          phoneNumber,
          userRole,
          userId,
        });
      }
    } catch (error) {
      // Log error but don't fail the webhook - treat as customer if lookup fails
      logger.warn('Failed to lookup user by phone number', {
        requestId,
        phoneNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const command = new PutEventsCommand({
    Entries: [
      {
        Source: 'vyapargyan.whatsapp',
        DetailType: 'IncomingWhatsAppWebhook',
        Detail: JSON.stringify({
          payload,
          receivedAt: new Date().toISOString(),
          requestId,
          source: 'twilio',
          // Include user context for routing
          userRole,
          userId,
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

  logger.info('Event published to EventBridge', { 
    requestId,
    userRole: userRole || 'customer',
  });
}
