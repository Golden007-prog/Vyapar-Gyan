"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeMessage = routeMessage;
const logger_1 = require("../../../utils/logger");
const greeting_handler_1 = require("./greeting-handler");
const browsing_handler_1 = require("./browsing-handler");
const checkout_handler_1 = require("./checkout-handler");
/**
 * Route incoming message to appropriate state handler based on session state
 */
async function routeMessage(context) {
    const { session, message } = context;
    const state = session.state || 'greeting';
    logger_1.logger.info('Routing message to state handler', {
        sessionId: session.id,
        state,
        messageType: message.type,
    });
    try {
        switch (state) {
            case 'greeting':
                await (0, greeting_handler_1.greetingHandler)(context);
                break;
            case 'browsing':
            case 'product_inquiry':
            case 'idle':
                // All browsing-related states use the same handler
                await (0, browsing_handler_1.browsingHandler)(context);
                break;
            case 'checkout':
            case 'ordering':
            case 'payment':
                await (0, checkout_handler_1.checkoutHandler)(context);
                break;
            case 'support':
                await handleSupport(context);
                break;
            default:
                logger_1.logger.warn('Unknown session state, defaulting to greeting', {
                    sessionId: session.id,
                    state,
                });
                await (0, greeting_handler_1.greetingHandler)(context);
        }
    }
    catch (error) {
        logger_1.logger.error('Error in state handler', {
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
async function handleSupport(context) {
    const { session } = context;
    logger_1.logger.info('Support state handler placeholder', {
        sessionId: session.id,
    });
    // For now, treat support like browsing
    await (0, browsing_handler_1.browsingHandler)(context);
}
//# sourceMappingURL=router.js.map