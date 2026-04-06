/**
 * Orders API Client
 *
 * Functions for customer order endpoints (JWT-protected).
 * Supports the full order confirmation flow with seller acceptance,
 * payment link generation, and fulfillment tracking.
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
  | 'pending_seller_confirmation'
  | 'confirmed'
  | 'payment_pending'
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'payment_failed'
  | 'expired'
  // Legacy statuses for backward compatibility
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

export interface TimelineEntry {
  status: string;
  timestamp: string;
  actor: 'customer' | 'seller' | 'system';
  note?: string;
}

export interface Order {
  id: string;
  orderId: string;
  customerId: string;
  sellerId: string;
  sellerName?: string;
  items: OrderItem[];
  subtotal: number;
  commissionAmount: number;
  totalAmount: number;
  status: OrderStatus;
  channel?: 'whatsapp' | 'web';
  paymentLinkId?: string;
  paymentLinkUrl?: string;
  razorpayPaymentId?: string;
  rejectionReason?: string;
  timeline?: TimelineEntry[];
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
  confirmedAt?: string;
  paidAt?: string;
  deliveredAt?: string;
}

export interface OrdersListResponse {
  orders: Order[];
  count: number;
  nextCursor?: string;
}

export interface CreateOrderInput {
  sellerId: string;
  items: { productId: string; quantity: number }[];
  shippingAddress?: {
    name: string;
    phone: string;
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
  };
}

export interface CreateOrderResponse {
  orderId: string;
  status: OrderStatus;
}

// --- API Functions ---

/** List customer orders with optional filters */
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

/** Get order detail by orderId */
export async function getOrder(orderId: string): Promise<{ order: Order }> {
  return api.get(`/api/v1/orders/${orderId}`);
}

/** Cancel an order (allowed when pending_seller_confirmation or confirmed) */
export async function cancelOrder(orderId: string): Promise<{ order: Order }> {
  return api.post(`/api/v1/orders/${orderId}/cancel`);
}

/** Create a new order from web checkout */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
  return api.post('/api/v1/orders', input);
}
