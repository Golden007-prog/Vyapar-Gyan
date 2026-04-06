import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getBasicConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Product from DynamoDB
 */
interface Product {
  id: string;
  productId: string;
  sellerId: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  categoryId: string;
  categoryName?: string;
  images: string[];
  status: 'active' | 'inactive' | 'out_of_stock';
  stockAge?: number; // Days since last stock update
  monthlyRevenue?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get Products Handler
 * 
 * Fetches products for a seller from DynamoDB.
 * Products are stored with:
 * - PK: SELLER#{sellerId}
 * - SK: PRODUCT#{productId}
 * 
 * Query Parameters:
 * - status: Filter by status (active, inactive, out_of_stock)
 * - pageSize: Number of results to return (default: 20, max: 100)
 * 
 * Authorization: Requires valid JWT token with seller role
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Get products request received', {
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
    const statusFilter = event.queryStringParameters?.status?.toLowerCase();
    const pageSize = Math.min(
      parseInt(event.queryStringParameters?.pageSize || '20', 10),
      100
    );

    logger.info('Querying products', {
      sellerId,
      statusFilter,
      pageSize,
    });

    // Query products from DynamoDB
    const config = getBasicConfig();
    const products = await queryProducts(
      config.tableName,
      sellerId,
      statusFilter,
      pageSize
    );

    logger.info('Products retrieved successfully', {
      sellerId,
      count: products.length,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        data: products,
        total: products.length,
        page: 1,
        pageSize,
      }),
    };
  } catch (error) {
    logger.error('Failed to get products', {
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
        message: 'Failed to retrieve products',
      }),
    };
  }
};

/**
 * Extract seller ID from API Gateway event
 * The seller ID should be in the JWT token claims, set by the authorizer
 */
function extractSellerIdFromEvent(event: APIGatewayProxyEvent): string | null {
  const authorizerContext = event.requestContext.authorizer;

  if (authorizerContext) {
    // HTTP API v2 JWT authorizer: claims are in authorizer.jwt.claims
    const jwtClaims = (authorizerContext as any)?.jwt?.claims;
    if (jwtClaims?.sub) {
      return jwtClaims.sub;
    }

    // REST API v1 authorizer: claims are in authorizer.claims
    const claims = authorizerContext.claims || authorizerContext;
    if (claims['custom:userId']) {
      return claims['custom:userId'];
    }
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
 * Query products from DynamoDB for a specific seller
 * 
 * Uses the seller index pattern:
 * PK: SELLER#{sellerId}
 * SK: PRODUCT#{productId}
 */
async function queryProducts(
  tableName: string,
  sellerId: string,
  statusFilter: string | undefined,
  limit: number
): Promise<Product[]> {
  const products: Product[] = [];

  try {
    // Query all products for the seller
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': { S: `SELLER#${sellerId}` },
        ':sk': { S: 'PRODUCT#' },
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit * 2, // Query more to account for filtering
    });

    const response = await dynamoDBClient.send(command);

    if (response.Items) {
      for (const item of response.Items) {
        const product = unmarshall(item) as Product;
        
        // Filter by status if provided
        if (statusFilter && product.status !== statusFilter) {
          continue;
        }

        products.push(product);
        
        // Stop if we have enough results
        if (products.length >= limit) {
          break;
        }
      }
    }

    return products;
  } catch (error) {
    logger.error('Failed to query products from DynamoDB', {
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
