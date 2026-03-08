/**
 * Campaign Analytics Handler
 *
 * GET /api/v1/seller/campaigns/{id}/analytics — JWT-protected (seller role)
 *
 * Returns delivery, read, click-through, and conversion rates for a campaign.
 *
 * Lambda config: 10s timeout, 256MB
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getCampaign } from '../../adapters/dynamodb-adapter';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);
    const campaignId = event.pathParameters?.id;

    if (!campaignId) {
      return response(400, { error: 'Campaign ID is required' });
    }

    const campaign = await getCampaign(campaignId);
    if (!campaign) {
      return response(404, { error: `Campaign ${campaignId} not found` });
    }
    if (campaign.sellerId !== sellerId) {
      return response(403, { error: 'Not authorized to view this campaign' });
    }

    // Calculate rates — guard against division by zero
    const sent = campaign.sentCount || 0;
    const deliveryRate = sent > 0 ? (campaign.deliveredCount / sent) * 100 : 0;
    const readRate = sent > 0 ? (campaign.readCount / sent) * 100 : 0;
    const conversionRate = sent > 0 ? (campaign.conversionCount / sent) * 100 : 0;

    return response(200, {
      campaignId,
      status: campaign.status,
      metrics: {
        estimatedReach: campaign.estimatedReach,
        sentCount: campaign.sentCount,
        deliveredCount: campaign.deliveredCount,
        readCount: campaign.readCount,
        conversionCount: campaign.conversionCount,
      },
      rates: {
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        readRate: Math.round(readRate * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
      },
      executedAt: campaign.executedAt,
      scheduledAt: campaign.scheduledAt,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Campaign analytics fetch failed', error, { requestId });
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
