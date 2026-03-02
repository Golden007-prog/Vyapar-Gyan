"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkoutHandler = checkoutHandler;
const logger_1 = require("../../../utils/logger");
const whatsapp_sender_1 = require("../../../services/whatsapp-sender");
const message_repository_1 = require("../../../repositories/message-repository");
const messageRepository = new message_repository_1.MessageRepository();
/**
 * Checkout State Handler
 *
 * Handles order confirmation, payment, and order placement.
 * Transitions back to browsing after order completion.
 *
 * Note: Full checkout implementation pending order creation service.
 */
async function checkoutHandler(context) {
    const { message, customer, session } = context;
    logger_1.logger.info('Processing checkout state', {
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
    await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
        type: 'text',
        text: '🛒 Checkout feature coming soon! Type "categories" to continue browsing.',
    }, session.id);
    logger_1.logger.info('Checkout handler placeholder executed', {
        sessionId: session.id,
    });
}
//# sourceMappingURL=checkout-handler.js.map