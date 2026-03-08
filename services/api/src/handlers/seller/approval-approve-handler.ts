/**
 * Approval Approve Handler
 *
 * PUT /api/v1/seller/approvals/{id}/approve — JWT-protected (seller role)
 *
 * Transitions approval to "approved", sets approvedAt/approvedBy,
 * publishes ApprovalApproved event to EventBridge, and logs to audit.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
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

    // Transition status to approved
    const updated = await transitionStatus({
      approvalId,
      sellerId,
      newStatus: 'approved',
      approvedBy: sellerId,
    });

    // Publish ApprovalApproved event for execution worker
    await executeApproval(approvalId, 'ApprovalApproved', {
      approvalId,
      sellerId,
      type: updated.type,
      payload: updated.payload,
    });

    // Audit log (fire-and-forget)
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'approval_approved',
      resourceType: 'approval',
      resourceId: approvalId,
      approvalId,
      newValues: { status: 'approved', approvedBy: sellerId },
    });

    return response(200, {
      success: true,
      approvalId,
      status: 'approved',
      executionTriggered: true,
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
    logger.error('Approval approve failed', error, { requestId });
    return response(500, { error: 'Internal server error' });
  } finally {
    publishCountMetric('ApprovalActions', 1, { Action: 'approve' });
  }
}

function response(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
