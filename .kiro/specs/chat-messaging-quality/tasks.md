# Implementation Plan: Chat & Messaging Quality

## Overview

Replace polling-based chat sync with WebSocket real-time messaging, add delivery receipts with visual status indicators, rich message types (product cards, order status cards, AI suggestion cards, quick-reply buttons), typing indicators, and seller presence tracking. Implementation follows bottom-up order: CDK infrastructure → backend handlers → shared schemas → frontend client → UI components → integration.

## Tasks

- [x] 1. Create shared WebSocket schemas and rich message types
  - [x] 1.1 Create `services/api/src/shared/websocket-schemas.ts` with Zod schemas
    - Define `MessageType` enum: `text`, `image`, `audio`, `interactive`, `product_card`, `order_status`, `ai_suggestion`, `quick_reply`, `system`
    - Define content schemas: `TextContentSchema`, `ProductCardContentSchema`, `OrderStatusContentSchema`, `AISuggestionContentSchema`, `QuickReplyContentSchema`
    - Define WebSocket action schemas: `HeartbeatActionSchema`, `TypingActionSchema`, `MarkReadActionSchema`, `SyncActionSchema`, `SendMessagePayloadSchema`
    - Define `ConnectionRegistryItem` and `PresenceRecord` types
    - Export inferred TypeScript types from all Zod schemas
    - _Requirements: 12.1, 12.2, 12.3, 3.1, 9.1, 10.1, 11.1, 11.3_

  - [x] 1.2 Write property tests for message schema validation (Property 10, Property 11)
    - **Property 10: Rich message content serialization round-trip**
    - **Property 11: Message type and content schema validation**
    - Test file: `services/api/src/shared/__tests__/websocket-schemas.property.test.ts`
    - Use fast-check to generate valid and invalid content for each messageType
    - **Validates: Requirements 12.1, 12.2, 12.3, 9.1, 10.1, 11.1, 11.3**

- [x] 2. Create WebSocket CDK infrastructure stack
  - [x] 2.1 Create `infra/cdk/lib/stacks/websocket-stack.ts`
    - Define `WebSocketStackProps` extending `cdk.StackProps` with `config`, `table`, `userPool`
    - Create API Gateway WebSocket API with routes: `$connect`, `$disconnect`, `$default`, `sendMessage`
    - Create 4 Lambda functions (Node.js 20, ARM64, 256MB, 30s timeout) for each route
    - Grant DynamoDB read/write permissions to all 4 Lambdas
    - Grant `execute-api:ManageConnections` to sendMessage and default handlers
    - Output WebSocket endpoint URL as CloudFormation stack output
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 2.2 Export WebSocketStack and wire into CDK app
    - Add `export * from './websocket-stack'` to `infra/cdk/lib/stacks/index.ts`
    - Instantiate `WebSocketStack` in `infra/cdk/bin/app.ts` after APIStack with proper dependencies
    - Pass `config`, `table`, `userPool` props
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.3 Write property tests for Connection Registry item structure (Property 2)
    - **Property 2: Connection Registry item structure**
    - Test file: `services/api/src/handlers/websocket/__tests__/websocket.property.test.ts`
    - Verify PK, SK, GSI1PK, GSI1SK patterns and expiresAt within 24h of connectedAt
    - **Validates: Requirements 2.1, 2.5**

