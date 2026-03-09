import { logger } from '../../../utils/logger';
import { whatsappSender } from '../../../services/whatsapp-sender';
import { MessageRepository } from '../../../repositories/message-repository';
import { SessionRepository } from '../../../repositories/session-repository';
import { CatalogRepository } from '../../../repositories/catalog-repository';
import { updateSessionState } from '../../../adapters/dynamodb-adapter';
import { findBestMatch, type ProductCandidate } from '../../../utils/product-matcher';
import { safeName } from '../../../utils/safe-name';
import { checkoutHandler } from './checkout-handler';
import type { MessageContext } from './router';

const messageRepository = new MessageRepository();
const sessionRepository = new SessionRepository();
const catalogRepository = new CatalogRepository();

// ── Menu context type stored in session.context ────────────────────────

interface MenuOption {
  index: number;
  id: string;
  name: string;
  type: 'category' | 'product';
}

interface MenuContext {
  lastMenu?: string;
  menuOptions?: MenuOption[];
  menuSentAt?: string;
}

// ── Intent types ───────────────────────────────────────────────────────

type Intent =
  | { type: 'browse_category'; categoryId: string }
  | { type: 'show_categories' }
  | { type: 'view_product'; productId: string }
  | { type: 'search_products'; query: string }
  | { type: 'stock_check'; query: string }
  | { type: 'price_check'; query: string }
  | { type: 'add_to_cart'; productId: string; quantity: number }
  | { type: 'view_cart' }
  | { type: 'checkout' }
  | { type: 'help' }
  | { type: 'greeting' }
  | { type: 'numeric_reply'; number: number }
  | { type: 'fallback' };

/**
 * Browsing State Handler
 *
 * Handles product catalog browsing, search, stock checks, price checks,
 * and numeric menu replies. Transitions to product_inquiry or checkout
 * states as needed.
 *
 * Session context is used to resolve numeric replies ("1", "2") against
 * the last menu that was sent to the customer.
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

  // Load session context for menu resolution
  const menuContext = await loadMenuContext(customer.id, customer.phoneNumber);

  // Detect intent from message
  const intent = detectIntent(message, menuContext);

  logger.info('Intent detected', {
    sessionId: session.id,
    intent: intent.type,
  });

  // Ensure we're in browsing state (may have been routed here from greeting)
  if (session.state === 'greeting') {
    await updateSessionState(session.id, 'browsing', 'whatsapp');
  }

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
    case 'stock_check':
      await handleStockCheck(context, intent.query);
      break;
    case 'price_check':
      await handlePriceCheck(context, intent.query);
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
    case 'greeting':
      await handleCustomerGreeting(context);
      break;
    case 'numeric_reply':
      await handleNumericReply(context, intent.number, menuContext);
      break;
    default:
      await handleFallback(context);
  }
}

// ── Intent Detection ───────────────────────────────────────────────────

/**
 * Detect intent from an incoming message.
 *
 * Priority order (highest first):
 * 1. Interactive button/list replies (WhatsApp native)
 * 2. Stock-check intent ("check stock of X", "X stock", "do you have X")
 * 3. Price-check intent ("price of X", "how much is X")
 * 4. Explicit commands (categories, cart, help, checkout)
 * 5. Greetings (hi, hello, namaste)
 * 6. Numeric replies resolved against stored menu context
 * 7. Free-text product search (anything > 2 chars)
 * 8. Fallback
 */
