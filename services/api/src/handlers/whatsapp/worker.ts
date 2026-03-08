import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { logger } from '../../utils/logger';
import { idempotencyService } from '../../utils/idempotency';
import { CustomerRepository } from '../../repositories/customer-repository';
import { getUserByPhone, putMessage } from '../../adapters/dynamodb-adapter';
import { resolveOrCreateSession } from '../../services/session-service';
import { recordInboundMessage, handleOptOut } from '../../services/consent-service';
import { getConfig } from '../../utils/config';
import { whatsappSender } from '../../services/whatsapp-sender';
import { routeMessage } from './states/router';

// Clients reused across invocations
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});

// Allowed image MIME types and max size
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const customerRepository = new CustomerRepository();

/**
 * WhatsApp Worker Lambda
 * 
 * Processes WhatsApp webhook events from SQS queue.
 * Handles idempotency, customer/session resolution, and message routing.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info('Processing WhatsApp worker batch', {
    recordCount: event.Records.length,
  });

  // Process records in parallel
  const results = await Promise.allSettled(
    event.Records.map(record => processRecord(record))
  );

  // Log any failures
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    logger.error('Some records failed processing', {
      failureCount: failures.length,
      totalCount: results.length,
    });
  }

  logger.info('Worker batch processing complete', {
    successCount: results.filter(r => r.status === 'fulfilled').length,
    failureCount: failures.length,
  });
};

/**
 * Process a single SQS record
 */
