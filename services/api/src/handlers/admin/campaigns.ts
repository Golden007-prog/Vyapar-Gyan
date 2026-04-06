import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, ScanCommand, QueryCommand, UpdateItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { randomUUID } from 'crypto';

const dynamoDBClient = new DynamoDBClient({});

// --- Types ---

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'flagged' | 'blocked';

export interface AdminCampaignRecord {
  campaignId: string;
  sellerId: string;
  sellerName: string;
  approvalId?: string;
  status: CampaignStatus;
  messageText: string;
  templateSid?: string;
  estimatedReach: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  conversionCount: number;
  revenueImpact: number;
  channel?: string;
  scheduledAt?: string;
  executedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryLogEntry {
  customerId: string;
  channel: string;
  sentAt: string;
  deliveredAt?: string;
  readAt?: string;
  convertedAt?: string;
  status: string;
}

interface AggregateMetrics {
  totalCampaigns30d: number;
  avgOpenRate: number;
  avgConversionRate: number;
  totalRevenue: number;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Admin Campaigns Handler
 *
 * Routes:
 *   GET  /admin/campaigns              — all campaigns across all sellers with filters
 *   GET  /admin/campaigns/{id}         — per-customer delivery log
 *   POST /admin/campaigns/{id}/flag    — flag underperforming campaign
 *   POST /admin/campaigns/{id}/block   — block campaign
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Admin campaigns request', {
    requestId,
    method: event.httpMethod,
    path: event.path,
    pathParams: event.pathParameters,
  });

  try {
    const userRole = extractUserRole(event);
    if (userRole !== 'admin') {
      return respond(403, { error: 'Forbidden', message: 'Admin access required' });
    }

    const campaignId = event.pathParameters?.id;
    const method = event.httpMethod;
    const path = event.path || '';

    // POST /admin/campaigns/{id}/flag
    if (method === 'POST' && campaignId && path.endsWith('/flag')) {
      return await handleFlagCampaign(campaignId, event);
    }

    // POST /admin/campaigns/{id}/block
    if (method === 'POST' && campaignId && path.endsWith('/block')) {
      return await handleBlockCampaign(campaignId, event);
    }

    // GET /admin/campaigns/{id}
    if (method === 'GET' && campaignId) {
      return await handleGetCampaignDetail(campaignId);
    }

    // GET /admin/campaigns
    if (method === 'GET') {
      return await handleListCampaigns(event);
    }

    return respond(404, { error: 'Not Found' });
  } catch (error) {
    logger.error('Admin campaigns handler error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return respond(500, { error: 'Internal Server Error', message: 'Failed to process request' });
  }
};

// ========================================================================
// List Campaigns
// ========================================================================

async function handleListCampaigns(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const sellerFilter = qs.seller ?? '';
  const channelFilter = qs.channel ?? '';
  const statusFilter = qs.status as CampaignStatus | undefined;
  const dateFrom = qs.date_from ?? '';
  const dateTo = qs.date_to ?? '';
  const page = Math.max(1, parseInt(qs.page || '1', 10));
  const size = Math.min(100, Math.max(1, parseInt(qs.size || '20', 10)));

  const config = await getConfig();
  const tableName = config.tableName;

  let campaigns = await scanCampaigns(tableName);

  // Enrich with seller names
  campaigns = await enrichCampaignsWithSellerNames(tableName, campaigns);

  // Apply filters
  let filtered = campaigns;
  if (sellerFilter) {
    filtered = filtered.filter((c) => c.sellerId === sellerFilter);
  }
  if (channelFilter) {
    filtered = filtered.filter((c) => c.channel === channelFilter);
  }
  if (statusFilter) {
    filtered = filtered.filter((c) => c.status === statusFilter);
  }
  if (dateFrom) {
    filtered = filtered.filter((c) => c.createdAt >= dateFrom);
  }
  if (dateTo) {
    filtered = filtered.filter((c) => c.createdAt <= dateTo);
  }

  // Sort by createdAt descending
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Compute aggregate metrics (last 30 days)
  const metrics = computeAggregateMetrics(campaigns);

  // Paginate
  const start = (page - 1) * size;
  const pageItems = filtered.slice(start, start + size);

  return respond(200, {
    campaigns: pageItems,
    metrics,
    total: filtered.length,
    page,
    size,
    totalPages: Math.ceil(filtered.length / size),
  });
}

// ========================================================================
// Campaign Detail (delivery log)
// ========================================================================

async function handleGetCampaignDetail(campaignId: string): Promise<APIGatewayProxyResult> {
  const config = await getConfig();
  const tableName = config.tableName;

  const campaign = await getCampaign(tableName, campaignId);
  if (!campaign) {
    return respond(404, { error: 'Not Found', message: 'Campaign not found' });
  }

  // Get seller name
  const sellerName = await getUserDisplayName(tableName, campaign.sellerId);

  // Get per-customer delivery log
  const deliveries = await queryCampaignDeliveries(tableName, campaignId);

  return respond(200, {
    campaign: { ...campaign, sellerName },
    deliveries,
  });
}

