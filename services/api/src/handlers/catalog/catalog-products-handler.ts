/**
 * Catalog Products Handler
 *
 * GET /api/v1/catalog/products — Optional JWT
 *
 * Browse products with search, category filter, price range, and sort.
 * Unauthenticated users can browse; authenticated users get personalization
 * context (userId) for future recommendation features.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { extractOptionalUserId } from '../../core/auth';
import { CatalogProductsQuerySchema } from '../../shared/schemas';

const dynamoDBClient = new DynamoDBClient({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractOptionalUserId(event);
    const params = event.queryStringParameters || {};
    const parsed = CatalogProductsQuerySchema.safeParse(params);

    if (!parsed.success) {
      return response(400, {
        error: 'Invalid query parameters',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const { category, search, minPrice, maxPrice, sort, limit, cursor } = parsed.data;
    const tableName = process.env.TABLE_NAME!;

    let products: Record<string, any>[];

    if (category) {
      // Query CategoryIndex GSI for products in a specific category
      products = await queryByCategory(tableName, category, limit, cursor);
    } else {
      // Scan all active products (with filter)
      products = await scanActiveProducts(tableName, limit, cursor);
    }

    // Apply in-memory filters for search, price range
    if (search) {
      const q = search.toLowerCase();
      products = products.filter(
        p => p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q),
      );
    }

    if (minPrice !== undefined) {
      products = products.filter(p => (p.price ?? 0) >= minPrice);
    }
    if (maxPrice !== undefined) {
      products = products.filter(p => (p.price ?? 0) <= maxPrice);
    }

    // Sort
    switch (sort) {
      case 'price_asc':
        products.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
        break;
      case 'price_desc':
        products.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
        break;
      case 'newest':
        products.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        break;
      case 'popularity':
        products.sort((a, b) => (b.monthlyRevenue ?? 0) - (a.monthlyRevenue ?? 0));
        break;
    }

    // Trim to limit
    const trimmed = products.slice(0, limit);

    const items = trimmed.map(formatProduct);

    logger.info('Catalog products listed', { requestId, count: items.length, userId, category, sort });

    return response(200, { products: items, count: items.length });
  } catch (error) {
    logger.error('Catalog products failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

async function queryByCategory(
  tableName: string,
  categoryId: string,
  limit: number,
  cursor?: string,
): Promise<Record<string, any>[]> {
  const command = new QueryCommand({
    TableName: tableName,
    IndexName: 'CategoryIndex',
    KeyConditionExpression: 'categoryId = :categoryId',
    FilterExpression: 'isActive = :active AND stockQuantity > :zero',
    ExpressionAttributeValues: {
      ':categoryId': { S: categoryId },
      ':active': { BOOL: true },
      ':zero': { N: '0' },
    },
    Limit: limit * 3, // over-fetch to account for filtering
    ...(cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64url').toString()) } : {}),
  });

  const res = await dynamoDBClient.send(command);
  return (res.Items || []).map(item => unmarshall(item));
}

async function scanActiveProducts(
  tableName: string,
  limit: number,
  cursor?: string,
): Promise<Record<string, any>[]> {
  const command = new ScanCommand({
    TableName: tableName,
    FilterExpression: 'begins_with(PK, :pk) AND SK = :sk AND isActive = :active AND stockQuantity > :zero',
    ExpressionAttributeValues: {
      ':pk': { S: 'PRODUCT#' },
      ':sk': { S: 'METADATA' },
      ':active': { BOOL: true },
      ':zero': { N: '0' },
    },
    Limit: limit * 5, // over-fetch since scan is less targeted
    ...(cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64url').toString()) } : {}),
  });

  const res = await dynamoDBClient.send(command);
  return (res.Items || []).map(item => unmarshall(item));
}

function formatProduct(p: Record<string, any>) {
  return {
    productId: p.id || p.productId,
    name: p.name,
    description: p.description,
    price: p.price,
    originalPrice: p.originalPrice,
    categoryId: p.categoryId,
    sellerId: p.sellerId,
    stockStatus: (p.stockQuantity ?? 0) > 0 ? 'in_stock' : 'out_of_stock',
    imageUrls: p.imageUrls || [],
    createdAt: p.createdAt,
  };
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