import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getBasicConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Order from DynamoDB
 */
interface Order {
  id: string;
  orderId: string;
  customerId: string;
  customerPhone: string;
  sellerId: string;
  status: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  subtotal: number;
  commissionAmount: number;
  sellerAmount: number;
  shippingAddress: {
    name: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  paymentId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get Orders Handler
 * 
 * Fetches orders for a seller from DynamoDB.
 * Orders are stored with:
 * - PK: SELLER#{sellerId}
 * - SK: ORDER#{createdAt}#{orderId}
 * 
 * Query Parameters:
 * - status: Filter by status (pending, confirmed, processing, delivered, cancelled)
 * - pageSize: Number of results to return (default: 20, max: 100)
 * 
 * Authorization: Requires valid JWT token with seller role
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Get orders request received', {
    requestId,
    path: event.path,
    queryParams: event.queryStringParameters,
  });

  try {
    // Extract seller ID from JWT token (set by API Gateway authorizer)
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

    // Parse query parameters
    const statusFilter = event.queryStringParameters?.status?.toUpperCase();
    const pageSize = Math.min(
      parseInt(event.queryStringParameters?.pageSize || '20', 10),
      100
    );

    logger.info('Querying orders', {
      sellerId,
      statusFilter,
      pageSize,
    });

    // Query orders from DynamoDB
    const config = getBasicConfig();
    const orders = await queryOrders(
      config.tableName,
      sellerId,
      statusFilter,
      pageSize
    );

    logger.info('Orders retrieved successfully', {
      sellerId,
      count: orders.length,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        data: orders,
        total: orders.length,
        page: 1,
        pageSize,
      }),
    };
  } catch (error) {
    logger.error('Failed to get orders', {
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
        message: 'Failed to retrieve orders',
      }),
    };
  }
};

/**
 * Extract seller ID from API Gateway event
 * The seller ID should be in the JWT token claims, set by the authorizer
 */
function extractSellerIdFromEvent(event: APIGatewayProxyEvent): string | null {
  // Check authorizer context first
  const authorizerContext = event.requestContext.authorizer;
  
  if (authorizerContext) {
    // For JWT authorizer, claims are in authorizer.claims
    const claims = authorizerContext.claims || authorizerContext;
    
    // Try to get seller ID from custom attribute
    if (claims['custom:userId']) {
      return claims['custom:userId'];
    }
    
    // Fallback to sub (Cognito user ID)
    if (claims.sub) {
      return claims.sub;
    }
  }

  // Fallback: try to extract from headers (for testing)
  const userIdHeader = event.headers['x-user-id'] || event.headers['X-User-Id'];
  if (userIdHeader) {
    return userIdHeader;
  }

  return null;
}

/**
 * Query orders from DynamoDB for a specific seller
 * 
 * Uses the seller index pattern:
 * PK: SELLER#{sellerId}
 * SK: ORDER#{createdAt}#{orderId}
 */
async function queryOrders(
  tableName: string,
  sellerId: string,
  statusFilter: string | undefined,
  limit: number
): Promise<Order[]> {
  const orders: Order[] = [];

  try {
    // Query all order index entries for the seller
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': { S: `SELLER#${sellerId}` },
        ':sk': { S: 'ORDER#' },
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit * 2, // Query more to account for filtering
    });

    const response = await dynamoDBClient.send(command);

    if (response.Items) {
      // Fetch full order details for each order
      for (const item of response.Items) {
        const indexEntry = unmarshall(item);
        
        // Filter by status if provided
        if (statusFilter && indexEntry.status?.toUpperCase() !== statusFilter) {
          continue;
        }

        // Fetch full order details
        const orderDetails = await getOrderDetails(tableName, indexEntry.orderUUID);
        
        if (orderDetails) {
          orders.push(orderDetails);
          
          // Stop if we have enough results
          if (orders.length >= limit) {
            break;
          }
        }
      }
    }

    return orders;
  } catch (error) {
    logger.error('Failed to query orders from DynamoDB', {
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get full order details by order UUID
 */
async function getOrderDetails(tableName: string, orderUUID: string): Promise<Order | null> {
  try {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `ORDER#${orderUUID}` },
        ':sk': { S: 'METADATA' },
      },
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    const firstItem = response.Items[0];
    if (!firstItem) {
      return null;
    }

    return unmarshall(firstItem) as Order;
  } catch (error) {
    logger.error('Failed to get order details', {
      orderUUID,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
