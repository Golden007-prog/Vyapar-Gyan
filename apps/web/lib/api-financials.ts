/**
 * Admin Financials API Client
 *
 * Functions for admin financials endpoints (JWT-protected, admin role).
 * Matches backend handler at /api/v1/admin/financials.
 */

import { api, fetchWithAuth } from './api-client';

// --- Types ---

export type TransferStatus = 'completed' | 'pending' | 'failed' | 'reversed';

export interface FinancialSummary {
  totalPlatformRevenue: number;
  totalCommissionEarned: number;
  pendingSettlements: number;
  failedPayouts: number;
}

export interface TransactionRecord {
  transferId: string;
  orderId: string;
  sellerId: string;
  sellerName: string;
  orderAmount: number;
  commissionRate: number;
  commissionAmount: number;
  sellerAmount: number;
  transferStatus: TransferStatus;
  razorpayTransferId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListTransactionsParams {
  date_from?: string;
  date_to?: string;
  seller?: string;
  status?: TransferStatus;
  page?: number;
  size?: number;
}

export interface ListTransactionsResponse {
  transactions: TransactionRecord[];
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface ExportParams {
  date_from?: string;
  date_to?: string;
  seller?: string;
  status?: TransferStatus;
}

// --- API Functions ---

export async function getFinancialSummary(): Promise<{ summary: FinancialSummary }> {
  return api.get<{ summary: FinancialSummary }>('/api/v1/admin/financials/summary');
}

export async function listTransactions(params: ListTransactionsParams = {}): Promise<ListTransactionsResponse> {
  const qs = new URLSearchParams();
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.seller) qs.set('seller', params.seller);
  if (params.status) qs.set('status', params.status);
  if (params.page) qs.set('page', String(params.page));
  if (params.size) qs.set('size', String(params.size));
  const query = qs.toString();
  return api.get<ListTransactionsResponse>(`/api/v1/admin/financials/transactions${query ? `?${query}` : ''}`);
}

export async function retryTransfer(transferId: string): Promise<any> {
  return api.post(`/api/v1/admin/financials/transactions/${transferId}/retry`);
}

export async function exportTransactionsCSV(params: ExportParams = {}): Promise<string> {
  const qs = new URLSearchParams();
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.seller) qs.set('seller', params.seller);
  if (params.status) qs.set('status', params.status);
  const query = qs.toString();

  // Use fetchWithAuth directly since we need the raw text response
  return fetchWithAuth<string>(`/api/v1/admin/financials/export${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: { Accept: 'text/csv' },
  });
}
