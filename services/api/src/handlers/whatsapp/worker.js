"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const logger_1 = require("../../utils/logger");
const idempotency_1 = require("../../utils/idempotency");
const customer_repository_1 = require("../../repositories/customer-repository");
const session_repository_1 = require("../../repositories/session-repository");
const router_1 = require("./states/router");
const customerRepository = new customer_repository_1.CustomerRepository();
const sessionRepository = new session_repository_1.SessionRepository();
/**
 * WhatsApp Worker Lambda
 *
 * Processes WhatsApp webhook events from SQS queue.
 * Handles idempotency, customer/session resolution, and message routing.
 */
const handler = async (event) => {
    logger_1.logger.info('Processing WhatsApp worker batch', {
        recordCount: event.Records.length,
    });
    // Process records in parallel
    const results = await Promise.allSettled(event.Records.map(record => processRecord(record)));
    // Log any failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
        logger_1.logger.error('Some records failed processing', {
            failureCount: failures.length,
            totalCount: results.length,
        });
    }
    logger_1.logger.info('Worker batch processing complete', {
        successCount: results.filter(r => r.status === 'fulfilled').length,
        failureCount: failures.length,
    });
};
exports.handler = handler;
/**
 * Process a single SQS record
 */
async function processRecord(record) {
    const messageId = record.messageId;
    try {
        // Parse EventBridge event from SQS message
        const eventBridgeEvent = JSON.parse(record.body);
        const detail = JSON.parse(eventBridgeEvent.detail);
        logger_1.logger.info('Processing WhatsApp webhook event', {
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
    }
    catch (error) {
        logger_1.logger.error('Error processing SQS record', {
            messageId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        throw error; // Re-throw to move message to DLQ
    }
}
/**
 * Process a message change from WhatsApp webhook
 */
async function processMessageChange(value, requestId) {
    const messages = value.messages || [];
    const contacts = value.contacts || [];
    for (const message of messages) {
        const messageId = message.id;
        // Check for duplicates using idempotency service
        const isFirstTime = await idempotency_1.idempotencyService.acquireLock(messageId, {
            requestId,
            from: message.from,
            timestamp: message.timestamp,
        });
        if (!isFirstTime) {
            logger_1.logger.info('Skipping duplicate message', { messageId });
            continue;
        }
        // Extract contact information
        const contact = contacts.find((c) => c.wa_id === message.from);
        const phoneNumber = message.from;
        const profileName = contact?.profile?.name || 'Unknown';
        logger_1.logger.info('Processing new message', {
            messageId,
            phoneNumber,
            profileName,
            messageType: message.type,
        });
        // Resolve or create customer
        const customer = await customerRepository.resolveOrCreate({
            phoneNumber,
            profileName,
            whatsappId: contact?.wa_id,
        });
        // Resolve or create session
        const session = await sessionRepository.resolveOrCreate({
            customerId: customer.id,
            phoneNumber,
            channelType: 'whatsapp',
        });
        logger_1.logger.info('Customer and session resolved', {
            customerId: customer.id,
            sessionId: session.id,
            sessionState: session.state,
        });
        // Route message to appropriate state handler
        await (0, router_1.routeMessage)({
            message,
            customer,
            session,
            requestId,
        });
    }
}
//# sourceMappingURL=worker.js.map