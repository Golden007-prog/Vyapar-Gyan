# Requirements Document

## Introduction

This specification covers Phase 3 of the VyaparGyan production roadmap: Chat & Messaging Quality. The feature replaces the current polling-based chat synchronization (`chat-sync-handler.ts` + `sync-client.ts`) with a WebSocket-based real-time messaging system, adds message delivery receipts with visual status indicators, introduces rich message types (product cards, order status cards, AI suggestion cards, quick-reply buttons), and implements typing indicators with seller presence tracking. The goal is to bring the chat experience to parity with modern messaging apps while maintaining cross-channel sync between the web chat and WhatsApp via Twilio.

## Glossary

- **WebSocket_API**: An API Gateway WebSocket API that maintains persistent bidirectional connections between clients and the VyaparGyan backend Lambda handlers.
- **Connection_Registry**: A set of DynamoDB items keyed by `CONN#{connectionId}` that track active WebSocket connections, mapping each connection to a userId, role, and connectedAt timestamp with a 24-hour TTL.
- **Chat_Client**: The frontend WebSocket client module (`apps/web/lib/websocket-client.ts`) that manages connection lifecycle, heartbeats, reconnection, and message dispatch.
- **Message_Router**: The `sendMessage` Lambda handler attached to the WebSocket API that receives messages from one participant and pushes them to all connected participants in the conversation.
- **Delivery_Status**: The lifecycle state of a message: `queued`, `sent`, `delivered`, `read`, or `failed`, stored in the `deliveryStatus` field of `THREAD#{userId} MSG#{ts}#{id}` items.
- **Status_Indicator**: The visual check-mark UI component (`MessageStatus.tsx`) that renders single check (sent), double check (delivered), or blue double check (read) icons.
- **Rich_Message**: A chat message with a `messageType` other than `text`, including `product_card`, `order_status`, `ai_suggestion`, and `quick_reply`, each carrying structured content in the `content` field.
- **Presence_Tracker**: The subsystem that uses WebSocket heartbeats to determine whether a seller is online or offline and records `lastSeen` timestamps.
- **Typing_Indicator**: An ephemeral signal broadcast via WebSocket when a participant is composing a message, displayed as animated dots in the recipient's chat view.
- **Heartbeat**: A periodic WebSocket ping sent every 30 seconds by the Chat_Client to keep the connection alive and update the Connection_Registry TTL.
- **Polling_Fallback**: The existing `sync-client.ts` polling mechanism that activates when the WebSocket connection cannot be established or is lost beyond the reconnection window.

## Requirements

### Requirement 1: WebSocket API Infrastructure

**User Story:** As a platform operator, I want a WebSocket API deployed via CDK, so that the platform can support persistent bidirectional connections for real-time messaging.

#### Acceptance Criteria

1. THE CDK WebSocket_Stack SHALL create an API Gateway WebSocket API with four routes: `$connect`, `$disconnect`, `$default`, and `sendMessage`.
2. THE CDK WebSocket_Stack SHALL create a Lambda function for each of the four WebSocket routes with appropriate IAM permissions to read and write the DynamoDB table.
3. THE CDK WebSocket_Stack SHALL output the WebSocket API endpoint URL as a CloudFormation stack output.
4. THE CDK WebSocket_Stack SHALL grant the `sendMessage` Lambda function permission to invoke `@connections` POST on the API Gateway Management API for pushing messages to connected clients.

### Requirement 2: WebSocket Connection Lifecycle

**User Story:** As a customer or seller, I want my WebSocket connection to be tracked reliably, so that the system knows where to deliver real-time messages.

#### Acceptance Criteria

1. WHEN a client connects via the `$connect` route, THE Connect_Handler SHALL store a Connection_Registry item in DynamoDB with fields `connectionId`, `userId`, `role`, `connectedAt`, and `expiresAt` set to 24 hours from connection time.
2. WHEN a client connects via the `$connect` route, THE Connect_Handler SHALL extract the `userId` and `role` from the Cognito JWT token provided in the query string parameter `token`.
3. WHEN a client disconnects via the `$disconnect` route, THE Disconnect_Handler SHALL delete the corresponding Connection_Registry item from DynamoDB.
4. IF the `$connect` request does not contain a valid JWT token, THEN THE Connect_Handler SHALL reject the connection with a 401 status code.
5. THE Connection_Registry item SHALL use the key pattern `PK: CONN#{connectionId}, SK: META` with a GSI1 entry `GSI1PK: USER_CONN#{userId}, GSI1SK: CONN#{connectionId}` to support lookup of all connections for a given user.

