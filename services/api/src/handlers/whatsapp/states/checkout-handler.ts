import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';
import { MessageRepository } from '../../../repositories/message-repository';
import type { MessageContext } from './router';

const messageRepository = new MessageRepository();

/**
 * Checkout State Handler
 * 
 * Handles order confirmation, payment, and order placement.
 * Transitions back to browsing after order completion.
 * 
 * Note: Full checkout implementation pending order creation service.
 */
export async function checkoutHandler(context: MessageContext): Promise<void> {
  const { message, customer, session } = context;

  logger.info('Processing checkout state', {
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

  // Placeholder: Checkout flow not yet implemented
  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: '🛒 Checkout feature coming soon! Type "categories" to continue browsing.',
    },
    session.id
  );

  logger.info('Checkout handler placeholder executed', {
    sessionId: session.id,
  });
}
