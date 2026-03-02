"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const tslib_1 = require("tslib");
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const crypto_1 = tslib_1.__importDefault(require("crypto"));
const logger_1 = require("../../utils/logger");
const config_1 = require("../../utils/config");
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({});
let config;
/**
 * WhatsApp Webhook Handler
 *
 * Handles both GET (verification) and POST (incoming messages) requests from Meta's WhatsApp Cloud API.
 *
 * GET: Responds to Meta's webhook verification challenge
 * POST: Validates signature, drops raw payload to EventBridge, returns 200 OK immediately
 */
const handler = async (event) => {
    const requestId = event.requestContext.requestId;
    // Load config on first invocation
    if (!config) {
        config = await (0, config_1.getConfig)();
    }
    logger_1.logger.info('WhatsApp webhook request received', {
        requestId,
        method: event.httpMethod,
        path: event.path,
    });
    try {
        // Handle GET request for webhook verification
        if (event.httpMethod === 'GET') {
            return handleVerification(event);
        }
        // Handle POST request for incoming webhooks
        if (event.httpMethod === 'POST') {
            return await handleIncomingWebhook(event, requestId);
        }
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }
    catch (error) {
        logger_1.logger.error('Error processing WhatsApp webhook', {
            requestId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        // Always return 200 to prevent Meta from retrying
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'error_logged' }),
        };
    }
};
exports.handler = handler;
/**
 * Handle Meta's webhook verification challenge
 */
function handleVerification(event) {
    const mode = event.queryStringParameters?.['hub.mode'];
    const token = event.queryStringParameters?.['hub.verify_token'];
    const challenge = event.queryStringParameters?.['hub.challenge'];
    logger_1.logger.info('Webhook verification request', { mode, token: token ? '***' : undefined });
    if (mode === 'subscribe' && token === config.whatsappVerifyToken) {
        logger_1.logger.info('Webhook verification successful');
        return {
            statusCode: 200,
            body: challenge || '',
        };
    }
    logger_1.logger.warn('Webhook verification failed', { mode, tokenMatch: token === config.whatsappVerifyToken });
    return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Verification failed' }),
    };
}
/**
 * Handle incoming WhatsApp webhook POST request
 */
async function handleIncomingWebhook(event, requestId) {
    const body = event.body;
    if (!body) {
        logger_1.logger.warn('Empty webhook body received');
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'ignored' }),
        };
    }
    // Verify webhook signature
    const signature = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];
    if (!verifySignature(body, signature)) {
        logger_1.logger.error('Invalid webhook signature', { requestId });
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'invalid_signature' }),
        };
    }
    // Parse and validate payload
    let payload;
    try {
        payload = JSON.parse(body);
    }
    catch (error) {
        logger_1.logger.error('Failed to parse webhook body', { requestId, error });
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'invalid_json' }),
        };
    }
    // Validate it's from a WhatsApp business account
    if (payload.object !== 'whatsapp_business_account') {
        logger_1.logger.warn('Non-WhatsApp business account webhook received', {
            requestId,
            object: payload.object,
        });
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'ignored' }),
        };
    }
    // Drop raw payload to EventBridge
    await publishToEventBridge(payload, requestId);
    logger_1.logger.info('WhatsApp webhook processed successfully', { requestId });
    return {
        statusCode: 200,
        body: JSON.stringify({ status: 'received' }),
    };
}
/**
 * Verify webhook signature using app secret
 */
function verifySignature(body, signature) {
    if (!signature) {
        logger_1.logger.warn('Missing webhook signature');
        return false;
    }
    const appSecret = config.whatsappAppSecret;
    if (!appSecret) {
        logger_1.logger.error('WHATSAPP_APP_SECRET not configured');
        return false;
    }
    const expectedSignature = 'sha256=' + crypto_1.default
        .createHmac('sha256', appSecret)
        .update(body)
        .digest('hex');
    return crypto_1.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}
/**
 * Publish webhook payload to EventBridge
 */
async function publishToEventBridge(payload, requestId) {
    const command = new client_eventbridge_1.PutEventsCommand({
        Entries: [
            {
                Source: 'vyapargyan.whatsapp',
                DetailType: 'IncomingWhatsAppWebhook',
                Detail: JSON.stringify({
                    payload,
                    receivedAt: new Date().toISOString(),
                    requestId,
                }),
                EventBusName: config.eventBusName || 'default',
            },
        ],
    });
    const response = await eventBridgeClient.send(command);
    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        logger_1.logger.error('Failed to publish to EventBridge', {
            requestId,
            failedCount: response.FailedEntryCount,
            entries: response.Entries,
        });
        throw new Error('Failed to publish event to EventBridge');
    }
    logger_1.logger.info('Event published to EventBridge', { requestId });
}
//# sourceMappingURL=webhook.js.map