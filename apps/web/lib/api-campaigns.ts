/**
 * Campaigns API Client
 *
 * Functions for seller campaign endpoints (JWT-protected).
 * Matches backend handlers at /api/v1/seller/campaigns/*.
 */

import { api } from './api-client';

// --- Types ---

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

export interface AudienceFilters {
  pastPurchasers?: string[];
  cartAbandoners?: boolean;
  highSpenders?: boolean;
  categoryInterest?: string[];
}

export interface CampaignSummary {
  campaignId: string;
  sellerId: string;
  approvalId?: string;
  status: CampaignStatus;
  messageText: string;
  templateSid?: string;
  audienceFilters: AudienceFilters;
  estimatedReach: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  conversionCount: number;
  scheduledAt?: string;
  executedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignAnalytics {
  campaignId: string;
  status: CampaignStatus;
  metrics: {
    estimatedReach: number;
    sentCount: number;
    deliveredCount: number;
    readCount: number;
    conversionCount: number;
  };
  rates: {
    deliveryRate: number;
    readRate: number;
    conversionRate: number;
  };
  executedAt?: string;
  scheduledAt?: string;
}

export interface CreateCampaignInput {
  approvalId?: string;
  messageText: string;
  templateSid?: string;
  audienceFilters: AudienceFilters;
  scheduledAt?: string;
}

export interface CreateCampaignResponse {
  success: boolean;
  campaign: {
    campaignId: string;
    status: CampaignStatus;
    estimatedReach: number;
    messageText: string;
    audienceFilters: AudienceFilters;
    scheduledAt?: string;
    createdAt: string;
  };
}

export interface ScheduleCampaignResponse {
  success: boolean;
  campaignId: string;
  status: string;
  scheduledAt: string;
  estimatedReach: number;
}

export interface EstimateReachResponse {
  estimatedReach: number;
  audienceFilters: AudienceFilters;
}

// --- API Functions ---

/** Create a new campaign */
export async function createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResponse> {
  return api.post<CreateCampaignResponse>('/api/v1/seller/campaigns', input);
}

/** Schedule a campaign for sending */
export async function scheduleCampaign(campaignId: string): Promise<ScheduleCampaignResponse> {
  return api.post<ScheduleCampaignResponse>(`/api/v1/seller/campaigns/${campaignId}/schedule`);
}

/** Estimate audience reach for given filters */
export async function estimateReach(audienceFilters: AudienceFilters): Promise<EstimateReachResponse> {
  return api.post<EstimateReachResponse>('/api/v1/seller/campaigns/estimate-reach', { audienceFilters });
}

/** Get campaign analytics */
export async function getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics> {
  return api.get<CampaignAnalytics>(`/api/v1/seller/campaigns/${campaignId}/analytics`);
}
