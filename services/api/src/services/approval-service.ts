/**
 * Approval Service
 *
 * Reusable workflow engine for seller review of all AI-generated and
 * admin-triggered actions. Supports discount, campaign, price_change,
 * stock_alert, and reorder_suggestion action types.
 *
 * Priority scoring: revenueImpact × 0.4 + stockAge × 0.3 + timeSensitivity × 0.3
 *
 * State machine: draft → pending_review → approved | rejected | edited_approved → executed
 */

import { randomUUID } from 'crypto';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';
import {
  putApproval,
  getApproval,
  queryApprovalsBySeller,
  updateApprovalStatus,
  type ApprovalRecord,
  type QueryApprovalsOptions,
} from '../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateApprovalParams {
  sellerId: string;
  type: ApprovalRecord['type'];
  payload: Record<string, unknown>;
  aiRationale: string;
  estimatedImpact: number;
  affectedProductIds: string[];
  /** Days since stock was added — used in priority calculation */
  stockAgeDays?: number;
  /** 0–100 score indicating how time-sensitive the action is */
  timeSensitivityScore?: number;
}

export interface TransitionStatusParams {
  approvalId: string;
  sellerId: string;
  newStatus: ApprovalRecord['status'];
  approvedBy?: string;
  rejectionReason?: string;
  originalPayload?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  scheduledFor?: string;
}

export interface GetApprovalsParams {
  sellerId: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// EventBridge client singleton
// ---------------------------------------------------------------------------

const ebClient = new EventBridgeClient({});

// ---------------------------------------------------------------------------
// Priority score calculation
// ---------------------------------------------------------------------------

/**
 * Calculate priority score as weighted composite:
 *   revenueImpact × 0.4 + stockAgeDays × 0.3 + timeSensitivity × 0.3
 *
 * All inputs are normalised to a 0–100 scale before weighting.
 */
export function calculatePriorityScore(
  estimatedImpact: number,
  stockAgeDays: number,
  timeSensitivityScore: number,
): number {
  // Normalise revenue impact: cap at 100 000 ₹ → 100
  const revenueNorm = Math.min((estimatedImpact / 1000) * 1, 100);
  // Normalise stock age: cap at 365 days → 100
  const stockNorm = Math.min((stockAgeDays / 365) * 100, 100);
  // timeSensitivity is already 0–100
  const timeNorm = Math.min(timeSensitivityScore, 100);

  const score = revenueNorm * 0.4 + stockNorm * 0.3 + timeNorm * 0.3;
  return Math.round(score * 100) / 100; // two decimal places
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new approval record and transition it to pending_review.
 */
export async function createApproval(params: CreateApprovalParams): Promise<ApprovalRecord> {
  const approvalId = randomUUID();
  const now = new Date().toISOString();

  const priorityScore = calculatePriorityScore(
    params.estimatedImpact,
    params.stockAgeDays ?? 0,
    params.timeSensitivityScore ?? 0,
  );

  const approval: ApprovalRecord = {
    approvalId,
    sellerId: params.sellerId,
    type: params.type,
    status: 'pending_review',
    payload: params.payload,
    aiRationale: params.aiRationale,
    estimatedImpact: params.estimatedImpact,
    affectedProductIds: params.affectedProductIds,
    priorityScore,
    createdAt: now,
    updatedAt: now,
  };

  await putApproval(approval);

  logger.info('Approval created', {
    approvalId,
    sellerId: params.sellerId,
    type: params.type,
    priorityScore,
  });

  return approval;
}

/**
 * Transition an approval record to a new status with optional metadata.
 */
export async function transitionStatus(params: TransitionStatusParams): Promise<ApprovalRecord> {
  const existing = await getApproval(params.approvalId);
  if (!existing) {
    throw new ApprovalNotFoundError(params.approvalId);
  }
  if (existing.sellerId !== params.sellerId) {
    throw new ApprovalForbiddenError(params.approvalId);
  }

  const updates: Partial<ApprovalRecord> = {
    status: params.newStatus,
  };

  if (params.approvedBy) updates.approvedBy = params.approvedBy;
  if (params.rejectionReason) updates.rejectionReason = params.rejectionReason;
  if (params.originalPayload) updates.originalPayload = params.originalPayload;
  if (params.payload) updates.payload = params.payload;
  if (params.scheduledFor) updates.scheduledFor = params.scheduledFor;

  if (['approved', 'edited_approved'].includes(params.newStatus)) {
    updates.approvedAt = new Date().toISOString();
  }

  await updateApprovalStatus(params.approvalId, params.sellerId, updates);

  logger.info('Approval status transitioned', {
    approvalId: params.approvalId,
    from: existing.status,
    to: params.newStatus,
  });

  return { ...existing, ...updates, updatedAt: new Date().toISOString() };
}

/**
 * Publish an EventBridge event to trigger the approval execution worker.
 */
export async function executeApproval(
  approvalId: string,
  detailType: 'ApprovalApproved' | 'ApprovalRejected' | 'ApprovalEditedApproved',
  detail: Record<string, unknown>,
): Promise<void> {
  const config = await getConfig();

  await ebClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'vyapargyan.approval',
          DetailType: detailType,
          Detail: JSON.stringify(detail),
          EventBusName: config.eventBusName,
        },
      ],
    }),
  );

  logger.info('Approval event published', { approvalId, detailType });
}

/**
 * Query approvals for a seller, optionally filtered by status.
 * Returns results sorted by GSI1SK (status + timestamp) descending.
 */
export async function getApprovalsBySeller(params: GetApprovalsParams): Promise<{
  approvals: ApprovalRecord[];
  nextCursor: string | null;
}> {
  const opts: QueryApprovalsOptions = {
    sellerId: params.sellerId,
    limit: params.limit ?? 20,
  };

  if (params.status && params.status !== 'all') {
    opts.statusPrefix = params.status;
  }

  if (params.cursor) {
    try {
      opts.exclusiveStartKey = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf-8'));
    } catch {
      // Invalid cursor — ignore and start from beginning
    }
  }

  const result = await queryApprovalsBySeller(opts);

  const nextCursor = result.lastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64url')
    : null;

  return {
    approvals: result.approvals,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ApprovalNotFoundError extends Error {
  public readonly statusCode = 404;
  constructor(approvalId: string) {
    super(`Approval ${approvalId} not found`);
    this.name = 'ApprovalNotFoundError';
  }
}

export class ApprovalForbiddenError extends Error {
  public readonly statusCode = 403;
  constructor(approvalId: string) {
    super(`Not authorized to access approval ${approvalId}`);
    this.name = 'ApprovalForbiddenError';
  }
}
