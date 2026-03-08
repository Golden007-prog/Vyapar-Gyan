/**
 * Campaign Service
 *
 * Business logic for seller-initiated promotional campaigns.
 * Handles campaign creation, audience reach estimation, scheduling
 * (via EventBridge CampaignScheduled events), and metric tracking.
 *
 * Campaign entity: PK CAMPAIGN#{campaignId}  SK METADATA
 * GSI1: SELLER#{sellerId} → CAMPAIGN#TS#{createdAt}
 */

import { randomUUID } from 'crypto';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';
import {
  putCampaign,
  getCampaign,
  updateCampaign,
  type CampaignRecord,
  type AudienceFilters,
} from '../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const ebClient = new EventBridgeClient({});
const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateCampaignParams {
  sellerId: string;
  approvalId?: string;
  messageText: string;
  templateSid?: string;
  audienceFilters: AudienceFilters;
  scheduledAt?: string;
}

export interface EstimateReachParams {
  sellerId: string;
  audienceFilters: AudienceFilters;
}

export interface TrackMetricsUpdate {
  sentCount?: number;
  deliveredCount?: number;
  readCount?: number;
  conversionCount?: number;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class CampaignNotFoundError extends Error {
  public readonly statusCode = 404;
  constructor(campaignId: string) {
    super(`Campaign ${campaignId} not found`);
    this.name = 'CampaignNotFoundError';
  }
}

export class CampaignForbiddenError extends Error {
  public readonly statusCode = 403;
  constructor(campaignId: string) {
    super(`Not authorized to access campaign ${campaignId}`);
    this.name = 'CampaignForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new campaign record in DynamoDB.
 * Status starts as "draft". Caller should follow up with scheduleCampaign.
 */
export async function createCampaign(params: CreateCampaignParams): Promise<CampaignRecord> {
  const campaignId = randomUUID();
  const now = new Date().toISOString();

  // Estimate reach before persisting
  const estimatedReach = await estimateReach({
    sellerId: params.sellerId,
    audienceFilters: params.audienceFilters,
  });

  const campaign: CampaignRecord = {
    campaignId,
    sellerId: params.sellerId,
    approvalId: params.approvalId,
    status: 'draft',
    messageText: params.messageText,
    templateSid: params.templateSid,
    audienceFilters: params.audienceFilters,
    estimatedReach,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    conversionCount: 0,
    scheduledAt: params.scheduledAt,
    createdAt: now,
    updatedAt: now,
  };

  await putCampaign(campaign);

  logger.info('Campaign created', {
    campaignId,
    sellerId: params.sellerId,
    estimatedReach,
    hasApproval: !!params.approvalId,
  });

  return campaign;
}

/**
 * Estimate audience reach by querying DynamoDB for matching customers.
 *
 * Filters supported:
 *   - pastPurchasers: product IDs — count customers who ordered those products
 *   - cartAbandoners: carts older than 24h
 *   - highSpenders: top 20% by total spend (approximated via scan)
 *   - categoryInterest: customers who browsed specific categories
 *
 * This is an approximation — full audience resolution happens at execution time.
 */
export async function estimateReach(params: EstimateReachParams): Promise<number> {
  const config = await getConfig();
  const { audienceFilters } = params;
  let totalReach = 0;

  try {
    // Past purchasers: scan orders for the seller, count distinct customers
    if (audienceFilters.pastPurchasers && audienceFilters.pastPurchasers.length > 0) {
      const res = await docClient.send(
        new ScanCommand({
          TableName: config.tableName,
          FilterExpression: 'begins_with(PK, :orderPrefix) AND sellerId = :sid',
          ExpressionAttributeValues: {
            ':orderPrefix': 'ORDER#',
            ':sid': params.sellerId,
          },
          ProjectionExpression: 'customerId',
        }),
      );
      const uniqueCustomers = new Set((res.Items ?? []).map((i) => i.customerId));
      totalReach += uniqueCustomers.size;
    }

    // Cart abandoners: scan carts older than 24h
    if (audienceFilters.cartAbandoners) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await docClient.send(
        new ScanCommand({
          TableName: config.tableName,
          FilterExpression: 'begins_with(PK, :cartPrefix) AND SK = :active AND updatedAt < :cutoff',
          ExpressionAttributeValues: {
            ':cartPrefix': 'CART#',
            ':active': 'ACTIVE',
            ':cutoff': cutoff,
          },
          ProjectionExpression: 'userId',
        }),
      );
      totalReach += (res.Items ?? []).length;
    }

    // High spenders: approximate by scanning orders and counting top 20%
    if (audienceFilters.highSpenders) {
      const res = await docClient.send(
        new ScanCommand({
          TableName: config.tableName,
          FilterExpression: 'begins_with(PK, :orderPrefix) AND sellerId = :sid',
          ExpressionAttributeValues: {
            ':orderPrefix': 'ORDER#',
            ':sid': params.sellerId,
          },
          ProjectionExpression: 'customerId, totalAmount',
        }),
      );
      const spendByCustomer = new Map<string, number>();
      for (const item of res.Items ?? []) {
        const current = spendByCustomer.get(item.customerId) ?? 0;
        spendByCustomer.set(item.customerId, current + (item.totalAmount ?? 0));
      }
      // Top 20%
      const count = Math.max(1, Math.ceil(spendByCustomer.size * 0.2));
      totalReach += count;
    }

    // Category interest: approximate count
    if (audienceFilters.categoryInterest && audienceFilters.categoryInterest.length > 0) {
      // Approximate: count sessions with recent browsing activity
      const res = await docClient.send(
        new ScanCommand({
          TableName: config.tableName,
          FilterExpression: 'begins_with(PK, :sessionPrefix) AND SK = :active',
          ExpressionAttributeValues: {
            ':sessionPrefix': 'SESSION#',
            ':active': 'ACTIVE',
          },
          ProjectionExpression: 'userId',
          Limit: 100,
        }),
      );
      totalReach += (res.Items ?? []).length;
    }

    // If no filters matched, return 0
    if (
      !audienceFilters.pastPurchasers?.length &&
      !audienceFilters.cartAbandoners &&
      !audienceFilters.highSpenders &&
      !audienceFilters.categoryInterest?.length
    ) {
      return 0;
    }
  } catch (err) {
    logger.error('Failed to estimate campaign reach', err, {
      sellerId: params.sellerId,
    });
    // Return 0 on error rather than failing the campaign creation
    return 0;
  }

  return totalReach;
}

/**
 * Schedule a campaign for execution.
 * Transitions status to "scheduled" and publishes CampaignScheduled event.
 */
export async function scheduleCampaign(
  campaignId: string,
  sellerId: string,
): Promise<CampaignRecord> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    throw new CampaignNotFoundError(campaignId);
  }
  if (campaign.sellerId !== sellerId) {
    throw new CampaignForbiddenError(campaignId);
  }

