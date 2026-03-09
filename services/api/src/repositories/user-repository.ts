import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../utils/config';
import { logger } from '../utils/logger';

// Import User type from shared contracts
interface User {
  id: string;
  email: string;
  phoneNumber: string;
  role: 'admin' | 'seller' | 'customer';
  cognitoId: string;
  createdAt: string;
  updatedAt: string;
}

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

let tableName: string;

/**
 * User Repository
 * 
 * Handles user data access patterns in DynamoDB.
 * Users are stored with PK: USER#{userId}, SK: PROFILE
 * 
 * Access patterns:
 * - Get user by ID
 * - Get user by phone number (requires GSI or scan)
 * - Get user by email (requires GSI2)
 */
export class UserRepository {
  private async getTableName(): Promise<string> {
    if (!tableName) {
      const envTable = process.env.TABLE_NAME;
      if (envTable) {
        tableName = envTable;
      } else {
        const config = await getConfig();
        tableName = config.tableName;
      }
    }
    return tableName;
  }

  /**
   * Get user by user ID
   */
  async getUserById(userId: string): Promise<User | null> {
    const table = await this.getTableName();

    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: table,
          Key: {
            PK: `USER#${userId}`,
            SK: 'PROFILE',
          },
        })
      );

      if (!result.Item) {
        return null;
      }

      return this.mapItemToUser(result.Item);
    } catch (error) {
      logger.error('Error getting user by ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get user by phone number
   * 
   * Note: Since there's no dedicated GSI for phone number lookups on USER entities,
   * this uses GSI1 with role-based queries. For production, consider:
   * 1. Adding GSI2PK: PHONE#{phoneNumber} when creating users
   * 2. Using a dedicated phone lookup GSI
   * 3. Caching phone->userId mappings in ElastiCache
   * 
   * Current implementation queries GSI1 for seller/admin roles only.
   */
  async getUserByPhone(phoneNumber: string): Promise<User | null> {
    const table = await this.getTableName();

    try {
      // Query GSI1 for sellers with this phone number
      // GSI1PK: ROLE#seller, GSI1SK: USER#{userId}
      const sellerResult = await docClient.send(
        new QueryCommand({
          TableName: table,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          FilterExpression: 'phoneNumber = :phone OR phone = :phone',
          ExpressionAttributeValues: {
            ':pk': 'ROLE#seller',
            ':phone': phoneNumber,
          },
          Limit: 1,
        })
      );

      if (sellerResult.Items && sellerResult.Items.length > 0) {
        return this.mapItemToUser(sellerResult.Items[0]);
      }

      // Query GSI1 for admins with this phone number
      const adminResult = await docClient.send(
        new QueryCommand({
          TableName: table,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk',
          FilterExpression: 'phoneNumber = :phone OR phone = :phone',
          ExpressionAttributeValues: {
            ':pk': 'ROLE#admin',
            ':phone': phoneNumber,
          },
          Limit: 1,
        })
      );

      if (adminResult.Items && adminResult.Items.length > 0) {
        return this.mapItemToUser(adminResult.Items[0]);
      }

      logger.info('No seller/admin user found with phone number', { phoneNumber });
      return null;
    } catch (error) {
      logger.error('Error getting user by phone', {
        phoneNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    const table = await this.getTableName();

    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: table,
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': `EMAIL#${email}`,
          },
          Limit: 1,
        })
      );

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      return this.mapItemToUser(result.Items[0]);
    } catch (error) {
      logger.error('Error getting user by email', {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Map DynamoDB item to User type
   */
  private mapItemToUser(item: any): User {
    return {
      id: item.id || item.PK?.replace('USER#', ''),
      email: item.email,
      phoneNumber: item.phoneNumber,
      role: item.role,
      cognitoId: item.cognitoId,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
