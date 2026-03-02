"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const logger_1 = require("../../utils/logger");
const catalog_repository_1 = require("../../repositories/catalog-repository");
const logger = (0, logger_1.createLogger)({ handler: 'bedrock-action-group-executor' });
/**
 * Parse query parameters from Bedrock event
 */
function parseParameters(event) {
    const params = {};
    if (event.parameters) {
        for (const param of event.parameters) {
            params[param.name] = param.value;
        }
    }
    return params;
}
/**
 * Create success response in Bedrock format
 */
function createSuccessResponse(event, data, statusCode = 200) {
    const apiResponse = {
        success: true,
        data,
        error: null,
        meta: {
            request_id: event.sessionId,
        },
    };
    return {
        messageVersion: event.messageVersion,
        response: {
            actionGroup: event.actionGroup,
            apiPath: event.apiPath,
            httpMethod: event.httpMethod,
            httpStatusCode: statusCode,
            responseBody: {
                'application/json': {
                    body: JSON.stringify(apiResponse),
                },
            },
        },
    };
}
/**
 * Create error response in Bedrock format
 */
function createErrorResponse(event, code, message, statusCode = 500, details) {
    const apiResponse = {
        success: false,
        data: null,
        error: {
            code,
            message,
            details,
        },
        meta: {
            request_id: event.sessionId,
        },
    };
    return {
        messageVersion: event.messageVersion,
        response: {
            actionGroup: event.actionGroup,
            apiPath: event.apiPath,
            httpMethod: event.httpMethod,
            httpStatusCode: statusCode,
            responseBody: {
                'application/json': {
                    body: JSON.stringify(apiResponse),
                },
            },
        },
    };
}
/**
 * Handle GET /catalog/categories
 */
async function handleListCategories(event, catalogRepo) {
    logger.info('Listing categories');
    const categories = await catalogRepo.getCategories();
    logger.info('Categories retrieved', { count: categories.length });
    return createSuccessResponse(event, categories);
}
/**
 * Handle GET /catalog/categories/{categoryId}/products
 */
async function handleListProductsByCategory(event, catalogRepo) {
    const params = parseParameters(event);
    const categoryId = params.categoryId;
    if (!categoryId) {
        return createErrorResponse(event, 'MISSING_PARAMETER', 'categoryId is required', 400);
    }
    logger.info('Listing products by category', { categoryId });
    // Verify category exists
    const category = await catalogRepo.getCategoryById(categoryId);
    if (!category) {
        return createErrorResponse(event, 'CATEGORY_NOT_FOUND', `Category with id ${categoryId} not found`, 404);
    }
    // Parse pagination and filter parameters
    const page = parseInt(params.page || '1', 10);
    const perPage = Math.min(parseInt(params.per_page || '20', 10), 100);
    const minPrice = params.min_price ? parseFloat(params.min_price) : undefined;
    const maxPrice = params.max_price ? parseFloat(params.max_price) : undefined;
    const sort = params.sort || 'newest';
    // Get products
    let products = await catalogRepo.getProductsByCategory(categoryId, perPage);
    // Apply price filters
    if (minPrice !== undefined) {
        products = products.filter(p => p.price >= minPrice);
    }
    if (maxPrice !== undefined) {
        products = products.filter(p => p.price <= maxPrice);
    }
    // Apply sorting
    if (sort === 'price_asc') {
        products.sort((a, b) => a.price - b.price);
    }
    else if (sort === 'price_desc') {
        products.sort((a, b) => b.price - a.price);
    }
    // 'newest' is default from DynamoDB query
    // Add primary image URL
    const productsWithPrimaryImage = products.map(p => ({
        ...p,
        primaryImageUrl: p.imageUrls && p.imageUrls.length > 0 ? p.imageUrls[0] : null,
    }));
    logger.info('Products retrieved', {
        categoryId,
        count: productsWithPrimaryImage.length,
    });
    const response = createSuccessResponse(event, productsWithPrimaryImage);
    // Add pagination metadata
    response.response.responseBody['application/json'].body = JSON.stringify({
        ...JSON.parse(response.response.responseBody['application/json'].body),
        meta: {
            request_id: event.sessionId,
            page,
            per_page: perPage,
            has_more: products.length === perPage,
        },
    });
    return response;
}
/**
 * Handle GET /catalog/products/search
 */
