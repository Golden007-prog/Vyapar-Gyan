import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../../utils/logger';
import { idempotencyService } from '../../utils/idempotency';
import { CustomerRepository } from '../../repositories/customer-repository';
import { getUserByPhone, putMessage, updateSessionIntent, updateSessionState as dbUpdateSessionState } from '../../adapters/dynamodb-adapter';
import { resolveOrCreateSession } from '../../services/session-service';
import { shouldBypassAI } from '../../services/session-service';
import { recordInboundMessage, handleOptOut } from '../../services/consent-service';
import { getConfig, getVoicePipelineConfig } from '../../utils/config';
import { whatsappSender } from '../../services/whatsapp-sender';
import { routeMessage } from './states/router';
import { sanitizeForTTS } from '../../utils/whatsapp-sanitizer';
import { GeminiAdapter } from '../../adapters/gemini-adapter';
import { publishCountMetric, publishLatencyMetric } from '../../core/metrics';
import { handleSellerCopilotMessage } from './seller-copilot';
import { handleCustomerDiscovery } from './customer-discovery';
import { executeFinancialQuery, isLikelyFinancialQuery, LANGUAGE_NAMES } from '../../services/financial-query';
import { extractAndRouteIntent } from '../../services/intent-extraction';
import {
  detectMediaType,
  handleInventoryUpload,
  commitInventory,
  applyInventoryEdit,
  parseInventoryEditCommand,
  formatInventoryList,
  type InventoryItem,
} from './inventory-upload';

// Clients reused across invocations
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const ebClient = new EventBridgeClient({});

// Allowed image MIME types and max size
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const customerRepository = new CustomerRepository();

// ---------------------------------------------------------------------------
// Voice Pipeline Configuration & Helpers
// ---------------------------------------------------------------------------

/** Voice pipeline configuration constants */
export const VOICE_CONFIG = {
  maxAudioSizeBytes: 16 * 1024 * 1024, // 16 MB
  supportedMimeTypes: [
    'audio/ogg',
    'audio/ogg; codecs=opus',  // WhatsApp voice notes use OGG/Opus
    'audio/opus',
    'audio/mpeg',
    'audio/mp4',
    'audio/amr',               // Some older WhatsApp clients
  ],
  maxTTSTextLength: 500,
  presignedUrlExpirySeconds: 600, // 10 minutes
  s3InboundPrefix: 'voice/inbound',
  s3OutboundPrefix: 'voice/outbound',
} as const;

/** Context passed through the voice processing pipeline */
export interface VoiceContext {
  message: any;
  userId: string;
  phoneNumber: string;
  userRole: 'seller' | 'customer';
  requestId: string;
  userProfile?: any;
}

/** Safely serialize any thrown value into a readable string */
function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

