/**
 * Catalog Search Handler
 *
 * GET /api/v1/catalog/search — Optional JWT
 *
 * Text search across product names and descriptions.
 * Uses DynamoDB Scan with filter (suitable for current scale).
 * For production scale, consider OpenSearch or DynamoDB Streams → search index.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { extractOptionalUserId } from '../../core/auth';
import { CatalogSearchQuerySchema } from '../../shared/schemas';

const dynamoDBClient = new DynamoDBClient({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractOptionalUserId(event);
    const params = event.queryStringParameters || {};
    const parsed = CatalogSearchQuerySchema.safeParse(params);

    if (!parsed.success) {
      return response(400, {
        error: 'Invalid query parameters',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const { q, limit } = parsed.data;
    const query = q.toLowerCase();
    const tableName = process.env.TABLE_NAME!;

    // Scan for active products matching the search query
    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression:
        'begins_with(PK, :pk) AND SK = :sk AND isActive = :active AND stockQuantity > :zero',
      ExpressionAttributeValues: {
        ':pk': { S: 'PRODUCT#' },
        ':sk': { S: 'METADATA' },
        ':active': { BOOL: true },
        ':zero': { N: '0' },
      },
      Limit: limit * 10, // over-fetch for in-memory text filtering
    });

    const res = await dynamoDBClient.send(command);
    const allProducts = (res.Items || []).map(item => unmarshall(item));

    // In-memory text search across name and description
    const matched = allProducts
      .filter(
        p =>
          p.name?.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query),
      )
      .slice(0, limit)
      .map(p => ({
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
      }));

    logger.info('Catalog search completed', { requestId, query: q, results: matched.length, userId });

    return response(200, { query: q, products: matched, count: matched.length });
  } catch (error) {
    logger.error('Catalog search failed', error, { requestId });
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
