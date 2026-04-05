/**
 * Onboarding State Handler
 *
 * Handles interactions from unregistered WhatsApp users.
 *
 * Behaviour:
 * - First message in a 24h window → full welcome with platform description + registration link
 * - Subsequent messages within the same 24h window → shorter reminder
 * - After the 24h TTL expires the session is cleaned up by DynamoDB TTL,
 *   so the next message creates a fresh onboarding session and re-triggers
 *   the full welcome.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */

import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';

/** Default web-app base URL (overridable via env var). */
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://vyapargyan.com';

/**
 * Build the registration link with WhatsApp referral query parameters.
 * The phone value is URL-encoded to handle the `+` prefix safely.
 */
export function buildRegistrationLink(phone: string): string {
  const encodedPhone = encodeURIComponent(phone);
  return `${WEB_APP_URL}/register?ref=whatsapp&phone=${encodedPhone}`;
}

/**
 * Build the full welcome message sent on the first contact within a 24h window.
 */
export function buildWelcomeMessage(phone: string): string {
  const link = buildRegistrationLink(phone);
  return [
    'Namaste! 🙏',
    '',
    'Welcome to *VyaparGyan* — your AI-powered local marketplace.',
    'Browse products from nearby stores, chat with sellers, and get the best deals delivered to your door.',
    '',
    '📲 Register to get started:',
    link,
    '',
    'Once registered you can shop, track orders, and receive personalised recommendations right here on WhatsApp!',
  ].join('\n');
}

/**
 * Build the shorter reminder message sent on subsequent contacts within the same 24h window.
 */
export function buildReminderMessage(phone: string): string {
  const link = buildRegistrationLink(phone);
  return [
    "Looks like you haven't registered yet.",
    '',
    '📲 Sign up here to start shopping:',
    link,
  ].join('\n');
}

export interface OnboardingContext {
  phoneNumber: string;
  /** Whether the user has already received the full welcome in this session window. */
  welcomeSent: boolean;
  sessionId: string;
}

/**
 * Handle an incoming message from an unregistered user.
 */
export async function onboardingHandler(ctx: OnboardingContext): Promise<void> {
  const { phoneNumber, welcomeSent, sessionId } = ctx;

  logger.info('Processing onboarding message', {
    phoneNumber,
    welcomeSent,
    sessionId,
  });

  const text = welcomeSent
    ? buildReminderMessage(phoneNumber)
    : buildWelcomeMessage(phoneNumber);

  await whatsappSender.sendMessage(
    phoneNumber,
    { type: 'text', text },
    sessionId,
  );

  logger.info('Onboarding message sent', {
    phoneNumber,
    messageType: welcomeSent ? 'reminder' : 'welcome',
    sessionId,
  });
}
