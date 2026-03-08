/**
 * Approval Reject Handler
 *
 * PUT /api/v1/seller/approvals/{id}/reject — JWT-protected (seller role)
 *
 * Transitions approval to "rejected", stores rejectionReason,
 * publishes ApprovalRejected event to EventBridge, and logs to audit.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { RejectSchema } from '../../shared/schemas';
import {
  transitionStatus,
  executeApproval,
  ApprovalNotFoundError,
  ApprovalForbiddenError,
} from '../../services/approval-service';
import { logAction } from '../../services/audit-service';
import { publishCountMetric } from '../../core/metrics';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    const sellerId = extractUserId(event);
    const approvalId = event.pathParameters?.id;

    if (!approvalId) {
      return response(400, { error: 'Approval ID is required' });
    }

    // Parse and validate request body
    const body = event.body ? JSON.parse(event.body) : {};
    const parsed = RejectSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { rejectionReason } = parsed.data;

    // Transition status to rejected
    await transitionStatus({
      approvalId,
      sellerId,
      newStatus: 'rejected',
      rejectionReason,
    });

    // Publish ApprovalRejected event
    await executeApproval(approvalId, 'ApprovalRejected', {
      approvalId,
      sellerId,
      rejectionReason,
    });

    // Audit log (fire-and-forget)
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'approval_rejected',
      resourceType: 'approval',
      resourceId: approvalId,
      approvalId,
      newValues: { status: 'rejected', rejectionReason },
    });

    return response(200, {
      success: true,
      approvalId,
      status: 'rejected',
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return response(401, { error: 'Unauthorized' });
    }
    if (error instanceof ApprovalNotFoundError) {
      return response(404, { error: error.message });
    }
    if (error instanceof ApprovalForbiddenError) {
      return response(403, { error: error.message });
    }
    logger.error('Approval reject failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  } finally {
    publishCountMetric('ApprovalActions', 1, { Action: 'reject' });
  }
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
