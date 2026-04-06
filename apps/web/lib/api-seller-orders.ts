/**
 * Seller Orders API Client
 *
 * Functions for seller order management endpoints (JWT-protected).
 * Supports listing orders, accepting/rejecting, and fulfillment status updates.
 */

import { api } from './api-client';
import type { Order, OrdersListResponse } from './api-orders';

// --- Seller-specific types ---

export interface SellerOrdersListResponse extends OrdersListResponse {
  pendingCount?: number;
}

export interface AcceptOrderResponse {
  order: Order;
}

export interface RejectOrderResponse {
  order: Order;
}

export interface UpdateStatusResponse {
  order: Order;
}

// --- API Functions ---

/** List seller orders with optional status filter */
export async function listSellerOrders(
  params: { status?: string; limit?: number; cursor?: string } = {},
): Promise<SellerOrdersListResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const query = qs.toString();
  return api.get(`/api/v1/seller/orders${query ? `?${query}` : ''}`);
}

/** Accept a pending order */
export async function acceptOrder(orderId: string): Promise<AcceptOrderResponse> {
  return api.post(`/api/v1/seller/orders/${orderId}/accept`);
}

/** Reject a pending order with reason */
export async function rejectOrder(orderId: string, reason: string): Promise<RejectOrderResponse> {
  return api.post(`/api/v1/seller/orders/${orderId}/reject`, { reason });
}

/** Update fulfillment status (preparing, shipped, delivered) */
export async function updateOrderStatus(
  orderId: string,
  status: 'preparing' | 'shipped' | 'delivered',
): Promise<UpdateStatusResponse> {
  return api.post(`/api/v1/seller/orders/${orderId}/status`, { status });
}
