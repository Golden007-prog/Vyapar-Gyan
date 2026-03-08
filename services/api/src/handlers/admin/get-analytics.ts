import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Platform Analytics
 */
interface PlatformAnalytics {
  totalGMV: number;
  totalCommission: number;
  activeSellers: number;
  totalOrders: number;
  pendingApprovals: number;
  averageOrderValue: number;
  topCategories: Array<{
    categoryId: string;
    categoryName: string;
    orderCount: number;
    revenue: number;
  }>;
  recentActivity: Array<{
    type: string;
    description: string;
    timestamp: string;
  }>;
}

/**
 * Get Analytics Handler
 * 
 * Fetches platform-wide analytics for admin dashboard.
 * Aggregates data from orders, sellers, and products.
 * 
 * Authorization: Requires valid JWT token with admin role
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Get analytics request received', {
    requestId,
    path: event.path,
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

    logger.info('Fetching platform analytics');

    // Fetch analytics from DynamoDB
    const config = await getConfig();
    const analytics = await fetchPlatformAnalytics(config.tableName);

    logger.info('Analytics retrieved successfully', {
      totalGMV: analytics.totalGMV,
      activeSellers: analytics.activeSellers,
      totalOrders: analytics.totalOrders,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        analytics,
        generatedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    logger.error('Failed to get analytics', {
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
        message: 'Failed to retrieve analytics',
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
 * Fetch platform-wide analytics from DynamoDB
 * 
 * Note: For MVP, we aggregate data on-demand. In production, consider:
 * - Pre-computed metrics stored in DynamoDB
 * - CloudWatch metrics and dashboards
 * - Separate analytics database (e.g., Redshift, Athena)
 */
async function fetchPlatformAnalytics(tableName: string): Promise<PlatformAnalytics> {
  try {
    // Fetch sellers count
    const sellersCount = await countSellers(tableName);
    
    // Fetch orders and calculate GMV
    const ordersData = await aggregateOrders(tableName);
    
    // Fetch pending approvals
    const pendingApprovals = await countPendingApprovals(tableName);

    // Calculate average order value
    const averageOrderValue = ordersData.totalOrders > 0
      ? ordersData.totalGMV / ordersData.totalOrders
      : 0;

    return {
      totalGMV: ordersData.totalGMV,
      totalCommission: ordersData.totalCommission,
      activeSellers: sellersCount.active,
      totalOrders: ordersData.totalOrders,
      pendingApprovals,
      averageOrderValue,
      topCategories: ordersData.topCategories,
      recentActivity: ordersData.recentActivity,
    };
  } catch (error) {
    logger.error('Failed to fetch platform analytics', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Count sellers by status
 */
async function countSellers(tableName: string): Promise<{ active: number; pending: number }> {
  try {
    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :userPrefix) AND SK = :sk',
      ExpressionAttributeValues: {
        ':userPrefix': { S: 'USER#' },
        ':sk': { S: 'PROFILE' },
      },
      ProjectionExpression: '#status, businessName',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
    });

    const response = await dynamoDBClient.send(command);

    let active = 0;
    let pending = 0;

    if (response.Items) {
      for (const item of response.Items) {
        const profile = unmarshall(item);
        
        // Only count sellers (users with businessName)
        if (profile.businessName) {
          if (profile.status === 'active') {
            active++;
          } else if (profile.status === 'pending') {
            pending++;
          }
        }
      }
    }

    return { active, pending };
  } catch (error) {
    logger.error('Failed to count sellers', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { active: 0, pending: 0 };
  }
}

/**
 * Aggregate order data
 */
async function aggregateOrders(tableName: string): Promise<{
  totalGMV: number;
  totalCommission: number;
  totalOrders: number;
  topCategories: Array<{ categoryId: string; categoryName: string; orderCount: number; revenue: number }>;
  recentActivity: Array<{ type: string; description: string; timestamp: string }>;
}> {
  try {
    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :orderPrefix) AND SK = :sk',
      ExpressionAttributeValues: {
        ':orderPrefix': { S: 'ORDER#' },
        ':sk': { S: 'METADATA' },
      },
      Limit: 1000, // Limit for MVP
    });

    const response = await dynamoDBClient.send(command);

    let totalGMV = 0;
    let totalCommission = 0;
    let totalOrders = 0;
    const recentActivity: Array<{ type: string; description: string; timestamp: string }> = [];

    if (response.Items) {
      const orders = response.Items.map(item => unmarshall(item));
      
      // Sort by createdAt for recent activity
      orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      for (const order of orders) {
        totalOrders++;
        totalGMV += order.subtotal || 0;
        totalCommission += order.commissionAmount || 0;

        // Add to recent activity (top 5)
        if (recentActivity.length < 5) {
          recentActivity.push({
            type: 'order',
            description: `Order ${order.id} - ₹${order.subtotal} - ${order.status}`,
            timestamp: order.createdAt,
          });
        }
      }
    }

    // For MVP, return empty top categories (would require category aggregation)
    const topCategories: Array<{ categoryId: string; categoryName: string; orderCount: number; revenue: number }> = [];

    return {
      totalGMV,
      totalCommission,
      totalOrders,
      topCategories,
      recentActivity,
    };
  } catch (error) {
    logger.error('Failed to aggregate orders', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      totalGMV: 0,
      totalCommission: 0,
      totalOrders: 0,
      topCategories: [],
      recentActivity: [],
    };
  }
}

/**
 * Count pending seller approvals
 */
async function countPendingApprovals(tableName: string): Promise<number> {
  try {
    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :userPrefix) AND SK = :sk AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':userPrefix': { S: 'USER#' },
        ':sk': { S: 'PROFILE' },
        ':status': { S: 'pending' },
      },
      Select: 'COUNT',
    });

    const response = await dynamoDBClient.send(command);
    return response.Count || 0;
  } catch (error) {
    logger.error('Failed to count pending approvals', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
