/**
 * Favorites Repository
 *
 * CRUD operations for customer favorite stores.
 * DynamoDB pattern: PK = CUSTOMER#{customerId}, SK = FAVORITE#{sellerId}
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

let _tableName: string;

async function tableName(): Promise<string> {
  if (!_tableName) {
    const envTable = process.env.TABLE_NAME;
    if (envTable) {
      _tableName = envTable;
    } else {
      const { getConfig } = await import('../utils/config.js');
      const cfg = await getConfig();
      _tableName = cfg.tableName;
    }
  }
  return _tableName;
}

export interface FavoriteStore {
  customerId: string;
  sellerId: string;
  storeName: string;
  addedAt: string;
}

/**
 * Add a store to customer's favorites.
 */
export async function addFavorite(fav: FavoriteStore): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `CUSTOMER#${fav.customerId}`,
        SK: `FAVORITE#${fav.sellerId}`,
        storeName: fav.storeName,
        sellerId: fav.sellerId,
        customerId: fav.customerId,
        addedAt: fav.addedAt,
      },
    }),
  );
  logger.info('Favorite added', { customerId: fav.customerId, sellerId: fav.sellerId });
}

/**
 * Remove a store from customer's favorites.
 */
export async function removeFavorite(customerId: string, sellerId: string): Promise<void> {
  const table = await tableName();
  await docClient.send(
    new DeleteCommand({
      TableName: table,
      Key: {
        PK: `CUSTOMER#${customerId}`,
        SK: `FAVORITE#${sellerId}`,
      },
    }),
  );
  logger.info('Favorite removed', { customerId, sellerId });
}

/**
 * List all favorite stores for a customer.
 */
export async function listFavorites(customerId: string): Promise<FavoriteStore[]> {
  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `CUSTOMER#${customerId}`,
        ':prefix': 'FAVORITE#',
      },
    }),
  );
  return (res.Items ?? []) as FavoriteStore[];
}
