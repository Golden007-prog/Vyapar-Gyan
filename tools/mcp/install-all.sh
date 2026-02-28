#!/bin/bash

echo "Installing MCP servers..."

# Install commerce-ops-mcp
echo "Installing commerce-ops-mcp..."
cd commerce-ops
npm install
npm run build
cd ..

# Install commerce-catalog-mcp
echo "Installing commerce-catalog-mcp..."
cd commerce-catalog
npm install
npm run build
cd ..

# Install commerce-admin-mcp
echo "Installing commerce-admin-mcp..."
cd commerce-admin
npm install
npm run build
cd ..

echo "All MCP servers installed and built successfully!"