// ========================================================================
// Flag Campaign
// ========================================================================

async function handleFlagCampaign(
  campaignId: string,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const config = await getConfig();
  const tableName = config.tableName;

  const campaign = await getCampaign(tableName, campaignId);
  if (!campaign) {
    return respond(404, { error: 'Not Found', message: 'Campaign not found' });
  }

  if (campaign.status === 'blocked') {
    return respond(409, { error: 'Conflict', message: 'Campaign is already blocked' });
  }

  const body = JSON.parse(event.body || '{}');
  const reason = body.reason || 'Flagged by admin for low performance';
  const now = new Date().toISOString();

  await updateCampaignStatus(tableName, campaignId, 'flagged', now);

  const adminId = extractUserId(event) || 'admin';
  await writeAuditLog(tableName, {
    actorId: adminId,
    actionType: 'campaign.flagged',
    resourceType: 'CAMPAIGN',
    resourceId: campaignId,
    newValues: { status: 'flagged', reason },
  });

  return respond(200, {
    message: 'Campaign flagged',
    campaign: { campaignId, status: 'flagged' },
  });
}

// ========================================================================
// Block Campaign
// ========================================================================

async function handleBlockCampaign(
  campaignId: string,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const config = await getConfig();
  const tableName = config.tableName;

  const campaign = await getCampaign(tableName, campaignId);
  if (!campaign) {
    return respond(404, { error: 'Not Found', message: 'Campaign not found' });
  }

  const body = JSON.parse(event.body || '{}');
  const reason = body.reason || 'Blocked by admin';
  const now = new Date().toISOString();

  await updateCampaignStatus(tableName, campaignId, 'blocked', now);

  const adminId = extractUserId(event) || 'admin';
  await writeAuditLog(tableName, {
    actorId: adminId,
    actionType: 'campaign.blocked',
    resourceType: 'CAMPAIGN',
    resourceId: campaignId,
    newValues: { status: 'blocked', reason },
  });

  return respond(200, {
    message: 'Campaign blocked',
    campaign: { campaignId, status: 'blocked' },
  });
}

// ========================================================================
// Aggregate Metrics
// ========================================================================

function computeAggregateMetrics(campaigns: AdminCampaignRecord[]): AggregateMetrics {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recent = campaigns.filter((c) => c.createdAt >= thirtyDaysAgo);

  const totalCampaigns30d = recent.length;
  let totalOpenRate = 0;
  let totalConversionRate = 0;
  let totalRevenue = 0;
  let rateCount = 0;

  for (const c of recent) {
    totalRevenue += c.revenueImpact;
    if (c.sentCount > 0) {
      totalOpenRate += c.readCount / c.sentCount;
      totalConversionRate += c.conversionCount / c.sentCount;
      rateCount++;
    }
  }

  return {
    totalCampaigns30d,
    avgOpenRate: rateCount > 0 ? Math.round((totalOpenRate / rateCount) * 10000) / 100 : 0,
    avgConversionRate: rateCount > 0 ? Math.round((totalConversionRate / rateCount) * 10000) / 100 : 0,
    totalRevenue: Math.round(totalRevenue),
  };
}

// ========================================================================
// DynamoDB Helpers
// ========================================================================

async function scanCampaigns(tableName: string): Promise<AdminCampaignRecord[]> {
  const campaigns: AdminCampaignRecord[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const res = await dynamoDBClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
        ExpressionAttributeValues: {
          ':prefix': { S: 'CAMPAIGN#' },
          ':sk': { S: 'METADATA' },
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const rec = unmarshall(item);
      campaigns.push(mapToCampaignRecord(rec));
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return campaigns;
}

async function getCampaign(tableName: string, campaignId: string): Promise<AdminCampaignRecord | null> {
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `CAMPAIGN#${campaignId}` },
        ':sk': { S: 'METADATA' },
      },
      Limit: 1,
    }),
  );
  if (!res.Items || res.Items.length === 0) return null;
  return mapToCampaignRecord(unmarshall(res.Items![0]!));
}