function detectIntent(message: any, _menuContext?: MenuContext | null): Intent {
  // ── Interactive message responses (WhatsApp native buttons/lists) ──
  if (message.type === 'interactive') {
    const response = message.interactive;

    if (response.type === 'button_reply') {
      const buttonId: string = response.button_reply.id;
      if (buttonId.startsWith('cat_')) return { type: 'browse_category', categoryId: buttonId.replace('cat_', '') };
      if (buttonId.startsWith('prod_')) return { type: 'view_product', productId: buttonId.replace('prod_', '') };
      if (buttonId.startsWith('add_')) {
        const parts = buttonId.split('_');
        return { type: 'add_to_cart', productId: parts[1]!, quantity: parseInt(parts[2] || '1', 10) };
      }
      if (buttonId === 'view_cart') return { type: 'view_cart' };
      if (buttonId === 'checkout') return { type: 'checkout' };
      if (buttonId === 'continue_shopping') return { type: 'show_categories' };
    }

    if (response.type === 'list_reply') {
      const listId: string = response.list_reply.id;
      if (listId.startsWith('cat_')) return { type: 'browse_category', categoryId: listId.replace('cat_', '') };
      if (listId.startsWith('prod_')) return { type: 'view_product', productId: listId.replace('prod_', '') };
    }
  }

  // ── Text messages ──
  if (message.type !== 'text') return { type: 'fallback' };

  const raw = (message.text?.body || '').trim();
  const text = raw.toLowerCase();

  // ── Stock-check intent (BEFORE generic search) ──
  // Supports English + Hindi/Hinglish stock queries
  const stockMatch = text.match(
    /(?:check\s+stock(?:\s+of)?|stock\s+(?:of|for|check)?|do you have|is there|got any|have you got|available|availability|स्टॉक|स्टोक|अवेलेबल|उपलब्ध|kitne?\s+(?:stock|hai|hain|available)|stock\s+(?:kitna|kitne|hai|hain)|maal\s+hai)/i,
  );
  if (stockMatch) {
    const query = text
      .replace(/\b(check|stock|of|for|do|you|have|got|any|is|there|available|availability|please|pls|the|how|much|many)\b/gi, '')
      // Remove Hindi/Hinglish filler words for stock queries
      .replace(/(के|का|की|में|कितने|कितना|स्टॉक|स्टोक|अवेलेबल|उपलब्ध|है|हैं|हे|क्या|\?)/gi, '')
      .replace(/\b(kitna|kitne|kya|hai|hain|maal|stock|available|availability)\b/gi, '')
      .replace(/[?!.,।]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (query.length > 1) return { type: 'stock_check', query };
    return { type: 'stock_check', query: '' };
  }

  // ── Price-check intent ──
  // Supports English + Hindi/Hinglish price queries
  const priceMatch = text.match(
    /(?:price|cost|how much|kitna|kya rate|rate|kya dam|dam|दाम|कीमत|रेट|प्राइस|कितने?\s+(?:ka|ke|ki|का|के|की)?\s*(?:dam|daam|rate|price|पैसे|रुपये))/i,
  );
  if (priceMatch) {
    const query = text
      .replace(/\b(what|is|the|price|cost|of|how|much|kitna|kya|rate|dam|hai|please|pls|for)\b/gi, '')
      // Remove Hindi/Hinglish filler words for price queries
      .replace(/(के|का|की|में|कितने|कितना|दाम|कीमत|रेट|प्राइस|है|हैं|हे|क्या|पैसे|रुपये|\?)/gi, '')
      .replace(/\b(kitna|kitne|kya|hai|hain|dam|daam|rate|price|cost|rupees|paisa)\b/gi, '')
      .replace(/[?!.,।]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (query.length > 1) return { type: 'price_check', query };
    return { type: 'price_check', query: '' };
  }

  // ── Explicit commands ──
  if (/^(categories|menu|show categories|list|browse)$/i.test(text)) return { type: 'show_categories' };
  if (/^(cart|view cart|my cart|show cart)$/i.test(text)) return { type: 'view_cart' };
  if (/^(checkout|pay|order now|place order)$/i.test(text)) return { type: 'checkout' };
  if (/^(help|support|assist)$/i.test(text)) return { type: 'help' };

  // ── Greetings ──
  if (/^(hi|hello|hey|namaste|namaskar|hola)\b/i.test(text)) return { type: 'greeting' };

  // ── Numeric reply (resolve against stored menu) ──
  if (/^\d{1,2}$/.test(text)) {
    return { type: 'numeric_reply', number: parseInt(text, 10) };
  }

  // ── Free-text search (anything with enough length) ──
  if (text.length > 2) return { type: 'search_products', query: raw };

  return { type: 'fallback' };
}

// ── Menu Context Helpers ───────────────────────────────────────────────

/**
 * Load the stored menu context from the legacy session record.
 * Returns null if no context is found (non-fatal).
 */
async function loadMenuContext(
  customerId: string,
  phoneNumber: string,
): Promise<MenuContext | null> {
  try {
    const session = await sessionRepository.getByCustomer(customerId, phoneNumber);
    if (session?.context && typeof session.context === 'object') {
      return session.context as MenuContext;
    }
  } catch (err) {
    logger.warn('Failed to load menu context', {
      customerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

/**
 * Save menu context so the next numeric reply can be resolved.
 */
async function saveMenuContext(
  sessionId: string,
  customerId: string,
  phoneNumber: string,
  ctx: MenuContext,
): Promise<void> {
  try {
    await sessionRepository.updateContext(sessionId, customerId, phoneNumber, ctx as any);
  } catch (err) {
    logger.warn('Failed to save menu context', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Handler: Numeric Reply ─────────────────────────────────────────────

/**
 * Resolve a numeric reply ("1", "2", etc.) against the stored menu context.
 * If no menu context exists, treat as a search query.
 */
async function handleNumericReply(
  context: MessageContext,
  num: number,
  menuContext: MenuContext | null,
): Promise<void> {
  const { customer, session } = context;

  if (!menuContext?.menuOptions || menuContext.menuOptions.length === 0) {
    // No stored menu — treat as search
    logger.info('No menu context for numeric reply, treating as search', { num });
    await handleSearchProducts(context, String(num));
    return;
  }

  const option = menuContext.menuOptions.find(o => o.index === num);

  if (!option) {
    // Invalid number
    const maxNum = menuContext.menuOptions.length;
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'text',
        text: `Please reply with a number between 1 and ${maxNum}.`,
      },
      session.id,
    );
    return;
  }

  logger.info('Numeric reply resolved', {
    sessionId: session.id,
    num,
    resolvedType: option.type,
    resolvedId: option.id,
    resolvedName: option.name,
  });

  if (option.type === 'category') {
    await handleBrowseCategory(context, option.id);
  } else if (option.type === 'product') {
    await handleViewProduct(context, option.id);
  }
}

// ── Handler: Stock Check ───────────────────────────────────────────────

/**
 * Handle stock-check intent. If query is empty, ask for product name.
 * Otherwise fuzzy-match and return stock info directly.
 */
async function handleStockCheck(context: MessageContext, query: string): Promise<void> {
  const { customer, session } = context;

  if (!query) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Which product would you like to check stock for? Please type the product name.' },
      session.id,
    );
    return;
  }

  // Fuzzy-match across all products
  const product = await fuzzyFindProduct(query);

  if (!product) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: `I couldn't find "${query}" in our store.\n\nPlease check the product name and try again, or type "categories" to browse.` },
      session.id,
    );
    return;
  }

  if (Array.isArray(product)) {
    // Multiple matches — ask for clarification
    await sendProductClarification(context, query, product);
    return;
  }

  // Direct answer
  const stockMsg = product.stockQuantity > 0
    ? `📦 *${product.name}*\n\n✅ In stock: ${product.stockQuantity} units\n💰 Price: ₹${product.price}`
    : `📦 *${product.name}*\n\n❌ Currently out of stock`;

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    { type: 'text', text: stockMsg },
    session.id,
  );
}

// ── Handler: Price Check ───────────────────────────────────────────────

/**
 * Handle price-check intent. Similar to stock check but focused on price.
 */
async function handlePriceCheck(context: MessageContext, query: string): Promise<void> {
  const { customer, session } = context;

  if (!query) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Which product would you like to check the price for? Please type the product name.' },
      session.id,
    );
    return;
  }

  const product = await fuzzyFindProduct(query);

  if (!product) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: `I couldn't find "${query}" in our store.\n\nPlease check the product name and try again, or type "categories" to browse.` },
      session.id,
    );
    return;
  }

  if (Array.isArray(product)) {
    await sendProductClarification(context, query, product);
    return;
  }

  const priceMsg = [
    `💰 *${product.name}*`,
    '',
    `Price: ₹${product.price}`,
    `Stock: ${product.stockQuantity > 0 ? `${product.stockQuantity} available` : 'Out of stock'}`,
  ].join('\n');

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    { type: 'text', text: priceMsg },
    session.id,
  );
}

