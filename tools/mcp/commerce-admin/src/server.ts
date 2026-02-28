/**
 * MCP server initialization and tool registration.
 * Handles ListToolsRequest and CallToolRequest for admin operations.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
    version: "0.1.0",
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
        description: "List pending seller approval requests awaiting verification",
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
        description: "Fetch detailed seller profile information including verification documents",
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
        description: "List open disputes requiring admin attention",
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
        description: "Fetch detailed dispute information including resolution history",
        inputSchema: {
          type: "object",
          properties: {
            orderId: {
              type: "string",
              description: "The order ID to fetch disputes for",
            },
            disputeId: {
              type: "string",
              description: "The dispute ID to fetch directly",
            },
          },
        },
      },
      {
        name: "get_audit_timeline",
        description: "Fetch audit timeline for a specific resource to track changes",
        inputSchema: {
          type: "object",
          properties: {
            resourceType: {
              type: "string",
              description: "The resource type (e.g., SELLER, ORDER, PRODUCT)",
            },
            resourceId: {
              type: "string",
              description: "The resource ID to fetch audit history for",
            },
          },
          required: ["resourceType", "resourceId"],
        },
      },
      {
        name: "list_recent_payments",
        description: "List recent payment transactions with optional status filtering",
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
  const startTime = Date.now();

  try {
    console.error(`[commerce-admin-mcp] Tool invocation: ${name}`);
    
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

    const duration = Date.now() - startTime;
    console.error(`[commerce-admin-mcp] Tool ${name} completed successfully in ${duration}ms`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[commerce-admin-mcp] Tool ${name} failed after ${duration}ms: ${errorMessage}`);
    
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
