import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

const dynamoDBClient = new DynamoDBClient({});

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
export class SessionRepository {
  private tableName: string;

  constructor(tableName?: string) {
    this.tableName = tableName || '';
  }

  private async getTableName(): Promise<string> {
    if (this.tableName) {
      return this.tableName;
    }
    const config = await getConfig();
    this.tableName = config.tableName;
    return this.tableName;
  }

  /**
   * Resolve existing session or create new one
   */
  async resolveOrCreate(input: ResolveOrCreateSessionInput): Promise<Session> {
    const { customerId, phoneNumber, channelType } = input;

    // Try to get existing session
    const existing = await this.getByCustomer(customerId, phoneNumber);
    if (existing) {
      // Update last activity timestamp
      await this.updateLastActivity(customerId, phoneNumber);
      logger.info('Existing session found', { sessionId: existing.id, customerId });
      return { ...existing, lastActivityAt: new Date().toISOString() };
    }

    // Create new session
    const session: Session = {
      id: randomUUID(),
      customerId,
      phoneNumber,
      channelType,
      state: 'greeting',
      context: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    await this.create(session);
    logger.info('New session created', { sessionId: session.id, customerId });
    
    return session;
  }

  /**
   * Get session by customer ID and phone number
   */
  async getByCustomer(customerId: string, phoneNumber: string): Promise<Session | null> {
    const tableName = await this.getTableName();
    const command = new GetItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
    });

    const response = await dynamoDBClient.send(command);
    
    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as Session;
  }

  /**
   * Create new session
   */
  async create(session: Session): Promise<void> {
    const tableName = await this.getTableName();
    const item = {
      PK: `SESSION#${session.customerId}`,
      SK: `WHATSAPP#${session.phoneNumber}`,
      ...session,
    };

    const command = new PutItemCommand({
      TableName: tableName,
      Item: marshall(item),
    });

    await dynamoDBClient.send(command);
  }

  /**
   * Update session state
   */
  async updateState(sessionId: string, customerId: string, phoneNumber: string, state: string): Promise<void> {
    const tableName = await this.getTableName();
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
      UpdateExpression: 'SET #state = :state, updatedAt = :updatedAt, lastActivityAt = :lastActivityAt',
      ExpressionAttributeNames: {
        '#state': 'state',
      },
      ExpressionAttributeValues: marshall({
        ':state': state,
        ':updatedAt': new Date().toISOString(),
        ':lastActivityAt': new Date().toISOString(),
      }),
    });

    await dynamoDBClient.send(command);
    logger.info('Session state updated', { sessionId, state });
  }

  /**
   * Update session context (conversation state)
   */
  async updateContext(
    sessionId: string,
    customerId: string,
    phoneNumber: string,
    context: Record<string, any>
  ): Promise<void> {
    const tableName = await this.getTableName();
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
      UpdateExpression: 'SET #context = :context, updatedAt = :updatedAt, lastActivityAt = :lastActivityAt',
      ExpressionAttributeNames: {
        '#context': 'context',
      },
      ExpressionAttributeValues: marshall({
        ':context': context,
        ':updatedAt': new Date().toISOString(),
        ':lastActivityAt': new Date().toISOString(),
      }),
    });

    await dynamoDBClient.send(command);
    logger.info('Session context updated', { sessionId });
  }

  /**
   * Update last activity timestamp
   */
  private async updateLastActivity(customerId: string, phoneNumber: string): Promise<void> {
    const tableName = await this.getTableName();
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
      UpdateExpression: 'SET lastActivityAt = :lastActivityAt',
      ExpressionAttributeValues: marshall({
        ':lastActivityAt': new Date().toISOString(),
      }),
    });

    await dynamoDBClient.send(command);
  }
}
