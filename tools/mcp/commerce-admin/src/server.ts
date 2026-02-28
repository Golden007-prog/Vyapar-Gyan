import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadEnv } from "./env.js";
import { listPendingSellerApprovals } from "./tools/list-pending-seller-approvals.js";
import { getSellerProfile } from "./tools/get-seller-profile.js";
import { listOpenDisputes } from "./tools/list-open-disputes.js";
import { getDispute } from "./tools/get-dispute.js";
import { getAuditTimeline } from "./tools/get-audit-timeline.js";
import { listRecentPayments } from "./tools/list-recent-payments.js";

const env = loadEnv();

const server = new Server(
  {
    name: "commerce-admin-mcp",
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
        name: "list_pending_seller_approvals",
        description: "List sellers pending approval",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Max results (default 20, max 100)",
            },
          },
        },
      },
      {
        name: "get_seller_profile",
        description: "Fetch seller profile with verification status",
        inputSchema: {
          type: "object",
          properties: {
            sellerId: {
              type: "string",
              description: "The seller ID to fetch",
            },
          },
          required: ["sellerId"],
        },
      },
      {
        name: "list_open_disputes",
        description: "List open disputes",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Max results (default 20, max 100)",
            },
          },
        },
      },
      {
        name: "get_dispute",
        description: "Fetch dispute details with order context",
        inputSchema: {
          type: "object",
          properties: {
            orderId: {
              type: "string",
              description: "Order ID to fetch dispute for",
            },
            disputeId: {
              type: "string",
              description: "Dispute ID to fetch directly",
            },
          },
        },
      },
      {
        name: "get_audit_timeline",
        description: "Fetch audit timeline for a resource",
        inputSchema: {
          type: "object",
          properties: {
            resourceType: {
              type: "string",
              description: "Resource type (e.g., ORDER, SELLER, PRODUCT)",
            },
            resourceId: {
              type: "string",
              description: "Resource ID",
            },
          },
          required: ["resourceType", "resourceId"],
        },
      },
      {
        name: "list_recent_payments",
        description: "List recent payments with optional status filter",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              description: "Filter by payment status (optional)",
            },
            limit: {
              type: "number",
              description: "Max results (default 20, max 100)",
            },
          },
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
      case "list_pending_seller_approvals":
        result = await listPendingSellerApprovals(args, env);
        break;
      case "get_seller_profile":
        result = await getSellerProfile(args, env);
        break;
      case "list_open_disputes":
        result = await listOpenDisputes(args, env);
        break;
      case "get_dispute":
        result = await getDispute(args, env);
        break;
      case "get_audit_timeline":
        result = await getAuditTimeline(args, env);
        break;
      case "list_recent_payments":
        result = await listRecentPayments(args, env);
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
