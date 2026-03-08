/**
 * Campaign Reach Handler
 *
 * POST /api/v1/seller/campaigns/estimate-reach — JWT-protected (seller role)
 *
 * Estimates audience count from the provided audience filters without
 * creating a campaign record. Used by the campaign composer UI to show
 * estimated reach before the seller confirms.
 *
 * Lambda config: 10s timeout, 256MB
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { estimateReach } from '../../services/campaign-service';

const EstimateReachSchema = z.object({
  audienceFilters: z.object({
    pastPurchasers: z.array(z.string()).optional(),
    cartAbandoners: z.boolean().optional(),
    highSpenders: z.boolean().optional(),
    categoryInterest: z.array(z.string()).optional(),
  }),
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);

    const body = JSON.parse(event.body ?? '{}');
    const parsed = EstimateReachSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, {
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    const filters = parsed.data.audienceFilters;
    const audienceFilters: import('../../adapters/dynamodb-adapter').AudienceFilters = {};
    if (filters.pastPurchasers) audienceFilters.pastPurchasers = filters.pastPurchasers;
    if (filters.cartAbandoners !== undefined) audienceFilters.cartAbandoners = filters.cartAbandoners;
    if (filters.highSpenders !== undefined) audienceFilters.highSpenders = filters.highSpenders;
    if (filters.categoryInterest) audienceFilters.categoryInterest = filters.categoryInterest;

    const reach = await estimateReach({
      sellerId,
      audienceFilters,
    });

    return response(200, {
      estimatedReach: reach,
      audienceFilters: parsed.data.audienceFilters,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    if (error instanceof SyntaxError) {
      return response(400, { error: 'Invalid JSON body' });
    }
    logger.error('Campaign reach estimation failed', error, { requestId });
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
