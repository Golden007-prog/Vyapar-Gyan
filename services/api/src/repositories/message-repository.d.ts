export interface Message {
    sessionId: string;
    waMessageId: string;
    direction: 'inbound' | 'outbound';
    messageType: 'text' | 'image' | 'interactive' | 'template' | 'audio' | 'document';
    content: Record<string, any>;
    waStatus?: 'sent' | 'delivered' | 'read' | 'failed';
    errorCode?: string;
    errorMessage?: string;
    createdAt: string;
    ttl: number;
}
export interface CreateMessageInput {
    sessionId: string;
    waMessageId: string;
    direction: 'inbound' | 'outbound';
    messageType: string;
    content: Record<string, any>;
    waStatus?: string;
}
/**
 * MessageRepository
 *
 * Manages WhatsApp message history in DynamoDB.
 * Uses PK: SESSION#{sessionId}, SK: MESSAGE#{timestamp}#{waMessageId} pattern.
 */
export declare class MessageRepository {
    private tableName;
    constructor(tableName?: string);
    /**
     * Store a message (inbound or outbound)
     */
    create(input: CreateMessageInput): Promise<Message>;
    /**
     * Get recent messages for a session
     */
    getRecentMessages(sessionId: string, limit?: number): Promise<Message[]>;
}
//# sourceMappingURL=message-repository.d.ts.map