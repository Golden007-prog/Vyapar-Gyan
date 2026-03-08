/**
 * Approvals API Client
 *
 * Functions for seller approval endpoints (JWT-protected).
 * Matches backend handlers at /api/v1/seller/approvals/*.
 */

import { api } from './api-client';

// --- Types ---

export type ApprovalType = 'discount' | 'campaign' | 'price_change' | 'stock_alert' | 'dead_stock_liquidation' | 'reorder_suggestion';
export type ApprovalStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'edited_approved' | 'executed';

export interface ApprovalSummary {
  approvalId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  aiRationale: string;
  estimatedImpact: number;
  affectedProductCount: number;
  priorityScore: number;
  createdAt: string;
}

export interface ApprovalDetail {
  approvalId: string;
  sellerId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  originalPayload: Record<string, unknown> | null;
  aiRationale: string;
  estimatedImpact: number;
  affectedProductIds: string[];
  priorityScore: number;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectionReason: string | null;
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListApprovalsResponse {
  approvals: ApprovalSummary[];
  nextCursor: string | null;
}

export interface ApprovalDetailResponse {
  approval: ApprovalDetail;
}

export interface ApprovalActionResponse {
  success: boolean;
  approvalId: string;
  status: string;
  executionTriggered?: boolean;
  scheduledFor?: string;
}

// --- API Functions ---

/** List approvals with optional status filter and pagination */
export async function listApprovals(
  status: 'pending_review' | 'approved' | 'rejected' | 'all' = 'pending_review',
  limit = 20,
  cursor?: string,
): Promise<ListApprovalsResponse> {
  const qs = new URLSearchParams({ status, limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  return api.get<ListApprovalsResponse>(`/api/v1/seller/approvals?${qs.toString()}`);
}

/** Get full approval detail */
export async function getApproval(approvalId: string): Promise<ApprovalDetailResponse> {
  return api.get<ApprovalDetailResponse>(`/api/v1/seller/approvals/${approvalId}`);
}

/** Approve an action as-is */
export async function approve(approvalId: string): Promise<ApprovalActionResponse> {
  return api.put<ApprovalActionResponse>(`/api/v1/seller/approvals/${approvalId}/approve`);
}

/** Reject an action with a reason */
export async function reject(approvalId: string, rejectionReason: string): Promise<ApprovalActionResponse> {
  return api.put<ApprovalActionResponse>(`/api/v1/seller/approvals/${approvalId}/reject`, { rejectionReason });
}

/** Edit the payload and approve */
export async function editApprove(approvalId: string, payload: Record<string, unknown>): Promise<ApprovalActionResponse> {
  return api.put<ApprovalActionResponse>(`/api/v1/seller/approvals/${approvalId}/edit-approve`, { payload });
}

/** Schedule approval for later execution */
export async function schedule(approvalId: string, scheduledFor: string): Promise<ApprovalActionResponse> {
  return api.put<ApprovalActionResponse>(`/api/v1/seller/approvals/${approvalId}/schedule`, { scheduledFor });
}
