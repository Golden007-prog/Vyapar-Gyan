export interface TextMessage {
    type: 'text';
    text: string;
}
export interface InteractiveButtonMessage {
    type: 'interactive';
    body: string;
    buttons: Array<{
        id: string;
        title: string;
    }>;
}
export interface InteractiveListMessage {
    type: 'interactive';
    body: string;
    buttonText: string;
    sections: Array<{
        title?: string;
        rows: Array<{
            id: string;
            title: string;
            description?: string;
        }>;
    }>;
}
export type OutboundMessage = TextMessage | InteractiveButtonMessage | InteractiveListMessage;
/**
 * WhatsAppSender
 *
 * Handles outbound WhatsApp message sending via Meta's Cloud API.
 * Includes retry logic and message persistence.
 */
export declare class WhatsAppSender {
    private client;
    private phoneNumberId;
    constructor();
    /**
     * Send a message to a WhatsApp user
     */
    sendMessage(phoneNumber: string, message: OutboundMessage, sessionId: string): Promise<string>;
    /**
     * Build WhatsApp API payload from message
     */
    private buildPayload;
    /**
     * Send with exponential backoff retry
     */
    private sendWithRetry;
    /**
     * Delay helper for retry logic
     */
    private delay;
}
export declare const whatsappSender: WhatsAppSender;
//# sourceMappingURL=whatsapp-sender.d.ts.map