/** Validate inbound audio MIME type and file size */
export function validateAudio(
  mimeType: string,
  sizeBytes: number,
): { valid: boolean; reason?: string } {
  // Normalize: strip parameters (e.g. "audio/ogg; codecs=opus" → check both full and base)
  const normalizedMime = mimeType.trim().toLowerCase();
  const baseMime = (normalizedMime.split(';')[0] ?? normalizedMime).trim();
  const isSupported = VOICE_CONFIG.supportedMimeTypes.some(
    (t) => normalizedMime.startsWith(t) || baseMime === t,
  );
  if (!isSupported) {
    return { valid: false, reason: 'unsupported_mime_type' };
  }
  if (sizeBytes > VOICE_CONFIG.maxAudioSizeBytes) {
    return { valid: false, reason: 'file_too_large' };
  }
  return { valid: true };
}

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
    const errMsg = error instanceof Error
      ? error.message
      : (typeof error === 'object' ? JSON.stringify(error) : String(error));
    logger.error('Error processing SQS record', {
      messageId,
      error: errMsg,
      stack: error instanceof Error ? error.stack : undefined,
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
        await whatsappSender.sendMessage(
          phoneNumber,
          { type: 'text', text: 'You have been unsubscribed from promotional messages. You will still receive order updates.' },
          `optout-${userProfile.userId}`,
        );
        return;
      }
    }

    // Route based on resolved user role
    if (!userProfile) {
      // Check legacy CUSTOMER# pattern before routing to onboarding
      // Some customers (e.g. Enigma) were seeded with CUSTOMER#+91... PK, not USER#
      let isLegacyCustomer = false;
      try {
        const legacyCustomer = await customerRepository.getByPhoneNumber(phoneNumber);
        isLegacyCustomer = !!legacyCustomer;
      } catch { /* ignore */ }

      if (isLegacyCustomer) {
        logger.info('Legacy customer found, routing to customer flow', { phoneNumber });
        await handleCustomerMessage({ message, phoneNumber, profileName, contact, requestId });
      } else {
        // Truly unregistered phone — route to onboarding
        logger.info('Unregistered phone, routing to onboarding', { phoneNumber });
        const { resolveOrCreateOnboardingSession: resolveOnboarding, markOnboardingWelcomeSent: markWelcome } = await import('../../services/session-service.js');
        const { onboardingHandler } = await import('./states/onboarding-handler.js');
        const { session: onboardingSession } = await resolveOnboarding(phoneNumber);
        await onboardingHandler({
          phoneNumber,
          welcomeSent: onboardingSession.welcomeSent,
          sessionId: `onboarding-${phoneNumber}`,
        });
        if (!onboardingSession.welcomeSent) {
          await markWelcome(phoneNumber);
        }
      }
    } else if (isSeller) {
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

  // Import seller copilot handler (statically imported at top)
  
  // Resolve full user details from the new USER#{userId} entity
  const userProfile = await getUserByPhone(phoneNumber);
  
  // Route audio messages to voice pipeline before text processing
  if (message.type === 'audio') {
    logger.info('Routing seller audio message to voice pipeline', { requestId, userId, phoneNumber });
    await handleVoiceNote({
      message,
      userId,
      phoneNumber,
      userRole: 'seller',
      requestId,
      userProfile,
    });
    return;
  }

  // Route media attachments (document/image) to inventory upload handler
  // Detect from Twilio webhook fields: MediaContentType0 / MediaUrl0
  const mediaContentType = message._rawPayload?.MediaContentType0
    || message.document?.mime_type
    || message.image?.mime_type;
  const mediaUrl = message._rawPayload?.MediaUrl0
    || message.document?.url
    || message.image?.url;

  if (mediaContentType && mediaUrl) {
    const mediaCategory = detectMediaType(mediaContentType);
    if (mediaCategory !== 'unknown') {
      logger.info('Routing seller media to inventory upload', {
        requestId, userId, phoneNumber, mediaCategory, mediaContentType,
      });

      const items = await handleInventoryUpload({
        sellerId: userId,
        phoneNumber,
        mediaUrl,
        mediaContentType,
        requestId,
      });

      // Store pending inventory in session context for confirmation/edit flow
      if (items.length > 0) {
        try {
          const { getSession, putSession } = await import('../../adapters/dynamodb-adapter.js');
          const session = await getSession(userId);
          if (session) {
            (session as any).pendingInventory = items;
            await putSession(session);
          }
        } catch (err) {
          logger.warn('Failed to store pending inventory in session', {
            requestId, userId, error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }
  }

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

  // Check for pending inventory confirmation/edit flow
  try {
    const { getSession, putSession } = await import('../../adapters/dynamodb-adapter.js');
    const session = await getSession(userId);
    const pendingItems = (session as any)?.pendingInventory as InventoryItem[] | undefined;

    if (pendingItems && pendingItems.length > 0) {
      const textLower = messageText.trim().toLowerCase();

      // Requirement 11.5: Seller confirms
      if (textLower === 'looks good' || textLower === 'confirm' || textLower === 'yes' || textLower === 'ok') {
        await commitInventory(userId, phoneNumber, pendingItems);
        // Clear pending inventory from session
        (session as any).pendingInventory = undefined;
        await putSession(session!);
        return;
      }

      // Cancel
      if (textLower === 'cancel' || textLower === 'discard') {
        (session as any).pendingInventory = undefined;
        await putSession(session!);
        await whatsappSender.sendMessage(
          phoneNumber,
          { type: 'text', text: '❌ Inventory upload cancelled.\n\nType "menu" to go back.' },
          `inv-cancel-${userId}`,
          'seller',
        );
        return;
      }

      // Requirement 11.6: Seller edits
      const editCmd = parseInventoryEditCommand(messageText);
      if (editCmd) {
        const result = applyInventoryEdit(pendingItems, editCmd);
        if (result.error) {
          await whatsappSender.sendMessage(
            phoneNumber,
            { type: 'text', text: `⚠️ ${result.error}` },
            `inv-edit-err-${userId}`,
            'seller',
          );
        } else {
          (session as any).pendingInventory = result.items;
          await putSession(session!);
          const updatedList = formatInventoryList(result.items);
          await whatsappSender.sendMessage(
            phoneNumber,
            { type: 'text', text: `✏️ Updated!\n\n${updatedList}` },
            `inv-edit-${userId}`,
            'seller',
          );
        }
        return;
      }
    }
  } catch (err) {
    logger.warn('Pending inventory check failed', {
      requestId, userId, error: err instanceof Error ? err.message : String(err),
    });
  }

  // Process seller command via copilot handler (home menu + stock check + Bedrock delegation)
  const response = await handleSellerCopilotMessage({
    user,
    message: messageText,
    phoneNumber,
    requestId,
  });

  // Send response back via WhatsApp (with seller audience for sanitization)
  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text: response },
    `seller-${user.id}`,
    'seller',
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

  // Publish CustomerMessageSent for omnichannel fan-out (fire-and-forget)
  // Always publish so messages appear in seller's web inbox
  const recipientSellerId = sessionResult.session.handoffSellerId
    || sessionResult.session.lastIntent?.store?.sellerId
    || 'seller-123'; // Default seller fallback for demo

  try {
    const eventBusName = process.env.EVENT_BUS_NAME ?? '';
    const messageContent = message.text?.body || '';

    if (!eventBusName) {
      logger.error('EVENT_BUS_NAME is empty — skipping EventBridge publish', undefined, {
        messageId: message.id,
        userId,
        recipientSellerId,
      });
    } else {
      // Publish to vyapargyan.chat (CustomerMessageSent) for notification router
      await ebClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'vyapargyan.chat',
              DetailType: 'CustomerMessageSent',
              Detail: JSON.stringify({
                userId,
                messageId: message.id,
                channel: 'whatsapp',
                sellerId: recipientSellerId,
                content: messageContent,
                messageType: message.type || 'text',
                createdAt: new Date().toISOString(),
              }),
              EventBusName: eventBusName,
            },
            // Also publish message.created for fan-out Lambda (WebSocket push)
            {
              Source: 'vyapargyan.messaging',
              DetailType: 'message.created',
              Detail: JSON.stringify({
                messageId: message.id,
                threadId: `THREAD#${userId}`,
                senderUserId: userId,
                senderType: 'customer',
                recipientUserId: recipientSellerId,
                channel: 'whatsapp',
                content: messageContent,
              }),
              EventBusName: eventBusName,
            },
          ],
        }),
      );
    }
  } catch (ebErr) {
    // Fire-and-forget — don't fail message processing if fan-out publish fails
    logger.error('Failed to publish message events', ebErr, {
      messageId: message.id,
      userId,
      recipientSellerId,
    });
  }

  logger.info('Customer and session resolved', {
    userId,
    sessionState: sessionResult.session.state,
    isNewSession: sessionResult.isNew,
    hasRestoredCart: !!sessionResult.restoredCart,
  });

  // --- Human Handoff Check (Req 10.2) ---
  // If handoff is active and not expired, skip AI and pipe to seller inbox
  if (shouldBypassAI(sessionResult.session)) {
    logger.info('Human handoff active — skipping AI, piping to seller inbox', {
      userId,
      handoffSellerId: sessionResult.session.handoffSellerId,
      handoffExpiresAt: sessionResult.session.handoffExpiresAt,
    });
    // Message already stored in THREAD#{userId} above.
    // Fan-out via EventBridge will push it to the seller's web inbox.
    return;
  }

  // --- Media detection: handle voice notes and images before text routing ---
  const messageType = message.type;

  if (messageType === 'audio') {
    logger.info('Voice note detected, routing to voice pipeline', { userId, messageId: message.id });
    await handleVoiceNote({
      message,
      userId,
      phoneNumber,
      userRole: 'customer',
      requestId,
    });
    return; // Don't route to text handler
  }

  if (messageType === 'image') {
    logger.info('Image detected, routing to media handler', { userId, messageId: message.id });
    await handleImageMessage({ message, userId, phoneNumber });
    return; // Don't route to text handler
  }

  // --- Continue with existing text message routing ---

  // Build a customer-like object for the existing routeMessage interface
  // Use displayName from profile, fall back to Twilio profileName, then empty string
  const resolvedName = userProfile?.displayName || profileName || '';
  const customer = { id: userId, phoneNumber, profileName: resolvedName, whatsappId: contact?.wa_id };

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

  // Route to customer discovery for new sessions or greeting state
  // Customer discovery handles store search, favorites, pincode/city lookup
  const messageText = message.text?.body?.trim() || '';
  // Route to customer discovery for greetings, new sessions, menu commands, and store selection
  const GREETING_RE = /^(hi|hello|hey|namaste|namaskar|hola|good\s*(morning|afternoon|evening)|howdy|sup|yo|menu|home|back)$/i;
  const isGreeting = GREETING_RE.test(messageText);
  const isDiscoveryTrigger = sessionResult.isNew
    || session.state === 'greeting'
    || isGreeting
    || /^(menu|home|discover|stores|1|2|3|4)$/i.test(messageText)
    || /^store\s+\d+$/i.test(messageText)
    || /^add to fav/i.test(messageText);

  // Greetings and menu commands ALWAYS go to discovery, even from browsing state
  // Only ordering/payment states are protected from interruption
  if (isDiscoveryTrigger && session.state !== 'ordering' && session.state !== 'payment') {
    logger.info('Routing to customer discovery', { userId, sessionState: session.state, isNew: sessionResult.isNew });
    await handleCustomerDiscovery({
      message,
      userId,
      phoneNumber,
      sessionId: session.id,
      requestId,
    });
    return;
  }

  // --- Intent extraction before routing (Req 9.1–9.6) ---
  // For non-discovery text messages, extract shopping intent via Gemini
  // to enable contextual routing to the correct seller/product.
  const intentMessageText = message.text?.body?.trim() || '';
  if (intentMessageText.length > 0 && session.state !== 'ordering' && session.state !== 'payment') {
    try {
      const intentResult = await extractAndRouteIntent(intentMessageText);

      // Store intent in session for conversation continuity (Req 9.4)
      const lastIntent: Record<string, unknown> = {
        product: intentResult.intent.product,
        store: intentResult.intent.store,
        language: intentResult.intent.language,
      };
      if (intentResult.routing.seller) {
        (lastIntent.store as Record<string, unknown>).sellerId = intentResult.routing.seller.sellerId;
      }
      await updateSessionIntent(userId, lastIntent as any);

      // Route based on intent (Req 9.2, 9.3)
      if (intentResult.routing.type === 'store_match' && intentResult.routing.seller) {
        logger.info('Intent: store match, routing to seller context', {
          userId, sellerId: intentResult.routing.seller.sellerId,
          storeName: intentResult.routing.seller.storeName,
        });
        // Transition to browsing with the matched seller
        await dbUpdateSessionState(userId, 'browsing', 'whatsapp');
        session.state = 'browsing';
        session.context = { sellerId: intentResult.routing.seller.sellerId };
      } else if (intentResult.routing.type === 'product_search' && intentResult.routing.searchQuery) {
        logger.info('Intent: product search across all sellers', {
          userId, searchQuery: intentResult.routing.searchQuery,
        });
        // Let the existing router handle the product search
      }
    } catch (intentErr) {
      // Non-fatal — continue with default routing on intent extraction failure
      logger.warn('Intent extraction failed, continuing with default routing', {
        userId,
        error: intentErr instanceof Error ? intentErr.message : String(intentErr),
      });
    }
  }

  // Route message to appropriate state handler (browsing, checkout, etc.)
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
 * 
 * Accepts optional pre-resolved credentials so the voice pipeline can pass
 * its isolated config without triggering a full getConfig() load.
 */