- [x] 3. Implement WebSocket connect and disconnect handlers
  - [x] 3.1 Create `services/api/src/handlers/websocket/connect.ts`
    - Extract JWT from `queryStringParameters.token`
    - Verify JWT against Cognito User Pool (reuse `extractUserId` pattern from `core/auth.ts`)
    - Extract `userId` and `role` from claims
    - Store Connection Registry item: `PK: CONN#{connectionId}`, `SK: META`, `GSI1PK: USER_CONN#{userId}`, `GSI1SK: CONN#{connectionId}`, `expiresAt: now + 86400`
    - Update or create PRESENCE record: increment `connectionCount`, set `online: true`
    - Return 200 on success, 401 on invalid/missing JWT
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [x] 3.2 Create `services/api/src/handlers/websocket/disconnect.ts`
    - Extract `connectionId` from `requestContext`
    - Read Connection Registry item to get `userId`
    - Delete `CONN#{connectionId}` item from DynamoDB
    - Query GSI1 for remaining connections of the user
    - If no connections remain, update PRESENCE record: set `online: false`, `lastSeen: now`, `connectionCount: 0`
    - Otherwise decrement `connectionCount`
    - Return 200 always (best effort)
    - _Requirements: 2.3, 14.1, 14.2_

  - [x] 3.3 Write property tests for connect/disconnect (Property 1, Property 3)
    - **Property 1: Connection Registry round-trip**
    - **Property 3: Invalid JWT rejection**
    - Test file: `services/api/src/handlers/websocket/__tests__/websocket.property.test.ts`
    - **Validates: Requirements 2.1, 2.3, 2.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement default handler (heartbeat, typing, markRead, sync)
  - [x] 5.1 Create `services/api/src/handlers/websocket/default.ts`
    - Parse incoming WebSocket action from `event.body`
    - Route by `action` field: `heartbeat`, `typing`, `markRead`, `sync`
    - **heartbeat**: Update Connection Registry `expiresAt` to `now + 86400`
    - **typing**: Query recipient's connections via GSI1, push typing event to all connections except sender's
    - **markRead**: Update message `deliveryStatus` to `read`, set `readAt`, push status update to sender's connections
    - **sync**: Query messages since `lastMessageTimestamp`, return missed messages to requesting connection
    - Return `{ statusCode: 200, body: '' }` for all actions
    - _Requirements: 5.1, 5.2, 13.1, 13.5, 6.3, 4.6_

  - [x] 5.2 Write property tests for heartbeat and typing (Property 8, Property 12, Property 13)
    - **Property 8: Heartbeat TTL refresh**
    - **Property 12: Typing debounce** (client-side, but validate server broadcast logic)
    - **Property 13: Typing broadcast excludes sender**
    - Test file: `services/api/src/handlers/websocket/__tests__/websocket.property.test.ts`
    - **Validates: Requirements 5.1, 13.3, 13.5**

