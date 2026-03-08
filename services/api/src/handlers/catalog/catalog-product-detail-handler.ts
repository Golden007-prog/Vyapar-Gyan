/**
 * Catalog Product Detail Handler
 *
 * GET /api/v1/catalog/products/{id} — Optional JWT
 *
 * Returns product detail with images, stock status, and seller info.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { extractOptionalUserId } from '../../core/auth';

const dynamoDBClient = new DynamoDBClient({});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const userId = extractOptionalUserId(event);
    const productId = event.pathParameters?.id;

    if (!productId) {
      return response(400, { error: 'Product ID is required' });
    }

    const tableName = process.env.TABLE_NAME!;

    // Fetch product
    const product = await getProduct(tableName, productId);
    if (!product || !product.isActive) {
      return response(404, { error: 'Product not found' });
    }

    // Fetch seller info
    const seller = await getSellerInfo(tableName, product.sellerId);

    // Fetch media
    const media = await getProductMedia(tableName, productId);

    const stockQuantity = product.stockQuantity ?? 0;
    let stockStatus: string;
    if (stockQuantity === 0) {
      stockStatus = 'out_of_stock';
    } else if (stockQuantity <= 5) {
      stockStatus = 'low_stock';
    } else {
      stockStatus = 'in_stock';
    }

    logger.info('Product detail fetched', { requestId, productId, userId });

    return response(200, {
      product: {
        productId: product.id || product.productId,
        name: product.name,
        description: product.description,
        price: product.price,
        originalPrice: product.originalPrice,
        categoryId: product.categoryId,
        stockStatus,
        imageUrls: media.length > 0 ? media : product.imageUrls || [],
        seller: seller
          ? { sellerId: seller.sellerId || seller.id, businessName: seller.businessName || seller.name }
          : { sellerId: product.sellerId },
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
    });
  } catch (error) {
    logger.error('Product detail failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}


async function getProduct(tableName: string, productId: string): Promise<Record<string, any> | null> {
  const command = new GetItemCommand({
    TableName: tableName,
    Key: marshall({ PK: `PRODUCT#${productId}`, SK: 'METADATA' }),
  });
  const res = await dynamoDBClient.send(command);
  return res.Item ? unmarshall(res.Item) : null;
}

async function getSellerInfo(tableName: string, sellerId: string): Promise<Record<string, any> | null> {
  // Try USER#{sellerId} PROFILE first (new pattern)
  const command = new GetItemCommand({
    TableName: tableName,
    Key: marshall({ PK: `USER#${sellerId}`, SK: 'PROFILE' }),
  });
  const res = await dynamoDBClient.send(command);
  if (res.Item) {
    return unmarshall(res.Item);
  }

  // Fallback: try SELLER#{sellerId} METADATA (legacy pattern)
  const fallback = new GetItemCommand({
    TableName: tableName,
    Key: marshall({ PK: `SELLER#${sellerId}`, SK: 'METADATA' }),
  });
  const res2 = await dynamoDBClient.send(fallback);
  return res2.Item ? unmarshall(res2.Item) : null;
}

async function getProductMedia(tableName: string, productId: string): Promise<string[]> {
  const command = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': { S: `PRODUCT#${productId}` },
      ':sk': { S: 'MEDIA#' },
    },
    Limit: 10,
  });

  try {
    const res = await dynamoDBClient.send(command);
    if (!res.Items || res.Items.length === 0) return [];
    return res.Items.map(item => {
      const m = unmarshall(item);
      return m.url || m.s3Key || '';
    }).filter(Boolean);
  } catch {
    return [];
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
