/**
 * Campaign Send (Dispatch) Handler
 *
 * POST /api/v1/seller/campaigns/{id}/send — JWT-protected (seller role)
 *
 * Creates a campaign from an insight approval, dispatches notifications
 * to selected customers via chosen channel(s) (web, whatsapp, or both).
 *
 * Request body:
 * {
 *   channel: 'web' | 'whatsapp' | 'both',
 *   targets: [{ userId: string, phoneNumber?: string }],
 *   messageText: string,
 *   insightId?: string
 * }
 *
 * Lambda config: 30s timeout, 512MB (needs time for Twilio + DynamoDB fan-out)
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import {
  createCampaign,
  dispatchCampaign,
  trackMetrics,
} from '../../services/campaign-service';
import { updateCampaign } from '../../adapters/dynamodb-adapter';
import { logAction } from '../../services/audit-service';

// Validation schema for send request
const CampaignSendSchema = z.object({
  channel: z.enum(['web', 'whatsapp', 'both']),
  targets: z.array(
    z.object({
      userId: z.string().min(1),
      phoneNumber: z.string().optional(),
    }),
  ).min(1),
  messageText: z.string().min(1).max(4096),
  insightId: z.string().optional(),
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);

    // Parse and validate request body
    const body = JSON.parse(event.body ?? '{}');
    const parsed = CampaignSendSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    const { channel, targets, messageText, insightId } = parsed.data;

    // Create campaign record
    const campaign = await createCampaign({
      sellerId,
      messageText,
      ...(insightId ? { approvalId: insightId } : {}),
      audienceFilters: { pastPurchasers: targets.map(t => t.userId) },
    });

    // Dispatch to selected channels — map targets to DispatchTarget with required phoneNumber
    const dispatchTargets = targets.map(t => ({
      userId: t.userId,
      ...(t.phoneNumber ? { phoneNumber: t.phoneNumber } : {}),
    }));
    const result = await dispatchCampaign(campaign.campaignId, channel, dispatchTargets as any);

    // Update campaign status to 'sent'
    const totalSent = result.sentWeb + result.sentWhatsApp;
    await updateCampaign(campaign.campaignId, {
      status: 'sent',
      sentCount: totalSent,
    });

    // Track metrics
    await trackMetrics(campaign.campaignId, { sentCount: totalSent });

    // Audit log
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'campaign_sent',
      resourceType: 'campaign',
      resourceId: campaign.campaignId,
      newValues: {
        channel,
        targetCount: targets.length,
        sentWeb: result.sentWeb,
        sentWhatsApp: result.sentWhatsApp,
        failed: result.failed,
        insightId: insightId ?? null,
      },
    });

    logger.info('Campaign sent successfully', {
      requestId,
      campaignId: campaign.campaignId,
      sellerId,
      channel,
      sentWeb: result.sentWeb,
      sentWhatsApp: result.sentWhatsApp,
      failed: result.failed,
    });

    return response(200, {
      success: true,
      campaignId: campaign.campaignId,
      sentWeb: result.sentWeb,
      sentWhatsApp: result.sentWhatsApp,
      failed: result.failed,
      totalSent,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON body' });
    }
    logger.error('Campaign send failed', error, { requestId });
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
