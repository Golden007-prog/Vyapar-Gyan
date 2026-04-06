/**
 * Tracking State Handler
 *
 * Handles customer interactions after an order has been placed.
 *
 * Supported commands:
 * - Order status inquiries ("where is my order", "order status", "track")
 * - PAY: Look up latest payment_pending order and resend payment link
 * - REORDER: Recreate cart from last order items
 * - BROWSE / CATEGORIES: Transition back to browsing
 *
 * Requirements: 16.8
 */

import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';
import { MessageRepository } from '../../../repositories/message-repository';
import { SessionRepository } from '../../../repositories/session-repository';
import { OrderService } from '../../../services/order-service';
import type { MessageContext } from './router';

const messageRepository = new MessageRepository();
const sessionRepository = new SessionRepository();
const orderService = new OrderService();

/** Status labels for human-readable display */
const STATUS_LABELS: Record<string, string> = {
  pending_seller_confirmation: '⏳ Waiting for seller confirmation',
  confirmed: '✅ Confirmed by seller',
  payment_pending: '💳 Awaiting payment',
  paid: '💰 Payment received',
  preparing: '📦 Being prepared',
  shipped: '🚚 Shipped',
  delivered: '✅ Delivered',
  completed: '🎉 Completed',
  rejected: '❌ Rejected by seller',
  cancelled: '🚫 Cancelled',
  payment_failed: '❌ Payment failed',
  expired: '⏰ Expired',
};

export async function trackingHandler(context: MessageContext): Promise<void> {
  const { message, customer, session } = context;

  logger.info('Processing tracking state', {
    customerId: customer.id,
    sessionId: session.id,
    messageType: message.type,
  });

  // Store inbound message
  await messageRepository.create({
    sessionId: session.id,
    waMessageId: message.id,
    direction: 'inbound',
    messageType: message.type,
    content: message,
  });

  const text = (message.text?.body || '').trim();
  const lower = text.toLowerCase();

  if (lower === 'pay') {
    await handlePayCommand(context);
  } else if (lower === 'reorder') {
    await handleReorderCommand(context);
  } else if (/^(browse|categories|menu|shop)$/i.test(lower)) {
    await handleBackToBrowsing(context);
  } else {
    // Default: show latest order status
    await handleOrderStatusInquiry(context);
  }
}

/**
 * Show the customer their most recent order status.
 */
async function handleOrderStatusInquiry(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  try {
    const orders = await orderService.listCustomerOrders(customer.id, undefined, 3);

    if (orders.length === 0) {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: "You don't have any orders yet.\n\nType *BROWSE* to start shopping!" },
        session.id,
      );
      return;
    }

    let msg = '📋 *Your Recent Orders*\n\n';
    for (const order of orders) {
      const statusLabel = STATUS_LABELS[order.status] || order.status;
      msg += `📦 *${order.orderId}* — ₹${order.totalAmount}\n`;
      msg += `   ${statusLabel}\n\n`;
    }

    msg += 'Commands:\n';
    msg += '• *PAY* — Pay for a pending order\n';
    msg += '• *REORDER* — Reorder from your last order\n';
    msg += '• *BROWSE* — Continue shopping';

    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: msg },
      session.id,
    );
  } catch (error) {
    logger.error('Failed to fetch order status', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Sorry, I could not fetch your order status right now. Please try again.' },
      session.id,
    );
  }
}

/**
 * Handle PAY command: look up latest payment_pending order and resend payment link.
 */
async function handlePayCommand(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  try {
    const orders = await orderService.listCustomerOrders(customer.id, 'payment_pending', 1);

    if (orders.length === 0) {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: 'No orders are currently awaiting payment.\n\nType *BROWSE* to start shopping!' },
        session.id,
      );
      return;
    }

    const orderSummary = orders[0]!;
    // Fetch full order to get payment link
    const order = await orderService.getOrder(orderSummary.orderUUID);

    if (!order) {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: 'Could not find order details. Please try again.' },
        session.id,
      );
      return;
    }

    if (order.paymentLinkUrl) {
      const msg = `💳 Pay for order *${order.orderId}* — ₹${order.totalAmount}\n\n${order.paymentLinkUrl}\n\n⏰ Complete payment before the link expires.`;
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: msg },
        session.id,
      );
    } else {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: `Order *${order.orderId}* is awaiting payment but the payment link hasn't been generated yet. Please wait for the seller to confirm.` },
        session.id,
      );
    }
  } catch (error) {
    logger.error('Failed to handle PAY command', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Sorry, something went wrong. Please try again.' },
      session.id,
    );
  }
}

/**
 * Handle REORDER command: recreate cart from last order items.
 */
async function handleReorderCommand(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  try {
    const orders = await orderService.listCustomerOrders(customer.id, undefined, 1);

    if (orders.length === 0) {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: "You don't have any previous orders to reorder from.\n\nType *BROWSE* to start shopping!" },
        session.id,
      );
      return;
    }

    const orderSummary = orders[0]!;
    const order = await orderService.getOrder(orderSummary.orderUUID);

    if (!order || !order.items || order.items.length === 0) {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: 'Could not retrieve items from your last order. Please try again.' },
        session.id,
      );
      return;
    }

    // Add each item from the last order to the cart
    for (const item of order.items) {
      await sessionRepository.addToCart(customer.id, customer.phoneNumber, {
        productId: item.productId,
        sellerId: item.sellerId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      });
    }

    const subtotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: `🛒 Added ${itemCount} items from order *${order.orderId}* to your cart.\n\n💰 Subtotal: ₹${subtotal}\n\nReply *CHECKOUT* to place your order or *CART* to review.`,
      },
      session.id,
    );

    // Transition to browsing so checkout flow works
    await sessionRepository.updateState(session.id, customer.id, customer.phoneNumber, 'browsing');

    logger.info('Reorder cart created', {
      sessionId: session.id,
      fromOrderId: order.orderId,
      itemCount,
    });
  } catch (error) {
    logger.error('Failed to handle REORDER command', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Sorry, something went wrong. Please try again.' },
      session.id,
    );
  }
}

/**
 * Transition back to browsing state.
 */
async function handleBackToBrowsing(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  await sessionRepository.updateState(session.id, customer.id, customer.phoneNumber, 'browsing');

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    { type: 'text', text: '🛍️ Back to shopping!\n\nType a product name to search or *CATEGORIES* to browse.' },
    session.id,
  );
}