### Requirement 3: Real-Time Message Delivery

**User Story:** As a customer, I want to receive new messages instantly without refreshing, so that conversations feel natural and responsive.

#### Acceptance Criteria

1. WHEN a participant sends a message via the `sendMessage` WebSocket route, THE Message_Router SHALL store the message in DynamoDB under `THREAD#{recipientUserId}` and `THREAD#{senderUserId}` with `deliveryStatus` set to `sent`.
2. WHEN a message is stored, THE Message_Router SHALL query the Connection_Registry for all active connections belonging to the recipient userId and push the message payload to each connection via the API Gateway Management API.
3. WHEN a message is stored, THE Message_Router SHALL push the message back to all active connections belonging to the sender userId to confirm delivery and sync across multiple devices.
4. IF pushing a message to a connection fails with a `GoneException` (status 410), THEN THE Message_Router SHALL delete the stale Connection_Registry item for that connectionId.
5. THE Message_Router SHALL deliver messages to the recipient within 500 milliseconds of the sender submitting the message, measured from Lambda invocation start to API Gateway Management API post completion.

### Requirement 4: Client-Side WebSocket Management

**User Story:** As a mobile user on a spotty network, I want the chat to reconnect automatically after network loss, so that I do not miss messages.

#### Acceptance Criteria

1. THE Chat_Client SHALL establish a WebSocket connection to the WebSocket_API endpoint on initialization, passing the Cognito JWT access token as a `token` query parameter.
2. THE Chat_Client SHALL send a heartbeat ping message every 30 seconds to keep the connection alive and detect stale connections.
3. WHEN the WebSocket connection is lost, THE Chat_Client SHALL attempt reconnection using exponential backoff starting at 1 second, doubling each attempt, capped at 30 seconds.
4. WHEN the WebSocket connection is lost, THE Chat_Client SHALL achieve reconnection within 5 seconds under normal network recovery conditions (single retry success).
5. IF the Chat_Client fails to establish or re-establish a WebSocket connection after 5 consecutive attempts, THEN THE Chat_Client SHALL activate the Polling_Fallback mechanism using the existing `sync-client.ts` module.
6. WHEN the Chat_Client successfully reconnects after a disconnection, THE Chat_Client SHALL request missed messages by sending a `sync` action with the timestamp of the last received message.

### Requirement 5: Heartbeat and Stale Connection Detection

**User Story:** As a platform operator, I want stale connections to be cleaned up automatically, so that the system does not waste resources pushing messages to dead connections.

#### Acceptance Criteria

1. WHEN the `$default` route receives a heartbeat message (action: `heartbeat`), THE Default_Handler SHALL update the `expiresAt` field of the corresponding Connection_Registry item to 24 hours from the current time.
2. WHILE a Connection_Registry item has an `expiresAt` value in the past, THE DynamoDB TTL mechanism SHALL automatically delete the stale connection item.
3. THE Chat_Client SHALL treat the absence of a server-side heartbeat acknowledgment within 60 seconds as a connection failure and initiate reconnection.

### Requirement 6: Message Delivery Receipts

**User Story:** As a seller, I want to see whether my messages have been delivered and read, so that I know if the customer has seen my response.

#### Acceptance Criteria

1. WHEN a message is successfully stored in DynamoDB, THE Message_Router SHALL set the `deliveryStatus` to `sent` and record the `sentAt` timestamp.
2. WHEN a message is successfully pushed to at least one of the recipient's active WebSocket connections, THE Message_Router SHALL update the `deliveryStatus` to `delivered` and record the `deliveredAt` timestamp.
3. WHEN the recipient's Chat_Client renders a message in the visible viewport, THE Chat_Client SHALL send a `markRead` action via WebSocket containing the messageId, and THE Message_Router SHALL update the `deliveryStatus` to `read` and record the `readAt` timestamp.
4. WHEN a message's `deliveryStatus` changes, THE Message_Router SHALL push a status update event to all active connections belonging to the original sender.
5. IF a message fails to be stored or pushed, THEN THE Message_Router SHALL set the `deliveryStatus` to `failed`, record the `failedAt` timestamp and `errorCode`, and push a failure notification to the sender's connections.

