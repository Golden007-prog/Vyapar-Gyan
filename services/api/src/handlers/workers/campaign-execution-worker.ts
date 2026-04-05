/**
 * Campaign Execution Worker
 *
 * EventBridge-triggered Lambda that sends campaign messages to targeted
 * customers. Consumes CampaignScheduled events from vyapargyan.campaign.
 *
 * For each audience member the worker:
 *   1. Checks consent (opt-out, frequency cap, quiet hours) via ConsentService
 *   2. Creates an idempotency key IDEMPOTENCY#{campaignId}#{userId} to prevent
 *      duplicate sends on retry
 *   3. Sends via TwilioAdapter (template if no service window, free-form if within)
 *   4. Increments promotional message counter
 *   5. Updates campaign metrics (sentCount, deliveredCount, etc.)
 *
 * Coexists with the existing campaign-worker.ts (DynamoDB Streams on INSIGHT#
 * items) per design Section 6.5. This worker handles the approval-engine flow.
 *
 * Lambda config: 300s timeout, 1024MB, EventBridge triggered
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import {
  getCampaign,
  updateCampaign,
  type CampaignRecord,
} from '../../adapters/dynamodb-adapter';
import {
  checkSendPermission,
  incrementPromotionalCount,
} from '../../services/consent-service';
import { trackMetrics, dispatchCampaign, type DispatchTarget } from '../../services/campaign-service';
import { logAction } from '../../services/audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CampaignScheduledDetail {
  campaignId: string;
  sellerId: string;
  scheduledAt: string;
  channel?: 'web' | 'whatsapp' | 'both'; // omnichannel dispatch (defaults to 'whatsapp')
}

interface AudienceMember {
  userId: string;
  phoneNumber?: string;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: EventBridgeEvent<'CampaignScheduled', CampaignScheduledDetail>,
): Promise<void> {
  const { campaignId, sellerId, channel: dispatchChannel } = event.detail;
  const channel = dispatchChannel ?? 'whatsapp'; // default to whatsapp for backward compat

  logger.info('Campaign execution worker started', { campaignId, sellerId, channel });

  try {
    const campaign = await getCampaign(campaignId);
    if (!campaign) {
      logger.error('Campaign not found', undefined, { campaignId });
      return;
    }

    // Skip if already sent or sending
    if (campaign.status === 'sent' || campaign.status === 'sending') {
      logger.info('Campaign already processed — skipping', {
        campaignId,
        status: campaign.status,
      });
      return;
    }

    // Transition to sending
    await updateCampaign(campaignId, { status: 'sending' });

    // Resolve audience
    const audience = await resolveAudience(campaign);
    logger.info('Audience resolved', {
      campaignId,
      audienceSize: audience.length,
    });

    // Filter audience through consent checks
    const eligibleTargets: DispatchTarget[] = [];
    let skippedCount = 0;

    for (const member of audience) {
      try {
        // Idempotency check — prevent duplicate sends on retry
        const alreadySent = await checkIdempotency(campaignId, member.userId);
        if (alreadySent) {
          logger.debug('Skipping duplicate send', { campaignId, userId: member.userId });
          continue;
        }

        // Consent check (opt-out, frequency cap, quiet hours)
        const permission = await checkSendPermission(member.userId, 'promotional');
        if (!permission.allowed) {
          logger.debug('Send blocked by consent', {
            campaignId,
            userId: member.userId,
            reason: permission.reason,
          });
          skippedCount++;
          continue;
        }

        // Record idempotency key
        await recordIdempotency(campaignId, member.userId);

        // Increment promotional counter for frequency cap
        await incrementPromotionalCount(member.userId);

        eligibleTargets.push({
          userId: member.userId,
          ...(member.phoneNumber ? { phoneNumber: member.phoneNumber } : {}),
        });
      } catch (err) {
        logger.error('Failed consent check for user', err, {
          campaignId,
          userId: member.userId,
        });
      }
    }

    // Dispatch via omnichannel dispatcher
    const { sentWeb, sentWhatsApp, failed: failedCount } = await dispatchCampaign(
      campaignId,
      channel,
      eligibleTargets,
    );

    const totalSent = sentWeb + sentWhatsApp;

    // Update campaign metrics and status
    const finalStatus = failedCount > 0 && totalSent === 0 ? 'failed' : 'sent';
    await updateCampaign(campaignId, {
      status: finalStatus,
      sentCount: totalSent,
      executedAt: new Date().toISOString(),
    });

    // Also update via trackMetrics for consistency
    if (totalSent > 0) {
      await trackMetrics(campaignId, { sentCount: totalSent });
    }

    // Audit log
    await logAction({
      actorId: 'system',
      actorRole: 'system',
      actionType: 'campaign_executed',
      resourceType: 'campaign',
      resourceId: campaignId,
      newValues: {
        status: finalStatus,
        channel,
        sentWeb,
        sentWhatsApp,
        skippedCount,
        failedCount,
        audienceSize: audience.length,
      },
    });

    logger.info('Campaign execution completed', {
      campaignId,
      channel,
      sentWeb,
      sentWhatsApp,
      skippedCount,
      failedCount,
      status: finalStatus,
    });
  } catch (error) {
    logger.error('Campaign execution worker failed', error, { campaignId });

    // Mark campaign as failed
    try {
      await updateCampaign(campaignId, { status: 'failed' });
    } catch {
      // Best-effort status update
    }
  }
}

// ---------------------------------------------------------------------------
// Audience resolution
// ---------------------------------------------------------------------------

/**
 * Resolve audience members from campaign filters.
 * Queries DynamoDB for matching customers based on the audience filters.
 */
