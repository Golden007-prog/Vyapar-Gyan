/**
 * Approval Edit & Approve Handler
 *
 * PUT /api/v1/seller/approvals/{id}/edit-approve — JWT-protected (seller role)
 *
 * Stores the original payload, saves the seller's modified payload,
 * transitions to "edited_approved", publishes ApprovalEditedApproved event,
 * and logs to audit.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import { getApproval } from '../../adapters/dynamodb-adapter';
import {
  transitionStatus,
  executeApproval,
  ApprovalNotFoundError,
  ApprovalForbiddenError,
} from '../../services/approval-service';
import { logAction } from '../../services/audit-service';

const EditApproveSchema = z.object({
  payload: z.record(z.unknown()),
});

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
    const parsed = EditApproveSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { payload: modifiedPayload } = parsed.data;

    // Fetch existing approval to capture original payload
    const existing = await getApproval(approvalId);
    if (!existing) {
      return response(404, { error: 'Approval not found' });
    }
    if (existing.sellerId !== sellerId) {
      return response(403, { error: 'Not authorized to edit this approval' });
    }

    const originalPayload = existing.payload;

    // Transition status to edited_approved
    await transitionStatus({
      approvalId,
      sellerId,
      newStatus: 'edited_approved',
      approvedBy: sellerId,
      originalPayload,
      payload: modifiedPayload,
    });

    // Publish ApprovalEditedApproved event for execution worker
    await executeApproval(approvalId, 'ApprovalEditedApproved', {
      approvalId,
      sellerId,
      originalPayload,
      payload: modifiedPayload,
    });

    // Audit log (fire-and-forget)
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'approval_edited_approved',
      resourceType: 'approval',
      resourceId: approvalId,
      approvalId,
      oldValues: { payload: originalPayload },
      newValues: { status: 'edited_approved', payload: modifiedPayload },
    });

    return response(200, {
      success: true,
      approvalId,
      status: 'edited_approved',
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
    logger.error('Approval edit-approve failed', error, { requestId });
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