### Requirement 7: Twilio WhatsApp Delivery Status Sync

**User Story:** As a seller, I want WhatsApp message delivery statuses to appear in the web chat, so that I have a unified view of message delivery across channels.

#### Acceptance Criteria

1. WHEN the existing `status-webhook-handler.ts` receives a Twilio StatusCallback with status `sent`, `delivered`, `read`, or `failed`, THE Status_Webhook_Handler SHALL update the corresponding message's `deliveryStatus` in DynamoDB (existing behavior).
2. WHEN the Status_Webhook_Handler updates a message's `deliveryStatus`, THE Status_Webhook_Handler SHALL query the Connection_Registry for all active WebSocket connections belonging to the message sender and push a delivery status update event to each connection.
3. THE Status_Webhook_Handler SHALL map Twilio statuses to Delivery_Status values: `sent` → `sent`, `delivered` → `delivered`, `read` → `read`, `failed` → `failed`, `undelivered` → `failed`.
4. IF the sender has no active WebSocket connections when a Twilio status update arrives, THEN THE Status_Webhook_Handler SHALL store the update in DynamoDB only, and the Chat_Client SHALL retrieve the updated status on next sync or reconnection.

### Requirement 8: Message Status UI Component

**User Story:** As a customer or seller, I want to see visual indicators showing whether my messages were sent, delivered, or read, so that I have clear feedback on message delivery.

#### Acceptance Criteria

1. THE Status_Indicator component SHALL render a single gray check icon for messages with `deliveryStatus` of `sent`.
2. THE Status_Indicator component SHALL render double gray check icons for messages with `deliveryStatus` of `delivered`.
3. THE Status_Indicator component SHALL render double blue check icons for messages with `deliveryStatus` of `read`.
4. THE Status_Indicator component SHALL render a red alert icon for messages with `deliveryStatus` of `failed`, accompanied by a "Retry" button.
5. THE Status_Indicator component SHALL render a clock icon for messages with `deliveryStatus` of `queued`.
6. WHEN the user taps the "Retry" button on a failed message, THE Chat_Client SHALL re-send the message content via the `sendMessage` WebSocket route with a new messageId.

### Requirement 9: Rich Message Types — Product Card

**User Story:** As a seller, I want to send product cards in chat with an image, price, and "Add to cart" button, so that customers can browse and purchase products directly from the conversation.

#### Acceptance Criteria

1. THE Message_Router SHALL accept messages with `messageType` of `product_card` containing structured content: `productId`, `name`, `price`, `imageUrl`, `sellerId`, and `description`.
2. THE web chat MessageList component SHALL render `product_card` messages as a styled card with the product image, name, formatted price (₹ prefix), and an "Add to cart" button.
3. WHEN the customer taps the "Add to cart" button on a product card, THE Chat_Client SHALL call the existing cart API (`api-cart.ts`) to add the product to the customer's cart.
4. WHEN a `product_card` message is sent to a WhatsApp channel via Twilio, THE Message_Router SHALL map the product card to a Twilio WhatsApp interactive message template with a product image, body text containing name and price, and a call-to-action button.

### Requirement 10: Rich Message Types — Order Status Card

**User Story:** As a customer, I want to receive order status updates as rich cards in chat, so that I can track my order without leaving the conversation.

#### Acceptance Criteria

1. THE Message_Router SHALL accept messages with `messageType` of `order_status` containing structured content: `orderId`, `orderNumber`, `status`, `items` (array of name and quantity), `totalAmount`, and `updatedAt`.
2. THE web chat MessageList component SHALL render `order_status` messages as a styled card showing the order number, current status with a color-coded badge, item summary, total amount, and last updated time.
3. WHEN an order status changes in the system, THE Order_Service SHALL publish an EventBridge event, and a downstream handler SHALL send an `order_status` card message to the customer's thread.

### Requirement 11: Rich Message Types — AI Suggestion Card and Quick Reply

**User Story:** As a seller, I want to receive AI-generated suggestions as interactive cards with quick-reply buttons, so that I can act on insights directly from the chat.

#### Acceptance Criteria

