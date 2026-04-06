/**
 * Order Notification Formatter
 *
 * Formats order event notifications for different channels (WhatsApp, Web)
 * and recipient roles (customer, seller).
 *
 * WhatsApp messages use emoji-rich text with order details.
 * Web notifications use structured JSON for frontend rendering.
 */

import type { OrderStatus } from './order-state-machine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationChannel = 'whatsapp' | 'web';
export type RecipientRole = 'customer' | 'seller';

export interface OrderEventDetail {
  orderId: string;
  humanReadableId: string;
  sellerId: string;
  customerId: string;
  items: OrderEventItem[];
  subtotal: number;
  totalAmount: number;
  commissionRate?: number;
  commissionAmount?: number;
  sellerAmount?: number;
  status: OrderStatus;
  channel: 'whatsapp' | 'web';
  timestamp: string;
  // Event-specific fields
  paymentLinkUrl?: string;
  rejectionReason?: string;
  razorpayPaymentId?: string;
  errorDescription?: string;
  // Display names resolved by the router
  customerName?: string;
  sellerName?: string;
}

export interface OrderEventItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  sellerId?: string;
}

export interface FormattedNotification {
  channel: NotificationChannel;
  recipientRole: RecipientRole;
  body: string;
  /** Structured payload for web notifications */
  payload?: WebNotificationPayload;
}

export interface WebNotificationPayload {
  type: 'order_update';
  orderId: string;
  humanReadableId: string;
  status: OrderStatus;
  title: string;
  message: string;
  timestamp: string;
  actionUrl?: string;
  actionLabel?: string;
}

// ---------------------------------------------------------------------------
// Event type to detail-type mapping
// ---------------------------------------------------------------------------

type OrderDetailType =
  | 'order.created'
  | 'order.confirmed'
  | 'order.payment_pending'
  | 'order.paid'
  | 'order.preparing'
  | 'order.shipped'
  | 'order.delivered'
  | 'order.rejected'
  | 'order.cancelled'
  | 'order.expired'
  | 'order.payment_failed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

function formatItemsList(items: OrderEventItem[]): string {
  return items
    .map((item) => `  • ${item.name} × ${item.quantity} — ${formatCurrency(item.price * item.quantity)}`)
    .join('\n');
}

function formatItemsSummary(items: OrderEventItem[]): string {
  if (items.length === 1) {
    return `${items[0]!.name} × ${items[0]!.quantity}`;
  }
  return `${items.length} items`;
}

// ---------------------------------------------------------------------------
// WhatsApp Formatters (emoji-rich text)
// ---------------------------------------------------------------------------

const whatsappSellerFormatters: Record<OrderDetailType, (e: OrderEventDetail) => string> = {
  'order.created': (e) => {
    const customerDisplay = e.customerName || e.customerId;
    const itemsList = formatItemsList(e.items);
    return [
      `🔔 *New Order ${e.humanReadableId}*`,
      '',
      `👤 Customer: ${customerDisplay}`,
      `📦 Items:`,
      itemsList,
      `💰 Total: ${formatCurrency(e.totalAmount)}`,
      '',
      `Reply *ACCEPT* to confirm or *REJECT* to decline.`,
    ].join('\n');
  },
  'order.confirmed': (e) =>
    `✅ Order ${e.humanReadableId} confirmed. Payment link sent to customer.`,
  'order.payment_pending': (e) =>
    `⏳ Waiting for customer payment on order ${e.humanReadableId} — ${formatCurrency(e.totalAmount)}.`,
  'order.paid': (e) =>
    `💰 Payment received for order ${e.humanReadableId} — ${formatCurrency(e.totalAmount)}. Time to prepare!`,
  'order.preparing': (e) =>
    `👨‍🍳 Order ${e.humanReadableId} is now being prepared.`,
  'order.shipped': (e) =>
    `🚚 Order ${e.humanReadableId} has been shipped.`,
  'order.delivered': (e) =>
    `📦 Order ${e.humanReadableId} delivered successfully!`,
  'order.rejected': (e) =>
    `❌ Order ${e.humanReadableId} rejected. Customer has been notified.`,
  'order.cancelled': (e) =>
    `🚫 Order ${e.humanReadableId} was cancelled by the customer.`,
  'order.expired': (e) =>
    `⏰ Payment expired for order ${e.humanReadableId}. Stock has been unreserved.`,
  'order.payment_failed': (e) =>
    `⚠️ Payment failed for order ${e.humanReadableId}. Customer has been notified.`,
};

