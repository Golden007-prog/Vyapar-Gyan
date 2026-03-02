"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.greetingHandler = greetingHandler;
const logger_1 = require("../../../utils/logger");
const whatsapp_sender_1 = require("../../../services/whatsapp-sender");
const session_repository_1 = require("../../../repositories/session-repository");
const message_repository_1 = require("../../../repositories/message-repository");
const catalog_repository_1 = require("../../../repositories/catalog-repository");
const sessionRepository = new session_repository_1.SessionRepository();
const messageRepository = new message_repository_1.MessageRepository();
const catalogRepository = new catalog_repository_1.CatalogRepository();
/**
 * Greeting State Handler
 *
 * Handles initial customer interactions and welcome messages.
 * Transitions to browsing state after greeting.
 */
async function greetingHandler(context) {
    const { message, customer, session } = context;
    logger_1.logger.info('Processing greeting state', {
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
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'text',
            text: `Namaste ${customer.profileName}! 🙏\n\nWelcome to VyaparGyan! We're setting up our catalog. Please check back soon!`,
        }, session.id);
        return;
    }
    // Send welcome message with category options
    if (categories.length <= 3) {
        // Use button message for 3 or fewer categories
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'interactive',
            body: `Namaste ${customer.profileName}! 🙏\n\nWelcome to VyaparGyan! Browse our products by category:`,
            buttons: categories.slice(0, 3).map(cat => ({
                id: `cat_${cat.id}`,
                title: cat.name.substring(0, 20), // WhatsApp limit
            })),
        }, session.id);
    }
    else {
        // Use list message for more categories
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'interactive',
            body: `Namaste ${customer.profileName}! 🙏\n\nWelcome to VyaparGyan! Browse our products by category:`,
            buttonText: 'View Categories',
            sections: [
                {
                    title: 'Product Categories',
                    rows: categories.map(cat => ({
                        id: `cat_${cat.id}`,
                        title: cat.name.substring(0, 24), // WhatsApp limit
                        description: cat.description?.substring(0, 72), // WhatsApp limit
                    })),
                },
            ],
        }, session.id);
    }
    // Transition to browsing state
    await sessionRepository.updateState(session.id, session.customerId, session.phoneNumber, 'browsing');
    logger_1.logger.info('Greeting completed, transitioned to browsing', {
        sessionId: session.id,
        categoriesShown: categories.length,
    });
}
//# sourceMappingURL=greeting-handler.js.map