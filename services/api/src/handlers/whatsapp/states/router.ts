import { logger } from '../../../utils/logger';
import { greetingHandler } from './greeting-handler';
import { browsingHandler } from './browsing-handler';
import { checkoutHandler } from './checkout-handler';
import { trackingHandler } from './tracking-handler';
import { sellerOrderHandler } from './seller-order-handler';
import { onboardingHandler } from './onboarding-handler';
import {
  resolveOrCreateOnboardingSession,
  markOnboardingWelcomeSent,
} from '../../../services/session-service';

export interface MessageContext {
  message: any;
  customer: any;
  session: any;
  requestId: string;
}

// ── Intent keywords that should bypass greeting and go straight to browsing ──

const DIRECT_INTENT_PATTERNS = [
  // Stock / availability checks
  /\b(stock|available|availability|do you have|is there|got any|have you got|check stock|in stock)\b/i,
  // Price checks
  /\b(price|cost|how much|kitna|kya rate|rate|kya dam)\b/i,
  // Explicit product search
  /\b(search|find|show me|looking for|i want|i need|mujhe chahiye)\b/i,
  // Cart actions
  /\b(cart|my cart|view cart|show cart)\b/i,
  // Checkout
  /\b(checkout|pay|order now|place order)\b/i,
  // Explicit menu/browse
  /\b(categories|menu|browse|list)\b/i,
  // Help
  /\b(help|support|assist)\b/i,
];

/**
 * Check if a text message contains a direct intent that should skip the
 * greeting flow and go straight to the browsing handler for proper
 * intent detection and fulfillment.
 */
function hasDirectIntent(message: any): boolean {
  if (message.type !== 'text') return false;
  const text = (message.text?.body || '').trim();
  if (!text) return false;
  return DIRECT_INTENT_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Check if a message is a numeric reply (e.g. "1", "2") that should be
 * interpreted against the current session context (stored menu options).
 */
function isNumericReply(message: any): boolean {
  if (message.type !== 'text') return false;
  const text = (message.text?.body || '').trim();
  return /^\d{1,2}$/.test(text);
}

/**
 * Route incoming message to appropriate state handler based on session state.
 *
 * Key routing rules:
 * 1. If the message contains a direct intent (stock check, price check, search),
 *    route to browsingHandler regardless of current state — this prevents the
 *    greeting handler from swallowing specific queries.
 * 2. Numeric replies ("1", "2") are always routed to browsingHandler so they
 *    can be resolved against stored menu context.
 * 3. Pure greetings ("hi", "hello") in greeting state go to greetingHandler.
 * 4. Everything else follows the state machine.
 */
export async function routeMessage(context: MessageContext): Promise<void> {
  const { session, message } = context;
  const state = session.state || 'greeting';

  logger.info('Routing message to state handler', {
    sessionId: session.id,
    state,
    messageType: message.type,
    textPreview: message.text?.body?.substring(0, 50),
  });

  try {
    // Priority 1: Direct intents bypass greeting state
    if (state === 'greeting' && hasDirectIntent(message)) {
      logger.info('Direct intent detected in greeting state, routing to browsing', {
        sessionId: session.id,
      });
      await browsingHandler(context);
      return;
    }

    // Priority 2: Numeric replies always go to browsing for menu resolution
    if (isNumericReply(message)) {
      logger.info('Numeric reply detected, routing to browsing for menu resolution', {
        sessionId: session.id,
        state,
      });
      await browsingHandler(context);
      return;
    }

    switch (state) {
      case 'greeting':
        await greetingHandler(context);
        break;
      
      case 'browsing':
      case 'product_inquiry':
      case 'idle':
        await browsingHandler(context);
        break;
      
      case 'checkout':
      case 'ordering':
      case 'payment':
        await checkoutHandler(context);
        break;
      
      case 'tracking':
        await trackingHandler(context);
        break;

      case 'seller_orders':
        await sellerOrderHandler(context);
        break;

      case 'support':
        await handleSupport(context);
        break;

      case 'onboarding':
        await handleOnboarding(context);
        break;
      
      default:
        logger.warn('Unknown session state, defaulting to browsing', {
          sessionId: session.id,
          state,
        });
        await browsingHandler(context);
    }
  } catch (error) {
    logger.error('Error in state handler', {
      sessionId: session.id,
      state,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Handle support state (placeholder)
 */
async function handleSupport(context: MessageContext): Promise<void> {
  const { session } = context;
  
  logger.info('Support state handler placeholder', {
    sessionId: session.id,
  });
  
  await browsingHandler(context);
}

/**
 * Handle onboarding state for unregistered users.
 *
 * Resolves or creates a 24h onboarding session keyed by phone number.
 * Sends the full welcome on first contact, shorter reminders on subsequent
 * messages within the same 24h window.
 */
async function handleOnboarding(context: MessageContext): Promise<void> {
  const { customer, session } = context;
  const phoneNumber = customer.phoneNumber || session.phoneNumber;

  logger.info('Routing to onboarding handler', {
    sessionId: session.id,
    phoneNumber,
  });

  const { session: onboardingSession } = await resolveOrCreateOnboardingSession(phoneNumber);

  await onboardingHandler({
    phoneNumber,
    welcomeSent: onboardingSession.welcomeSent,
    sessionId: session.id || `onboarding-${phoneNumber}`,
  });

  // After sending the first welcome, mark it so subsequent messages get the reminder
  if (!onboardingSession.welcomeSent) {
    await markOnboardingWelcomeSent(phoneNumber);
  }
}
