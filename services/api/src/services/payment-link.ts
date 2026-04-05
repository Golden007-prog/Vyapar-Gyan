import { logger } from '../utils/logger';
import { RazorpayAdapter, type PaymentLinkResponse } from '../adapters/razorpay-adapter';
import type { Order, OrderItem } from './order-service';

const razorpayAdapter = new RazorpayAdapter();

/** Result of generating a WhatsApp payment link */
export interface WhatsAppPaymentLinkResult {
  paymentLink: PaymentLinkResponse;
  whatsappMessage: string;
}

/**
 * Format a WhatsApp payment message with order summary and payment link.
 *
 * Exported as a pure function for property testing (P24).
 */
export function formatPaymentMessage(
  order: Pick<Order, 'orderId' | 'items' | 'totalAmount'>,
  paymentLinkUrl: string,
): string {
  const lines: string[] = [
    '🛒 *Order Summary*',
    '',
  ];

  order.items.forEach((item: OrderItem, idx: number) => {
    lines.push(`${idx + 1}. ${item.name} × ${item.quantity} — ₹${item.price * item.quantity}`);
  });

  lines.push('');
  lines.push(`*Total: ₹${order.totalAmount}*`);
  lines.push('');
  lines.push('💳 Pay securely via UPI or card:');
  lines.push(paymentLinkUrl);
  lines.push('');
  lines.push('⏰ This link expires in 30 minutes.');

  return lines.join('\n');
}


/**
 * Generate a Razorpay Payment Link for WhatsApp checkout and format the
 * WhatsApp message with order summary + payment URL.
 *
 * Requirements: 20.1, 20.2
 */
export async function generateWhatsAppPaymentLink(
  order: Order,
): Promise<WhatsAppPaymentLinkResult> {
  // Resolve seller Razorpay linked account ID
  const sellerAccountId =
    process.env.RAZORPAY_SELLER_ACCOUNT_ID || 'acc_SELLER_PLACEHOLDER';

  logger.info('Generating WhatsApp payment link', {
    orderId: order.orderId,
    totalAmount: order.totalAmount,
    customerPhone: order.customerPhone,
  });

  const paymentLink = await razorpayAdapter.createPaymentLink({
    orderId: order.id,
    amount: order.totalAmount,
    customerPhone: order.customerPhone,
    customerName: order.shippingAddress?.name || 'Customer',
    description: `Order ${order.orderId}`,
    sellerAccountId,
    commissionAmount: order.commissionAmount,
  });

  const whatsappMessage = formatPaymentMessage(order, paymentLink.short_url);

  logger.info('WhatsApp payment link generated', {
    orderId: order.orderId,
    paymentLinkId: paymentLink.id,
    shortUrl: paymentLink.short_url,
  });

  return { paymentLink, whatsappMessage };
}