async function processRecord(record: SQSRecord): Promise<void> {
  const messageId = record.messageId;
  
  try {
    // Parse EventBridge event from SQS message
    const eventBridgeEvent = JSON.parse(record.body);
    
    // Handle detail - it may already be an object or a JSON string
    const detail = typeof eventBridgeEvent.detail === 'string' 
      ? JSON.parse(eventBridgeEvent.detail) 
      : eventBridgeEvent.detail;
    
    logger.info('Processing WhatsApp webhook event', {
      messageId,
      requestId: detail.requestId,
    });

    // Extract WhatsApp payload
    const whatsappPayload = detail.payload;
    
    // Process each entry in the webhook payload
    for (const entry of whatsappPayload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'messages') {
          await processMessageChange(change.value, detail.requestId);
        }
      }
    }
  } catch (error) {
    logger.error('Error processing SQS record', {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    
    throw error; // Re-throw to move message to DLQ
  }
}

/**
 * Process a message change from WhatsApp webhook.
 * 
 * Routing logic (Task 9.3):
 * - Resolve user via GSI1 PHONE#{phone} lookup (replaces hardcoded test number)
 * - If user is an approved seller → route to seller copilot
 * - Otherwise → route to customer shopping flow
 * 
 * Opt-out detection (Task 9.4):
 * - Before routing, check for STOP/Unsubscribe/रुको/बंद करो keywords
 * - If opt-out detected, update consent and send confirmation
 */
async function processMessageChange(
  value: any, 
  requestId: string,
): Promise<void> {
  const messages = value.messages || [];
  const contacts = value.contacts || [];
  
  for (const message of messages) {
    const messageId = message.id;
    
    // Check for duplicates using idempotency service
    const isFirstTime = await idempotencyService.acquireLock(messageId, {
      requestId,
      from: message.from,
      timestamp: message.timestamp,
    });

    if (!isFirstTime) {
      logger.info('Skipping duplicate message', { messageId });
      continue;
    }

    // Extract contact information
    const contact = contacts.find((c: any) => c.wa_id === message.from);
    const phoneNumber = message.from;
    const profileName = contact?.profile?.name || 'Unknown';

    // Resolve user via GSI1 phone lookup (Task 9.3)
    const userProfile = await getUserByPhone(phoneNumber);
    const isSeller = userProfile?.role === 'seller' && userProfile?.sellerStatus === 'approved';

    logger.info('Processing new message', {
      messageId,
      phoneNumber,
      profileName,
      messageType: message.type,
      resolvedUserId: userProfile?.userId,
      isSeller,
    });

    // Opt-out keyword detection (Task 9.4)
    const messageText = message.text?.body || '';
    if (messageText && userProfile) {
      const wasOptOut = await handleOptOut(userProfile.userId, messageText);
      if (wasOptOut) {
        const { whatsappSender } = await import('../../services/whatsapp-sender.js');
        await whatsappSender.sendMessage(
          phoneNumber,
          { type: 'text', text: 'You have been unsubscribed from promotional messages. You will still receive order updates.' },
          `optout-${userProfile.userId}`,
        );
        return;
      }
    }

    // Route based on resolved user role
    if (isSeller && userProfile) {
      await handleSellerMessage({
        message,
        phoneNumber,
        userId: userProfile.userId,
        userRole: 'seller',
        requestId,
      });
    } else {
      await handleCustomerMessage({
        message,
        phoneNumber,
        profileName,
        contact,
        requestId,
      });
    }
  }
}

/**
 * Handle WhatsApp message from a seller or admin.
 * 
 * Task 9.3: Replaces hardcoded SELLER_TEST_ID/SELLER_TEST_NUMBER with
 * proper GSI1 phone lookup. The user profile is already resolved in
 * processMessageChange.
 */
async function handleSellerMessage(context: {
  message: any;
  phoneNumber: string;
  userId: string;
  userRole: string;
  requestId: string;
}): Promise<void> {
  const { message, phoneNumber, userId, userRole, requestId } = context;

  logger.info('Routing to seller copilot', {
    requestId,
    userId,
    userRole,
    phoneNumber,
  });

  // Import seller copilot handler
  const { handleSellerWhatsAppCommand } = await import('../../services/whatsapp/seller-copilot.js');
  
  // Resolve full user details from the new USER#{userId} entity
  const userProfile = await getUserByPhone(phoneNumber);
  
  const user: any = userProfile
    ? {
        id: userProfile.userId,
        email: `${userProfile.displayName.toLowerCase().replace(/\s+/g, '.')}@vyapargyan.com`,
        phoneNumber: userProfile.phoneNumber,
        role: userProfile.role,
        cognitoId: userProfile.cognitoId,
        createdAt: userProfile.createdAt,
        updatedAt: userProfile.updatedAt,
      }
    : {
        // Fallback if profile somehow missing (shouldn't happen since we checked in processMessageChange)
        id: userId,
        phoneNumber,
        role: 'seller' as const,
        cognitoId: 'unknown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

  // Extract message text
  const messageText = message.text?.body || '';

  // Process seller command
  const response = await handleSellerWhatsAppCommand({
    user,
    message: messageText,
    phoneNumber,
    requestId,
  });

  // Send response back via WhatsApp
  const { whatsappSender } = await import('../../services/whatsapp-sender.js');
  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text: response },
    `seller-${user.id}`
  );

  logger.info('Seller message processed and response sent', {
    requestId,
    userId: user.id,
    responseLength: response.length,
  });
}

/**
 * Handle WhatsApp message from a customer.
 * 
 * Task 9.2: Updated to use new entity patterns:
 * - Resolve user via GSI1 PHONE#{phone} → USER#{userId} (with legacy fallback)
 * - Use new session service: resolveOrCreateSession({ userId, phoneNumber, channel: 'whatsapp' })
 * - Store messages in THREAD#{userId} using putMessage
 * - Update CONSENT#{userId} SERVICE_WINDOW on every inbound message
 */
