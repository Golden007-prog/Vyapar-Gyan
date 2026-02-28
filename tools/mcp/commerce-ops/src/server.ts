import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadEnv } from "./env.js";
import { getOrder } from "./tools/get-order.js";
import { getOrderTimeline } from "./tools/get-order-timeline.js";
import { getPayment } from "./tools/get-payment.js";
import { getInventory } from "./tools/get-inventory.js";
import { getWhatsappSession } from "./tools/get-whatsapp-session.js";
import { searchLogs } from "./tools/search-logs.js";
import { listSellerOrders } from "./tools/list-seller-orders.js";

const env = loadEnv();

const server = new Server(
  {
    name: "commerce-ops-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_order",
        description: "Fetch order details by order ID",
        inputSchema: {
          type: "object",
          properties: {
            orderId: {
              type: "string",
              description: "The order ID to fetch",
            },
          },
          required: ["orderId"],
        },
      },
      {
        name: "get_order_timeline",
        description: "Fetch complete order timeline including items, payments, audit logs, and disputes",
        inputSchema: {
          type: "object",
          properties: {
            orderId: {
              type: "string",
              description: "The order ID to fetch timeline for",
            },
          },
          required: ["orderId"],
        },
      },
      {
        name: "get_payment",
        description: "Fetch payment details for an order",
        inputSchema: {
          type: "object",
          properties: {
            orderId: {
              type: "string",
              description: "The order ID to fetch payments for",
            },
          },
          required: ["orderId"],
        },
      },
      {
        name: "get_inventory",
        description: "Fetch product inventory and recent inventory logs",
        inputSchema: {
          type: "object",
          properties: {
            productId: {
              type: "string",
              description: "The product ID to fetch inventory for",
            },
          },
          required: ["productId"],
        },
      },
      {
        name: "get_whatsapp_session",
        description: "Fetch WhatsApp session by phone or session ID",
        inputSchema: {
          type: "object",
          properties: {
            phone: {
              type: "string",
              description: "Phone number to lookup session",
            },
            sessionId: {
              type: "string",
              description: "Session ID to lookup directly",
            },
          },
        },
      },
      {
        name: "search_logs",
        description: "Search CloudWatch logs with filter pattern",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "CloudWatch filter pattern",
            },
            logGroupPrefix: {
              type: "string",
              description: "Log group prefix (optional)",
            },
            startTime: {
              type: "string",
              description: "Start time ISO string (optional)",
            },
            endTime: {
              type: "string",
              description: "End time ISO string (optional)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_seller_orders",
        description: "List orders for a specific seller",
        inputSchema: {
          type: "object",
          properties: {
            sellerId: {
              type: "string",
              description: "The seller ID",
            },
            status: {
              type: "string",
              description: "Filter by order status (optional)",
            },
            limit: {
              type: "number",
              description: "Max results (default 20, max 100)",
            },
          },
          required: ["sellerId"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    
    switch (name) {
      case "get_order":
        result = await getOrder(args, env);
        break;
      case "get_order_timeline":
        result = await getOrderTimeline(args, env);
        break;
      case "get_payment":
        result = await getPayment(args, env);
        break;
      case "get_inventory":
        result = await getInventory(args, env);
        break;
      case "get_whatsapp_session":
        result = await getWhatsappSession(args, env);
        break;
      case "search_logs":
        result = await searchLogs(args, env);
        break;
      case "list_seller_orders":
        result = await listSellerOrders(args, env);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: {
              code: "TOOL_ERROR",
              message: error instanceof Error ? error.message : "Unknown error",
            },
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

export { server };
