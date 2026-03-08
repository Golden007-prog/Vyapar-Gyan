/**
 * Campaign Create Handler
 *
 * POST /api/v1/seller/campaigns — JWT-protected (seller role)
 *
 * Creates a new CAMPAIGN#{campaignId} record with audience filters.
 * Optionally links to an approvalId when originating from the approval flow.
 *
 * Lambda config: 10s timeout, 256MB
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { CreateCampaignSchema } from '../../shared/schemas';
import { createCampaign } from '../../services/campaign-service';
import { logAction } from '../../services/audit-service';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);

    // Parse and validate request body
    const body = JSON.parse(event.body ?? '{}');
    const parsed = CreateCampaignSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    const input = parsed.data;

    // Create campaign via service
    const campaign = await createCampaign({
      sellerId,
      approvalId: input.approvalId,
      messageText: input.messageText,
      templateSid: input.templateSid,
      audienceFilters: input.audienceFilters,
      scheduledAt: input.scheduledAt,
    });

    // Audit log (fire-and-forget)
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'campaign_created',
      resourceType: 'campaign',
      resourceId: campaign.campaignId,
      newValues: {
        status: campaign.status,
        estimatedReach: campaign.estimatedReach,
        hasApproval: !!input.approvalId,
      },
    });

    return response(201, {
      success: true,
      campaign: {
        campaignId: campaign.campaignId,
        status: campaign.status,
        estimatedReach: campaign.estimatedReach,
        messageText: campaign.messageText,
        audienceFilters: campaign.audienceFilters,
        scheduledAt: campaign.scheduledAt,
        createdAt: campaign.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON body' });
    }
    logger.error('Campaign creation failed', error, { requestId });
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