1. THE Message_Router SHALL accept messages with `messageType` of `ai_suggestion` containing structured content: `suggestionId`, `title`, `body`, `actionType` (e.g., `approve_discount`, `reorder_stock`), and `actionPayload`.
2. THE web chat MessageList component SHALL render `ai_suggestion` messages as a styled card with a title, body text, and one or two action buttons (e.g., "Approve", "Dismiss").
3. THE Message_Router SHALL accept messages with `messageType` of `quick_reply` containing structured content: `prompt` (text) and `options` (array of `label` and `value` pairs).
4. THE web chat MessageList component SHALL render `quick_reply` messages as a text prompt followed by horizontally scrollable pill-shaped buttons for each option.
5. WHEN the user taps a quick-reply option, THE Chat_Client SHALL send a new text message with the selected option's `value` as the message content.

### Requirement 12: DynamoDB Message Type Schema

**User Story:** As a developer, I want message types to be clearly defined in the data model, so that all handlers and UI components can process messages consistently.

#### Acceptance Criteria

1. THE `messageType` field in `THREAD#{userId} MSG#{ts}#{id}` items SHALL support the following values: `text`, `image`, `audio`, `interactive`, `product_card`, `order_status`, `ai_suggestion`, `quick_reply`, and `system`.
2. THE `content` field for each `messageType` SHALL follow a documented schema: `text` messages use `{ body: string }`, `product_card` messages use `{ productId, name, price, imageUrl, sellerId, description }`, `order_status` messages use `{ orderId, orderNumber, status, items, totalAmount, updatedAt }`, `ai_suggestion` messages use `{ suggestionId, title, body, actionType, actionPayload }`, and `quick_reply` messages use `{ prompt, options: [{ label, value }] }`.
3. FOR ALL valid Rich_Message objects, serializing the `content` field to JSON and deserializing it back SHALL produce an equivalent object (round-trip property).

### Requirement 13: Typing Indicators

**User Story:** As a customer, I want to see when the seller is typing a response, so that I know a reply is coming.

#### Acceptance Criteria

1. WHEN a participant begins typing, THE Chat_Client SHALL send a `typing` action via WebSocket containing the `userId` and `isTyping: true`.
2. WHEN the Chat_Client receives a `typing` event from the WebSocket, THE MessageList component SHALL display an animated "typing..." indicator below the last message.
3. THE Chat_Client SHALL debounce typing signals to send at most one `typing` event per 3 seconds while the user is actively typing.
4. WHEN 5 seconds elapse without a new `typing` event from a participant, THE Chat_Client SHALL automatically hide the typing indicator for that participant.
5. THE Message_Router SHALL broadcast typing events only to the other participants in the conversation, not back to the sender.

### Requirement 14: Seller Presence and Online Status

**User Story:** As a customer, I want to see whether the seller is online or offline, so that I know whether to expect an immediate response.

#### Acceptance Criteria

1. WHILE a seller has at least one active WebSocket connection with a heartbeat received within the last 60 seconds, THE Presence_Tracker SHALL consider the seller online.
2. WHEN a seller transitions from online to offline (last connection disconnected or heartbeat expired), THE Presence_Tracker SHALL record the `lastSeen` timestamp on the seller's presence record in DynamoDB.
3. THE web chat header SHALL display "Online" with a green dot when the seller is online, and "Last seen [relative time]" when the seller is offline.
4. WHEN a customer sends a message while the seller is offline, THE system SHALL send an auto-reply message of type `system` with content: "The seller is currently offline. Expected response time: [estimated time based on seller's typical response patterns or a default of 30 minutes]."

### Requirement 15: WebSocket and Polling Coexistence

**User Story:** As a developer, I want the WebSocket and polling systems to coexist gracefully, so that the transition is smooth and fallback is reliable.

#### Acceptance Criteria

1. THE `useWebSocket` React hook SHALL expose a `connectionState` value of `connecting`, `connected`, `reconnecting`, or `disconnected` to the UI layer.
2. WHILE the `connectionState` is `connected`, THE `useWebSocket` hook SHALL suppress the polling sync client to avoid duplicate message delivery.
3. WHEN the `connectionState` transitions to `disconnected` (after exhausting reconnection attempts), THE `useWebSocket` hook SHALL activate the existing `sync-client.ts` polling mechanism.
4. WHEN the `connectionState` transitions back to `connected` from `disconnected`, THE `useWebSocket` hook SHALL stop the polling sync client and request a sync of missed messages from the server.
5. THE `useWebSocket` hook SHALL deduplicate messages received from both WebSocket and polling by checking `messageId` before adding to the message list.
