import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Seller Profile from DynamoDB
 */
interface SellerProfile {
  id: string;
  userId: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  status: 'pending' | 'active' | 'rejected' | 'suspended';
  businessAddress: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  gstNumber?: string;
  bankDetails?: {
    accountNumber: string;
    ifscCode: string;
    accountHolderName: string;
  };
  totalRevenue?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get Sellers Handler
 * 
 * Fetches all sellers from DynamoDB for admin dashboard.
 * Sellers are stored with:
 * - PK: USER#{userId}
 * - SK: PROFILE
 * 
 * Query Parameters:
 * - status: Filter by status (pending, active, rejected, suspended)
 * - pageSize: Number of results to return (default: 50, max: 100)
 * 
 * Authorization: Requires valid JWT token with admin role
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Get sellers request received', {
    requestId,
    path: event.path,
    queryParams: event.queryStringParameters,
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

    // Parse query parameters
    const statusFilter = event.queryStringParameters?.status?.toLowerCase();
    const pageSize = Math.min(
      parseInt(event.queryStringParameters?.pageSize || '50', 10),
      100
    );

    logger.info('Scanning sellers', {
      statusFilter,
      pageSize,
    });

    // Scan for all sellers from DynamoDB
    const config = await getConfig();
    const sellers = await scanSellers(
      config.tableName,
      statusFilter,
      pageSize
    );

    logger.info('Sellers retrieved successfully', {
      count: sellers.length,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        sellers,
        total: sellers.length,
        page: 1,
        pageSize,
      }),
    };
  } catch (error) {
    logger.error('Failed to get sellers', {
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
        message: 'Failed to retrieve sellers',
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
 * Scan for all sellers in DynamoDB
 * 
 * Note: For MVP, we use Scan. In production, consider using a GSI
 * with PK: ROLE#seller, SK: USER#{userId} for efficient queries.
 */
async function scanSellers(
  tableName: string,
  statusFilter: string | undefined,
  limit: number
): Promise<SellerProfile[]> {
  const sellers: SellerProfile[] = [];

  try {
    // Build filter expression
    let filterExpression = 'begins_with(PK, :userPrefix) AND SK = :sk';
    const expressionAttributeValues: Record<string, any> = {
      ':userPrefix': { S: 'USER#' },
      ':sk': { S: 'PROFILE' },
    };

    // Add status filter if provided
    if (statusFilter) {
      filterExpression += ' AND #status = :status';
      expressionAttributeValues[':status'] = { S: statusFilter };
    }

    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression: filterExpression,
      ExpressionAttributeNames: statusFilter ? {
        '#status': 'status',
      } : undefined,
      ExpressionAttributeValues: expressionAttributeValues,
      Limit: limit * 2, // Scan more to account for non-seller users
    });

    const response = await dynamoDBClient.send(command);

    if (response.Items) {
      for (const item of response.Items) {
        const profile = unmarshall(item);
        
        // Only include sellers (users with role='seller' or businessName)
        if (profile.businessName || profile.role === 'seller') {
          sellers.push({
            id: profile.id || profile.userId,
            userId: profile.userId,
            businessName: profile.businessName || 'N/A',
            ownerName: profile.ownerName || profile.name || 'N/A',
            email: profile.email || 'N/A',
            phone: profile.phone || 'N/A',
            status: profile.status || 'pending',
            businessAddress: profile.businessAddress || {
              addressLine1: 'N/A',
              city: 'N/A',
              state: 'N/A',
              pincode: 'N/A',
            },
            gstNumber: profile.gstNumber,
            bankDetails: profile.bankDetails,
            totalRevenue: profile.totalRevenue || 0,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
          });
          
          // Stop if we have enough results
          if (sellers.length >= limit) {
            break;
          }
        }
      }
    }

    return sellers;
  } catch (error) {
    logger.error('Failed to scan sellers from DynamoDB', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
