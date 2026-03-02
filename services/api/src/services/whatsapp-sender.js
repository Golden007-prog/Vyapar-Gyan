"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappSender = exports.WhatsAppSender = void 0;
const tslib_1 = require("tslib");
const axios_1 = tslib_1.__importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const config_1 = require("../utils/config");
const message_repository_1 = require("../repositories/message-repository");
const config = (0, config_1.getConfig)();
const messageRepository = new message_repository_1.MessageRepository();
/**
 * WhatsAppSender
 *
 * Handles outbound WhatsApp message sending via Meta's Cloud API.
 * Includes retry logic and message persistence.
 */
class WhatsAppSender {
    client;
    phoneNumberId;
    constructor() {
        this.phoneNumberId = config.whatsappPhoneNumberId;
        this.client = axios_1.default.create({
            baseURL: config.whatsappApiUrl,
            headers: {
                'Authorization': `Bearer ${config.whatsappToken}`,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });
    }
    /**
     * Send a message to a WhatsApp user
     */
    async sendMessage(phoneNumber, message, sessionId) {
        const payload = this.buildPayload(phoneNumber, message);
        logger_1.logger.info('Sending WhatsApp message', {
            sessionId,
            phoneNumber,
            messageType: message.type,
        });
        try {
            const response = await this.sendWithRetry(payload);
            const waMessageId = response.messages[0].id;
            // Persist outbound message
            await messageRepository.create({
                sessionId,
                waMessageId,
                direction: 'outbound',
                messageType: message.type,
                content: message,
                waStatus: 'sent',
            });
            logger_1.logger.info('WhatsApp message sent successfully', {
                sessionId,
                waMessageId,
                phoneNumber,
            });
            return waMessageId;
        }
        catch (error) {
            logger_1.logger.error('Failed to send WhatsApp message', {
                sessionId,
                phoneNumber,
                error: error instanceof Error ? error.message : String(error),
            });
            // Persist failed message attempt
            await messageRepository.create({
                sessionId,
                waMessageId: `failed-${Date.now()}`,
                direction: 'outbound',
                messageType: message.type,
                content: message,
                waStatus: 'failed',
            });
            throw error;
        }
    }
    /**
     * Build WhatsApp API payload from message
     */
    buildPayload(phoneNumber, message) {
        const basePayload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: phoneNumber,
        };
        if (message.type === 'text') {
            return {
                ...basePayload,
                type: 'text',
                text: {
                    body: message.text,
                },
            };
        }
        if (message.type === 'interactive') {
            if ('buttons' in message) {
                // Button message
                return {
                    ...basePayload,
                    type: 'interactive',
                    interactive: {
                        type: 'button',
                        body: {
                            text: message.body,
                        },
                        action: {
                            buttons: message.buttons.map(btn => ({
                                type: 'reply',
                                reply: {
                                    id: btn.id,
                                    title: btn.title,
                                },
                            })),
                        },
                    },
                };
            }
            if ('sections' in message) {
                // List message
                return {
                    ...basePayload,
                    type: 'interactive',
                    interactive: {
                        type: 'list',
                        body: {
                            text: message.body,
                        },
                        action: {
                            button: message.buttonText,
                            sections: message.sections,
                        },
                    },
                };
            }
        }
        throw new Error(`Unsupported message type: ${message.type}`);
    }
    /**
     * Send with exponential backoff retry
     */
    async sendWithRetry(payload, maxAttempts = 3) {
        let lastError = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
                return response.data;
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < maxAttempts) {
                    const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                    logger_1.logger.warn('WhatsApp send failed, retrying', {
                        attempt,
                        maxAttempts,
                        delayMs,
                        error: lastError.message,
                    });
                    await this.delay(delayMs);
                }
            }
        }
        throw lastError;
    }
    /**
     * Delay helper for retry logic
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.WhatsAppSender = WhatsAppSender;
// Singleton instance
exports.whatsappSender = new WhatsAppSender();
//# sourceMappingURL=whatsapp-sender.js.map