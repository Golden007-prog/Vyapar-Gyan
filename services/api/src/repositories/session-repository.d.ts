export interface Session {
    id: string;
    customerId: string;
    phoneNumber: string;
    channelType: 'whatsapp';
    state: string;
    context?: Record<string, any>;
    createdAt: string;
    updatedAt: string;
    lastActivityAt: string;
}
export interface ResolveOrCreateSessionInput {
    customerId: string;
    phoneNumber: string;
    channelType: 'whatsapp';
}
/**
 * SessionRepository
 *
 * Manages WhatsApp session data in DynamoDB.
 * Uses PK: SESSION#{customerId}, SK: WHATSAPP#{phoneNumber} pattern.
 */
export declare class SessionRepository {
    private tableName;
    constructor(tableName?: string);
    /**
     * Resolve existing session or create new one
     */
    resolveOrCreate(input: ResolveOrCreateSessionInput): Promise<Session>;
    /**
     * Get session by customer ID and phone number
     */
    getByCustomer(customerId: string, phoneNumber: string): Promise<Session | null>;
    /**
     * Create new session
     */
    create(session: Session): Promise<void>;
    /**
     * Update session state
     */
    updateState(sessionId: string, customerId: string, phoneNumber: string, state: string): Promise<void>;
    /**
     * Update session context (conversation state)
     */
    updateContext(sessionId: string, customerId: string, phoneNumber: string, context: Record<string, any>): Promise<void>;
    /**
     * Update last activity timestamp
     */
    private updateLastActivity;
}
//# sourceMappingURL=session-repository.d.ts.map