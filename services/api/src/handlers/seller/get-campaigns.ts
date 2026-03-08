import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Campaign from DynamoDB
 */
interface Campaign {
  id: string;
  campaignId: string;
  sellerId: string;
  productId: string;
  productName: string;
  campaignType: 'dead_stock_discount' | 'price_increase' | 'seasonal_promo';
  discountPercent?: number;
  priceIncrease?: number;
  targetAudience: string;
  messagesSent: number;
  messagesDelivered: number;
  clickThroughRate?: number;
  conversions: number;
  revenue: number;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

/**
 * Campaign Summary Metrics
 */
interface CampaignMetrics {
  totalCampaigns: number;
  activeCampaigns: number;
  totalMessagesSent: number;
  totalConversions: number;
  totalRevenue: number;
  averageCTR: number;
}

/**
 * Get Campaigns Handler
 * 
 * Fetches campaign history and metrics for a seller from DynamoDB.
 * Campaigns are stored with:
 * - PK: SELLER#{sellerId}
 * - SK: CAMPAIGN#{campaignId}
 * 
 * Query Parameters:
 * - status: Filter by status (scheduled, active, completed, cancelled)
 * - pageSize: Number of results to return (default: 20, max: 100)
 * 
 * Authorization: Requires valid JWT token with seller role
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Get campaigns request received', {
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

    logger.info('Querying campaigns', {
      sellerId,
      statusFilter,
      pageSize,
    });

    // Query campaigns from DynamoDB
    const config = await getConfig();
    const campaigns = await queryCampaigns(
      config.tableName,
      sellerId,
      statusFilter,
      pageSize
    );

    // Calculate summary metrics
    const metrics = calculateMetrics(campaigns);

    logger.info('Campaigns retrieved successfully', {
      sellerId,
      count: campaigns.length,
      metrics,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        metrics,
        campaigns,
        total: campaigns.length,
        page: 1,
        pageSize,
      }),
    };
  } catch (error) {
    logger.error('Failed to get campaigns', {
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
        message: 'Failed to retrieve campaigns',
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
 * Query campaigns from DynamoDB for a specific seller
 * 
 * Uses the seller index pattern:
 * PK: SELLER#{sellerId}
 * SK: CAMPAIGN#{campaignId}
 */
async function queryCampaigns(
  tableName: string,
  sellerId: string,
  statusFilter: string | undefined,
  limit: number
): Promise<Campaign[]> {
  const campaigns: Campaign[] = [];

  try {
    // Query all campaigns for the seller
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': { S: `SELLER#${sellerId}` },
        ':sk': { S: 'CAMPAIGN#' },
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit * 2, // Query more to account for filtering
    });

    const response = await dynamoDBClient.send(command);

    if (response.Items) {
      for (const item of response.Items) {
        const campaign = unmarshall(item) as Campaign;
        
        // Filter by status if provided
        if (statusFilter && campaign.status !== statusFilter) {
          continue;
        }

        campaigns.push(campaign);
        
        // Stop if we have enough results
        if (campaigns.length >= limit) {
          break;
        }
      }
    }

    return campaigns;
  } catch (error) {
    logger.error('Failed to query campaigns from DynamoDB', {
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Calculate summary metrics from campaign data
 */
function calculateMetrics(campaigns: Campaign[]): CampaignMetrics {
  const metrics: CampaignMetrics = {
    totalCampaigns: campaigns.length,
    activeCampaigns: campaigns.filter(c => c.status === 'active').length,
    totalMessagesSent: 0,
    totalConversions: 0,
    totalRevenue: 0,
    averageCTR: 0,
  };

  if (campaigns.length === 0) {
    return metrics;
  }

  let totalCTR = 0;
  let campaignsWithCTR = 0;

  for (const campaign of campaigns) {
    metrics.totalMessagesSent += campaign.messagesSent || 0;
    metrics.totalConversions += campaign.conversions || 0;
    metrics.totalRevenue += campaign.revenue || 0;

    if (campaign.clickThroughRate !== undefined) {
      totalCTR += campaign.clickThroughRate;
      campaignsWithCTR++;
    }
  }

  // Calculate average CTR
  if (campaignsWithCTR > 0) {
    metrics.averageCTR = totalCTR / campaignsWithCTR;
  }

  return metrics;
}