function mapToCampaignRecord(rec: Record<string, any>): AdminCampaignRecord {
  const sentCount = rec.sentCount || 0;
  const conversionCount = rec.conversionCount || 0;
  // Estimate revenue impact from conversion count (avg order value heuristic)
  const revenueImpact = rec.revenueImpact || conversionCount * 500;

  return {
    campaignId: rec.campaignId || rec.PK?.replace('CAMPAIGN#', '') || '',
    sellerId: rec.sellerId || '',
    sellerName: rec.sellerName || '',
    approvalId: rec.approvalId,
    status: rec.status || 'draft',
    messageText: rec.messageText || '',
    templateSid: rec.templateSid,
    estimatedReach: rec.estimatedReach || 0,
    sentCount,
    deliveredCount: rec.deliveredCount || 0,
    readCount: rec.readCount || 0,
    conversionCount,
    revenueImpact,
    channel: rec.channel || 'whatsapp',
    scheduledAt: rec.scheduledAt,
    executedAt: rec.executedAt,
    createdAt: rec.createdAt || '',
    updatedAt: rec.updatedAt || rec.createdAt || '',
  };
}

async function queryCampaignDeliveries(tableName: string, campaignId: string): Promise<DeliveryLogEntry[]> {
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `CAMPAIGN#${campaignId}` },
        ':prefix': { S: 'DELIVERY#' },
      },
      Limit: 200,
    }),
  );

  return (res.Items ?? []).map((item) => {
    const rec = unmarshall(item);
    return {
      customerId: rec.customerId || '',
      channel: rec.channel || 'whatsapp',
      sentAt: rec.sentAt || '',
      deliveredAt: rec.deliveredAt,
      readAt: rec.readAt,
      convertedAt: rec.convertedAt,
      status: rec.status || 'sent',
    };
  });
}

async function enrichCampaignsWithSellerNames(
  tableName: string,
  campaigns: AdminCampaignRecord[],
): Promise<AdminCampaignRecord[]> {
  const cache = new Map<string, string>();

  const getName = async (sellerId: string): Promise<string> => {
    if (!sellerId) return 'Unknown';
    if (cache.has(sellerId)) return cache.get(sellerId)!;
    const name = await getUserDisplayName(tableName, sellerId);
    cache.set(sellerId, name);
    return name;
  };

  const enriched: AdminCampaignRecord[] = [];
  for (const c of campaigns) {
    enriched.push({ ...c, sellerName: c.sellerName || await getName(c.sellerId) });
  }
  return enriched;
}

async function getUserDisplayName(tableName: string, userId: string): Promise<string> {
  if (!userId) return 'Unknown';
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':sk': { S: 'PROFILE' },
      },
      ProjectionExpression: 'displayName, businessName',
      Limit: 1,
    }),
  );
  if (!res.Items || res.Items.length === 0) return 'Unknown';
  const rec = unmarshall(res.Items![0]!);
  return rec.businessName || rec.displayName || 'Unknown';
}

async function updateCampaignStatus(
  tableName: string,
  campaignId: string,
  status: CampaignStatus,
  updatedAt: string,
): Promise<void> {
  await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ PK: `CAMPAIGN#${campaignId}`, SK: 'METADATA' }),
      UpdateExpression: 'SET #status = :s, updatedAt = :u',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({ ':s': status, ':u': updatedAt }),
    }),
  );
}

async function writeAuditLog(
  tableName: string,
  params: {
    actorId: string;
    actionType: string;
    resourceType: string;
    resourceId: string;
    newValues?: Record<string, unknown>;
  },
): Promise<void> {
  const auditId = randomUUID();
  const now = new Date().toISOString();

  await dynamoDBClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: marshall(
        {
          PK: `AUDIT#${auditId}`,
          SK: `TS#${now}`,
          GSI1PK: `ACTOR#${params.actorId}`,
          GSI1SK: `TS#${now}`,
          GSI2PK: `RESOURCE#${params.resourceType}#${params.resourceId}`,
          GSI2SK: `TS#${now}`,
          auditId,
          actorId: params.actorId,
          actorRole: 'admin',
          actionType: params.actionType,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          newValues: params.newValues,
          createdAt: now,
        },
        { removeUndefinedValues: true },
      ),
    }),
  );
}

// ========================================================================
// Utilities
// ========================================================================

function extractUserRole(event: APIGatewayProxyEvent): string | null {
  const authCtx = event.requestContext.authorizer;
  if (authCtx) {
    const claims = authCtx.claims || authCtx;
    if (claims['cognito:groups']) {
      const groups = claims['cognito:groups'];
      if (typeof groups === 'string' && groups.includes('admin')) return 'admin';
      if (Array.isArray(groups) && groups.includes('admin')) return 'admin';
    }
    if (claims['custom:role']) return claims['custom:role'];
  }
  const roleHeader = event.headers['x-user-role'] || event.headers['X-User-Role'];
  return roleHeader ?? null;
}

function extractUserId(event: APIGatewayProxyEvent): string | null {
  const authCtx = event.requestContext.authorizer;
  if (authCtx) {
    const claims = authCtx.claims || authCtx;
    if (claims.sub) return claims.sub;
  }
  return event.headers['x-user-id'] || event.headers['X-User-Id'] || null;
}

function respond(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
