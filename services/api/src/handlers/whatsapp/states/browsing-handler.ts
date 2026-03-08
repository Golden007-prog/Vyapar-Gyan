import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';
import { MessageRepository } from '../../../repositories/message-repository';
import { SessionRepository } from '../../../repositories/session-repository';
import { CatalogRepository } from '../../../repositories/catalog-repository';
import { checkoutHandler } from './checkout-handler';
import type { MessageContext } from './router';

const messageRepository = new MessageRepository();
const sessionRepository = new SessionRepository();
const catalogRepository = new CatalogRepository();

/**
 * Browsing State Handler
 * 
 * Handles product catalog browsing, search, and selection.
 * Transitions to product_inquiry state when customer selects a product.
 */
export async function browsingHandler(context: MessageContext): Promise<void> {
  const { message, customer, session } = context;

  logger.info('Processing browsing state', {
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

  // Detect intent from message
  const intent = detectIntent(message);

  logger.info('Intent detected', {
    sessionId: session.id,
    intent: intent.type,
  });

  switch (intent.type) {
    case 'browse_category':
      await handleBrowseCategory(context, intent.categoryId);
      break;

    case 'show_categories':
      await handleShowCategories(context);
      break;

    case 'view_product':
      await handleViewProduct(context, intent.productId);
      break;

    case 'search_products':
      await handleSearchProducts(context, intent.query);
      break;

    case 'add_to_cart':
      await handleAddToCart(context, intent.productId, intent.quantity);
      break;

    case 'view_cart':
      await handleViewCart(context);
      break;

    case 'checkout':
      await handleCheckout(context);
      break;

    case 'help':
      await handleHelp(context);
      break;

    default:
      await handleFallback(context);
  }
}

/**
 * Simple intent detection based on message content
 */
function detectIntent(message: any): any {
  // Handle interactive message responses
  if (message.type === 'interactive') {
    const response = message.interactive;
    
    if (response.type === 'button_reply') {
      const buttonId = response.button_reply.id;
      
      if (buttonId.startsWith('cat_')) {
        return { type: 'browse_category', categoryId: buttonId.replace('cat_', '') };
      }
      if (buttonId.startsWith('prod_')) {
        return { type: 'view_product', productId: buttonId.replace('prod_', '') };
      }
      if (buttonId.startsWith('add_')) {
        // Format: add_{productId}_{quantity}
        const parts = buttonId.split('_');
        return { 
          type: 'add_to_cart', 
          productId: parts[1], 
          quantity: parseInt(parts[2] || '1', 10) 
        };
      }
      if (buttonId === 'view_cart') {
        return { type: 'view_cart' };
      }
      if (buttonId === 'checkout') {
        return { type: 'checkout' };
      }
      if (buttonId === 'continue_shopping') {
        return { type: 'show_categories' };
      }
    }
    
    if (response.type === 'list_reply') {
      const listId = response.list_reply.id;
      
      if (listId.startsWith('cat_')) {
        return { type: 'browse_category', categoryId: listId.replace('cat_', '') };
      }
      if (listId.startsWith('prod_')) {
        return { type: 'view_product', productId: listId.replace('prod_', '') };
      }
    }
  }

  // Handle text messages
  if (message.type === 'text') {
    const text = message.text.body.toLowerCase().trim();

    // Show categories
    if (text.match(/^(categories|menu|show categories|list|browse)$/i)) {
      return { type: 'show_categories' };
    }

    // View cart
    if (text.match(/^(cart|view cart|my cart|show cart)$/i)) {
      return { type: 'view_cart' };
    }

    // Help
    if (text.match(/^(help|support|assist)$/i)) {
      return { type: 'help' };
    }

    // Search (anything else is treated as search query)
    if (text.length > 2) {
      return { type: 'search_products', query: text };
    }
  }

  return { type: 'fallback' };
}

/**
 * Handle category browsing
 */
async function handleBrowseCategory(context: MessageContext, categoryId: string): Promise<void> {
  const { customer, session } = context;

  const category = await catalogRepository.getCategoryById(categoryId);
  if (!category) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: 'Sorry, that category is not available. Type "categories" to see all options.',
      },
      session.id
    );
    return;
  }

  const products = await catalogRepository.getProductsByCategory(categoryId, 10);

  if (products.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: `No products available in ${category.name} right now. Type "categories" to browse other options.`,
      },
      session.id
    );
    return;
  }

  // Show products as list
  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'interactive',
      body: `📦 *${category.name}*\n\nFound ${products.length} products:`,
      buttonText: 'View Products',
      sections: [
        {
          title: category.name,
          rows: products.map(prod => ({
            id: `prod_${prod.id}`,
            title: prod.name.substring(0, 24),
            description: `₹${prod.price} • ${prod.stockQuantity} in stock`.substring(0, 72),
          })),
        },
      ],
    },
    session.id
  );

  logger.info('Category products shown', {
    sessionId: session.id,
    categoryId,
    productCount: products.length,
  });
}

/**
 * Handle showing all categories
 */
async function handleShowCategories(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  const categories = await catalogRepository.getCategories();

  if (categories.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: 'No categories available right now. Please check back soon!',
      },
      session.id
    );
    return;
  }

  if (categories.length <= 3) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'interactive',
        body: '📂 *Product Categories*\n\nSelect a category to browse:',
        buttons: categories.slice(0, 3).map(cat => ({
          id: `cat_${cat.id}`,
          title: cat.name.substring(0, 20),
        })),
      },
      session.id
    );
  } else {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'interactive',
        body: '📂 *Product Categories*\n\nSelect a category to browse:',
        buttonText: 'View Categories',
        sections: [
          {
            title: 'All Categories',
            rows: categories.map(cat => {
              const row: { id: string; title: string; description?: string } = {
                id: `cat_${cat.id}`,
                title: cat.name.substring(0, 24),
              };
              if (cat.description) {
                row.description = cat.description.substring(0, 72);
              }
              return row;
            }),
          },
        ],
      },
      session.id
    );
  }
}