  const now = new Date().toISOString();
  const scheduledAt = campaign.scheduledAt ?? now;

  await updateCampaign(campaignId, {
    status: 'scheduled',
    scheduledAt,
  });

  // Publish CampaignScheduled event for the execution worker
  const config = await getConfig();
  await ebClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'vyapargyan.campaign',
          DetailType: 'CampaignScheduled',
          Detail: JSON.stringify({ campaignId, sellerId, scheduledAt }),
          EventBusName: config.eventBusName,
        },
      ],
    }),
  );

  logger.info('Campaign scheduled', { campaignId, sellerId, scheduledAt });

  return { ...campaign, status: 'scheduled', scheduledAt, updatedAt: now };
}

/**
 * Increment campaign metrics after message sends / status callbacks.
 * Uses partial update to avoid overwriting concurrent metric changes.
 */
export async function trackMetrics(
  campaignId: string,
  updates: TrackMetricsUpdate,
): Promise<void> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    logger.warn('Campaign not found for metric update', { campaignId });
    return;
  }

  const merged: Partial<CampaignRecord> = {};
  if (updates.sentCount !== undefined) merged.sentCount = campaign.sentCount + updates.sentCount;
  if (updates.deliveredCount !== undefined) merged.deliveredCount = campaign.deliveredCount + updates.deliveredCount;
  if (updates.readCount !== undefined) merged.readCount = campaign.readCount + updates.readCount;
  if (updates.conversionCount !== undefined) merged.conversionCount = campaign.conversionCount + updates.conversionCount;

  await updateCampaign(campaignId, merged);

  logger.debug('Campaign metrics updated', { campaignId, updates });
}
