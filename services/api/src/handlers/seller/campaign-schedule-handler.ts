/**
 * Campaign Schedule Handler
 *
 * POST /api/v1/seller/campaigns/{id}/schedule — JWT-protected (seller role)
 *
 * Validates that the campaign has either active service windows for its
 * audience or a valid templateSid for out-of-window sends, then transitions
 * the campaign to "scheduled" and publishes a CampaignScheduled event.
 *
 * Lambda config: 10s timeout, 256MB
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getCampaign } from '../../adapters/dynamodb-adapter';
import { getTemplate } from '../../adapters/dynamodb-adapter';
import {
  scheduleCampaign,
  CampaignNotFoundError,
  CampaignForbiddenError,
} from '../../services/campaign-service';
import { logAction } from '../../services/audit-service';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);
    const campaignId = event.pathParameters?.id;

    if (!campaignId) {
      return response(400, { error: 'Campaign ID is required' });
    }

    // Fetch campaign to validate pre-conditions
    const campaign = await getCampaign(campaignId);
    if (!campaign) {
      return response(404, { error: `Campaign ${campaignId} not found` });
    }
    if (campaign.sellerId !== sellerId) {
      return response(403, { error: 'Not authorized to schedule this campaign' });
    }
    if (campaign.status !== 'draft') {
      return response(409, {
        error: `Campaign is already in "${campaign.status}" status`,
      });
    }

    // Validate: if a templateSid is specified, ensure it exists and is approved
    if (campaign.templateSid) {
      const template = await getTemplate(campaign.templateSid);
      if (!template) {
        return response(400, {
          error: `Template ${campaign.templateSid} not found in registry`,
        });
      }
      if (template.approvalStatus !== 'approved') {
        return response(400, {
          error: `Template ${campaign.templateSid} is not approved (status: ${template.approvalStatus})`,
        });
      }
    }

    // Schedule the campaign — publishes CampaignScheduled event
    const updated = await scheduleCampaign(campaignId, sellerId);

    // Audit log (fire-and-forget)
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'campaign_scheduled',
      resourceType: 'campaign',
      resourceId: campaignId,
      oldValues: { status: 'draft' },
      newValues: { status: 'scheduled', scheduledAt: updated.scheduledAt },
    });

    return response(200, {
      success: true,
      campaignId,
      status: 'scheduled',
      scheduledAt: updated.scheduledAt,
      estimatedReach: updated.estimatedReach,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    if (error instanceof CampaignNotFoundError) {
      return response(404, { error: error.message });
    }
    if (error instanceof CampaignForbiddenError) {
      return response(403, { error: error.message });
    }
    logger.error('Campaign scheduling failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  }
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