/**
 * Handle product view
 */
async function handleViewProduct(context: MessageContext, productId: string): Promise<void> {
  const { customer, session } = context;

  const product = await catalogRepository.getProductById(productId);
  if (!product) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: 'Sorry, that product is not available.',
      },
      session.id
    );
    return;
  }

  // Format product details
  const details = [
    `🛍️ *${product.name}*`,
    '',
    product.description,
    '',
    `💰 Price: ₹${product.price}`,
    `📦 Stock: ${product.stockQuantity} available`,
  ].join('\n');

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: details + '\n\nType "categories" to browse more products.',
    },
    session.id
  );

  logger.info('Product details shown', {
    sessionId: session.id,
    productId,
  });
}

/**
 * Handle product search
 */
async function handleSearchProducts(context: MessageContext, query: string): Promise<void> {
  const { customer, session } = context;

  const products = await catalogRepository.searchProducts(query, 10);

  if (products.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: `No products found for "${query}". Type "categories" to browse all products.`,
      },
      session.id
    );
    return;
  }

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'interactive',
      body: `🔍 Search results for "${query}"\n\nFound ${products.length} products:`,
      buttonText: 'View Products',
      sections: [
        {
          title: 'Search Results',
          rows: products.map(prod => ({
            id: `prod_${prod.id}`,
            title: prod.name.substring(0, 24),
            description: `₹${prod.price} • ${prod.stockQuantity} in stock`.substring(0, 72),
          })),
        },
      ],
    },
    session.id
  );

  logger.info('Search results shown', {
    sessionId: session.id,
    query,
    resultCount: products.length,
  });
}

/**
 * Handle adding product to cart
 */
async function handleAddToCart(context: MessageContext, productId: string, quantity: number): Promise<void> {
  const { customer, session } = context;

  // Fetch product details
  const product = await catalogRepository.getProductById(productId);
  if (!product) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: 'Sorry, that product is not available.',
      },
      session.id
    );
    return;
  }

  // Check stock availability
  if (product.stockQuantity < quantity) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: `Sorry, only ${product.stockQuantity} units available for ${product.name}.`,
      },
      session.id
    );
    return;
  }

  // Add to cart
  const updatedCart = await sessionRepository.addToCart(customer.id, customer.phoneNumber, {
    productId: product.id,
    name: product.name,
    price: product.price,
    quantity,
    sellerId: product.sellerId,
  });

  // Calculate cart subtotal
  const subtotal = sessionRepository.calculateCartSubtotal(updatedCart);
  const itemCount = updatedCart.reduce((sum, item) => sum + item.quantity, 0);

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'interactive',
      body: `✅ Added ${quantity}x ${product.name} to cart\n\n🛒 Cart: ${itemCount} items • ₹${subtotal.toFixed(2)}`,
      buttons: [
        { id: 'view_cart', title: 'View Cart' },
        { id: 'continue_shopping', title: 'Continue Shopping' },
      ],
    },
    session.id
  );

  logger.info('Product added to cart', {
    sessionId: session.id,
    productId,
    quantity,
    subtotal,
  });
}

/**
 * Handle viewing cart
 */
async function handleViewCart(context: MessageContext): Promise<void> {
  const { customer, session } = context;

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

  // Format cart items
  const itemsList = cart.map((item, idx) => 
    `${idx + 1}. ${item.name}\n   ${item.quantity}x ₹${item.price} = ₹${(item.quantity * item.price).toFixed(2)}`
  ).join('\n\n');

  const subtotal = sessionRepository.calculateCartSubtotal(cart);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const cartMessage = [
    `🛒 *Your Cart* (${itemCount} items)`,
    '',
    itemsList,
    '',
    `💰 *Subtotal: ₹${subtotal.toFixed(2)}*`,
  ].join('\n');

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'interactive',
      body: cartMessage,
      buttons: [
        { id: 'checkout', title: 'Checkout' },
        { id: 'continue_shopping', title: 'Continue Shopping' },
      ],
    },
    session.id
  );

  logger.info('Cart displayed', {
    sessionId: session.id,
    itemCount,
    subtotal,
  });
}

/**
 * Handle checkout initiation
 */
async function handleCheckout(context: MessageContext): Promise<void> {
  const { customer, session } = context;

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

  // Transition to checkout state
  await sessionRepository.updateState(session.id, customer.id, customer.phoneNumber, 'checkout');

  // Trigger checkout handler by sending a checkout message
  const checkoutContext = {
    ...context,
    session: {
      ...session,
      state: 'checkout',
      cart,
    },
  };

  await checkoutHandler(checkoutContext);

  logger.info('Transitioned to checkout state', {
    sessionId: session.id,
    itemCount: cart.length,
  });
}

/**
 * Handle help request
 */
async function handleHelp(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  const helpText = [
    '🤝 *How can I help you?*',
    '',
    '• Type "categories" to browse products',
    '• Type product name to search',
    '• Select from menu options',
    '• Type "cart" to view your cart',
    '• Type "help" anytime for assistance',
  ].join('\n');

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: helpText,
    },
    session.id
  );
}

/**
 * Handle fallback for unrecognized input
 */
async function handleFallback(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: 'I didn\'t understand that. Type "categories" to browse products or "help" for assistance.',
    },
    session.id
  );
}
