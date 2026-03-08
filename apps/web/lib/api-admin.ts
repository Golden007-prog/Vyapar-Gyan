/**
 * Admin API Client
 *
 * Functions for admin endpoints (JWT-protected, admin role).
 * Matches backend handlers at /api/v1/admin/*.
 */

import { api } from './api-client';

// --- Types ---

export interface AuditLog {
  auditId: string;
  actorId: string;
  actorRole: 'admin' | 'seller' | 'system';
  actionType: string;
  resourceType: string;
  resourceId: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  approvalId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface QueryAuditLogsParams {
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  cursor?: string;
}

export interface QueryAuditLogsResponse {
  auditLogs: AuditLog[];
  nextCursor: string | null;
}

export interface ReprocessMediaParams {
  maxMessages?: number;
}

export interface ReprocessMediaResponse {
  success: boolean;
  reprocessed: number;
  failed: number;
  errors?: string[];
  message?: string;
}

export interface MessagingConfig {
  quietHours: { startHour: number; endHour: number; timezone: string };
  frequencyCap: { maxPromotionalPerDay: number; windowHours: number };
  templateDefaults: { defaultLanguage: string; requireApproval: boolean };
}

export interface GetMessagingConfigResponse {
  config: MessagingConfig;
}

export interface UpdateMessagingConfigResponse {
  success: boolean;
  config: MessagingConfig;
}

// --- API Functions ---

/** Query audit logs by actor or resource with optional date range */
export async function queryAuditLogs(params: QueryAuditLogsParams): Promise<QueryAuditLogsResponse> {
  const qs = new URLSearchParams();
  if (params.actorId) qs.set('actorId', params.actorId);
  if (params.resourceType) qs.set('resourceType', params.resourceType);
  if (params.resourceId) qs.set('resourceId', params.resourceId);
  if (params.startDate) qs.set('startDate', params.startDate);
  if (params.endDate) qs.set('endDate', params.endDate);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  return api.get<QueryAuditLogsResponse>(`/api/v1/admin/audit?${qs.toString()}`);
}

/** Reprocess failed media from DLQ */
export async function reprocessMedia(params?: ReprocessMediaParams): Promise<ReprocessMediaResponse> {
  return api.post<ReprocessMediaResponse>('/api/v1/admin/media/reprocess', params ?? {});
}

/** Get current messaging configuration */
export async function getMessagingConfig(): Promise<GetMessagingConfigResponse> {
  return api.get<GetMessagingConfigResponse>('/api/v1/admin/messaging/config');
}

/** Update messaging configuration (partial updates supported) */
export async function updateMessagingConfig(
  config: Partial<MessagingConfig>,
): Promise<UpdateMessagingConfigResponse> {
  return api.put<UpdateMessagingConfigResponse>('/api/v1/admin/messaging/config', config);
}
