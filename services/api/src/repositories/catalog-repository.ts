import { DynamoDBClient, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

const dynamoDBClient = new DynamoDBClient({});

export interface Category {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  displayOrder: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  sellerId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  stockQuantity: number;
  imageUrls: string[];
  isActive: boolean;
  createdAt: string;
}

/**
 * CatalogRepository
 * 
 * Manages product catalog data access from DynamoDB.
 * Provides read-only access for browsing and search.
 */
export class CatalogRepository {
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
   * Get all active categories
   */
  async getCategories(): Promise<Category[]> {
    const tableName = await this.getTableName();
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: marshall({
        ':pk': 'CATEGORY',
        ':sk': 'CATEGORY#',
        ':active': true,
      }),
    });

    const response = await dynamoDBClient.send(command);
    
    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    const categories = response.Items.map(item => unmarshall(item) as Category);
    
    // Sort by display order
    return categories.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  /**
   * Get category by ID
   */
  async getCategoryById(categoryId: string): Promise<Category | null> {
    const tableName = await this.getTableName();
    const command = new GetItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: 'CATEGORY',
        SK: `CATEGORY#${categoryId}`,
      }),
    });

    const response = await dynamoDBClient.send(command);
    
    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as Category;
  }

  /**
   * Get products by category
   */
  async getProductsByCategory(categoryId: string, limit: number = 20): Promise<Product[]> {
    const tableName = await this.getTableName();
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'CategoryIndex',
      KeyConditionExpression: 'categoryId = :categoryId',
      FilterExpression: 'isActive = :active AND stockQuantity > :zero',
      ExpressionAttributeValues: marshall({
        ':categoryId': categoryId,
        ':active': true,
        ':zero': 0,
      }),
      Limit: limit,
    });

    const response = await dynamoDBClient.send(command);
    
    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map(item => unmarshall(item) as Product);
  }

  /**
   * Get product by ID
   */
  async getProductById(productId: string): Promise<Product | null> {
    const tableName = await this.getTableName();
    const command = new GetItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `PRODUCT#${productId}`,
        SK: 'METADATA',
      }),
    });

    const response = await dynamoDBClient.send(command);
    
    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as Product;
  }

  /**
   * Search products by name (simple text match)
   */
  async searchProducts(query: string, limit: number = 10): Promise<Product[]> {
    const tableName = await this.getTableName();
    // Note: This is a simple scan-based search. For production, consider:
    // - OpenSearch for full-text search
    // - DynamoDB Streams + Lambda to maintain search index
    // - Pre-computed search results in cache
    
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'ProductSearchIndex',
      KeyConditionExpression: 'begins_with(#name, :query)',
      FilterExpression: 'isActive = :active AND stockQuantity > :zero',
      ExpressionAttributeNames: {
        '#name': 'name',
      },
      ExpressionAttributeValues: marshall({
        ':query': query.toLowerCase(),
        ':active': true,
        ':zero': 0,
      }, { removeUndefinedValues: true }),
      Limit: limit,
    });

    try {
      const response = await dynamoDBClient.send(command);
      
      if (!response.Items || response.Items.length === 0) {
        return [];
      }

      return response.Items.map(item => unmarshall(item) as Product);
    } catch (error) {
      logger.warn('Product search failed, returning empty results', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
