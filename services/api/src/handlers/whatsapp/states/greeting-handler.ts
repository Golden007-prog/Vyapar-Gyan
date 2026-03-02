import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';
import { SessionRepository } from '../../../repositories/session-repository';
import { MessageRepository } from '../../../repositories/message-repository';
import { CatalogRepository } from '../../../repositories/catalog-repository';
import type { MessageContext } from './router';

const sessionRepository = new SessionRepository();
const messageRepository = new MessageRepository();
const catalogRepository = new CatalogRepository();

/**
 * Greeting State Handler
 * 
 * Handles initial customer interactions and welcome messages.
 * Transitions to browsing state after greeting.
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

  // Get categories for welcome message
  const categories = await catalogRepository.getCategories();

  if (categories.length === 0) {
    // No categories available
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: `Namaste ${customer.profileName}! 🙏\n\nWelcome to VyaparGyan! We're setting up our catalog. Please check back soon!`,
      },
      session.id
    );
    return;
  }

  // Send welcome message with category options
  if (categories.length <= 3) {
    // Use button message for 3 or fewer categories
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'interactive',
        body: `Namaste ${customer.profileName}! 🙏\n\nWelcome to VyaparGyan! Browse our products by category:`,
        buttons: categories.slice(0, 3).map(cat => ({
          id: `cat_${cat.id}`,
          title: cat.name.substring(0, 20), // WhatsApp limit
        })),
      },
      session.id
    );
  } else {
    // Use list message for more categories
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'interactive',
        body: `Namaste ${customer.profileName}! 🙏\n\nWelcome to VyaparGyan! Browse our products by category:`,
        buttonText: 'View Categories',
        sections: [
          {
            title: 'Product Categories',
            rows: categories.map(cat => {
              const row: { id: string; title: string; description?: string } = {
                id: `cat_${cat.id}`,
                title: cat.name.substring(0, 24), // WhatsApp limit
              };
              if (cat.description) {
                row.description = cat.description.substring(0, 72); // WhatsApp limit
              }
              return row;
            }),
          },
        ],
      },
      session.id
    );
  }

  // Transition to browsing state
  await sessionRepository.updateState(
    session.id,
    session.customerId,
    session.phoneNumber,
    'browsing'
  );

  logger.info('Greeting completed, transitioned to browsing', {
    sessionId: session.id,
    categoriesShown: categories.length,
  });
}