async function handleCustomerMessage(context: {
  message: any;
  phoneNumber: string;
  profileName: string;
  contact: any;
  requestId: string;
}): Promise<void> {
  const { message, phoneNumber, profileName, contact, requestId } = context;

  // Resolve user via GSI1 phone lookup (new pattern)
  const userProfile = await getUserByPhone(phoneNumber);
  let userId: string;

  if (userProfile) {
    userId = userProfile.userId;
  } else {
    // Legacy fallback — use old customer repository (lazy migration)
    const customer = await customerRepository.resolveOrCreate({
      phoneNumber,
      profileName,
      whatsappId: contact?.wa_id,
    });
    userId = customer.id;
  }

  // Use new session service (SESSION#{userId} ACTIVE)
  const sessionResult = await resolveOrCreateSession({
    userId,
    phoneNumber,
    channel: 'whatsapp',
  });

  // Store message in THREAD#{userId}
  await putMessage({
    userId,
    messageId: message.id,
    direction: 'inbound',
    channel: 'whatsapp',
    senderRole: 'customer',
    messageType: message.type || 'text',
    content: { text: message.text?.body || '', raw: message },
    deliveryStatus: 'delivered',
    createdAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30-day TTL
  });

  // Update consent service window on inbound
  await recordInboundMessage(userId);

  logger.info('Customer and session resolved', {
    userId,
    sessionState: sessionResult.session.state,
    isNewSession: sessionResult.isNew,
    hasRestoredCart: !!sessionResult.restoredCart,
  });

  // --- Media detection: handle voice notes and images before text routing ---
  const messageType = message.type;

  if (messageType === 'audio') {
    logger.info('Voice note detected, routing to media handler', { userId, messageId: message.id });
    await handleVoiceNote({ message, userId, phoneNumber });
    return; // Don't route to text handler
  }

  if (messageType === 'image') {
    logger.info('Image detected, routing to media handler', { userId, messageId: message.id });
    await handleImageMessage({ message, userId, phoneNumber });
    return; // Don't route to text handler
  }

  // --- Continue with existing text message routing ---

  // Build a customer-like object for the existing routeMessage interface
  const customer = userProfile
    ? { id: userId, phoneNumber, profileName: userProfile.displayName, whatsappId: contact?.wa_id }
    : { id: userId, phoneNumber, profileName, whatsappId: contact?.wa_id };

  // Build a session-like object compatible with the existing router
  const session = {
    id: userId,
    state: sessionResult.session.state,
    customerId: userId,
    phoneNumber,
    channelType: 'whatsapp' as const,
    context: {} as any,
    createdAt: sessionResult.session.createdAt,
    updatedAt: sessionResult.session.lastActivityAt,
    expiresAt: new Date(sessionResult.session.expiresAt * 1000).toISOString(),
  };

  // Route message to appropriate state handler
  await routeMessage({
    message,
    customer,
    session,
    requestId,
  });
}


// ---------------------------------------------------------------------------
// Media Handling Helpers
// ---------------------------------------------------------------------------

/**
 * Download media from Twilio MediaUrl using basic auth.
 * Twilio requires account SID + auth token for media downloads.
 */