// ── Shared: Fuzzy product finder ───────────────────────────────────────

/**
 * Fuzzy-find a product across all categories.
 * Returns a single ProductCandidate, an array (multiple matches), or null.
 */
async function fuzzyFindProduct(
  query: string,
): Promise<ProductCandidate | ProductCandidate[] | null> {
  // Try index search first
  const indexed = await catalogRepository.searchProducts(query, 5);
  if (indexed.length === 1) {
    const p = indexed[0]!;
    return { id: p.id, name: p.name, price: p.price, stockQuantity: p.stockQuantity, categoryId: p.categoryId };
  }
  if (indexed.length > 1) {
    return indexed.map(p => ({ id: p.id, name: p.name, price: p.price, stockQuantity: p.stockQuantity, categoryId: p.categoryId }));
  }

  // Fallback: fuzzy match across all categories
  const categories = await catalogRepository.getCategories();
  const allProducts: ProductCandidate[] = [];
  for (const cat of categories.slice(0, 6)) {
    const catProducts = await catalogRepository.getProductsByCategory(cat.id, 50);
    for (const p of catProducts) {
      allProducts.push({ id: p.id, name: p.name, price: p.price, stockQuantity: p.stockQuantity, categoryId: p.categoryId });
    }
  }

  if (allProducts.length === 0) return null;

  const match = findBestMatch(query, allProducts);
  if (match.type === 'exact' || match.type === 'fuzzy') return match.product!;
  if (match.type === 'multiple' && match.candidates) return match.candidates;
  return null;
}

