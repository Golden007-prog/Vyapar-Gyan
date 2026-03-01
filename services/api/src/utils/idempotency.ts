import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { logger } from './logger';
import { getConfig } from './config';

const dynamoDBClient = new DynamoDBClient({});
const config = getConfig();

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
export class IdempotencyService {
  private tableName: string;
  private defaultTtlSeconds: number;

  constructor(options: IdempotencyOptions = {}) {
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
  async acquireLock(messageId: string, context?: Record<string, any>): Promise<boolean> {
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
      const command = new PutItemCommand({
        TableName: this.tableName,
        Item: marshall(item),
        ConditionExpression: 'attribute_not_exists(PK)',
      });

      await dynamoDBClient.send(command);
      
      logger.info('Idempotency lock acquired', { messageId });
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        logger.info('Duplicate message detected', { messageId });
        return false;
      }

      logger.error('Error acquiring idempotency lock', {
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
  async isDuplicate(messageId: string): Promise<boolean> {
    // Attempt to acquire lock - if it fails, it's a duplicate
    return !(await this.acquireLock(messageId));
  }
}

/**
 * Default idempotency service instance
 */
export const idempotencyService = new IdempotencyService();
