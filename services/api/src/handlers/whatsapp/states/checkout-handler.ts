import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';
import { MessageRepository } from '../../../repositories/message-repository';
import { SessionRepository } from '../../../repositories/session-repository';
import { OrderService } from '../../../services/order-service';
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

  // Determine sellerId from cart items
  const sellerId = cart[0]?.sellerId;
  if (!sellerId) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: '❌ Unable to determine seller. Please try again.' },
      session.id,
    );
    return;
  }

  // Create order using OrderService with pending_seller_confirmation status
  const result = await orderService.createOrder({
    customerId: customer.id,
    customerPhone: customer.phoneNumber,
    sellerId,
    cartItems: cart,
    channel: 'whatsapp',
  });

  if (result.success && result.order) {
    const order = result.order;

    // Resolve seller name for the confirmation message
    const sellerName = await resolveSellerName(order.sellerId);

    // Send confirmation message per Req 2.7, 16.3
    const confirmMsg = `🛒 Order #${order.orderId} placed! Waiting for ${sellerName} to confirm. We'll notify you once confirmed.`;

    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: confirmMsg },
      session.id,
    );

    // Clear cart
    await sessionRepository.clearCart(customer.id, customer.phoneNumber);

    // Transition WhatsApp session state to tracking (Req 2.5)
    await sessionRepository.updateState(
      session.id,
      customer.id,
      customer.phoneNumber,
      'tracking'
    );

    logger.info('Order placed successfully with pending_seller_confirmation', {
      sessionId: session.id,
      orderId: order.orderId,
      totalAmount: order.totalAmount,
      sellerId: order.sellerId,
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
 * Resolve seller display name from sellerId.
 * Falls back to "the seller" if lookup fails.
 */
async function resolveSellerName(sellerId: string): Promise<string> {
  try {
    const { UserRepository } = await import('../../../repositories/user-repository.js');
    const userRepo = new UserRepository();
    const seller = await userRepo.getUserById(sellerId);
    return seller?.email?.split('@')[0] || 'the seller';
  } catch {
    return 'the seller';
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
