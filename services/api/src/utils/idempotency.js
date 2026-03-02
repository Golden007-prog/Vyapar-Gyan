"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idempotencyService = exports.IdempotencyService = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const logger_1 = require("./logger");
const config_1 = require("./config");
const dynamoDBClient = new client_dynamodb_1.DynamoDBClient({});
const config = (0, config_1.getConfig)();
/**
 * IdempotencyService
 *
 * Provides idempotency guarantees for message processing using DynamoDB conditional writes.
 * Uses PK/SK pattern with TTL for automatic cleanup.
 */
class IdempotencyService {
    tableName;
    defaultTtlSeconds;
    constructor(options = {}) {
        this.tableName = options.tableName || config.tableName;
        this.defaultTtlSeconds = options.ttlSeconds || 60;
    }
    /**
     * Attempt to acquire an idempotency lock for a given message ID
     *
     * @param messageId - Unique identifier for the message (e.g., WhatsApp message ID)
     * @param context - Additional context to store with the lock
     * @returns true if lock acquired (first time processing), false if duplicate
     */
    async acquireLock(messageId, context) {
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + this.defaultTtlSeconds;
        const item = {
            PK: `IDEMPOTENCY#${messageId}`,
            SK: 'LOCK',
            messageId,
            createdAt: new Date().toISOString(),
            expiresAt,
            ...context,
        };
        try {
            const command = new client_dynamodb_1.PutItemCommand({
                TableName: this.tableName,
                Item: (0, util_dynamodb_1.marshall)(item),
                ConditionExpression: 'attribute_not_exists(PK)',
            });
            await dynamoDBClient.send(command);
            logger_1.logger.info('Idempotency lock acquired', { messageId });
            return true;
        }
        catch (error) {
            if (error instanceof client_dynamodb_1.ConditionalCheckFailedException) {
                logger_1.logger.info('Duplicate message detected', { messageId });
                return false;
            }
            logger_1.logger.error('Error acquiring idempotency lock', {
                messageId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    /**
     * Check if a message has already been processed
     *
     * @param messageId - Unique identifier for the message
     * @returns true if message was already processed, false otherwise
     */
    async isDuplicate(messageId) {
        // Attempt to acquire lock - if it fails, it's a duplicate
        return !(await this.acquireLock(messageId));
    }
}
exports.IdempotencyService = IdempotencyService;
/**
 * Default idempotency service instance
 */
exports.idempotencyService = new IdempotencyService();
//# sourceMappingURL=idempotency.js.map