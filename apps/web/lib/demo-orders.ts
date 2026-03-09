/**
 * Demo-safe local order store
 *
 * Persists orders in sessionStorage so the orders page can display
 * them after checkout in demo / GitHub Pages mode.
 */

import type { Cart } from './api-cart';

const ORDERS_KEY = 'vyapargyan_demo_orders';

export interface DemoOrder {
  id: string;
  orderId: string;
  customerId: string;
  sellerId: string;
  storeName: string;
  items: { productId: string; sellerId: string; name: string; price: number; quantity: number }[];
  subtotal: number;
  gst: number;
  totalAmount: number;
  commissionAmount: number;
  status: 'PAID' | 'PROCESSING' | 'DELIVERED';
  customerName: string;
  customerPhone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

export function getDemoOrders(): DemoOrder[] {
  try {
    const raw = sessionStorage.getItem(ORDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveDemoOrder(order: DemoOrder): void {
  try {
    const orders = getDemoOrders();
    orders.unshift(order);
    sessionStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  } catch { /* ignore */ }
}

export function createDemoOrder(
  cart: Cart,
  sellerId: string,
  storeName: string,
  customerName: string,
  customerPhone: string,
  address: string,
): DemoOrder {
  const subtotal = cart.subtotal;
  const gst = Math.round(subtotal * 0.18);
  const total = subtotal + gst;
  const orderId = `VG-${Date.now().toString(36).toUpperCase()}`;

  return {
    id: `demo-${Date.now()}`,
    orderId,
    customerId: 'cust-demo',
    sellerId,
    storeName,
    items: cart.items.map(i => ({
      productId: i.productId,
      sellerId: i.sellerId,
      name: i.name,
      price: i.price,
      quantity: i.quantity,
    })),
    subtotal,
    gst,
    totalAmount: total,
    commissionAmount: Math.round(subtotal * 0.10),
    status: 'PAID',
    customerName,
    customerPhone,
    address,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
