import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Reject Insight Handler
 * 
 * Updates an insight's status from 'pending' to 'rejected' in DynamoDB.
 * Rejected insights will not trigger any campaigns.
 * 
 * Path Parameters:
 * - insightId: The ID of the insight to reject
 * 
 * Authorization: Requires valid JWT token with seller or admin role
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Reject insight request received', {
    requestId,
    path: event.path,
    pathParameters: event.pathParameters,
  });

  try {
    const sellerId = extractSellerIdFromEvent(event);
    
    if (!sellerId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Seller ID not found in token',
        }),
      };
    }

    const insightId = event.pathParameters?.insightId;
    
    if (!insightId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Insight ID is required',
        }),
      };
    }

    const config = await getConfig();

    // Verify insight exists and belongs to seller
    const existingInsight = await getInsight(config.tableName, sellerId, insightId);
    
    if (!existingInsight) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Not Found',
          message: 'Insight not found',
        }),
      };
    }

    if (existingInsight.status !== 'pending') {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: `Insight is already ${existingInsight.status}`,
        }),
      };
    }

    // Update status to rejected
    await rejectInsight(config.tableName, sellerId, insightId);

    logger.info('Insight rejected successfully', {
      sellerId,
      insightId,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        message: 'Insight rejected successfully',
      }),
    };
  } catch (error) {
    logger.error('Failed to reject insight', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to reject insight',
      }),
    };
  }
};

function extractSellerIdFromEvent(event: APIGatewayProxyEvent): string | null {
  const authorizerContext = event.requestContext.authorizer;
  
  if (authorizerContext) {
    const claims = authorizerContext.claims || authorizerContext;
    if (claims['custom:userId']) return claims['custom:userId'];
    if (claims.sub) return claims.sub;
  }

  const userIdHeader = event.headers['x-user-id'] || event.headers['X-User-Id'];
  return userIdHeader || null;
}

async function getInsight(tableName: string, sellerId: string, insightId: string) {
  const command = new GetItemCommand({
    TableName: tableName,
    Key: marshall({
      PK: `SELLER#${sellerId}`,
      SK: `INSIGHT#${insightId}`,
    }),
  });

  const response = await dynamoDBClient.send(command);
  return response.Item ? unmarshall(response.Item) : null;
}

async function rejectInsight(tableName: string, sellerId: string, insightId: string) {
  const command = new UpdateItemCommand({
    TableName: tableName,
    Key: marshall({
      PK: `SELLER#${sellerId}`,
      SK: `INSIGHT#${insightId}`,
    }),
    UpdateExpression: 'SET #status = :status, rejectedAt = :rejectedAt, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: marshall({
      ':status': 'rejected',
      ':rejectedAt': new Date().toISOString(),
      ':updatedAt': new Date().toISOString(),
      ':pending': 'pending',
    }),
    ConditionExpression: '#status = :pending',
  });

  await dynamoDBClient.send(command);
}
