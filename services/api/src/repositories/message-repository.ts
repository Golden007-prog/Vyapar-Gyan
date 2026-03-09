import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

const dynamoDBClient = new DynamoDBClient({});

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
export class MessageRepository {
  private tableName: string;

  constructor(tableName?: string) {
    this.tableName = tableName || '';
  }

  private async getTableName(): Promise<string> {
    if (this.tableName) {
      return this.tableName;
    }
    const envTable = process.env.TABLE_NAME;
    if (envTable) {
      this.tableName = envTable;
    } else {
      const config = await getConfig();
      this.tableName = config.tableName;
    }
    return this.tableName;
  }

  /**
   * Store a message (inbound or outbound)
   */
  async create(input: CreateMessageInput): Promise<Message> {
    const tableName = await this.getTableName();
    const now = new Date();
    const timestamp = now.getTime();
    const ttl = Math.floor(timestamp / 1000) + (30 * 24 * 60 * 60); // 30 days

    const message: Message = {
      sessionId: input.sessionId,
      waMessageId: input.waMessageId,
      direction: input.direction,
      messageType: input.messageType as any,
      content: input.content,
      waStatus: input.waStatus as any,
      createdAt: now.toISOString(),
      ttl,
    };

    const item = {
      PK: `SESSION#${input.sessionId}`,
      SK: `MESSAGE#${timestamp}#${input.waMessageId}`,
      ...message,
    };

    const command = new PutItemCommand({
      TableName: tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    });

    await dynamoDBClient.send(command);
    
    logger.info('Message stored', {
      sessionId: input.sessionId,
      waMessageId: input.waMessageId,
      direction: input.direction,
      messageType: input.messageType,
    });

    return message;
  }

  /**
   * Get recent messages for a session
   */
  async getRecentMessages(sessionId: string, limit: number = 20): Promise<Message[]> {
    const tableName = await this.getTableName();
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: marshall({
        ':pk': `SESSION#${sessionId}`,
        ':sk': 'MESSAGE#',
      }, { removeUndefinedValues: true }),
      ScanIndexForward: false, // Most recent first
      Limit: limit,
    });

    const response = await dynamoDBClient.send(command);
    
    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map(item => unmarshall(item) as Message);
  }
}
