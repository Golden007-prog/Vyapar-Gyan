/**
 * Seller Dashboard Handler
 *
 * GET /api/v1/seller/dashboard — JWT-protected (seller role)
 *
 * Returns aggregated dashboard metrics for the authenticated seller:
 * - Total sales amount and month-over-month change
 * - Active product count and low-stock alerts
 * - Active campaign count and pending approvals
 * - Monthly revenue and trend
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getBasicConfig } from '../../utils/config';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);
    logger.info('Fetching seller dashboard', { sellerId, requestId });

    const config = getBasicConfig();
    const tableName = config.tableName;

    // Run queries in parallel for performance
    const [ordersResult, productsResult, campaignsResult] = await Promise.all([
      // Query seller orders (SellerOrdersIndex or SELLER_ORDERS# partition)
      querySellerOrders(tableName, sellerId),
      // Query seller products
      querySellerProducts(tableName, sellerId),
      // Query seller campaigns
      querySellerCampaigns(tableName, sellerId),
    ]);

    // Calculate metrics
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const allOrders = ordersResult;
    const thisMonthOrders = allOrders.filter(o => new Date(o.createdAt) >= thisMonth);
    const lastMonthOrders = allOrders.filter(o => {
      const d = new Date(o.createdAt);
      return d >= lastMonth && d < thisMonth;
    });

    const totalSales = allOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const thisMonthRevenue = thisMonthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const lastMonthRevenue = lastMonthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

    const revenueChange = lastMonthRevenue > 0
      ? ((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue * 100).toFixed(1)
      : '0';

    const activeProducts = productsResult.filter(p => p.status === 'active');
    const lowStockProducts = activeProducts.filter(p => (p.stockQuantity || 0) < 10);

    const activeCampaigns = campaignsResult.filter(c =>
      c.status === 'active' || c.status === 'scheduled'
    );
    const pendingCampaigns = campaignsResult.filter(c => c.status === 'pending_approval');

    const metrics = {
      totalSales: formatINR(totalSales),
      totalSalesChange: `${Number(revenueChange) >= 0 ? '+' : ''}${revenueChange}% from last month`,
      totalSalesTrend: Number(revenueChange) >= 0 ? 'up' : 'down',
      activeProducts: String(activeProducts.length),
      activeProductsChange: lowStockProducts.length > 0
        ? `${lowStockProducts.length} low stock items`
        : 'All stocked',
      activeCampaigns: String(activeCampaigns.length),
      activeCampaignsChange: pendingCampaigns.length > 0
        ? `${pendingCampaigns.length} pending approval`
        : 'None pending',
      monthlyRevenue: formatINR(thisMonthRevenue),
      monthlyRevenueChange: `${Number(revenueChange) >= 0 ? '+' : ''}${revenueChange}% from last month`,
      monthlyRevenueTrend: Number(revenueChange) >= 0 ? 'up' : 'down',
    };

    logger.info('Dashboard metrics computed', { sellerId, requestId });

    return response(200, metrics);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Seller dashboard failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

async function querySellerOrders(tableName: string, sellerId: string): Promise<any[]> {
  try {
    const res = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'SellerOrdersIndex',
        KeyConditionExpression: 'sellerId = :sid',
        ExpressionAttributeValues: { ':sid': sellerId },
        ScanIndexForward: false,
        Limit: 200,
      }),
    );
    return res.Items ?? [];
  } catch {
    // Index may not exist — fall back to empty
    return [];
  }
}

async function querySellerProducts(tableName: string, sellerId: string): Promise<any[]> {
  try {
    const res = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `SELLER#${sellerId}`,
          ':prefix': 'PRODUCT#',
        },
        Limit: 500,
      }),
    );
    return res.Items ?? [];
  } catch {
    return [];
  }
}

async function querySellerCampaigns(tableName: string, sellerId: string): Promise<any[]> {
  try {
    const res = await ddbClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `SELLER#${sellerId}`,
          ':prefix': 'CAMPAIGN#',
        },
        Limit: 100,
      }),
    );
    return res.Items ?? [];
  } catch {
    return [];
  }
}

function formatINR(amount: number): string {
  if (amount >= 100000) {
    return `\u20B9${(amount / 100000).toFixed(1)}L`;
  }
  return `\u20B9${amount.toLocaleString('en-IN')}`;
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
