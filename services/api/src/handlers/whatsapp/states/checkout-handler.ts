import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';
import { MessageRepository } from '../../../repositories/message-repository';
import { SessionRepository } from '../../../repositories/session-repository';
import { OrderService } from '../../../services/order-service';
import { generateWhatsAppPaymentLink } from '../../../services/payment-link';
import type { MessageContext } from './router';

const messageRepository = new MessageRepository();
const sessionRepository = new SessionRepository();
const orderService = new OrderService();

/**
 * Checkout State Handler
 * 
 * Handles cart management, order confirmation, and order placement.
 * 
 * Supported intents:
 * - add_to_cart: Add product to cart
 * - view_cart: Show current cart
 * - checkout: Initiate checkout flow
 * - confirm_order: Confirm and place order (when user replies "YES")
 * - remove_from_cart: Remove item from cart
 */
export async function checkoutHandler(context: MessageContext): Promise<void> {
  const { message, customer, session } = context;

  logger.info('Processing checkout state', {
    customerId: customer.id,
    sessionId: session.id,
    messageType: message.type,
    sessionState: session.state,
  });

  // Store inbound message
  await messageRepository.create({
    sessionId: session.id,
    waMessageId: message.id,
    direction: 'inbound',
    messageType: message.type,
    content: message,
  });

  // Extract message text
  const messageText = message.text?.body?.toLowerCase().trim() || '';

  // Handle different checkout intents
  if (session.state === 'checkout' && (messageText === 'yes' || messageText === 'confirm')) {
    // User confirmed order - place it
    await handleOrderConfirmation(context);
  } else if (messageText.includes('cart') || messageText.includes('view cart')) {
    // Show cart
    await handleViewCart(context);
  } else if (messageText.includes('checkout')) {
    // Initiate checkout
    await handleInitiateCheckout(context);
  } else if (messageText === 'no' || messageText === 'cancel') {
    // Cancel checkout
    await handleCancelCheckout(context);
  } else {
    // Default: show cart and checkout options
    await handleViewCart(context);
  }
}

/**
 * Handle viewing cart
 */
async function handleViewCart(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  // Get cart from session
  const cart = await sessionRepository.getCart(customer.id, customer.phoneNumber);

  if (!cart || cart.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: '🛒 Your cart is empty.\n\nType "categories" to start shopping!',
      },
      session.id
    );
    return;
  }

  // Calculate subtotal
  const subtotal = sessionRepository.calculateCartSubtotal(cart);

  // Build cart message
  let cartMessage = '🛒 *Your Cart*\n\n';
  
  cart.forEach((item, index) => {
    cartMessage += `${index + 1}. ${item.name}\n`;
    cartMessage += `   ₹${item.price} × ${item.quantity} = ₹${item.price * item.quantity}\n\n`;
  });

  cartMessage += `*Subtotal:* ₹${subtotal}\n\n`;
  cartMessage += 'Reply *CHECKOUT* to place your order\n';
  cartMessage += 'Reply *CATEGORIES* to continue shopping';

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: cartMessage,
    },
    session.id
  );

  logger.info('Cart displayed', {
    sessionId: session.id,
    itemCount: cart.length,
    subtotal,
  });
}

/**
 * Handle initiating checkout
 */
async function handleInitiateCheckout(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  // Get cart from session
  const cart = await sessionRepository.getCart(customer.id, customer.phoneNumber);

  if (!cart || cart.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: '🛒 Your cart is empty. Add some products first!',
      },
      session.id
    );
    return;
  }

  // Calculate subtotal
  const subtotal = sessionRepository.calculateCartSubtotal(cart);

  // Build order summary
  let summaryMessage = '📋 *Order Summary*\n\n';
  
  cart.forEach((item, index) => {
    summaryMessage += `${index + 1}. ${item.name}\n`;
    summaryMessage += `   ₹${item.price} × ${item.quantity} = ₹${item.price * item.quantity}\n\n`;
  });

  summaryMessage += `*Total Amount:* ₹${subtotal}\n\n`;
  summaryMessage += '✅ Reply *YES* to confirm and place your order\n';
  summaryMessage += '❌ Reply *NO* to cancel';

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: summaryMessage,
    },
    session.id
  );

  // Update session state to checkout (waiting for confirmation)
  await sessionRepository.updateState(
    session.id,
    customer.id,
    customer.phoneNumber,
    'checkout'
  );

  logger.info('Checkout initiated', {
    sessionId: session.id,
    itemCount: cart.length,
    subtotal,
  });
}

