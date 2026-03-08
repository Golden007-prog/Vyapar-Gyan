/**
 * Catalog Categories Handler
 *
 * GET /api/v1/catalog/categories — No auth required
 *
 * Returns all active categories sorted by display order.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';

const dynamoDBClient = new DynamoDBClient({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const tableName = process.env.TABLE_NAME!;

    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'isActive = :active',
      ExpressionAttributeValues: {
        ':pk': { S: 'CATEGORY' },
        ':sk': { S: 'CATEGORY#' },
        ':active': { BOOL: true },
      },
    });

    const res = await dynamoDBClient.send(command);
    const categories = (res.Items || [])
      .map(item => unmarshall(item))
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map(c => ({
        categoryId: c.id,
        name: c.name,
        description: c.description,
        imageUrl: c.imageUrl,
        displayOrder: c.displayOrder,
      }));

    logger.info('Categories listed', { requestId, count: categories.length });

    return response(200, { categories });
  } catch (error) {
    logger.error('List categories failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
