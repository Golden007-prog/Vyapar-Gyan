/**
 * Approval Execution Worker
 *
 * EventBridge-triggered Lambda that executes approved seller actions.
 * Consumes ApprovalApproved and ApprovalEditedApproved events.
 *
 * Supported action types:
 *   - discount / price_change → update product prices via TransactWriteItems
 *   - campaign → create campaign record and publish CampaignScheduled event
 *   - stock_alert → log notification (future: send seller WhatsApp alert)
 *   - reorder_suggestion → log for dashboard display
 *
 * After execution, transitions approval status to "executed" and logs to audit.
 *
 * Lambda config: timeout 60s, memory 512MB, triggered by EventBridge
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import {
  getApproval,
  updateApprovalStatus,
  putCampaign,
  type ApprovalRecord,
} from '../../adapters/dynamodb-adapter';
import { logAction } from '../../services/audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApprovalEventDetail {
  approvalId: string;
  sellerId: string;
  type?: ApprovalRecord['type'];
  payload?: Record<string, unknown>;
  originalPayload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const ebClient = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(
  event: EventBridgeEvent<'ApprovalApproved' | 'ApprovalEditedApproved', ApprovalEventDetail>,
): Promise<void> {
  const detail = event.detail;
  const detailType = event['detail-type'];

  logger.info('Approval execution worker processing', {
    approvalId: detail.approvalId,
    sellerId: detail.sellerId,
    detailType,
  });

  try {
    // Fetch the full approval record
    const approval = await getApproval(detail.approvalId);
    if (!approval) {
      logger.error('Approval not found for execution', undefined, {
        approvalId: detail.approvalId,
      });
      return;
    }

    // Skip if already executed
    if (approval.status === 'executed') {
      logger.info('Approval already executed — skipping', {
        approvalId: detail.approvalId,
      });
      return;
    }

    // Skip if scheduled for the future
    if (approval.scheduledFor && new Date(approval.scheduledFor) > new Date()) {
      logger.info('Approval scheduled for future — skipping', {
        approvalId: detail.approvalId,
        scheduledFor: approval.scheduledFor,
      });
      return;
    }

    // Use the payload from the event (may be edited) or fall back to approval record
    const payload = detail.payload ?? approval.payload;

    // Execute based on type
    switch (approval.type) {
      case 'discount':
      case 'price_change':
        await executePriceUpdate(approval, payload);
        break;
      case 'campaign':
        await executeCampaignCreation(approval, payload);
        break;
      case 'stock_alert':
        await executeStockAlert(approval, payload);
        break;
      case 'reorder_suggestion':
        await executeReorderSuggestion(approval, payload);
        break;
      default:
        logger.warn('Unknown approval type', { type: approval.type });
    }

    // Transition to executed
    await updateApprovalStatus(approval.approvalId, approval.sellerId, {
      status: 'executed',
    });

    // Audit log
    await logAction({
      actorId: 'system',
      actorRole: 'system',
      actionType: 'approval_executed',
      resourceType: 'approval',
      resourceId: approval.approvalId,
      approvalId: approval.approvalId,
      newValues: { status: 'executed', type: approval.type },
    });

    logger.info('Approval executed successfully', {
      approvalId: approval.approvalId,
      type: approval.type,
    });
  } catch (error) {
    logger.error('Approval execution failed', error, {
      approvalId: detail.approvalId,
    });
    // Don't rethrow — EventBridge will not retry by default
  }
}

// ---------------------------------------------------------------------------
// Action executors
// ---------------------------------------------------------------------------

/**
 * Update product prices via TransactWriteItems.
 * Payload expected: { products: [{ productId, newPrice, discountedPrice? }] }
 */
async function executePriceUpdate(
  approval: ApprovalRecord,
  payload: Record<string, unknown>,
): Promise<void> {
  const config = await getConfig();
  const products = (payload.products as Array<{
    productId: string;
    newPrice?: number;
    discountedPrice?: number;
  }>) ?? [];

  if (products.length === 0) {
    logger.warn('No products in price update payload', {
      approvalId: approval.approvalId,
    });
    return;
  }

  // TransactWriteItems supports up to 100 items per transaction
  const transactItems = products.map((p) => ({
    Update: {
      TableName: config.tableName,
      Key: {
        PK: `PRODUCT#${p.productId}`,
        SK: 'METADATA',
      },
      UpdateExpression: p.discountedPrice !== undefined
        ? 'SET price = :price, discountedPrice = :dp, updatedAt = :now'
        : 'SET price = :price, updatedAt = :now',
      ExpressionAttributeValues: {
        ':price': p.newPrice ?? p.discountedPrice,
        ...(p.discountedPrice !== undefined && { ':dp': p.discountedPrice }),
        ':now': new Date().toISOString(),
      },
    },
  }));

  await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

  logger.info('Product prices updated', {
    approvalId: approval.approvalId,
    productCount: products.length,
  });
}

/**
 * Create a campaign record and publish CampaignScheduled event.
 * Payload expected: { messageText, audienceFilters, templateSid?, scheduledAt? }
 */
async function executeCampaignCreation(
  approval: ApprovalRecord,
  payload: Record<string, unknown>,
): Promise<void> {
  const config = await getConfig();
  const campaignId = randomUUID();
  const now = new Date().toISOString();

  await putCampaign({
    campaignId,
    sellerId: approval.sellerId,
    approvalId: approval.approvalId,
    status: 'scheduled',
    messageText: (payload.messageText as string) ?? '',
    ...(payload.templateSid ? { templateSid: payload.templateSid as string } : {}),
    audienceFilters: (payload.audienceFilters as any) ?? {},
    estimatedReach: 0,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
    conversionCount: 0,
    scheduledAt: (payload.scheduledAt as string) ?? now,
    createdAt: now,
    updatedAt: now,
  });

  // Publish CampaignScheduled event
  await ebClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'vyapargyan.campaign',
          DetailType: 'CampaignScheduled',
          Detail: JSON.stringify({
            campaignId,
            sellerId: approval.sellerId,
            scheduledAt: (payload.scheduledAt as string) ?? now,
          }),
          EventBusName: config.eventBusName,
        },
      ],
    }),
  );

  logger.info('Campaign created from approval', {
    approvalId: approval.approvalId,
    campaignId,
  });
}

/**
 * Handle stock alert execution — log for now, future: send seller notification.
 */
async function executeStockAlert(
  approval: ApprovalRecord,
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info('Stock alert executed', {
    approvalId: approval.approvalId,
    sellerId: approval.sellerId,
    affectedProducts: approval.affectedProductIds,
    payload,
  });
}

/**
 * Handle reorder suggestion execution — log for dashboard display.
 */
async function executeReorderSuggestion(
  approval: ApprovalRecord,
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info('Reorder suggestion executed', {
    approvalId: approval.approvalId,
    sellerId: approval.sellerId,
    affectedProducts: approval.affectedProductIds,
    payload,
  });
}
