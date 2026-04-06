/**
 * Seller Order Handler
 *
 * Handles seller ACCEPT / REJECT commands via WhatsApp.
 *
 * Supported commands (case-insensitive):
 * - ACCEPT           → Accept most recent pending order
 * - REJECT           → Reject most recent pending order
 * - ACCEPT {orderId} → Accept specific order
 * - REJECT {orderId} → Reject specific order
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';
import { MessageRepository } from '../../../repositories/message-repository';
import { OrderService } from '../../../services/order-service';
import type { MessageContext } from './router';

const messageRepository = new MessageRepository();
const orderService = new OrderService();

// ── Seller Command Parser (pure function, exported for property testing) ──

export interface SellerCommand {
  action: 'accept' | 'reject';
  orderId: string | null;
}

/**
 * Parse a seller command from a WhatsApp message text.
 *
 * Returns null if the message does not match ACCEPT or REJECT patterns.
 * Returns { action, orderId } where orderId is null for bare commands.
 *
 * Exported for property testing (Property 11).
 */
export function parseSellerCommand(text: string): SellerCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Match: ACCEPT or REJECT optionally followed by an orderId
  const match = trimmed.match(/^(accept|reject)(?:\s+(.+))?$/i);
  if (!match) return null;

  const action = match[1]!.toLowerCase() as 'accept' | 'reject';
  const orderId = match[2]?.trim() || null;

  return { action, orderId };
}

// ── Handler ──

export async function sellerOrderHandler(context: MessageContext): Promise<void> {
  const { message, customer, session } = context;

  logger.info('Processing seller order state', {
    sellerId: customer.id,
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
  const command = parseSellerCommand(text);

  if (!command) {
    // Not a recognized command — show help
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: '📋 *Seller Order Commands*\n\n• *ACCEPT* — Accept the latest pending order\n• *REJECT* — Reject the latest pending order\n• *ACCEPT {orderId}* — Accept a specific order\n• *REJECT {orderId}* — Reject a specific order',
      },
      session.id,
      'seller',
    );
    return;
  }

  if (command.action === 'accept') {
    await handleAccept(context, command.orderId);
  } else {
    await handleReject(context, command.orderId);
  }
}

/**
 * Handle ACCEPT command.
 */
async function handleAccept(context: MessageContext, targetOrderId: string | null): Promise<void> {
  const { customer, session } = context;
  const sellerId = customer.id;

  try {
    const orderUUID = await resolveOrderUUID(sellerId, targetOrderId);

    if (!orderUUID) {
      const msg = targetOrderId
        ? `⚠️ Order ${targetOrderId} not found or is not pending.`
        : '⚠️ No pending orders found.';
      await whatsappSender.sendMessage(customer.phoneNumber, { type: 'text', text: msg }, session.id, 'seller');
      return;
    }

    // Fetch full order to check current status
    const order = await orderService.getOrder(orderUUID);
    if (!order) {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: '⚠️ Order not found.' },
        session.id,
        'seller',
      );
      return;
    }

    // Check if already processed (Req 6.6)
    if (order.status !== 'pending_seller_confirmation') {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: `⚠️ Order #${order.orderId} is already ${order.status}.` },
        session.id,
        'seller',
      );
      return;
    }

    const result = await orderService.transitionOrder({
      orderId: orderUUID,
      targetStatus: 'confirmed',
      actor: 'seller',
      actorId: sellerId,
    });

    if (result.success) {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: `✅ Order #${order.orderId} accepted!` },
        session.id,
        'seller',
      );
      logger.info('Seller accepted order via WhatsApp', { sellerId, orderId: order.orderId });
    } else {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: `⚠️ Could not accept order #${order.orderId}: ${result.error}` },
        session.id,
        'seller',
      );
    }
  } catch (error) {
    logger.error('Failed to handle ACCEPT command', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Sorry, something went wrong. Please try again.' },
      session.id,
      'seller',
    );
  }
}

/**
 * Handle REJECT command.
 */
async function handleReject(context: MessageContext, targetOrderId: string | null): Promise<void> {
  const { customer, session } = context;
  const sellerId = customer.id;

  try {
    const orderUUID = await resolveOrderUUID(sellerId, targetOrderId);

    if (!orderUUID) {
      const msg = targetOrderId
        ? `⚠️ Order ${targetOrderId} not found or is not pending.`
        : '⚠️ No pending orders found.';
      await whatsappSender.sendMessage(customer.phoneNumber, { type: 'text', text: msg }, session.id, 'seller');
      return;
    }

    const order = await orderService.getOrder(orderUUID);
    if (!order) {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: '⚠️ Order not found.' },
        session.id,
        'seller',
      );
      return;
    }

    // Check if already processed (Req 6.6)
    if (order.status !== 'pending_seller_confirmation') {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: `⚠️ Order #${order.orderId} is already ${order.status}.` },
        session.id,
        'seller',
      );
      return;
    }

    const result = await orderService.transitionOrder({
      orderId: orderUUID,
      targetStatus: 'rejected',
      actor: 'seller',
      actorId: sellerId,
      reason: 'Seller declined via WhatsApp',
    });

    if (result.success) {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: `❌ Order #${order.orderId} rejected.` },
        session.id,
        'seller',
      );
      logger.info('Seller rejected order via WhatsApp', { sellerId, orderId: order.orderId });
    } else {
      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: `⚠️ Could not reject order #${order.orderId}: ${result.error}` },
        session.id,
        'seller',
      );
    }
  } catch (error) {
    logger.error('Failed to handle REJECT command', {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Sorry, something went wrong. Please try again.' },
      session.id,
      'seller',
    );
  }
}

/**
 * Resolve an order UUID from either a human-readable orderId or the most recent pending order.
 *
 * If targetOrderId is provided, searches seller's orders for a match.
 * If null, returns the most recent pending_seller_confirmation order.
 */
async function resolveOrderUUID(sellerId: string, targetOrderId: string | null): Promise<string | null> {
  if (targetOrderId) {
    // Search seller's pending orders for a matching human-readable orderId
    const orders = await orderService.listSellerOrders(sellerId, 'pending_seller_confirmation', 50);
    const match = orders.find(o => o.orderId === targetOrderId);
    return match?.orderUUID || null;
  }

  // No specific orderId — get most recent pending order
  const orders = await orderService.listSellerOrders(sellerId, 'pending_seller_confirmation', 1);
  return orders.length > 0 ? orders[0]!.orderUUID : null;
}