/**
 * Handle order confirmation and placement
 */
async function handleOrderConfirmation(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  // Get cart from session
  const cart = await sessionRepository.getCart(customer.id, customer.phoneNumber);

  if (!cart || cart.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: '❌ Your cart is empty. Cannot place order.',
      },
      session.id
    );
    return;
  }

  // Send processing message
  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: '⏳ Processing your order...',
    },
    session.id
  );

  // Create order using OrderService
  const result = await orderService.createOrder({
    customerId: customer.id,
    customerPhone: customer.phoneNumber,
    cartItems: cart,
    // TODO: Collect shipping address in future
  });

  if (result.success && result.order) {
    // Order created successfully
    const order = result.order;

    // Generate Razorpay payment link via payment-link service (Req 20.1, 20.2)
    try {
      const { whatsappMessage } = await generateWhatsAppPaymentLink(order);

      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: whatsappMessage },
        session.id,
      );

      logger.info('Payment link message sent', {
        sessionId: session.id,
        orderId: order.orderId,
        amount: order.totalAmount,
      });
    } catch (error) {
      logger.error('Failed to generate payment link', {
        sessionId: session.id,
        orderId: order.orderId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback: send order confirmation without payment link
      let fallbackMsg = '✅ *Order Created!*\n\n';
      fallbackMsg += `📦 Order ID: *${order.orderId}*\n`;
      fallbackMsg += `💰 Total: *₹${order.totalAmount}*\n\n`;
      fallbackMsg += 'Payment link will be sent shortly. Please wait for payment instructions.\n\n';
      fallbackMsg += 'Thank you for shopping with VyaparGyan! 🎉';

      await whatsappSender.sendMessage(
        customer.phoneNumber,
        { type: 'text', text: fallbackMsg },
        session.id,
      );
    }

    // Clear cart
    await sessionRepository.clearCart(customer.id, customer.phoneNumber);

    // Update session state back to browsing
    await sessionRepository.updateState(
      session.id,
      customer.id,
      customer.phoneNumber,
      'browsing'
    );

    logger.info('Order placed successfully', {
      sessionId: session.id,
      orderId: order.orderId,
      totalAmount: order.totalAmount,
      hasPaymentLink: !!paymentLink,
    });
  } else {
    // Order creation failed
    let errorMessage = '❌ *Order Failed*\n\n';
    
    if (result.outOfStockItems && result.outOfStockItems.length > 0) {
      errorMessage += 'Sorry, the following items are out of stock:\n\n';
      result.outOfStockItems.forEach((item) => {
        errorMessage += `• ${item}\n`;
      });
      errorMessage += '\nPlease remove them from your cart and try again.';
    } else {
      errorMessage += result.error || 'Unable to place order. Please try again later.';
    }

    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: errorMessage,
      },
      session.id
    );

    // Keep in checkout state so user can retry
    logger.error('Order creation failed', {
      sessionId: session.id,
      error: result.error,
      outOfStockItems: result.outOfStockItems,
    });
  }
}

/**
 * Handle canceling checkout
 */
async function handleCancelCheckout(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: '❌ Checkout cancelled.\n\nYour cart is still saved. Type *CART* to view it or *CATEGORIES* to continue shopping.',
    },
    session.id
  );

  // Update session state back to browsing
  await sessionRepository.updateState(
    session.id,
    customer.id,
    customer.phoneNumber,
    'browsing'
  );

  logger.info('Checkout cancelled', {
    sessionId: session.id,
  });
}
