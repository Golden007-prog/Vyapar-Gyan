/**
 * Admin Campaigns API Client
 *
 * Functions for admin campaign oversight endpoints (JWT-protected, admin role).
 * Matches backend handler at /api/v1/admin/campaigns.
 */

import { api } from './api-client';

// --- Types ---

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'flagged' | 'blocked';

export interface AdminCampaignRecord {
  campaignId: string;
  sellerId: string;
  sellerName: string;
  approvalId?: string;
  status: CampaignStatus;
  messageText: string;
  estimatedReach: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  conversionCount: number;
  revenueImpact: number;
  channel?: string;
  scheduledAt?: string;
  executedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AggregateMetrics {
  totalCampaigns30d: number;
  avgOpenRate: number;
  avgConversionRate: number;
  totalRevenue: number;
}

export interface DeliveryLogEntry {
  customerId: string;
  channel: string;
  sentAt: string;
  deliveredAt?: string;
  readAt?: string;
  convertedAt?: string;
  status: string;
}

export interface ListAdminCampaignsParams {
  seller?: string;
  channel?: string;
  status?: CampaignStatus;
  date_from?: string;
  date_to?: string;
  page?: number;
  size?: number;
}

export interface ListAdminCampaignsResponse {
  campaigns: AdminCampaignRecord[];
  metrics: AggregateMetrics;
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface CampaignDetailResponse {
  campaign: AdminCampaignRecord;
  deliveries: DeliveryLogEntry[];
}

// --- API Functions ---

export async function listAdminCampaigns(params: ListAdminCampaignsParams = {}): Promise<ListAdminCampaignsResponse> {
  const qs = new URLSearchParams();
  if (params.seller) qs.set('seller', params.seller);
  if (params.channel) qs.set('channel', params.channel);
  if (params.status) qs.set('status', params.status);
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.page) qs.set('page', String(params.page));
  if (params.size) qs.set('size', String(params.size));
  const query = qs.toString();
  return api.get<ListAdminCampaignsResponse>(`/api/v1/admin/campaigns${query ? `?${query}` : ''}`);
}

export async function getAdminCampaignDetail(campaignId: string): Promise<CampaignDetailResponse> {
  return api.get<CampaignDetailResponse>(`/api/v1/admin/campaigns/${campaignId}`);
}

export async function flagCampaign(campaignId: string, reason?: string): Promise<any> {
  return api.post(`/api/v1/admin/campaigns/${campaignId}/flag`, { reason });
}

export async function blockCampaign(campaignId: string, reason?: string): Promise<any> {
  return api.post(`/api/v1/admin/campaigns/${campaignId}/block`, { reason });
}
