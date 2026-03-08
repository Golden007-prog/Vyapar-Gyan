/**
 * Approvals List Handler
 *
 * GET /api/v1/seller/approvals — JWT-protected (seller role)
 *
 * Queries GSI1 SELLER#{sellerId} filtered by status, returns results
 * sorted by priorityScore descending with cursor-based pagination.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { ApprovalsQuerySchema } from '../../shared/schemas';
import { getApprovalsBySeller } from '../../services/approval-service';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);

    // Validate query params
    const parsed = ApprovalsQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { status, limit, cursor } = parsed.data;

    const result = await getApprovalsBySeller({ sellerId, status, limit, cursor });

    // Sort by priorityScore descending (GSI1 sorts by status+timestamp, not priority)
    result.approvals.sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));

    return response(200, {
      approvals: result.approvals.map(a => ({
        approvalId: a.approvalId,
        type: a.type,
        status: a.status,
        aiRationale: a.aiRationale.length > 100 ? a.aiRationale.slice(0, 100) + '…' : a.aiRationale,
        estimatedImpact: a.estimatedImpact,
        affectedProductCount: a.affectedProductIds.length,
        priorityScore: a.priorityScore,
        createdAt: a.createdAt,
      })),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Approvals list failed', error, { requestId });
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
