import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';
import { MessageRepository } from '../../../repositories/message-repository';
import { CatalogRepository } from '../../../repositories/catalog-repository';
import { updateSessionState } from '../../../adapters/dynamodb-adapter';
import { safeName } from '../../../utils/safe-name';
import type { MessageContext } from './router';

const messageRepository = new MessageRepository();
const catalogRepository = new CatalogRepository();

/**
 * Greeting State Handler
 * 
 * Handles initial customer interactions and welcome messages.
 * Transitions to browsing state after greeting.
 * 
 * Uses the unified session system (SESSION#{userId} ACTIVE) for state
 * transitions instead of the legacy SessionRepository.
 */
export async function greetingHandler(context: MessageContext): Promise<void> {
  const { message, customer, session } = context;

  logger.info('Processing greeting state', {
    customerId: customer.id,
    sessionId: session.id,
    messageType: message.type,
  });

  // Store inbound message
  await messageRepository.create({
    sessionId: session.id,
    waMessageId: message.id,
    direction: 'inbound',
    messageType: message.type,
    content: message,
  });

  // Resolve display name safely — never allow "undefined" or "null"
  const displayName = safeName(customer.profileName);

  // Get categories for welcome message
  const categories = await catalogRepository.getCategories();

  if (categories.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: `Namaste${displayName ? ` ${displayName}` : ''}! 🙏\n\nWelcome to VyaparGyan! We're setting up our catalog. Please check back soon!`,
      },
      session.id
    );
    return;
  }

  // Build category menu text
  const greetingText = `Namaste${displayName ? ` ${displayName}` : ''}! 🙏\n\nWelcome to VyaparGyan! Browse our products by category:`;

  // Send welcome message with category options
  if (categories.length <= 3) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'interactive',
        body: greetingText,
        buttons: categories.slice(0, 3).map(cat => ({
          id: `cat_${cat.id}`,
          title: cat.name.substring(0, 20),
        })),
      },
      session.id
    );
  } else {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'interactive',
        body: greetingText,
        buttonText: 'View Categories',
        sections: [
          {
            title: 'Product Categories',
            rows: categories.map(cat => {
              const row: { id: string; title: string; description?: string } = {
                id: `cat_${cat.id}`,
                title: cat.name.substring(0, 24),
              };
              if (cat.description) {
                row.description = cat.description.substring(0, 72);
              }
              return row;
            }),
          },
        ],
      },
      session.id
    );
  }

  // Store the sent menu in session context so numeric replies can be resolved
  const menuContext = {
    lastMenu: 'categories',
    menuOptions: categories.map((cat, idx) => ({
      index: idx + 1,
      id: cat.id,
      name: cat.name,
      type: 'category' as const,
    })),
    menuSentAt: new Date().toISOString(),
  };

  // Transition to browsing state using the unified session system
  // and store menu context for numeric reply resolution
  await updateSessionState(session.id, 'browsing', 'whatsapp');

  // Also store menu context in the legacy session for the browsing handler
  try {
    const { SessionRepository } = await import('../../../repositories/session-repository.js');
    const sessionRepo = new SessionRepository();
    await sessionRepo.updateContext(
      session.id,
      customer.id,
      customer.phoneNumber,
      menuContext,
    );
  } catch (err) {
    // Non-fatal — browsing will still work, just without numeric reply support
    logger.warn('Failed to store menu context', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('Greeting completed, transitioned to browsing', {
    sessionId: session.id,
    categoriesShown: categories.length,
  });
}