/**
 * Send a "did you mean?" clarification with product options.
 * Stores the options in session context for numeric reply resolution.
 */
async function sendProductClarification(
  context: MessageContext,
  query: string,
  candidates: ProductCandidate[],
): Promise<void> {
  const { customer, session } = context;
  const top = candidates.slice(0, 5);

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'interactive',
      body: `I found a few products matching "${query}":`,
      buttonText: 'View Products',
      sections: [{
        title: 'Did you mean?',
        rows: top.map(p => ({
          id: `prod_${p.id}`,
          title: p.name.substring(0, 24),
          description: `₹${p.price} • ${p.stockQuantity} in stock`.substring(0, 72),
        })),
      }],
    },
    session.id,
  );

  // Store as menu context for numeric reply
  await saveMenuContext(session.id, customer.id, customer.phoneNumber, {
    lastMenu: 'product_clarification',
    menuOptions: top.map((p, i) => ({ index: i + 1, id: p.id, name: p.name, type: 'product' as const })),
    menuSentAt: new Date().toISOString(),
  });
}

// ── Handler: Browse Category ───────────────────────────────────────────

async function handleBrowseCategory(context: MessageContext, categoryId: string): Promise<void> {
  const { customer, session } = context;

  const category = await catalogRepository.getCategoryById(categoryId);
  if (!category) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Sorry, that category is not available. Type "categories" to see all options.' },
      session.id,
    );
    return;
  }

  const products = await catalogRepository.getProductsByCategory(categoryId, 10);

  if (products.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: `No products available in ${category.name} right now. Type "categories" to browse other options.` },
      session.id,
    );
    return;
  }

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'interactive',
      body: `📦 *${category.name}*\n\nFound ${products.length} products:`,
      buttonText: 'View Products',
      sections: [{
        title: category.name,
        rows: products.map(prod => ({
          id: `prod_${prod.id}`,
          title: prod.name.substring(0, 24),
          description: `₹${prod.price} • ${prod.stockQuantity} in stock`.substring(0, 72),
        })),
      }],
    },
    session.id,
  );

  // Store product menu for numeric reply resolution
  await saveMenuContext(session.id, customer.id, customer.phoneNumber, {
    lastMenu: 'category_products',
    menuOptions: products.map((p, i) => ({ index: i + 1, id: p.id, name: p.name, type: 'product' as const })),
    menuSentAt: new Date().toISOString(),
  });

  logger.info('Category products shown', { sessionId: session.id, categoryId, productCount: products.length });
}

// ── Handler: Show Categories ───────────────────────────────────────────

async function handleShowCategories(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  const categories = await catalogRepository.getCategories();

  if (categories.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'No categories available right now. Please check back soon!' },
      session.id,
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
      session.id,
    );
  } else {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      {
        type: 'interactive',
        body: '📂 *Product Categories*\n\nSelect a category to browse:',
        buttonText: 'View Categories',
        sections: [{
          title: 'All Categories',
          rows: categories.map(cat => {
            const row: { id: string; title: string; description?: string } = {
              id: `cat_${cat.id}`,
              title: cat.name.substring(0, 24),
            };
            if (cat.description) row.description = cat.description.substring(0, 72);
            return row;
          }),
        }],
      },
      session.id,
    );
  }

  // Store category menu for numeric reply resolution
  await saveMenuContext(session.id, customer.id, customer.phoneNumber, {
    lastMenu: 'categories',
    menuOptions: categories.map((cat, i) => ({ index: i + 1, id: cat.id, name: cat.name, type: 'category' as const })),
    menuSentAt: new Date().toISOString(),
  });
}

// ── Handler: View Product ──────────────────────────────────────────────

async function handleViewProduct(context: MessageContext, productId: string): Promise<void> {
  const { customer, session } = context;

  const product = await catalogRepository.getProductById(productId);
  if (!product) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Sorry, that product is not available.' },
      session.id,
    );
    return;
  }

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
    { type: 'text', text: details + '\n\nType "categories" to browse more products.' },
    session.id,
  );

  logger.info('Product details shown', { sessionId: session.id, productId });
}

