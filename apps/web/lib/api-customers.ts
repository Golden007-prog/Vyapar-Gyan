/**
 * Admin Customers API Client
 *
 * Functions for admin customer endpoints (JWT-protected, admin role).
 * Matches backend handler at /api/v1/admin/customers.
 */

import { api } from './api-client';

// --- Types ---

export interface CustomerListItem {
  userId: string;
  name: string;
  phone: string;
  registeredDate: string;
  totalOrders: number;
  ltv: number;
  storesVisited: number;
  lastActive: string;
  preferredChannel: string;
}

export interface CustomerSummary {
  totalCustomers: number;
  newThisMonth: number;
  averageLTV: number;
  averageOrdersPerCustomer: number;
}

export interface ListCustomersParams {
  search?: string;
  page?: number;
  size?: number;
  sort?: string;
  ltv_min?: number;
  ltv_max?: number;
  date_from?: string;
  date_to?: string;
}

export interface ListCustomersResponse {
  customers: CustomerListItem[];
  summary: CustomerSummary;
  total: number;
  page: number;
  size: number;
  totalPages: number;
}

export interface OrderSummary {
  orderId: string;
  sellerId: string;
  totalAmount: number;
  status: string;
  createdAt: string;
}

export interface ChatMessage {
  messageId: string;
  content: unknown;
  channel: string;
  senderRole: string;
  createdAt: string;
}

export interface FavoriteStore {
  sellerId: string;
  storeName: string;
  addedAt: string;
}

export interface CustomerDetail extends CustomerListItem {
  orders: OrderSummary[];
  chatHistory: ChatMessage[];
  favoriteStores: FavoriteStore[];
}

export interface GetCustomerDetailResponse {
  customer: CustomerDetail;
}

// --- API Functions ---

export async function listCustomers(params: ListCustomersParams = {}): Promise<ListCustomersResponse> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.page) qs.set('page', String(params.page));
  if (params.size) qs.set('size', String(params.size));
  if (params.sort) qs.set('sort', params.sort);
  if (params.ltv_min !== undefined) qs.set('ltv_min', String(params.ltv_min));
  if (params.ltv_max !== undefined) qs.set('ltv_max', String(params.ltv_max));
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  const query = qs.toString();
  return api.get<ListCustomersResponse>(`/api/v1/admin/customers${query ? `?${query}` : ''}`);
}

export async function getCustomerDetail(customerId: string): Promise<GetCustomerDetailResponse> {
  return api.get<GetCustomerDetailResponse>(`/api/v1/admin/customers/${customerId}`);
}
