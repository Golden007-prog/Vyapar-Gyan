/**
 * Approval Schedule Handler
 *
 * PUT /api/v1/seller/approvals/{id}/schedule — JWT-protected (seller role)
 *
 * Sets scheduledFor timestamp and transitions approval to "approved"
 * with a deferred execution date. The execution worker will pick it up
 * when the scheduled time arrives.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { extractUserId, UnauthorizedError } from '../../core/auth';
import {
  transitionStatus,
  ApprovalNotFoundError,
  ApprovalForbiddenError,
} from '../../services/approval-service';
import { logAction } from '../../services/audit-service';

const ScheduleSchema = z.object({
  scheduledFor: z.string().datetime({ message: 'scheduledFor must be a valid ISO 8601 datetime' }),
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
    const parsed = ScheduleSchema.safeParse(body);
    if (!parsed.success) {
      return response(400, { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) });
    }

    const { scheduledFor } = parsed.data;

    // Ensure scheduled time is in the future
    if (new Date(scheduledFor) <= new Date()) {
      return response(400, { error: 'scheduledFor must be in the future' });
    }

    // Transition status to approved with scheduledFor
    await transitionStatus({
      approvalId,
      sellerId,
      newStatus: 'approved',
      approvedBy: sellerId,
      scheduledFor,
    });

    // Audit log (fire-and-forget)
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'approval_scheduled',
      resourceType: 'approval',
      resourceId: approvalId,
      approvalId,
      newValues: { status: 'approved', scheduledFor },
    });

    return response(200, {
      success: true,
      approvalId,
      status: 'approved',
      scheduledFor,
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
    logger.error('Approval schedule failed', error, { requestId });
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