const whatsappCustomerFormatters: Record<OrderDetailType, (e: OrderEventDetail) => string> = {
  'order.created': (e) => {
    const sellerDisplay = e.sellerName || 'the seller';
    return `🛒 Order ${e.humanReadableId} placed! Waiting for ${sellerDisplay} to confirm. We'll notify you once confirmed.`;
  },
  'order.confirmed': (e) => {
    const sellerDisplay = e.sellerName || 'The seller';
    const paymentPart = e.paymentLinkUrl
      ? ` Pay ${formatCurrency(e.totalAmount)} here: ${e.paymentLinkUrl}`
      : '';
    return `✅ ${sellerDisplay} accepted your order ${e.humanReadableId}!${paymentPart}`;
  },
  'order.payment_pending': (e) => {
    const link = e.paymentLinkUrl || '';
    return `💳 Pay ${formatCurrency(e.totalAmount)} for order ${e.humanReadableId}: ${link}`;
  },
  'order.paid': (e) =>
    `🎉 Payment received! Your order ${e.humanReadableId} is being prepared.`,
  'order.preparing': (e) =>
    `👨‍🍳 Your order ${e.humanReadableId} is being prepared!`,
  'order.shipped': (e) =>
    `🚚 Your order ${e.humanReadableId} has been shipped!`,
  'order.delivered': (e) => {
    const sellerDisplay = e.sellerName || 'the seller';
    return `📦 Your order ${e.humanReadableId} has been delivered! Thank you for shopping at ${sellerDisplay}.`;
  },
  'order.rejected': (e) => {
    const reason = e.rejectionReason ? ` Reason: ${e.rejectionReason}` : '';
    return `😔 Sorry, your order ${e.humanReadableId} was declined by the seller.${reason}`;
  },
  'order.cancelled': (e) =>
    `🚫 Your order ${e.humanReadableId} has been cancelled.`,
  'order.expired': (e) =>
    `⏰ Payment link expired for order ${e.humanReadableId}. Reply REORDER to place a new order.`,
  'order.payment_failed': (e) => {
    const desc = e.errorDescription ? ` Reason: ${e.errorDescription}.` : '';
    return `❌ Payment failed for order ${e.humanReadableId}.${desc} Reply PAY to get a new payment link.`;
  },
};

// ---------------------------------------------------------------------------
// Web Notification Formatters (structured JSON)
// ---------------------------------------------------------------------------

interface WebMeta {
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
}

const webSellerMeta: Record<OrderDetailType, (e: OrderEventDetail) => WebMeta> = {
  'order.created': (e) => ({
    title: 'New Order',
    message: `Order ${e.humanReadableId} from ${e.customerName || 'customer'} — ${formatCurrency(e.totalAmount)}`,
    actionUrl: `/seller/orders?highlight=${e.orderId}`,
    actionLabel: 'Review Order',
  }),
  'order.confirmed': (e) => ({
    title: 'Order Confirmed',
    message: `Order ${e.humanReadableId} confirmed. Payment link sent.`,
  }),
  'order.payment_pending': (e) => ({
    title: 'Awaiting Payment',
    message: `Waiting for payment on order ${e.humanReadableId}.`,
  }),
  'order.paid': (e) => ({
    title: 'Payment Received',
    message: `Payment of ${formatCurrency(e.totalAmount)} received for order ${e.humanReadableId}.`,
    actionUrl: `/seller/orders?highlight=${e.orderId}`,
    actionLabel: 'Start Preparing',
  }),
  'order.preparing': (e) => ({
    title: 'Preparing',
    message: `Order ${e.humanReadableId} is being prepared.`,
  }),
  'order.shipped': (e) => ({
    title: 'Shipped',
    message: `Order ${e.humanReadableId} has been shipped.`,
  }),
  'order.delivered': (e) => ({
    title: 'Delivered',
    message: `Order ${e.humanReadableId} delivered successfully!`,
  }),
  'order.rejected': (e) => ({
    title: 'Order Rejected',
    message: `Order ${e.humanReadableId} was rejected.`,
  }),
  'order.cancelled': (e) => ({
    title: 'Order Cancelled',
    message: `Order ${e.humanReadableId} was cancelled by the customer.`,
  }),
  'order.expired': (e) => ({
    title: 'Payment Expired',
    message: `Payment expired for order ${e.humanReadableId}.`,
  }),
  'order.payment_failed': (e) => ({
    title: 'Payment Failed',
    message: `Payment failed for order ${e.humanReadableId}.`,
  }),
};