- [x] 6. Implement sendMessage handler
  - [x] 6.1 Create `services/api/src/handlers/websocket/send-message.ts`
    - Parse and validate `SendMessagePayload` using Zod schema from `websocket-schemas.ts`
    - Look up sender's `userId` from Connection Registry via `connectionId`
    - Generate `messageId` and `timestamp`
    - Store message in both `THREAD#{senderId}` and `THREAD#{recipientId}` with `deliveryStatus: 'sent'`, `sentAt: now`
    - Query Connection Registry (GSI1) for all recipient connections
    - Push message to each recipient connection via API Gateway Management API `@connections`
    - On successful push to ≥1 connection: update `deliveryStatus` to `delivered`, set `deliveredAt`
    - Push message back to all sender connections (multi-device sync)
    - Handle `GoneException` (410): delete stale connection, continue with remaining
    - On all pushes fail: leave as `sent`, available on next sync
    - On DynamoDB write failure: set `deliveryStatus: 'failed'`, push failure notification to sender
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.1, 6.2, 6.4, 6.5_

  - [x] 6.2 Write property tests for message delivery (Property 4, Property 5, Property 6)
    - **Property 4: Message dual-thread storage**
    - **Property 5: Message fan-out to all user connections**
    - **Property 6: Delivery status transition on successful push**
    - Test file: `services/api/src/handlers/websocket/__tests__/websocket.property.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.3, 6.1, 6.2, 6.3, 6.4, 7.2**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Enhance status-webhook-handler with WebSocket push
  - [x] 8.1 Modify `services/api/src/handlers/whatsapp/status-webhook-handler.ts`
    - After updating delivery status in DynamoDB, query Connection Registry (GSI1) for sender's active connections
    - If connections exist, push delivery status update event to each connection via API Gateway Management API
    - Handle `GoneException` by deleting stale connections
    - If no connections, store in DynamoDB only (client picks up on next sync)
    - Add `WEBSOCKET_API_ENDPOINT` environment variable for Management API URL
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 8.2 Write property test for Twilio status mapping (Property 9)
    - **Property 9: Twilio status mapping**
    - Test file: `services/api/src/handlers/websocket/__tests__/websocket.property.test.ts`
    - Verify mapping: sent→sent, delivered→delivered, read→read, failed→failed, undelivered→failed, unknown→undefined
    - **Validates: Requirements 7.3**

- [x] 9. Implement seller presence and auto-reply
  - [x] 9.1 Add presence logic to connect/disconnect/default handlers
    - In connect handler: update `PRESENCE#{userId}` with `online: true`, increment `connectionCount`
    - In disconnect handler: decrement `connectionCount`, if 0 set `online: false` and `lastSeen`
    - In default handler (heartbeat): update presence `updatedAt` timestamp
    - _Requirements: 14.1, 14.2_

  - [x] 9.2 Add auto-reply for offline seller in sendMessage handler
    - Before pushing to recipient, check `PRESENCE#{recipientId}` record
    - If seller is offline (no active connections or last heartbeat > 60s ago), create a `system` type message in customer's thread with estimated response time
    - _Requirements: 14.3, 14.4_

  - [x] 9.3 Write property tests for presence and auto-reply (Property 14, Property 15)
    - **Property 14: Seller presence determination**
    - **Property 15: Auto-reply to offline seller**
    - Test file: `services/api/src/handlers/websocket/__tests__/websocket.property.test.ts`
    - **Validates: Requirements 14.1, 14.2, 14.4**

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Create frontend WebSocket client
  - [x] 11.1 Create `apps/web/lib/websocket-client.ts`
    - Implement `WebSocketClient` class with `connect(token)`, `disconnect()`, `send(action, payload)`, `onMessage(handler)`, `onStateChange(handler)`
    - Manage `ConnectionState`: `connecting`, `connected`, `reconnecting`, `disconnected`
    - Send heartbeat ping every 30 seconds
    - Implement exponential backoff reconnection: 1s → 2s → 4s → 8s → 16s → 30s cap
    - After 5 consecutive failures, transition to `disconnected` state
    - Treat absence of heartbeat ack within 60s as connection failure
    - On reconnection, send `sync` action with last received message timestamp
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3_

  - [x] 11.2 Write property tests for reconnection and dedup (Property 7, Property 16, Property 17)
    - **Property 7: Exponential backoff calculation**
    - **Property 16: Message deduplication**
    - **Property 17: Reconnection sync timestamp**
    - Test file: `apps/web/lib/__tests__/websocket-client.property.test.ts`
    - **Validates: Requirements 4.3, 15.5, 4.6**

- [x] 12. Create useWebSocket React hook
  - [x] 12.1 Create `apps/web/hooks/useWebSocket.ts`
    - Expose `connectionState`, `sendMessage`, `sendTyping`, `markRead`, `messages`, `typingUsers`, `presenceMap`
    - When `connected`: suppress `sync-client.ts` polling
    - When `disconnected` (after exhausting retries): activate polling fallback
    - When reconnected from `disconnected`: stop polling, request sync of missed messages
    - Deduplicate messages by `messageId` from both WebSocket and polling sources
    - Debounce typing signals: at most one `typing` event per 3 seconds
    - Auto-hide typing indicator after 5 seconds without new typing event
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 13.3, 13.4_

  - [x] 12.2 Write property test for typing debounce (Property 12)
    - **Property 12: Typing debounce**
    - Test file: `apps/web/lib/__tests__/websocket-client.property.test.ts`
    - Verify at most one typing event per 3-second window
    - **Validates: Requirements 13.3**

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Create MessageStatus component with retry
  - [x] 14.1 Create `apps/web/components/Chat/MessageStatus.tsx`
    - Render delivery status icons: clock (queued), single gray check (sent), double gray checks (delivered), double blue checks (read), red alert (failed)
    - Show "Retry" button for failed messages
    - On retry tap, re-send message via `sendMessage` WebSocket route with new messageId
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 14.2 Write unit tests for MessageStatus component
    - Render with each deliveryStatus value, verify correct icon and aria-label
    - Verify Retry button appears only for `failed` status
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 15. Create rich message card components
  - [x] 15.1 Create `apps/web/components/Chat/ProductCard.tsx`
    - Render product image, name, formatted price (₹ prefix), description, and "Add to cart" button
    - On "Add to cart" tap, call existing cart API (`api-cart.ts`)
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 15.2 Create `apps/web/components/Chat/OrderStatusCard.tsx`
    - Render order number, color-coded status badge, item summary, total amount, last updated time
    - _Requirements: 10.1, 10.2_

  - [x] 15.3 Create `apps/web/components/Chat/AISuggestionCard.tsx`
    - Render title, body text, and action buttons (e.g., "Approve", "Dismiss")
    - _Requirements: 11.1, 11.2_

  - [x] 15.4 Create `apps/web/components/Chat/QuickReplyButtons.tsx`
    - Render text prompt followed by horizontally scrollable pill-shaped buttons
    - On tap, send a new text message with the selected option's `value`
    - _Requirements: 11.3, 11.4, 11.5_

  - [x] 15.5 Write unit tests for rich message card components
    - Test ProductCard, OrderStatusCard, AISuggestionCard, QuickReplyButtons with sample data
    - Verify rendered elements, button interactions, and accessibility
    - _Requirements: 9.2, 10.2, 11.2, 11.4_

