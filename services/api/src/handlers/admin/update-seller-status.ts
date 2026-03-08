import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Update Seller Status Handler
 * 
 * Updates the status of a seller profile in DynamoDB.
 * 
 * Path Parameters:
 * - sellerId: The seller's user ID
 * 
 * Body:
 * - status: 'active' | 'rejected' | 'suspended'
 * - reason: Optional reason for status change
 * 
 * Authorization: Requires valid JWT token with admin role
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Update seller status request received', {
    requestId,
    path: event.path,
    pathParameters: event.pathParameters,
  });

  try {
    // Extract user role from JWT token
    const userRole = extractUserRoleFromEvent(event);
    
    if (userRole !== 'admin') {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Forbidden',
          message: 'Admin access required',
        }),
      };
    }

    // Extract seller ID from path parameters
    const sellerId = event.pathParameters?.sellerId;
    
    if (!sellerId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Seller ID is required',
        }),
      };
    }

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { status, reason } = body;

    // Validate status
    const validStatuses = ['active', 'rejected', 'suspended'];
    if (!status || !validStatuses.includes(status)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: `Status must be one of: ${validStatuses.join(', ')}`,
        }),
      };
    }

    logger.info('Updating seller status', {
      sellerId,
      status,
      reason,
    });

    // Update seller status in DynamoDB
    const config = await getConfig();
    const updatedSeller = await updateSellerStatus(
      config.tableName,
      sellerId,
      status,
      reason
    );

    if (!updatedSeller) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Not Found',
          message: 'Seller not found',
        }),
      };
    }

    logger.info('Seller status updated successfully', {
      sellerId,
      status,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Seller status updated successfully',
        seller: updatedSeller,
      }),
    };
  } catch (error) {
    logger.error('Failed to update seller status', {
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
        message: 'Failed to update seller status',
      }),
    };
  }
};

/**
 * Extract user role from API Gateway event
 */
function extractUserRoleFromEvent(event: APIGatewayProxyEvent): string | null {
  // Check authorizer context first
  const authorizerContext = event.requestContext.authorizer;
  
  if (authorizerContext) {
    const claims = authorizerContext.claims || authorizerContext;
    
    // Check Cognito groups
    if (claims['cognito:groups']) {
      const groups = claims['cognito:groups'];
      if (typeof groups === 'string' && groups.includes('admin')) {
        return 'admin';
      }
      if (Array.isArray(groups) && groups.includes('admin')) {
        return 'admin';
      }
    }
    
    // Check custom role attribute
    if (claims['custom:role']) {
      return claims['custom:role'];
    }
  }

  // Fallback: try to extract from headers (for testing)
  const roleHeader = event.headers['x-user-role'] || event.headers['X-User-Role'];
  if (roleHeader) {
    return roleHeader;
  }

  return null;
}

/**
 * Update seller status in DynamoDB
 */
async function updateSellerStatus(
  tableName: string,
  sellerId: string,
  status: string,
  reason?: string
): Promise<any> {
  try {
    // First, check if seller exists
    const getCommand = new GetItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `USER#${sellerId}`,
        SK: 'PROFILE',
      }),
    });

    const getResponse = await dynamoDBClient.send(getCommand);

    if (!getResponse.Item) {
      return null;
    }

    // Update seller status
    const updateExpression = reason
      ? 'SET #status = :status, #updatedAt = :updatedAt, #statusReason = :reason'
      : 'SET #status = :status, #updatedAt = :updatedAt';

    const expressionAttributeValues: Record<string, any> = {
      ':status': { S: status },
      ':updatedAt': { S: new Date().toISOString() },
    };

    if (reason) {
      expressionAttributeValues[':reason'] = { S: reason };
    }

    const updateCommand = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `USER#${sellerId}`,
        SK: 'PROFILE',
      }),
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        ...(reason ? { '#statusReason': 'statusReason' } : {}),
      },
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    });

    const updateResponse = await dynamoDBClient.send(updateCommand);

    if (!updateResponse.Attributes) {
      return null;
    }

    return unmarshall(updateResponse.Attributes);
  } catch (error) {
    logger.error('Failed to update seller status in DynamoDB', {
      sellerId,
      status,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
