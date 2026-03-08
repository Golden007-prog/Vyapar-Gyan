import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

const dynamoDBClient = new DynamoDBClient({});

export interface Customer {
  id: string;
  phoneNumber: string;
  profileName: string;
  whatsappId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResolveOrCreateCustomerInput {
  phoneNumber: string;
  profileName: string;
  whatsappId?: string;
}

/**
 * CustomerRepository
 * 
 * Manages customer data in DynamoDB.
 * Uses PK: CUSTOMER#{phoneNumber}, SK: PROFILE pattern.
 */
export class CustomerRepository {
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
   * Resolve existing customer or create new one
   */
  async resolveOrCreate(input: ResolveOrCreateCustomerInput): Promise<Customer> {
    const { phoneNumber, profileName, whatsappId } = input;

    // Try to get existing customer
    const existing = await this.getByPhoneNumber(phoneNumber);
    if (existing) {
      logger.info('Existing customer found', { customerId: existing.id, phoneNumber });
      return existing;
    }

    // Create new customer
    const customer: Customer = {
      id: randomUUID(),
      phoneNumber,
      profileName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    if (whatsappId) {
      customer.whatsappId = whatsappId;
    }

    await this.create(customer);
    logger.info('New customer created', { customerId: customer.id, phoneNumber });
    
    return customer;
  }

  /**
   * Get customer by phone number
   */
  async getByPhoneNumber(phoneNumber: string): Promise<Customer | null> {
    const tableName = await this.getTableName();
    const command = new GetItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `CUSTOMER#${phoneNumber}`,
        SK: 'PROFILE',
      }),
    });

    const response = await dynamoDBClient.send(command);
    
    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as Customer;
  }

  /**
   * Create new customer
   */
  async create(customer: Customer): Promise<void> {
    const tableName = await this.getTableName();
    const item = {
      PK: `CUSTOMER#${customer.phoneNumber}`,
      SK: 'PROFILE',
      ...customer,
    };

    const command = new PutItemCommand({
      TableName: tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    });

    await dynamoDBClient.send(command);
  }
}
