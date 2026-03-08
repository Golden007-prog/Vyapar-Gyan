/**
 * Orders API Client
 *
 * Functions for customer order endpoints (JWT-protected).
 */

import { api } from './api-client';

// --- Types ---

export interface OrderItem {
  productId: string;
  sellerId: string;
  name: string;
  price: number;
  quantity: number;
}

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface Order {
  id: string;
  orderId: string;
  customerId: string;
  sellerId: string;
  items: OrderItem[];
  subtotal: number;
  commissionAmount: number;
  totalAmount: number;
  status: OrderStatus;
  paymentId?: string;
  shippingAddress?: {
    name: string;
    phone: string;
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OrdersListResponse {
  orders: Order[];
  count: number;
  nextCursor?: string;
}

// --- API Functions ---

export async function listOrders(
  params: { status?: string; limit?: number; cursor?: string } = {},
): Promise<OrdersListResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);
  const query = qs.toString();
  return api.get(`/api/v1/orders${query ? `?${query}` : ''}`);
}

export async function getOrder(orderId: string): Promise<{ order: Order }> {
  return api.get(`/api/v1/orders/${orderId}`);
}
