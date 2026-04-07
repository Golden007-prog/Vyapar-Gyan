# Bedrock Web Chat Setup

## Overview

This is a native WhatsApp-style web chat interface built directly into the Next.js frontend to test the Bedrock Agent independently of Twilio integration.

## Components Created

### 1. API Route: `/app/api/bedrock-chat/route.ts`
- Accepts POST requests with `{ message, userId, role, sessionId }`
- Uses `@aws-sdk/client-bedrock-agent-runtime` to invoke the Bedrock Agent
- Agent ID: `9LAQJGS7JX`
- Agent Alias ID: `FB5ID7OVWJ`
- Returns the agent's natural language response

### 2. UI Component: `/components/Chat/WebChat.tsx`
- Reusable React component with WhatsApp-style UI
- Green/gray message bubbles
- Auto-scrolling message list
- Loading spinner during agent processing
- Styled with Tailwind CSS

### 3. Test Page: `/app/seller-copilot/page.tsx`
- Mounts the WebChat component
- Hardcoded test props for GOLDEN Store:
  - `userId: "seller-golden-001"`
  - `role: "seller"`
  - `sessionId: "test-session-golden-123"`

## Local Testing

1. Start the Next.js development server:
   ```bash
   cd apps/web
   pnpm dev
   ```

2. Open your browser to:
   ```
   http://localhost:3000/seller-copilot
   ```

3. Test the chat interface by sending messages to the Bedrock Agent

## Environment Variables

Added to `.env.local`:
```
AWS_REGION=us-east-1
```

## Dependencies

Added `@aws-sdk/client-bedrock-agent-runtime` to package.json

## AWS Credentials

The API route will use the default AWS credentials from your environment. Ensure you have:
- AWS credentials configured (via `~/.aws/credentials` or environment variables)
- Permissions to invoke Bedrock agents

## Testing Scenarios

Try these test messages:
- "What products do I have in stock?"
- "Show me my recent orders"
- "What are my low stock items?"
- "Give me insights about my inventory"

## Next Steps

Once verified working:
1. Add authentication to the API route
2. Integrate with real user sessions
3. Add message history persistence
4. Implement typing indicators
5. Add file upload support for images
