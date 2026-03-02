"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browsingHandler = browsingHandler;
const logger_1 = require("../../../utils/logger");
const whatsapp_sender_1 = require("../../../services/whatsapp-sender");
const session_repository_1 = require("../../../repositories/session-repository");
const message_repository_1 = require("../../../repositories/message-repository");
const catalog_repository_1 = require("../../../repositories/catalog-repository");
const sessionRepository = new session_repository_1.SessionRepository();
const messageRepository = new message_repository_1.MessageRepository();
const catalogRepository = new catalog_repository_1.CatalogRepository();
/**
 * Browsing State Handler
 *
 * Handles product catalog browsing, search, and selection.
 * Transitions to product_inquiry state when customer selects a product.
 */
async function browsingHandler(context) {
    const { message, customer, session } = context;
    logger_1.logger.info('Processing browsing state', {
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
    logger_1.logger.info('Intent detected', {
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
function detectIntent(message) {
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
async function handleBrowseCategory(context, categoryId) {
    const { customer, session } = context;
    const category = await catalogRepository.getCategoryById(categoryId);
    if (!category) {
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'text',
            text: 'Sorry, that category is not available. Type "categories" to see all options.',
        }, session.id);
        return;
    }
    const products = await catalogRepository.getProductsByCategory(categoryId, 10);
    if (products.length === 0) {
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'text',
            text: `No products available in ${category.name} right now. Type "categories" to browse other options.`,
        }, session.id);
        return;
    }
    // Show products as list
    await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
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
    }, session.id);
    logger_1.logger.info('Category products shown', {
        sessionId: session.id,
        categoryId,
        productCount: products.length,
    });
}
/**
 * Handle showing all categories
 */
async function handleShowCategories(context) {
    const { customer, session } = context;
    const categories = await catalogRepository.getCategories();
    if (categories.length === 0) {
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'text',
            text: 'No categories available right now. Please check back soon!',
        }, session.id);
        return;
    }
    if (categories.length <= 3) {
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'interactive',
            body: '📂 *Product Categories*\n\nSelect a category to browse:',
            buttons: categories.slice(0, 3).map(cat => ({
                id: `cat_${cat.id}`,
                title: cat.name.substring(0, 20),
            })),
        }, session.id);
    }
    else {
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'interactive',
            body: '📂 *Product Categories*\n\nSelect a category to browse:',
            buttonText: 'View Categories',
            sections: [
                {
                    title: 'All Categories',
                    rows: categories.map(cat => ({
                        id: `cat_${cat.id}`,
                        title: cat.name.substring(0, 24),
                        description: cat.description?.substring(0, 72),
                    })),
                },
            ],
        }, session.id);
    }
}
/**
 * Handle product view
 */
async function handleViewProduct(context, productId) {
    const { customer, session } = context;
    const product = await catalogRepository.getProductById(productId);
    if (!product) {
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'text',
            text: 'Sorry, that product is not available.',
        }, session.id);
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
    await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
        type: 'text',
        text: details + '\n\nType "categories" to browse more products.',
    }, session.id);
    logger_1.logger.info('Product details shown', {
        sessionId: session.id,
        productId,
    });
}
/**
 * Handle product search
 */
async function handleSearchProducts(context, query) {
    const { customer, session } = context;
    const products = await catalogRepository.searchProducts(query, 10);
    if (products.length === 0) {
        await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
            type: 'text',
            text: `No products found for "${query}". Type "categories" to browse all products.`,
        }, session.id);
        return;
    }
    await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
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
    }, session.id);
    logger_1.logger.info('Search results shown', {
        sessionId: session.id,
        query,
        resultCount: products.length,
    });
}
/**
 * Handle help request
 */
async function handleHelp(context) {
    const { customer, session } = context;
    const helpText = [
        '🤝 *How can I help you?*',
        '',
        '• Type "categories" to browse products',
        '• Type product name to search',
        '• Select from menu options',
        '• Type "help" anytime for assistance',
    ].join('\n');
    await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
        type: 'text',
        text: helpText,
    }, session.id);
}
/**
 * Handle fallback for unrecognized input
 */
async function handleFallback(context) {
    const { customer, session } = context;
    await whatsapp_sender_1.whatsappSender.sendMessage(customer.phoneNumber, {
        type: 'text',
        text: 'I didn\'t understand that. Type "categories" to browse products or "help" for assistance.',
    }, session.id);
}
//# sourceMappingURL=browsing-handler.js.map