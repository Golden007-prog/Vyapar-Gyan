import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getBasicConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Seller Insight from DynamoDB
 */
interface SellerInsight {
  id: string;
  sellerId: string;
  productId: string;
  insightType: 'pricing_recommendation' | 'dead_stock_alert' | 'market_trend';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  actionRecommended: string;
  suggestedDiscountPercent?: number;
  suggestedPriceIncrease?: number;
  marketInsights?: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
  expiresAt: string;
  approvedAt?: string;
}

/**
 * Approve Insight Handler
 * 
 * Updates an insight's status from 'pending' to 'approved' in DynamoDB.
 * 
 * IMPORTANT: This update will trigger the DynamoDB Stream, which will
 * invoke the campaign-worker Lambda to automatically send WhatsApp
 * discount notifications to past customers (Phase 4 implementation).
 * 
 * Path Parameters:
 * - insightId: The ID of the insight to approve
 * 
 * Authorization: Requires valid JWT token with seller or admin role
 * 
 * Response:
 * - 200: Insight approved successfully
 * - 400: Invalid request (insight not found or already processed)
 * - 401: Unauthorized (seller doesn't own this insight)
 * - 500: Internal server error
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Approve insight request received', {
    requestId,
    path: event.path,
    pathParameters: event.pathParameters,
  });

  try {
    // Extract seller ID from JWT token
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

    // Extract insight ID from path parameters
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

    logger.info('Approving insight', {
      sellerId,
      insightId,
    });

    // Get the config
    const config = getBasicConfig();

    // First, verify the insight exists and belongs to this seller
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
          message: 'Insight not found or you do not have permission to access it',
        }),
      };
    }

    // Check if insight is already processed
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

    // Update the insight status to 'approved'
    const updatedInsight = await approveInsight(
      config.tableName,
      sellerId,
      insightId
    );

    logger.info('Insight approved successfully', {
      sellerId,
      insightId,
      insightType: updatedInsight.insightType,
    });

    // Note: The DynamoDB Stream will automatically trigger the campaign-worker
    // which will send WhatsApp notifications to customers

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: true,
        insight: updatedInsight,
        message: 'Insight approved successfully. Campaign will be executed shortly.',
      }),
    };
  } catch (error) {
    logger.error('Failed to approve insight', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to approve insight',
      }),
    };
  }
};

/**
 * Extract seller ID from API Gateway event
 */
function extractSellerIdFromEvent(event: APIGatewayProxyEvent): string | null {
  const authorizerContext = event.requestContext.authorizer;
  
  if (authorizerContext) {
    const claims = authorizerContext.claims || authorizerContext;
    
    if (claims['custom:userId']) {
      return claims['custom:userId'];
    }
    
    if (claims.sub) {
      return claims.sub;
    }
  }

  const userIdHeader = event.headers['x-user-id'] || event.headers['X-User-Id'];
  if (userIdHeader) {
    return userIdHeader;
  }

  return null;
}

/**
 * Get insight from DynamoDB to verify ownership
 */
async function getInsight(
  tableName: string,
  sellerId: string,
  insightId: string
): Promise<SellerInsight | null> {
  try {
    const command = new GetItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SELLER#${sellerId}`,
        SK: `INSIGHT#${insightId}`,
      }),
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as SellerInsight;
  } catch (error) {
    logger.error('Failed to get insight from DynamoDB', {
      sellerId,
      insightId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Approve insight by updating status to 'approved'
 * 
 * This update will trigger the DynamoDB Stream, which will invoke
 * the campaign-worker to send WhatsApp notifications.
 */
async function approveInsight(
  tableName: string,
  sellerId: string,
  insightId: string
): Promise<SellerInsight> {
  try {
    const now = new Date().toISOString();

    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SELLER#${sellerId}`,
        SK: `INSIGHT#${insightId}`,
      }),
      UpdateExpression: 'SET #status = :status, approvedAt = :approvedAt, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':status': 'approved',
        ':approvedAt': now,
        ':updatedAt': now,
        ':pending': 'pending',
      }),
      ConditionExpression: '#status = :pending', // Only update if still pending
      ReturnValues: 'ALL_NEW',
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Attributes) {
      throw new Error('Failed to update insight');
    }

    return unmarshall(response.Attributes) as SellerInsight;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      throw new Error('Insight is no longer pending');
    }
    
    logger.error('Failed to approve insight in DynamoDB', {
      sellerId,
      insightId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