async function downloadTwilioMedia(
  mediaUrl: string,
  credentials?: { twilioAccountSid: string; twilioAuthToken: string },
): Promise<{ buffer: Buffer; contentType: string }> {
  let accountSid: string;
  let authToken: string;

  if (credentials) {
    accountSid = credentials.twilioAccountSid;
    authToken = credentials.twilioAuthToken;
  } else {
    const config = await getConfig();
    accountSid = config.twilioAccountSid;
    authToken = config.twilioAuthToken;
  }

  const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  logger.info('Downloading Twilio media', {
    mediaUrl: mediaUrl.substring(0, 80) + '...',
    hasAccountSid: !!accountSid,
    hasAuthToken: !!authToken,
  });

  // Strategy: Try redirect: 'follow' first (simplest, Node.js strips auth on cross-origin).
  // If that fails, fall back to manual redirect handling.
  let response: Response;
  let finalUrl = mediaUrl;

  try {
    response = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${authHeader}` },
      redirect: 'follow',
    });
    logger.info('Twilio media fetch completed', {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      url: response.url?.substring(0, 80),
    });
    finalUrl = response.url || mediaUrl;
  } catch (fetchErr) {
    // fetch() itself threw — log full details and try manual redirect approach
    logger.warn('fetch(redirect:follow) threw, trying manual redirect', {
      error: serializeError(fetchErr),
    });

    const initialResponse = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${authHeader}` },
      redirect: 'manual',
    });

    if (initialResponse.status === 301 || initialResponse.status === 302 || initialResponse.status === 303) {
      const redirectUrl = initialResponse.headers.get('location');
      if (!redirectUrl) {
        throw new Error(`media_download_failed: Twilio returned ${initialResponse.status} but no Location header`);
      }
      logger.info('Following Twilio media redirect (manual)', {
        status: initialResponse.status,
        redirectUrl: redirectUrl.substring(0, 80) + '...',
      });
      response = await fetch(redirectUrl);
      finalUrl = redirectUrl;
    } else {
      response = initialResponse;
    }
  }

  if (!response.ok) {
    // Read body for error details
    let errorBody = '';
    try { errorBody = await response.text(); } catch { /* ignore */ }
    throw new Error(`media_download_failed: Twilio returned ${response.status} ${response.statusText} from ${finalUrl.substring(0, 60)} body=${errorBody.substring(0, 200)}`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

/**
 * Resolve the Twilio media download URL from a WhatsApp message.
 * 
 * The webhook transform (transformTwilioToWhatsAppFormat) sets message.audio.url
 * directly from Twilio's MediaUrl0 field. This is the most reliable source.
 * Falls back to constructing the URL from the Twilio REST API pattern.
 */
function resolveMediaUrl(message: any): string | null {
  // Primary: direct URL set by webhook transform from MediaUrl0
  if (message.audio?.url) return message.audio.url;
  if (message.image?.url) return message.image.url;

  // Fallback: raw payload from Twilio webhook (form-encoded format)
  if (message._rawPayload?.MediaUrl0) return message._rawPayload.MediaUrl0;

  // Last resort: construct from Twilio REST API using message SID
  // Twilio media is accessible at: /2010-04-01/Accounts/{SID}/Messages/{MessageSid}/Media
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const messageSid = message.id; // message.id is the Twilio MessageSid
  if (accountSid && messageSid && messageSid.startsWith('SM')) {
    // List media resources for this message — Twilio returns JSON with media SIDs
    return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media.json`;
  }

  logger.warn('Could not resolve media URL from message', {
    messageId: message.id,
    hasAudio: !!message.audio,
    hasAudioUrl: !!message.audio?.url,
    hasAudioId: !!message.audio?.id,
    hasRawPayload: !!message._rawPayload,
  });

  return null;
}

/**
 * Handle voice note message with full voice round-trip pipeline.
 *
 * Accepts a VoiceContext (seller or customer) and orchestrates:
 *   1. Download audio from Twilio
 *   2. Validate MIME type and size
 *   3. Store inbound audio in S3
 *   4. Transcribe via Gemini
 *   5. Route transcript to agent pipeline (seller copilot or customer router)
 *   6. Tag agent reply with sourceChannel: 'voice'
 *   7. Sanitize reply for TTS
 *   8. Generate TTS audio via Gemini
 *   9. Store outbound audio in S3 and generate pre-signed URL
 *  10. Send voice reply via Twilio
 *
 * Every stage has a try/catch with text fallback — the function never throws.
 */
export async function handleVoiceNote(context: VoiceContext): Promise<void> {
  const { userId, phoneNumber, userRole, requestId } = context;
  const pipelineStart = Date.now();

  // Emit received metric
  publishCountMetric('VoiceMessagesReceived', 1, { Channel: 'whatsapp', Role: userRole });

  logger.info('Voice pipeline started', { userId, requestId, userRole, messageId: context.message?.id });

  // Send processing acknowledgment immediately so the user knows we're working on it
  try {
    await whatsappSender.sendMessage(
      phoneNumber,
      { type: 'text', text: '🔄 Processing your voice note...' },
      `voice-ack-${userId}`,
      userRole,
    );
  } catch { /* best effort — don't block pipeline */ }

  // Wrap entire pipeline in a top-level safety net so the user NEVER gets stuck
  // after the "Processing your voice note..." acknowledgment
  try {
    await _executeVoicePipeline(context, pipelineStart);
  } catch (fatalErr) {
    const errMsg = fatalErr instanceof Error
      ? fatalErr.message
      : (typeof fatalErr === 'object' ? JSON.stringify(fatalErr) : String(fatalErr));
    logger.error('FATAL: Voice pipeline unhandled exception', {
      userId, requestId, userRole,
      error: errMsg,
      stack: fatalErr instanceof Error ? fatalErr.stack : undefined,
      elapsedMs: Date.now() - pipelineStart,
    });
    publishCountMetric('VoiceFallbackToText', 1, { Stage: 'fatal' });
    try {
      await whatsappSender.sendMessage(
        phoneNumber,
        { type: 'text', text: "I had trouble processing that voice note. Could you try again or type your message?" },
        `voice-fatal-${userId}`,
        userRole,
      );
    } catch { /* absolute last resort — nothing more we can do */ }
  } finally {
    publishLatencyMetric('VoicePipelineE2ELatency', Date.now() - pipelineStart, { Channel: 'whatsapp' });
    logger.info('Voice pipeline exited', {
      userId, requestId, userRole, e2eLatencyMs: Date.now() - pipelineStart,
    });
  }
}

/**
 * Internal voice pipeline execution. Separated from handleVoiceNote so the
 * outer function can guarantee a fallback message on any unhandled error.
 */
async function _executeVoicePipeline(context: VoiceContext, pipelineStart: number): Promise<void> {
  const { message, userId, phoneNumber, userRole, requestId, userProfile } = context;

  // ── Step 0: Load only voice-relevant config (isolated from full config) ──
  const configStart = Date.now();
  let voiceConfig: import('../../utils/config').VoicePipelineConfig;
  try {
    voiceConfig = await getVoicePipelineConfig();
    logger.info('Voice pipeline config loaded', {
      userId, requestId,
      hasGeminiKey: !!voiceConfig.geminiApiKey,
      hasTwilioSid: !!voiceConfig.twilioAccountSid,
      hasTwilioAuth: !!voiceConfig.twilioAuthToken,
      hasTwilioPhone: !!voiceConfig.twilioPhoneNumber,
      bucket: voiceConfig.productImagesBucket,
      elapsedMs: Date.now() - configStart,
    });
  } catch (cfgErr) {
    logger.error('Voice pipeline config failed', {
      userId, requestId,
      error: cfgErr instanceof Error ? cfgErr.message : String(cfgErr),
    });
    // Can't even send a fallback without Twilio creds — try anyway via the sender singleton
    try {
      await whatsappSender.sendMessage(
        phoneNumber,
        { type: 'text', text: 'Voice processing is temporarily unavailable. Please type your request instead.' },
        `voice-cfg-fail-${userId}`,
        userRole,
      );
    } catch { /* best effort */ }
    return;
  }

  // Create a dedicated GeminiAdapter with the resolved key so it never triggers full config
  const voiceGemini = new GeminiAdapter(voiceConfig.geminiApiKey);

  // ── Helper: send text fallback and emit metric ──
  const sendTextFallback = async (text: string, stage: string) => {
    publishCountMetric('VoiceFallbackToText', 1, { Stage: stage });
    logger.warn('Voice pipeline falling back to text', { userId, requestId, stage });
    try {
      await whatsappSender.sendMessage(
        phoneNumber,
        { type: 'text', text },
        `voice-fallback-${userId}`,
        userRole,
      );
    } catch (sendErr) {
      logger.error('Failed to send text fallback', {
        userId, requestId, stage,
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    }
  };

  // ── Step 1: Download audio from Twilio ──
  let audioBuffer: Buffer;
  let contentType: string;
  const downloadStart = Date.now();
  try {
    let mediaUrl = resolveMediaUrl(message);
    logger.info('Resolved media URL', {
      userId, requestId,
      hasMediaUrl: !!mediaUrl,
      mediaUrlPrefix: mediaUrl?.substring(0, 60),
      audioUrl: message.audio?.url?.substring(0, 60),
      audioId: message.audio?.id,
    });

    if (!mediaUrl) {
      await sendTextFallback(
        "I couldn't process that voice note. Could you try sending it again or type your request?",
        'download',
      );
      return;
    }

    // If the URL is a Media.json list endpoint, fetch the actual media URL first
    if (mediaUrl.endsWith('/Media.json')) {
      logger.info('Fetching media list from Twilio API', { userId, requestId, mediaUrl });
      const listResult = await downloadTwilioMedia(mediaUrl, {
        twilioAccountSid: voiceConfig.twilioAccountSid,
        twilioAuthToken: voiceConfig.twilioAuthToken,
      });
      try {
        const mediaList = JSON.parse(listResult.buffer.toString('utf-8'));
        const mediaSid = mediaList?.media_list?.[0]?.sid;
        if (mediaSid) {
          mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${voiceConfig.twilioAccountSid}/Messages/${message.id}/Media/${mediaSid}`;
          logger.info('Resolved media SID from list', { userId, requestId, mediaSid });
        } else {
          logger.warn('No media found in Twilio media list', { userId, requestId });
          await sendTextFallback(
            "I couldn't process that voice note. Could you try sending it again or type your request?",
            'download',
          );
          return;
        }
      } catch (parseErr) {
        logger.error('Failed to parse Twilio media list', {
          userId, requestId,
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
        await sendTextFallback(
          "I couldn't process that voice note. Could you try sending it again or type your request?",
          'download',
        );
        return;
      }
    }

    const downloaded = await downloadTwilioMedia(mediaUrl, {
      twilioAccountSid: voiceConfig.twilioAccountSid,
      twilioAuthToken: voiceConfig.twilioAuthToken,
    });
    audioBuffer = downloaded.buffer;
    contentType = downloaded.contentType;
    logger.info('Audio downloaded from Twilio', {
      userId, requestId, sizeBytes: audioBuffer.length, contentType,
      downloadElapsedMs: Date.now() - downloadStart,
    });
  } catch (err) {
    logger.error('media_download_failed', err, {
      userId, requestId,
      errorSerialized: serializeError(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    await sendTextFallback(
      "I couldn't process that voice note. Could you try sending it again or type your request?",
      'download',
    );
    return;
  }

  // ── Step 2: Validate MIME type and size ──
  const mimeType = message.audio?.mime_type || contentType;
  const validation = validateAudio(mimeType, audioBuffer.length);
  if (!validation.valid) {
    logger.warn('Audio validation failed', {
      userId, requestId, mimeType, sizeBytes: audioBuffer.length, reason: validation.reason,
    });
    if (validation.reason === 'unsupported_mime_type') {
      await sendTextFallback(
        "That audio format isn't supported. Please send an OGG voice note or type your request.",
        'validation',
      );
    } else {
      await sendTextFallback(
        "That voice note is too long. Please send a shorter message or type your request.",
        'validation',
      );
    }
    return;
  }
  logger.info('Audio validated', { userId, requestId, mimeType, sizeBytes: audioBuffer.length });

  // ── Step 3: Store inbound audio in S3 ──
  const inboundTs = Date.now();
  const inboundKey = `${VOICE_CONFIG.s3InboundPrefix}/${userId}/${inboundTs}.ogg`;
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: voiceConfig.productImagesBucket,
      Key: inboundKey,
      Body: audioBuffer,
      ContentType: 'audio/ogg',
      Tagging: 'mediaType=voice&direction=inbound',
    }));
    logger.info('Inbound audio stored in S3', {
      userId, requestId, s3Key: inboundKey, sizeBytes: audioBuffer.length,
    });
  } catch (err) {
    logger.error('S3 inbound upload failed', {
      userId, requestId, s3Key: inboundKey,
      error: serializeError(err),
    });
    // Non-fatal — continue pipeline, but log the failure
  }

  // ── Step 4: Transcribe via Gemini ──
  let transcriptText: string;
  let detectedLanguage: string;
  let extractedProducts: Array<{ name: string; quantity: number; confidence: number }> = [];
  try {
    const transcriptionStart = Date.now();
    logger.info('Transcription starting', { userId, requestId, audioSizeBytes: audioBuffer.length });
    const transcription = await voiceGemini.transcribeVoiceNote(audioBuffer, 'auto', []);
    publishLatencyMetric('VoiceTranscriptionLatency', Date.now() - transcriptionStart, { Channel: 'whatsapp' });

    logger.info('Transcription completed', {
      userId, requestId,
      confidence: transcription.confidence,
      detectedLanguage: transcription.detectedLanguage,
      transcriptLength: transcription.transcript.length,
      productCount: transcription.products.length,
      products: transcription.products.map(p => p.name),
    });

    // Check confidence and non-empty transcript
    if (!transcription.transcript || transcription.transcript.trim().length === 0 || transcription.confidence < 30) {
      logger.warn('Low confidence or empty transcript', {
        userId, requestId,
        confidence: transcription.confidence,
        transcriptLength: transcription.transcript?.length ?? 0,
      });
      await sendTextFallback(
        "I couldn't quite understand that. Could you repeat it or type your request?",
        'transcription',
      );
      return;
    }

    transcriptText = transcription.transcript;
    detectedLanguage = transcription.detectedLanguage;
    extractedProducts = transcription.products;
  } catch (err) {
    logger.error('gemini_transcription_failed', err, {
      userId, requestId,
      errorSerialized: serializeError(err),
    });
    await sendTextFallback(
      "Voice processing is temporarily unavailable. Please type your request instead.",
      'transcription',
    );
    return;
  }

  // ── Step 5: Route transcript to agent pipeline ──
  let agentReply: string = '';
  try {
    if (userRole === 'seller') {
      // Seller voice pipeline: check for financial query FIRST, then fall through to copilot
      // Requirement 22.2, 22.3: Extract financial intent and execute query

      if (isLikelyFinancialQuery(transcriptText)) {
        try {
          const financialResult = await executeFinancialQuery(
            voiceGemini,
            userId,
            transcriptText,
            detectedLanguage,
          );

          if (financialResult.intent !== 'unknown') {
            agentReply = financialResult.text;
            // Override detected language for TTS to match the financial query language
            detectedLanguage = LANGUAGE_NAMES[financialResult.language] || detectedLanguage;
            logger.info('Financial query handled via voice pipeline', {
              userId, requestId, intent: financialResult.intent,
              language: financialResult.language,
            });
          } else {
            // Unknown intent — fall through to seller copilot
            agentReply = '';
          }
        } catch (fqErr) {
          logger.warn('Financial query failed, falling through to copilot', {
            userId, requestId,
            error: fqErr instanceof Error ? fqErr.message : String(fqErr),
          });
          agentReply = '';
        }
      }

      // Fall through to seller copilot if not a financial query or if it failed
      if (!agentReply) {
        // Build user object matching SellerCommandContext
        const resolvedProfile = userProfile || await getUserByPhone(phoneNumber);
        const user: any = resolvedProfile
          ? {
              id: resolvedProfile.userId,
              email: `${resolvedProfile.displayName?.toLowerCase().replace(/\s+/g, '.') || 'seller'}@vyapargyan.com`,
              phoneNumber: resolvedProfile.phoneNumber,
              role: resolvedProfile.role,
              cognitoId: resolvedProfile.cognitoId,
              createdAt: resolvedProfile.createdAt,
              updatedAt: resolvedProfile.updatedAt,
            }
          : {
              id: userId,
              phoneNumber,
              role: 'seller' as const,
              cognitoId: 'unknown',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

        agentReply = await handleSellerCopilotMessage({
          user,
          message: transcriptText,
          phoneNumber,
          requestId,
        });
      }
    } else {
      // Customer: construct a text message and route through the state router
      const customerProfile = await getUserByPhone(phoneNumber);
      const custUserId = customerProfile?.userId || userId;

      const sessionResult = await resolveOrCreateSession({
        userId: custUserId,
        phoneNumber,
        channel: 'whatsapp',
      });

      const customer = {
        id: custUserId,
        phoneNumber,
        profileName: customerProfile?.displayName || '',
        whatsappId: phoneNumber,
      };

      const session = {
        id: custUserId,
        state: sessionResult.session.state,
        customerId: custUserId,
        phoneNumber,
        channelType: 'whatsapp' as const,
        context: {} as any,
        createdAt: sessionResult.session.createdAt,
        updatedAt: sessionResult.session.lastActivityAt,
        expiresAt: new Date(sessionResult.session.expiresAt * 1000).toISOString(),
      };

      // Build a synthetic text message from the transcript.
      // If Gemini extracted product names (in English), use those for better catalog matching.
      // This handles Hindi/multilingual voice notes where the raw transcript won't match English product names.
      let routingText = transcriptText;
      if (extractedProducts.length > 0) {
        // Build an English query from extracted products for better catalog matching
        const productQuery = extractedProducts
          .map(p => p.quantity > 1 ? `${p.quantity} ${p.name}` : p.name)
          .join(', ');
        // Detect intent from transcript to prefix appropriately
        const lowerTranscript = transcriptText.toLowerCase();
        const isStockQuery = /stock|available|availability|स्टॉक|अवेलेबल|उपलब्ध|kitne|kitna/i.test(lowerTranscript);
        const isPriceQuery = /price|cost|rate|दाम|कीमत|रेट|kitna|dam/i.test(lowerTranscript);
        if (isStockQuery) {
          routingText = `check stock of ${productQuery}`;
        } else if (isPriceQuery) {
          routingText = `price of ${productQuery}`;
        } else {
          routingText = productQuery;
        }
        logger.info('Using extracted products for routing', {
          userId: custUserId, requestId,
          originalTranscript: transcriptText,
          routingText,
          extractedProducts: extractedProducts.map(p => p.name),
        });
      }

      const textMessage = {
        ...message,
        type: 'text',
        text: { body: routingText },
      };

      await routeMessage({
        message: textMessage,
        customer,
        session,
        requestId,
      });

      // routeMessage sends its own reply — we capture it as a signal to proceed with TTS
      // Since routeMessage sends directly, we set agentReply to empty to skip TTS for customer
      // Actually, routeMessage sends text replies directly via whatsappSender.
      // For voice round-trip, we need the reply text. Since routeMessage sends directly,
      // we'll skip TTS for customer routing and let the text reply stand.
      logger.info('Voice pipeline completed (customer text route)', { userId: custUserId, requestId });
      return;
    }

    logger.info('Agent reply generated', {
      userId, requestId, userRole, replyLength: agentReply.length,
    });
  } catch (err) {
    logger.error('Agent routing failed', {
      userId, requestId, userRole,
      error: serializeError(err),
    });
    await sendTextFallback(
      "Sorry, I couldn't process that right now. Please try again or type your request.",
      'transcription',
    );
    return;
  }

  // ── Step 6: Tag agent reply with sourceChannel: 'voice' ──
  // (The tag is used conceptually — we proceed to TTS because this is a voice-originated reply)
  const sourceChannel = 'voice' as const;
  logger.info('Agent reply tagged', { userId, requestId, sourceChannel });

  // ── Step 7: Sanitize reply for TTS ──
  const ttsInput = sanitizeForTTS(agentReply, userRole);
  logger.info('Reply sanitized for TTS', {
    userId, requestId, originalLength: agentReply.length, sanitizedLength: ttsInput.length,
  });

  // ── Step 8: Generate TTS audio via Gemini ──
  let ttsAudioBuffer: Buffer;
  try {
    const ttsStart = Date.now();
    logger.info('TTS generation starting', { userId, requestId, textLength: ttsInput.length, language: detectedLanguage });
    ttsAudioBuffer = await voiceGemini.textToSpeech(ttsInput, detectedLanguage);
    publishLatencyMetric('VoiceTTSLatency', Date.now() - ttsStart, { Channel: 'whatsapp' });

    logger.info('TTS audio generated', {
      userId, requestId, audioSizeBytes: ttsAudioBuffer.length, language: detectedLanguage,
    });
  } catch (err) {
    logger.error('tts_generation_failed', {
      userId, requestId,
      error: serializeError(err),
    });
    // Fallback: send the agent's text reply as a standard WhatsApp text message
    await sendTextFallback(agentReply, 'tts');
    return;
  }

  // ── Step 9: Store outbound audio in S3 and generate pre-signed URL ──
  let presignedUrl: string;
  const outboundTs = Date.now();
  const outboundKey = `${VOICE_CONFIG.s3OutboundPrefix}/${userId}/${outboundTs}.wav`;
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: voiceConfig.productImagesBucket,
      Key: outboundKey,
      Body: ttsAudioBuffer,
      ContentType: 'audio/wav',
      Tagging: 'mediaType=voice&direction=outbound',
    }));

    logger.info('Outbound audio stored in S3', {
      userId, requestId, s3Key: outboundKey, sizeBytes: ttsAudioBuffer.length,
    });

    presignedUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: voiceConfig.productImagesBucket,
        Key: outboundKey,
      }),
      { expiresIn: VOICE_CONFIG.presignedUrlExpirySeconds },
    );

    logger.info('Pre-signed URL generated', {
      userId, requestId, s3Key: outboundKey, expirySeconds: VOICE_CONFIG.presignedUrlExpirySeconds,
    });
  } catch (err) {
    logger.error('s3_outbound_upload_failed', {
      userId, requestId, s3Key: outboundKey,
      error: serializeError(err),
    });
    await sendTextFallback(agentReply, 's3_outbound');
    return;
  }

  // ── Step 10: Send voice reply via Twilio ──
  try {
    await whatsappSender.sendMessage(
      phoneNumber,
      {
        type: 'audio',
        mediaUrl: presignedUrl,
        fallbackText: agentReply,
      },
      `voice-${userId}`,
      userRole,
    );

    logger.info('Voice reply sent successfully', {
      userId, requestId, s3Key: outboundKey,
    });
  } catch (err) {
    logger.error('twilio_media_send_failed', {
      userId, requestId,
      error: serializeError(err),
    });
    await sendTextFallback(agentReply, 'delivery');
  }

  logger.info('Voice pipeline completed', {
    userId, requestId, userRole, e2eLatencyMs: Date.now() - pipelineStart,
  });
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
