/**
 * Seller Context Handler
 *
 * GET /api/v1/seller/inbox/{userId}/context — JWT-protected (seller role)
 *
 * Returns customer profile, order history, total spend, and preferred channel
 * to give the seller context when replying to a customer conversation.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getConfig } from '../../utils/config';
import { getUserProfile } from '../../adapters/dynamodb-adapter';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface OrderSummary {
  orderId: string;
  status: string;
  subtotal: number;
  itemCount: number;
  createdAt: string;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);
    const customerUserId = event.pathParameters?.userId;

    if (!customerUserId) {
      return response(400, { error: 'Customer userId is required' });
    }

    logger.info('Seller context request', {
      requestId,
      sellerId,
      customerUserId,
    });

    const config = await getConfig();

    // Fetch customer profile
    const profile = await getUserProfile(customerUserId);

    // Query customer orders using CustomerOrdersIndex
    const ordersRes = await ddbClient.send(
      new QueryCommand({
        TableName: config.tableName,
        IndexName: 'CustomerOrdersIndex',
        KeyConditionExpression: 'customerId = :cid',
        ExpressionAttributeValues: {
          ':cid': customerUserId,
        },
        ScanIndexForward: false, // most recent first
        Limit: 20,
      }),
    );

    const orders: OrderSummary[] = (ordersRes.Items ?? []).map((item: any) => ({
      orderId: item.orderId || item.orderUUID || item.PK?.replace('ORDER#', ''),
      status: item.status || 'unknown',
      subtotal: item.subtotal || 0,
      itemCount: Array.isArray(item.items) ? item.items.length : 0,
      createdAt: item.createdAt || '',
    }));

    // Calculate total spend
    const totalSpend = orders.reduce((sum, o) => sum + (o.subtotal || 0), 0);

    const customerContext = {
      profile: profile
        ? {
            userId: profile.userId,
            displayName: profile.displayName,
            phoneNumber: profile.phoneNumber,
            preferredChannel: profile.preferredChannel,
            whatsappConnected: profile.whatsappConnected,
            createdAt: profile.createdAt,
          }
        : null,
      orderHistory: orders,
      totalSpend,
      orderCount: orders.length,
      preferredChannel: profile?.preferredChannel || 'web',
    };

    logger.info('Seller context retrieved', {
      sellerId,
      customerUserId,
      orderCount: orders.length,
      totalSpend,
    });

    return response(200, customerContext);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Seller context failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