async function handleSearchProducts(event, catalogRepo) {
    const params = parseParameters(event);
    const query = params.q;
    if (!query) {
        return createErrorResponse(event, 'MISSING_PARAMETER', 'Search query parameter "q" is required', 400);
    }
    logger.info('Searching products', { query });
    // Parse pagination and filter parameters
    const page = parseInt(params.page || '1', 10);
    const perPage = Math.min(parseInt(params.per_page || '20', 10), 100);
    const categoryId = params.category_id;
    const sellerId = params.seller_id;
    const minPrice = params.min_price ? parseFloat(params.min_price) : undefined;
    const maxPrice = params.max_price ? parseFloat(params.max_price) : undefined;
    const sort = params.sort || 'relevance';
    // Search products
    let products = await catalogRepo.searchProducts(query, perPage);
    // Apply filters
    if (categoryId) {
        products = products.filter(p => p.categoryId === categoryId);
    }
    if (sellerId) {
        products = products.filter(p => p.sellerId === sellerId);
    }
    if (minPrice !== undefined) {
        products = products.filter(p => p.price >= minPrice);
    }
    if (maxPrice !== undefined) {
        products = products.filter(p => p.price <= maxPrice);
    }
    // Apply sorting
    if (sort === 'price_asc') {
        products.sort((a, b) => a.price - b.price);
    }
    else if (sort === 'price_desc') {
        products.sort((a, b) => b.price - a.price);
    }
    else if (sort === 'newest') {
        products.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    // 'relevance' is default from search
    // Add primary image URL
    const productsWithPrimaryImage = products.map(p => ({
        ...p,
        primaryImageUrl: p.imageUrls && p.imageUrls.length > 0 ? p.imageUrls[0] : null,
    }));
    logger.info('Search completed', {
        query,
        count: productsWithPrimaryImage.length,
    });
    const response = createSuccessResponse(event, productsWithPrimaryImage);
    // Add pagination metadata
    response.response.responseBody['application/json'].body = JSON.stringify({
        ...JSON.parse(response.response.responseBody['application/json'].body),
        meta: {
            request_id: event.sessionId,
            page,
            per_page: perPage,
            has_more: products.length === perPage,
        },
    });
    return response;
}
/**
 * Route API path to appropriate handler
 */
async function routeRequest(event, catalogRepo) {
    const { apiPath, httpMethod } = event;
    logger.info('Routing request', { apiPath, httpMethod });
    // Only support GET methods for catalog
    if (httpMethod !== 'GET') {
        return createErrorResponse(event, 'METHOD_NOT_ALLOWED', `HTTP method ${httpMethod} is not supported`, 405);
    }
    // Route based on API path
    if (apiPath === '/catalog/categories') {
        return handleListCategories(event, catalogRepo);
    }
    if (apiPath.match(/^\/catalog\/categories\/[^/]+\/products$/)) {
        return handleListProductsByCategory(event, catalogRepo);
    }
    if (apiPath === '/catalog/products/search') {
        return handleSearchProducts(event, catalogRepo);
    }
    // Unknown path
    return createErrorResponse(event, 'NOT_FOUND', `API path ${apiPath} not found`, 404);
}
/**
 * Lambda handler for Bedrock Agent Action Group
 *
 * This handler receives events from Amazon Bedrock when an agent invokes
 * catalog-related actions. It routes requests to the appropriate catalog
 * repository methods and returns responses in the format Bedrock expects.
 *
 * Supported operations:
 * - GET /catalog/categories - List all categories
 * - GET /catalog/categories/{categoryId}/products - List products by category
 * - GET /catalog/products/search - Search products
 */
async function handler(event) {
    return (0, logger_1.withContext)({
        requestId: event.sessionId,
        agentId: event.agent.id,
        actionGroup: event.actionGroup,
    }, async () => {
        logger.info('Bedrock action group invoked', {
            apiPath: event.apiPath,
            httpMethod: event.httpMethod,
            inputText: event.inputText,
        });
        try {
            const catalogRepo = new catalog_repository_1.CatalogRepository();
            const response = await routeRequest(event, catalogRepo);
            logger.info('Request completed successfully', {
                statusCode: response.response.httpStatusCode,
            });
            return response;
        }
        catch (error) {
            logger.error('Request failed', error, {
                apiPath: event.apiPath,
                httpMethod: event.httpMethod,
            });
            return createErrorResponse(event, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'An unexpected error occurred', 500);
        }
    });
}
//# sourceMappingURL=action-group-executor.js.map