async function downloadTwilioMedia(mediaUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const config = await getConfig();
  const authHeader = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');

  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${authHeader}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download media from Twilio: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

/**
 * Resolve the Twilio media download URL from a WhatsApp message.
 * WhatsApp messages include media info under message.audio / message.image with an `id`.
 * The actual download URL is constructed via the Twilio Content API.
 */
function resolveMediaUrl(message: any): string | null {
  // Twilio webhook format stores media URLs in the raw payload
  // Check for direct URL first (some webhook formats include it)
  if (message.audio?.url) return message.audio.url;
  if (message.image?.url) return message.image.url;

  // Fallback: construct from Twilio media ID
  // The raw webhook payload may have MediaUrl0 in the original Twilio format
  if (message._rawPayload?.MediaUrl0) return message._rawPayload.MediaUrl0;

  // WhatsApp Cloud API format: media ID needs to be fetched via Graph API
  // For Twilio-proxied WhatsApp, the media URL is typically in the webhook body
  const mediaId = message.audio?.id || message.image?.id;
  if (mediaId) {
    // Twilio provides media via their API endpoint
    return `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID || 'unknown'}/Messages/${message.id}/Media/${mediaId}`;
  }

  return null;
}

/**
 * Handle voice note message from WhatsApp customer.
 * Downloads audio, stores in S3, publishes VoiceNoteReceived to media processing queue.
 */
async function handleVoiceNote(context: {
  message: any;
  userId: string;
  phoneNumber: string;
}): Promise<void> {
  const { message, userId, phoneNumber } = context;
  const ts = Date.now();

  // Send processing acknowledgment immediately
  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text: '🔄 Processing your voice note...' },
    `media-ack-${userId}`,
  );

  // Resolve media URL
  const mediaUrl = resolveMediaUrl(message);
  if (!mediaUrl) {
    logger.error('No media URL found for voice note', { userId, messageId: message.id });
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: "I couldn't process that voice note. Could you try sending it again or type your order?" },
      `media-err-${userId}`,
    );
    return;
  }

  try {
    // Download audio from Twilio
    const { buffer } = await downloadTwilioMedia(mediaUrl);

    // Store in S3
    const config = await getConfig();
    const s3Key = `voice/${userId}/${ts}.ogg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: config.productImagesBucket,
      Key: s3Key,
      Body: buffer,
      ContentType: 'audio/ogg',
    }));

    logger.info('Voice note stored in S3', { userId, s3Key, sizeBytes: buffer.length });

    // Publish VoiceNoteReceived to media processing queue
    const queueUrl = process.env.MEDIA_PROCESSING_QUEUE_URL;
    if (!queueUrl) {
      throw new Error('MEDIA_PROCESSING_QUEUE_URL environment variable not set');
    }

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        mediaType: 'voice_note',
        userId,
        s3Key,
        mimeType: 'audio/ogg',
        languageHint: 'Hindi',
        browsingContext: [],
        channel: 'whatsapp',
      }),
    }));

    logger.info('VoiceNoteReceived event published to media queue', { userId, s3Key });
  } catch (error) {
    logger.error('Failed to process voice note', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: "I couldn't process that voice note. Could you type what you'd like to order?" },
      `media-fallback-${userId}`,
    );
  }
}

/**
 * Handle image message from WhatsApp customer.
 * Downloads image, validates format/size, stores in S3, publishes ImageSearchRequested.
 */
async function handleImageMessage(context: {
  message: any;
  userId: string;
  phoneNumber: string;
}): Promise<void> {
  const { message, userId, phoneNumber } = context;
  const ts = Date.now();

  // Send processing acknowledgment immediately
  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text: '🔄 Processing your image...' },
    `media-ack-${userId}`,
  );

  // Resolve media URL
  const mediaUrl = resolveMediaUrl(message);
  if (!mediaUrl) {
    logger.error('No media URL found for image', { userId, messageId: message.id });
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: "I couldn't process that image. Could you try sending it again or describe what you're looking for?" },
      `media-err-${userId}`,
    );
    return;
  }

  try {
    // Download image from Twilio
    const { buffer, contentType } = await downloadTwilioMedia(mediaUrl);

    // Validate MIME type
    const mimeType = message.image?.mime_type || contentType;
    if (!ALLOWED_IMAGE_TYPES.includes(mimeType as any)) {
      logger.warn('Unsupported image format', { userId, mimeType });
      await whatsappSender.sendMessage(
        phoneNumber,
        { type: 'text', text: `Unsupported image format (${mimeType}). Please send a JPEG, PNG, or WebP image.` },
        `media-format-${userId}`,
      );
      return;
    }

    // Validate file size
    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      logger.warn('Image too large', { userId, sizeBytes: buffer.length });
      await whatsappSender.sendMessage(
        phoneNumber,
        { type: 'text', text: 'That image is too large (max 5MB). Please send a smaller image.' },
        `media-size-${userId}`,
      );
      return;
    }

    // Determine file extension
    const ext = MIME_TO_EXT[mimeType] || 'jpg';

    // Store in S3
    const config = await getConfig();
    const s3Key = `image-search/${userId}/${ts}.${ext}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: config.productImagesBucket,
      Key: s3Key,
      Body: buffer,
      ContentType: mimeType,
    }));

    logger.info('Image stored in S3', { userId, s3Key, sizeBytes: buffer.length, mimeType });

    // Publish ImageSearchRequested to media processing queue
    const queueUrl = process.env.MEDIA_PROCESSING_QUEUE_URL;
    if (!queueUrl) {
      throw new Error('MEDIA_PROCESSING_QUEUE_URL environment variable not set');
    }

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        mediaType: 'image_search',
        userId,
        s3Key,
        mimeType,
        channel: 'whatsapp',
      }),
    }));

    logger.info('ImageSearchRequested event published to media queue', { userId, s3Key });
  } catch (error) {
    logger.error('Failed to process image', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: "I couldn't analyze that image. Could you describe what you're looking for?" },
      `media-fallback-${userId}`,
    );
  }
}
