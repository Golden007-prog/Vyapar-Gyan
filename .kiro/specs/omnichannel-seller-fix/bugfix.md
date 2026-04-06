# Bugfix Requirements Document

## Introduction

The omnichannel chat sync system and seller tab UI have multiple bugs that break the core bidirectional messaging experience and degrade the seller dashboard usability. Messages sent on WhatsApp don't appear in web chat and vice versa due to a client-side bridge (sessionStorage) being used as the primary message store instead of the backend API. The seller inbox reads from the same client-side bridge, so real backend messages never sync. Additionally, the seller dashboard displays hardcoded demo metrics with no real data binding, the inbox lacks sync status indicators, and order actions provide no visual feedback.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a customer sends a message via WhatsApp THEN the system does not display that message in the web chat interface because the web chat reads from sessionStorage bridge which has no connection to the backend message store

1.2 WHEN a customer sends a message via web chat THEN the system writes it to sessionStorage bridge and attempts an HTTP API call, but the message does not appear on WhatsApp because the backend worker's bot response is not pushed back to the web chat's bridge or polling state

1.3 WHEN a seller sends a reply from the seller inbox THEN the system writes to sessionStorage bridge and sends an HTTP API call, but the customer's web chat does not receive the reply unless both tabs share the same sessionStorage (same browser window) and the bridge polling picks it up

1.4 WHEN the WebSocket connection fails silently THEN the system does not resume polling because the polling suppression logic checks `connectionState === 'connected'` but the WebSocket state may not transition to `'disconnected'` on silent failures

1.5 WHEN messages arrive from both the bridge (IDs like `demo-1`, `cust-{timestamp}`) and the backend API (IDs like `msg-uuid`) THEN the system may display duplicate messages because deduplication relies on `messageId` which differs between the two sources for the same logical message

1.6 WHEN the seller opens the dashboard page THEN the system displays hardcoded demo metrics (₹45,231 total sales, 127 active products, etc.) with no attempt to fetch real data from the backend API

1.7 WHEN the seller views the inbox conversation list THEN the system shows no visual indication of whether messages are synced with the backend or only stored locally in the bridge

1.8 WHEN the seller marks a conversation as read by selecting it THEN the system resets the unread count in local state only; the count does not persist across page refreshes because it is not sent to the backend

1.9 WHEN the seller accepts or rejects an order in the orders page THEN the system performs an optimistic UI update but provides no toast/visual feedback on the orders list view for inline quick actions (only the modal has action buttons)

### Expected Behavior (Correct)

2.1 WHEN a customer sends a message via WhatsApp THEN the system SHALL store it in the backend (THREAD#{userId}) and the web chat SHALL receive it via polling sync or WebSocket push, displaying it with a WhatsApp channel indicator

2.2 WHEN a customer sends a message via web chat THEN the system SHALL send it to the backend API, the backend SHALL process it through the same worker logic, and the bot response SHALL appear in web chat immediately via sync polling AND also be sent to WhatsApp if the customer has an active WhatsApp session

2.3 WHEN a seller sends a reply from the seller inbox THEN the system SHALL send it via the backend API, and the customer's web chat SHALL receive it via the sync polling endpoint or WebSocket, not solely through sessionStorage bridge

2.4 WHEN the WebSocket connection fails silently THEN the system SHALL detect the failure (via heartbeat timeout or readyState check) and SHALL automatically resume polling-based sync within a reasonable interval

2.5 WHEN the same logical message is received from both bridge and backend sources THEN the system SHALL deduplicate correctly by normalizing message identifiers or using content-based deduplication to prevent duplicate display

2.6 WHEN the seller opens the dashboard page THEN the system SHALL attempt to fetch real metrics from the backend API (e.g., `/api/v1/seller/dashboard`) and display them, falling back to demo data only if the API is unavailable

2.7 WHEN the seller views the inbox conversation list THEN the system SHALL display a visual sync status indicator (e.g., a subtle icon or badge) showing whether messages are synced with the backend or only stored locally

2.8 WHEN the seller marks a conversation as read THEN the system SHALL send a read receipt to the backend API so the unread count persists across page refreshes and is consistent across devices

2.9 WHEN the seller accepts or rejects an order THEN the system SHALL display a toast notification confirming the action result, both from the modal and from inline quick-action buttons on the order list

### Available Tooling and Infrastructure

4.1 AWS credentials and CLI commands are available for debugging and deployment. Use profile `kiro-mcp` for read-only DynamoDB access and CloudWatch log tailing.

4.2 MCP servers are available for live platform data access:
- **commerce-ops-mcp**: Orders, payments, inventory, WhatsApp sessions, CloudWatch log search
- **commerce-catalog-mcp**: Products, categories, stock levels, media
- **commerce-admin-mcp**: Seller approvals, disputes, audit logs, analytics

4.3 Twilio MCP server is available for WhatsApp message history, delivery status checks, and sending test messages. Use `mcp_twilio_mcp_get_message_history` and `mcp_twilio_mcp_get_message_status` for debugging message flow issues.

4.4 CloudWatch logs can be searched via `mcp_commerce_ops_mcp_search_logs` to trace message processing through the webhook → EventBridge → SQS worker pipeline.

4.5 WhatsApp session state can be inspected via `mcp_commerce_ops_mcp_get_whatsapp_session` to verify session resolution and routing flow.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the backend API is unavailable THEN the system SHALL CONTINUE TO fall back to the sessionStorage bridge for demo messaging so the chat experience degrades gracefully rather than breaking entirely

3.2 WHEN the WebSocket is connected and functioning normally THEN the system SHALL CONTINUE TO suppress polling-based sync to avoid redundant network requests

3.3 WHEN a customer sends a message via web chat with a product context or cart action THEN the system SHALL CONTINUE TO handle cart operations (add to cart, checkout) through the existing cart API flow without disruption

3.4 WHEN the seller inbox displays hardcoded seed conversations (Priya Sharma, Rahul Verma) THEN the system SHALL CONTINUE TO show these as fallback data when no real API conversations are available

3.5 WHEN the seller orders page loads THEN the system SHALL CONTINUE TO display demo order data as fallback when the backend API is unavailable, with the existing filter tabs, order detail modal, and timeline view functioning correctly

3.6 WHEN the customer chat page renders messages THEN the system SHALL CONTINUE TO display rich message types (product cards, order status cards, AI suggestions, quick replies) with the existing MessageList component rendering logic

3.7 WHEN the seller inbox composer sends a message THEN the system SHALL CONTINUE TO send via both HTTP API (primary) and WebSocket (secondary) for redundancy