async function resolveAudience(campaign: CampaignRecord): Promise<AudienceMember[]> {
  const config = await getConfig();
  const filters = campaign.audienceFilters;
  const memberMap = new Map<string, AudienceMember>();

  // Past purchasers: find customers who ordered from this seller
  if (filters.pastPurchasers && filters.pastPurchasers.length > 0) {
    const res = await docClient.send(
      new ScanCommand({
        TableName: config.tableName,
        FilterExpression: 'begins_with(PK, :orderPrefix) AND sellerId = :sid',
        ExpressionAttributeValues: {
          ':orderPrefix': 'ORDER#',
          ':sid': campaign.sellerId,
        },
        ProjectionExpression: 'customerId',
      }),
    );
    for (const item of res.Items ?? []) {
      if (item.customerId && !memberMap.has(item.customerId)) {
        memberMap.set(item.customerId, { userId: item.customerId });
      }
    }
  }

  // Cart abandoners: carts older than 24h
  if (filters.cartAbandoners) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await docClient.send(
      new ScanCommand({
        TableName: config.tableName,
        FilterExpression:
          'begins_with(PK, :cartPrefix) AND SK = :active AND updatedAt < :cutoff',
        ExpressionAttributeValues: {
          ':cartPrefix': 'CART#',
          ':active': 'ACTIVE',
          ':cutoff': cutoff,
        },
        ProjectionExpression: 'userId',
      }),
    );
    for (const item of res.Items ?? []) {
      if (item.userId && !memberMap.has(item.userId)) {
        memberMap.set(item.userId, { userId: item.userId });
      }
    }
  }

  // High spenders: top 20% by total spend for this seller
  if (filters.highSpenders) {
    const res = await docClient.send(
      new ScanCommand({
        TableName: config.tableName,
        FilterExpression: 'begins_with(PK, :orderPrefix) AND sellerId = :sid',
        ExpressionAttributeValues: {
          ':orderPrefix': 'ORDER#',
          ':sid': campaign.sellerId,
        },
        ProjectionExpression: 'customerId, totalAmount',
      }),
    );
    const spendByCustomer = new Map<string, number>();
    for (const item of res.Items ?? []) {
      if (!item.customerId) continue;
      const current = spendByCustomer.get(item.customerId) ?? 0;
      spendByCustomer.set(item.customerId, current + (item.totalAmount ?? 0));
    }
    // Sort by spend descending, take top 20%
    const sorted = [...spendByCustomer.entries()].sort((a, b) => b[1] - a[1]);
    const top20Count = Math.max(1, Math.ceil(sorted.length * 0.2));
    for (let i = 0; i < top20Count && i < sorted.length; i++) {
      const entry = sorted[i];
      if (!entry) continue;
      const cid = entry[0];
      if (!memberMap.has(cid)) {
        memberMap.set(cid, { userId: cid });
      }
    }
  }

  // Category interest: sessions with recent activity
  if (filters.categoryInterest && filters.categoryInterest.length > 0) {
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
    for (const item of res.Items ?? []) {
      if (item.userId && !memberMap.has(item.userId)) {
        memberMap.set(item.userId, { userId: item.userId });
      }
    }
  }

  // Enrich with phone numbers from USER profiles
  const members = [...memberMap.values()];
  for (const member of members) {
    try {
      const userRes = await docClient.send(
        new ScanCommand({
          TableName: config.tableName,
          FilterExpression: 'PK = :pk AND SK = :sk',
          ExpressionAttributeValues: {
            ':pk': `USER#${member.userId}`,
            ':sk': 'PROFILE',
          },
          ProjectionExpression: 'phoneNumber',
          Limit: 1,
        }),
      );
      const profile = userRes.Items?.[0];
      if (profile?.phoneNumber) {
        member.phoneNumber = profile.phoneNumber;
      }
    } catch {
      // Skip users we can't resolve
    }
  }

  return members.filter((m) => !!m.phoneNumber);
}

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

/**
 * Check if a campaign message was already sent to this user.
 * Returns true if the idempotency key exists (already sent).
 */
async function checkIdempotency(campaignId: string, userId: string): Promise<boolean> {
  const config = await getConfig();
  try {
    await rawClient.send(
      new PutItemCommand({
        TableName: config.tableName,
        Item: marshall({
          PK: `IDEMPOTENCY#${campaignId}#${userId}`,
          SK: 'PROCESSED',
          processedAt: new Date().toISOString(),
          expiresAt: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7-day TTL
        }),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    // Key didn't exist — this is a new send
    return false;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      // Key already exists — duplicate
      return true;
    }
    throw err;
  }
}

/**
 * Record that a campaign message was sent to this user.
 * This is a no-op if checkIdempotency already wrote the key (which it does).
 */
async function recordIdempotency(
  _campaignId: string,
  _userId: string,
): Promise<void> {
  // checkIdempotency already writes the key via conditional put.
  // This function exists for clarity in the send flow.
}
