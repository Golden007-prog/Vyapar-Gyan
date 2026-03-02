export interface IdempotencyOptions {
    ttlSeconds?: number;
    tableName?: string;
}
/**
 * IdempotencyService
 *
 * Provides idempotency guarantees for message processing using DynamoDB conditional writes.
 * Uses PK/SK pattern with TTL for automatic cleanup.
 */
export declare class IdempotencyService {
    private tableName;
    private defaultTtlSeconds;
    constructor(options?: IdempotencyOptions);
    /**
     * Attempt to acquire an idempotency lock for a given message ID
     *
     * @param messageId - Unique identifier for the message (e.g., WhatsApp message ID)
     * @param context - Additional context to store with the lock
     * @returns true if lock acquired (first time processing), false if duplicate
     */
    acquireLock(messageId: string, context?: Record<string, any>): Promise<boolean>;
    /**
     * Check if a message has already been processed
     *
     * @param messageId - Unique identifier for the message
     * @returns true if message was already processed, false otherwise
     */
    isDuplicate(messageId: string): Promise<boolean>;
}
/**
 * Default idempotency service instance
 */
export declare const idempotencyService: IdempotencyService;
//# sourceMappingURL=idempotency.d.ts.map