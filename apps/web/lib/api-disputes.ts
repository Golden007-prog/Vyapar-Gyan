/**
 * Admin Disputes API Client
 *
 * Functions for admin dispute endpoints (JWT-protected, admin role).
 * Matches backend handler at /api/v1/admin/disputes.
 */

import { api } from './api-client';

// --- Types ---

export type DisputeIssueType = 'wrong_item' | 'not_delivered' | 'quality_issue' | 'refund_request' | 'payment_failed';
export type DisputeStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';
export type ResolutionAction = 'refund_full' | 'refund_partial' | 'replace' | 'dismiss' | 'escalate';

export interface DisputeListItem {
  disputeId: string;
  orderId: string;
  customerId: string;
  sellerId: string;
  customerName: string;
  sellerName: string;
  issueType: DisputeIssueType;
  status: DisputeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ListDisputesParams {
  status?: DisputeStatus;
  issue_type?: DisputeIssueType;
  page?: number;
  size?: number;
}

export interface ListDisputesResponse {
  disputes: DisputeListItem[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface DisputeDetail {
  disputeId: string;
  orderId: string;
  customerId: string;
  sellerId: string;
  customerName: string;
  sellerName: string;
  issueType: DisputeIssueType;
  status: DisputeStatus;
  adminNotes: string;
  resolution: {
    action: ResolutionAction;
    amount?: number;
    resolvedBy?: string;
    resolvedAt?: string;
    notes?: string;
  } | null;
  evidenceUrls: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetail {
  orderId: string;
  totalAmount: number;
  status: string;
  items?: any[];
  razorpayPaymentId?: string;
  createdAt: string;
}

export interface ChatMessage {
  messageId: string;
  content: unknown;
  channel: string;
  senderRole: string;
  direction: string;
  createdAt: string;
}

export interface TimelineEntry {
  auditId: string;
  actorId: string;
  actionType: string;
  newValues: Record<string, unknown>;
  createdAt: string;
}

export interface GetDisputeDetailResponse {
  dispute: DisputeDetail;
  order: OrderDetail | null;
  chatTranscript: ChatMessage[];
  timeline: TimelineEntry[];
}

export interface ResolveDisputeParams {
  action: ResolutionAction;
  amount?: number;
  notes?: string;
}

// --- API Functions ---

export async function listDisputes(params: ListDisputesParams = {}): Promise<ListDisputesResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.issue_type) qs.set('issue_type', params.issue_type);
  if (params.page) qs.set('page', String(params.page));
  if (params.size) qs.set('size', String(params.size));
  const query = qs.toString();
  return api.get<ListDisputesResponse>(`/api/v1/admin/disputes${query ? `?${query}` : ''}`);
}

export async function getDisputeDetail(disputeId: string): Promise<GetDisputeDetailResponse> {
  return api.get<GetDisputeDetailResponse>(`/api/v1/admin/disputes/${disputeId}`);
}

export async function resolveDispute(disputeId: string, params: ResolveDisputeParams): Promise<any> {
  return api.post(`/api/v1/admin/disputes/${disputeId}/resolve`, params);
}

export async function updateDisputeNotes(disputeId: string, notes: string): Promise<any> {
  return api.put(`/api/v1/admin/disputes/${disputeId}/notes`, { notes });
}
