#!/usr/bin/env node

/**
 * Entry point for the commerce-catalog-mcp server.
 * Initializes the MCP server with stdio transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";

async function main() {
  try {
    console.error("[commerce-catalog-mcp] Starting server...");
    
    const transport = new StdioServerTransport();
    
    await server.connect(transport);
    
    console.error("[commerce-catalog-mcp] Server started successfully");
  } catch (error) {
    console.error("[commerce-catalog-mcp] Fatal error during startup:", error);
    process.exit(1);
  }
}

main();