const webCustomerMeta: Record<OrderDetailType, (e: OrderEventDetail) => WebMeta> = {
  'order.created': (e) => ({
    title: 'Order Placed',
    message: `Order ${e.humanReadableId} placed. Waiting for seller confirmation.`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'Track Order',
  }),
  'order.confirmed': (e) => ({
    title: 'Order Confirmed',
    message: `${e.sellerName || 'Seller'} accepted your order ${e.humanReadableId}!`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'Pay Now',
  }),
  'order.payment_pending': (e) => ({
    title: 'Payment Required',
    message: `Pay ${formatCurrency(e.totalAmount)} for order ${e.humanReadableId}.`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'Pay Now',
  }),
  'order.paid': (e) => ({
    title: 'Payment Received',
    message: `Payment received for order ${e.humanReadableId}!`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'Track Order',
  }),
  'order.preparing': (e) => ({
    title: 'Being Prepared',
    message: `Your order ${e.humanReadableId} is being prepared.`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'Track Order',
  }),
  'order.shipped': (e) => ({
    title: 'Shipped',
    message: `Your order ${e.humanReadableId} has been shipped!`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'Track Order',
  }),
  'order.delivered': (e) => ({
    title: 'Delivered',
    message: `Your order ${e.humanReadableId} has been delivered!`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'View Order',
  }),
  'order.rejected': (e) => ({
    title: 'Order Declined',
    message: `Your order ${e.humanReadableId} was declined.${e.rejectionReason ? ` Reason: ${e.rejectionReason}` : ''}`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'View Details',
  }),
  'order.cancelled': (e) => ({
    title: 'Order Cancelled',
    message: `Your order ${e.humanReadableId} has been cancelled.`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'View Details',
  }),
  'order.expired': (e) => ({
    title: 'Payment Expired',
    message: `Payment link expired for order ${e.humanReadableId}.`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'View Details',
  }),
  'order.payment_failed': (e) => ({
    title: 'Payment Failed',
    message: `Payment failed for order ${e.humanReadableId}.`,
    actionUrl: `/orders/${e.orderId}`,
    actionLabel: 'Retry Payment',
  }),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Format an order notification for a given channel and recipient role.
 *
 * @param detailType - The EventBridge detail type (e.g. 'order.created')
 * @param event - The order event detail payload
 * @param channel - Target channel: 'whatsapp' or 'web'
 * @param recipientRole - 'customer' or 'seller'
 * @returns Formatted notification with body text and optional web payload
 */
export function formatOrderNotification(
  detailType: string,
  event: OrderEventDetail,
  channel: NotificationChannel,
  recipientRole: RecipientRole,
): FormattedNotification {
  const eventType = detailType as OrderDetailType;

  if (channel === 'whatsapp') {
    const formatters = recipientRole === 'seller'
      ? whatsappSellerFormatters
      : whatsappCustomerFormatters;

    const formatter = formatters[eventType];
    const body = formatter
      ? formatter(event)
      : `📋 Order ${event.humanReadableId} status updated to ${event.status}.`;

    return { channel, recipientRole, body };
  }

  // Web channel — structured JSON
  const metaMap = recipientRole === 'seller' ? webSellerMeta : webCustomerMeta;
  const metaFn = metaMap[eventType];
  const meta = metaFn
    ? metaFn(event)
    : { title: 'Order Update', message: `Order ${event.humanReadableId} status: ${event.status}` };

  const payload: WebNotificationPayload = {
    type: 'order_update',
    orderId: event.orderId,
    humanReadableId: event.humanReadableId,
    status: event.status,
    title: meta.title,
    message: meta.message,
    timestamp: event.timestamp || new Date().toISOString(),
    ...(meta.actionUrl ? { actionUrl: meta.actionUrl } : {}),
    ...(meta.actionLabel ? { actionLabel: meta.actionLabel } : {}),
  };

  return {
    channel,
    recipientRole,
    body: meta.message,
    payload,
  };
}
