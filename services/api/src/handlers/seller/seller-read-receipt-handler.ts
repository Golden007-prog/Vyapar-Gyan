/**
 * Seller Read Receipt Handler
 *
 * POST /api/v1/seller/inbox/{userId}/read — JWT-protected (seller role)
 *
 * Marks all inbound messages from a customer as 'read' in THREAD#{sellerId}.
 * Updates deliveryStatus to 'read' for all inbound messages that are not already read.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { resolveSellerId } from '../../adapters/dynamodb-adapter';
import { getBasicConfig } from '../../utils/config';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const cognitoSub = extractUserId(event);
    const sellerId = await resolveSellerId(cognitoSub);
    const customerUserId = event.pathParameters?.userId;

    if (!customerUserId) {
      return response(400, { error: 'Missing userId path parameter' });
    }

    logger.info('Mark conversation read', { requestId, sellerId, customerUserId });

    const config = getBasicConfig();

    // Query all messages in THREAD#{sellerId} that are inbound from this customer
    const res = await ddbClient.send(
      new QueryCommand({
        TableName: config.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `THREAD#${sellerId}`,
          ':prefix': 'MSG#',
        },
        ScanIndexForward: false,
        Limit: 200,
      }),
    );

    const messages = res.Items ?? [];
    const now = new Date().toISOString();
    let updatedCount = 0;

    // Update all unread inbound messages from this customer
    for (const msg of messages) {
      const msgCustomerId = (msg as any).customerUserId || (msg as any).counterpartUserId;
      if (msgCustomerId !== customerUserId) continue;
      if (msg.direction !== 'inbound') continue;
      if (msg.deliveryStatus === 'read') continue;

      await ddbClient.send(
        new UpdateCommand({
          TableName: config.tableName,
          Key: { PK: `THREAD#${sellerId}`, SK: msg.SK as string },
          UpdateExpression: 'SET deliveryStatus = :status, readAt = :readAt',
          ExpressionAttributeValues: {
            ':status': 'read',
            ':readAt': now,
          },
        }),
      );
      updatedCount++;
    }

    logger.info('Conversation marked read', { sellerId, customerUserId, updatedCount });

    return response(200, { success: true, updatedCount });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Mark read failed', error, { requestId });
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
