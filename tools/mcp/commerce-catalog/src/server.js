/**
 * MCP server initialization and tool registration.
 * Handles ListToolsRequest and CallToolRequest.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import { loadEnv } from "./env.js";
import { getProduct } from "./tools/get-product.js";
import { listProductsBySeller } from "./tools/list-products-by-seller.js";
import { listProductsByCategory } from "./tools/list-products-by-category.js";
import { getCategory } from "./tools/get-category.js";
import { listLowStockProducts } from "./tools/list-low-stock-products.js";
import { getProductMedia } from "./tools/get-product-media.js";
const env = loadEnv();
const server = new Server({
    name: "commerce-catalog-mcp",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_product",
                description: "Fetch product details by product ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        productId: {
                            type: "string",
                            description: "The product ID to fetch",
                        },
                    },
                    required: ["productId"],
                },
            },
            {
                name: "list_products_by_seller",
                description: "List products for a specific seller",
                inputSchema: {
                    type: "object",
                    properties: {
                        sellerId: {
                            type: "string",
                            description: "The seller ID",
                        },
                        limit: {
                            type: "number",
                            description: "Max results (default 20, max 100)",
                        },
                    },
                    required: ["sellerId"],
                },
            },
            {
                name: "list_products_by_category",
                description: "List products in a specific category",
                inputSchema: {
                    type: "object",
                    properties: {
                        categoryId: {
                            type: "string",
                            description: "The category ID",
                        },
                        limit: {
                            type: "number",
                            description: "Max results (default 20, max 100)",
                        },
                    },
                    required: ["categoryId"],
                },
            },
            {
                name: "get_category",
                description: "Fetch category metadata by category ID",
                inputSchema: {
                    type: "object",
                    properties: {
                        categoryId: {
                            type: "string",
                            description: "The category ID to fetch",
                        },
                    },
                    required: ["categoryId"],
                },
            },
            {
                name: "list_low_stock_products",
                description: "List products below stock threshold for a seller",
                inputSchema: {
                    type: "object",
                    properties: {
                        sellerId: {
                            type: "string",
                            description: "The seller ID",
                        },
                        threshold: {
                            type: "number",
                            description: "Stock threshold (default 5)",
                        },
                        limit: {
                            type: "number",
                            description: "Max results (default 20, max 100)",
                        },
                    },
                    required: ["sellerId"],
                },
            },
            {
                name: "get_product_media",
                description: "Fetch product media metadata and S3 keys",
                inputSchema: {
                    type: "object",
                    properties: {
                        productId: {
                            type: "string",
                            description: "The product ID to fetch media for",
                        },
                    },
                    required: ["productId"],
                },
            },
        ],
    };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startTime = Date.now();
    try {
        console.error(`[commerce-catalog-mcp] Tool invocation: ${name}`);
        let result;
        switch (name) {
            case "get_product":
                result = await getProduct(args, env);
                break;
            case "list_products_by_seller":
                result = await listProductsBySeller(args, env);
                break;
            case "list_products_by_category":
                result = await listProductsByCategory(args, env);
                break;
            case "get_category":
                result = await getCategory(args, env);
                break;
            case "list_low_stock_products":
                result = await listLowStockProducts(args, env);
                break;
            case "get_product_media":
                result = await getProductMedia(args, env);
                break;
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
        const duration = Date.now() - startTime;
        console.error(`[commerce-catalog-mcp] Tool ${name} completed successfully in ${duration}ms`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                },
            ],
        };
    }
    catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[commerce-catalog-mcp] Tool ${name} failed after ${duration}ms: ${errorMessage}`);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: {
                            code: "TOOL_ERROR",
                            message: errorMessage,
                        },
                    }, null, 2),
                },
            ],
            isError: true,
        };
    }
});
export { server };
//# sourceMappingURL=server.js.map