// ── Handler: Search Products ───────────────────────────────────────────

async function handleSearchProducts(context: MessageContext, query: string): Promise<void> {
  const { customer, session } = context;

  const result = await fuzzyFindProduct(query);

  if (!result) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: `Sorry, I couldn't find "${query}" in our store.\n\nType "categories" to browse what's available.` },
      session.id,
    );
    return;
  }

  // Single match
  if (!Array.isArray(result)) {
    const p = result;
    const details = [
      `🛍️ ${p.name}`,
      `💰 ₹${p.price}`,
      `📦 ${p.stockQuantity} in stock`,
    ].join('\n');

    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: details + '\n\nType "categories" to browse more.' },
      session.id,
    );
    return;
  }

  // Multiple matches
  await sendProductClarification(context, query, result);
}

// ── Handler: Add to Cart ───────────────────────────────────────────────

async function handleAddToCart(context: MessageContext, productId: string, quantity: number): Promise<void> {
  const { customer, session } = context;

  const product = await catalogRepository.getProductById(productId);
  if (!product) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: 'Sorry, that product is not available.' },
      session.id,
    );
    return;
  }

  if (product.stockQuantity < quantity) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: `Sorry, only ${product.stockQuantity} units available for ${product.name}.` },
      session.id,
    );
    return;
  }

  const updatedCart = await sessionRepository.addToCart(customer.id, customer.phoneNumber, {
    productId: product.id,
    name: product.name,
    price: product.price,
    quantity,
    sellerId: product.sellerId,
  });

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
    session.id,
  );

  logger.info('Product added to cart', { sessionId: session.id, productId, quantity, subtotal });
}

// ── Handler: View Cart ─────────────────────────────────────────────────

async function handleViewCart(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  const cart = await sessionRepository.getCart(customer.id, customer.phoneNumber);

  if (!cart || cart.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: '🛒 Your cart is empty.\n\nType "categories" to start shopping!' },
      session.id,
    );
    return;
  }

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
    session.id,
  );

  logger.info('Cart displayed', { sessionId: session.id, itemCount, subtotal });
}

// ── Handler: Checkout ──────────────────────────────────────────────────

async function handleCheckout(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  const cart = await sessionRepository.getCart(customer.id, customer.phoneNumber);

  if (!cart || cart.length === 0) {
    await whatsappSender.sendMessage(
      customer.phoneNumber,
      { type: 'text', text: '🛒 Your cart is empty.\n\nType "categories" to start shopping!' },
      session.id,
    );
    return;
  }

  // Transition to checkout state via unified session system
  await updateSessionState(session.id, 'ordering', 'whatsapp');

  const checkoutContext = {
    ...context,
    session: { ...session, state: 'checkout', cart },
  };

  await checkoutHandler(checkoutContext);

  logger.info('Transitioned to checkout state', { sessionId: session.id, itemCount: cart.length });
}

// ── Handler: Help ──────────────────────────────────────────────────────

async function handleHelp(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  const helpText = [
    '🤝 *How can I help you?*',
    '',
    '• Type a product name to search (e.g. "Tata Salt")',
    '• Type "stock of [product]" to check availability',
    '• Type "price of [product]" to check price',
    '• Type "categories" to browse products',
    '• Type "cart" to view your cart',
    '• Type "help" anytime for assistance',
  ].join('\n');

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    { type: 'text', text: helpText },
    session.id,
  );
}

// ── Handler: Greeting (returning customer says hi in browsing state) ──

async function handleCustomerGreeting(context: MessageContext): Promise<void> {
  const { customer, session } = context;
  const name = safeName(customer.profileName);

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: `Hi${name ? ` ${name}` : ''}! 👋\n\nHow can I help you today? You can:\n• Search for a product by name\n• Type "categories" to browse\n• Type "cart" to see your cart`,
    },
    session.id,
  );
}

// ── Handler: Fallback ──────────────────────────────────────────────────

async function handleFallback(context: MessageContext): Promise<void> {
  const { customer, session } = context;

  await whatsappSender.sendMessage(
    customer.phoneNumber,
    {
      type: 'text',
      text: "I didn't quite get that. You can:\n• Type a product name to search\n• Type \"categories\" to browse\n• Type \"help\" for more options",
    },
    session.id,
  );
}
