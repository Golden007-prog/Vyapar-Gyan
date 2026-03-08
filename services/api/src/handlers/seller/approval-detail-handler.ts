/**
 * Approval Detail Handler
 *
 * GET /api/v1/seller/approvals/{id} — JWT-protected (seller role)
 *
 * Returns the full approval record with affected products,
 * current vs proposed values, and AI rationale.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getApproval } from '../../adapters/dynamodb-adapter';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);
    const approvalId = event.pathParameters?.id;

    if (!approvalId) {
      return response(400, { error: 'Approval ID is required' });
    }

    const approval = await getApproval(approvalId);

    if (!approval) {
      return response(404, { error: 'Approval not found' });
    }

    if (approval.sellerId !== sellerId) {
      return response(403, { error: 'Not authorized to view this approval' });
    }

    return response(200, {
      approval: {
        approvalId: approval.approvalId,
        sellerId: approval.sellerId,
        type: approval.type,
        status: approval.status,
        payload: approval.payload,
        originalPayload: approval.originalPayload ?? null,
        aiRationale: approval.aiRationale,
        estimatedImpact: approval.estimatedImpact,
        affectedProductIds: approval.affectedProductIds,
        priorityScore: approval.priorityScore,
        approvedAt: approval.approvedAt ?? null,
        approvedBy: approval.approvedBy ?? null,
        rejectionReason: approval.rejectionReason ?? null,
        scheduledFor: approval.scheduledFor ?? null,
        createdAt: approval.createdAt,
        updatedAt: approval.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    logger.error('Approval detail failed', error, { requestId });
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