- [x] 16. Update TypingIndicator component
  - [x] 16.1 Enhance `apps/web/components/Chat/TypingIndicator.tsx`
    - Accept `typingUsers` prop (Map of userId → boolean)
    - Display animated dots with participant name when typing
    - Auto-hide after 5 seconds without new typing event
    - _Requirements: 13.2, 13.4_

- [x] 17. Integrate rich messages and WebSocket into MessageList
  - [x] 17.1 Modify `apps/web/components/Chat/MessageList.tsx`
    - Import and render `ProductCard`, `OrderStatusCard`, `AISuggestionCard`, `QuickReplyButtons` based on `messageType`
    - Replace inline `DeliveryStatusIcon` with new `MessageStatus` component
    - Pass `typingUsers` to `TypingIndicator`
    - Send `markRead` via WebSocket when messages enter visible viewport (IntersectionObserver)
    - _Requirements: 9.2, 10.2, 11.2, 11.4, 8.1, 6.3, 13.2_

- [x] 18. Wire WebSocket into chat pages
  - [x] 18.1 Integrate `useWebSocket` hook into `apps/web/app/(customer)/chat/page.tsx`
    - Initialize WebSocket connection with Cognito JWT token
    - Pass `connectionState`, `messages`, `typingUsers`, `presenceMap` to child components
    - Display seller online/offline status in chat header with green dot or "Last seen" text
    - Wire `sendMessage`, `sendTyping` to ChatComposer
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 14.3_

  - [x] 18.2 Integrate `useWebSocket` hook into `apps/web/app/seller/inbox/page.tsx`
    - Initialize WebSocket connection for seller role
    - Pass real-time messages and typing indicators to inbox components
    - Display customer presence status
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 19. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Final integration and end-to-end wiring
  - [x] 20.1 Update WebSocketStack to pass endpoint URL to status-webhook-handler
    - Add `WEBSOCKET_API_ENDPOINT` environment variable to the status webhook Lambda in `api-stack.ts`
    - Grant `execute-api:ManageConnections` permission to status webhook Lambda
    - _Requirements: 7.2_

  - [x] 20.2 Verify WebSocket ↔ polling fallback coexistence
    - Ensure `useWebSocket` hook correctly suppresses/activates `sync-client.ts`
    - Verify message deduplication across both sources
    - _Requirements: 15.2, 15.3, 15.4, 15.5_

  - [x] 20.3 Write integration tests for end-to-end flows
    - Test: connect → send → receive → markRead → status update
    - Test: Twilio status webhook → DynamoDB update → WebSocket push
    - Test: WebSocket → polling fallback → WebSocket reconnection with sync
    - _Requirements: 3.1, 3.2, 6.1, 6.2, 6.3, 7.1, 7.2, 15.2, 15.3, 15.4_

- [x] 21. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 17 correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The implementation follows bottom-up order: schemas → CDK → backend handlers → frontend client → UI components → integration
