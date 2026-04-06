# Omnichannel Sync Fix — Bugfix Design

## Overview

Five interconnected defects break bi-directional message delivery between WhatsApp and the web dashboard. The seller-reply-handler publishes `SellerReplySent` events that the notification-router ignores; the WebSocket `sendMessage` handler and WhatsApp worker both skip EventBridge publication; the fan-out Lambda queries the wrong DynamoDB key pattern for WebSocket connections; and the fan-out Lambda is missing the `WEBSOCKET_API_ENDPOINT` environment variable. The fix wires each message producer into the `message-router` service (or directly publishes `message.created`), corrects the fan-out Lambda's DynamoDB query to use `GSI1PK = USER_CONN#{userId}`, and adds the missing env var in CDK.

## Glossary

- **Bug_Condition (C)**: Any message that should be delivered cross-channel (seller reply → customer WhatsApp, WhatsApp inbound → seller WebSocket, web message → WhatsApp) but is not, due to missing EventBridge events, wrong DynamoDB key lookups, or missing env vars
- **Property (P)**: Every message stored in DynamoDB triggers a `message.created` EventBridge event, the fan-out Lambda correctly resolves recipient WebSocket connections via GSI1, and the fan-out Lambda has the WebSocket endpoint to push messages
- **Preservation**: Existing web-to-web chat delivery, WhatsApp inbound message storage, seller inbox polling, human handoff state management, and notification-router `CustomerMessageSent` routing must remain unchanged
- **message-router**: The service in `services/api/src/services/message-router.ts` that stores a message in DynamoDB and publishes `message.created` to EventBridge
- **fan-out Lambda**: The Lambda in `services/api/src/handlers/messaging/fanout.ts` triggered by `message.created` events that pushes messages to recipient's active channels
- **Connection Registry**: DynamoDB items with `PK = CONN#{connectionId}`, `SK = META`, `GSI1PK = USER_CONN#{userId}` storing active WebSocket connections

## Bug Details

### Bug Condition

The bug manifests when any message needs cross-channel delivery (web ↔ WhatsApp). Five defects in the sync chain prevent the `message.created` EventBridge event from being published, or prevent the fan-out Lambda from successfully delivering messages even when the event fires.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { source: string, handler: string, recipientUserId: string }
  OUTPUT: boolean

  // Defect 1: Seller reply via HTTP API never triggers fan-out
  IF input.handler == 'seller-reply-handler'
     AND input.source == 'vyapargyan.chat'
     AND eventType == 'SellerReplySent'
     RETURN TRUE  // notification-router only handles CustomerMessageSent

  // Defect 2: WebSocket sendMessage never publishes to EventBridge
  IF input.handler == 'ws-send-message'
     AND NOT publishes('message.created')
     RETURN TRUE

  // Defect 3: WhatsApp worker stores via putMessage() without EventBridge
  IF input.handler == 'whatsapp-worker'
     AND NOT calls(messageRouter.routeMessage)
     AND NOT publishes('message.created')
     RETURN TRUE

  // Defect 4: Fan-out queries wrong key pattern for WebSocket connections
  IF input.handler == 'fanout'
     AND queriesKey('CONNECTION#{userId}')  // should be GSI1PK = USER_CONN#{userId}
     RETURN TRUE

  // Defect 5: Fan-out missing WEBSOCKET_API_ENDPOINT env var
  IF input.handler == 'fanout'
     AND NOT hasEnvVar('WEBSOCKET_API_ENDPOINT')
     RETURN TRUE

  RETURN FALSE
END FUNCTION
```

### Examples

- Seller replies "Your order is ready" from web Inbox → `SellerReplySent` event published to `vyapargyan.chat` → notification-router ignores it (only handles `CustomerMessageSent`) → customer never receives WhatsApp message
- Customer sends "I want Amul Butter" via WebSocket chat → message stored in dual threads, pushed to recipient WebSocket connections → but no `message.created` event → fan-out never triggers → no WhatsApp delivery to seller
- Customer sends "Hello" via WhatsApp → worker stores in `THREAD#{userId}` via `putMessage()` → no EventBridge event → seller's web Inbox only sees it on next poll/refresh, not real-time
- Fan-out Lambda receives `message.created` → queries `PK = CONNECTION#{userId}` → returns 0 items (connections stored as `PK = CONN#{connectionId}` with `GSI1PK = USER_CONN#{userId}`) → WebSocket push skipped
- Fan-out Lambda tries to push via WebSocket → reads `WEBSOCKET_API_ENDPOINT` → undefined → logs warning and skips push

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Web-to-web chat delivery via WebSocket `sendMessage` handler must continue to store messages in dual threads and push to recipient WebSocket connections directly (immediate same-channel delivery)
- WhatsApp worker must continue to store inbound messages in `THREAD#{userId}` via `putMessage()` for persistence
- Human handoff state management in seller-reply-handler (`/ai` command, startHandoff, extendHandoff, endHandoff) must remain unchanged
- Notification-router must continue to handle `CustomerMessageSent` events for routing customer messages to sellers based on preferred channel
- Connection Registry schema (`PK = CONN#{connectionId}`, `GSI1PK = USER_CONN#{userId}`) must not change
- WebSocket connect/disconnect handlers must continue to work with existing key patterns

**Scope:**
All inputs that do NOT involve cross-channel delivery should be completely unaffected. This includes:
- Same-channel WebSocket message delivery (already works)
- WhatsApp inbound message storage (already works)
- Seller inbox polling/refresh (already works)
- Authentication, session management, cart operations
- Campaign execution, approval workflows, admin operations

## Hypothesized Root Cause

Based on code analysis, the root causes are confirmed (not hypothesized):

1. **Seller-reply-handler publishes wrong event type**: `seller-reply-handler.ts` line ~117 publishes `{ Source: 'vyapargyan.chat', DetailType: 'SellerReplySent' }` but the notification-router only handles `CustomerMessageSent`. No EventBridge rule routes `SellerReplySent` to the fan-out Lambda either, since fan-out listens on `source: vyapargyan.messaging` / `detail-type: message.created`.

2. **WebSocket sendMessage handler never publishes to EventBridge**: `send-message.ts` stores messages in dual threads and pushes to WebSocket connections, but has no EventBridge integration. It doesn't import `EventBridgeClient` or call `routeMessage()`.

3. **WhatsApp worker stores directly without EventBridge**: `worker.ts` calls `putMessage()` directly in `handleCustomerMessage()` (line ~530) but never calls `routeMessage()` from `message-router.ts` and never publishes `message.created` to EventBridge.

4. **Fan-out Lambda queries wrong DynamoDB key**: `fanout.ts` `getActiveChannels()` queries `PK = CONNECTION#{userId}` but the Connection Registry uses `PK = CONN#{connectionId}` with `GSI1PK = USER_CONN#{userId}`. The correct query should use GSI1 with `GSI1PK = USER_CONN#{recipientUserId}`.

5. **Fan-out Lambda missing WEBSOCKET_API_ENDPOINT**: In `events-stack.ts`, the `messageFanoutFunction` environment block does not include `WEBSOCKET_API_ENDPOINT`. The WebSocket stack constructs this URL as `https://{apiId}.execute-api.{region}.amazonaws.com/{stage}` but never passes it to the events stack.

## Correctness Properties

Property 1: Bug Condition - Cross-Channel Message Delivery

_For any_ message where the sender and recipient are on different channels (seller web reply to WhatsApp customer, WhatsApp inbound to web seller, web chat to WhatsApp recipient), the fixed system SHALL publish a `message.created` event to EventBridge with correct `recipientUserId`, `channel`, and `content`, and the fan-out Lambda SHALL successfully resolve the recipient's active channels and deliver the message.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Same-Channel and Existing Behavior

_For any_ input that does NOT require cross-channel delivery (same-channel WebSocket messages, WhatsApp inbound storage, seller inbox polling, human handoff commands, notification-router CustomerMessageSent handling), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

**File**: `services/api/src/handlers/seller/seller-reply-handler.ts`

**Defect 1 Fix**: After storing messages in dual threads and managing handoff state, additionally publish a `message.created` event via `routeMessage()` or directly via EventBridge with `source: vyapargyan.messaging` and `detail-type: message.created`. Keep the existing `SellerReplySent` event for backward compatibility with notification-router.

**Specific Changes**:
1. Import `routeMessage` from `../../services/message-router`
2. After the dual-thread writes and handoff logic (but before the existing `SellerReplySent` publish), call `routeMessage()` with `recipientUserId = customerUserId`, `channel = 'web'`, `senderType = 'seller'`
3. Skip the `routeMessage` call when content is `/ai` (handoff command, not a real message)
4. Note: `routeMessage` will write a third copy to `THREAD#{customerUserId}` — this is acceptable as it's idempotent (same messageId, same SK pattern). Alternatively, publish the EventBridge event directly without the extra DynamoDB write since the message is already stored.

---

**File**: `services/api/src/handlers/websocket/send-message.ts`

**Defect 2 Fix**: After storing the message in dual threads (step 5), publish a `message.created` event to EventBridge for cross-channel fan-out.

**Specific Changes**:
1. Import `EventBridgeClient` and `PutEventsCommand` from `@aws-sdk/client-eventbridge`
2. After the dual-thread store succeeds (after step 5, before step 6), publish `{ Source: 'vyapargyan.messaging', DetailType: 'message.created' }` with `recipientUserId`, `channel: 'web'`, `senderType` mapped from `senderRole`
3. The EventBridge publish is fire-and-forget (don't block the WebSocket response on it)
4. Add `EVENT_BUS_NAME` env var to the sendMessage Lambda in `websocket-stack.ts`
5. Grant `eventBus.grantPutEventsTo(sendMessageFunction)` in `websocket-stack.ts`

---

**File**: `services/api/src/handlers/whatsapp/worker.ts`

**Defect 3 Fix**: In `handleCustomerMessage()`, after storing the inbound message via `putMessage()`, publish a `message.created` event to EventBridge for real-time WebSocket push to the seller.

**Specific Changes**:
1. Import `EventBridgeClient` and `PutEventsCommand` from `@aws-sdk/client-eventbridge`
2. After the `putMessage()` call in `handleCustomerMessage()`, publish `{ Source: 'vyapargyan.messaging', DetailType: 'message.created' }` with `recipientUserId` set to the seller's userId (resolved from the customer's session or thread context), `channel: 'whatsapp'`, `senderType: 'customer'`
3. Determining the `recipientUserId` (seller): use the session's `handoffSellerId` if in handoff mode, or look up the seller associated with the customer's active thread. If no seller can be determined, skip the EventBridge publish (the message is still stored for polling).
4. The WhatsApp worker already has `EVENT_BUS_NAME` env var and EventBridge permissions in CDK.

---

**File**: `services/api/src/handlers/messaging/fanout.ts`

**Defect 4 Fix**: Change `getActiveChannels()` to query GSI1 with `GSI1PK = USER_CONN#{recipientUserId}` instead of querying the main table with `PK = CONNECTION#{recipientUserId}`.

**Specific Changes**:
1. In `getActiveChannels()`, change the WebSocket connection query from:
   ```typescript
   KeyConditionExpression: 'PK = :pk',
   ExpressionAttributeValues: { ':pk': `CONNECTION#${recipientUserId}` },
   ```
   to:
   ```typescript
   IndexName: 'GSI1',
   KeyConditionExpression: 'GSI1PK = :pk',
   ExpressionAttributeValues: { ':pk': `USER_CONN#${recipientUserId}` },
   ```
2. In `pushToWebSocket()`, apply the same GSI1 query fix for the full connection list retrieval
3. Extract `connectionId` from the GSI1 query results (the items have a `connectionId` field)

---

**File**: `infra/cdk/lib/stacks/events-stack.ts`

**Defect 5 Fix**: Pass `WEBSOCKET_API_ENDPOINT` to the fan-out Lambda.

**Specific Changes**:
1. Accept the WebSocket API endpoint as a prop in `EventsStackProps` (add `webSocketEndpoint?: string`)
2. Add `WEBSOCKET_API_ENDPOINT: props.webSocketEndpoint` to the `messageFanoutFunction` environment block
3. In the CDK app entry point (where stacks are instantiated), pass `webSocketStack.webSocketEndpoint` (the `https://` callback URL) to the events stack

---

**File**: `infra/cdk/lib/stacks/websocket-stack.ts`

**Defect 2 CDK Fix**: Add EventBridge integration for the sendMessage Lambda.

**Specific Changes**:
1. Accept `eventBus` as a prop in `WebSocketStackProps`
2. Add `EVENT_BUS_NAME: eventBus.eventBusName` to the `sendMessageFunction` environment
3. Grant `eventBus.grantPutEventsTo(sendMessageFunction)`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each defect BEFORE implementing the fix. Confirm the root cause analysis.

**Test Plan**: Write unit tests that mock DynamoDB and EventBridge, then verify each handler's behavior regarding EventBridge event publication and DynamoDB query patterns.

**Test Cases**:
1. **Seller Reply EventBridge Test**: Call `seller-reply-handler` with a valid reply → assert no `message.created` event is published (will confirm defect 1 on unfixed code)
2. **WebSocket sendMessage EventBridge Test**: Call `send-message.handler` with a valid message → assert no EventBridge `PutEvents` call is made (will confirm defect 2 on unfixed code)
3. **WhatsApp Worker EventBridge Test**: Process a customer WhatsApp message through `handleCustomerMessage` → assert no `message.created` event is published after `putMessage()` (will confirm defect 3 on unfixed code)
4. **Fan-out Connection Query Test**: Call `getActiveChannels()` with a userId that has connections stored as `CONN#{connId}` with `GSI1PK = USER_CONN#{userId}` → assert the query uses `PK = CONNECTION#{userId}` (wrong key, will return 0 results, confirming defect 4)
5. **Fan-out Env Var Test**: Instantiate fan-out handler without `WEBSOCKET_API_ENDPOINT` → assert `pushToWebSocket` logs warning and skips (will confirm defect 5)

**Expected Counterexamples**:
- No `message.created` events published by seller-reply-handler, sendMessage handler, or WhatsApp worker
- Fan-out Lambda returns empty connection list despite active connections existing
- Fan-out Lambda skips WebSocket push due to missing endpoint

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedHandler(input)
  ASSERT message.created event published to EventBridge
  ASSERT fan-out Lambda queries GSI1 with USER_CONN#{userId}
  ASSERT fan-out Lambda has WEBSOCKET_API_ENDPOINT
  ASSERT cross-channel delivery succeeds
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT fixedHandler(input) = originalHandler(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for same-channel WebSocket messages, WhatsApp storage, and handoff commands, then write property-based tests capturing that behavior.

**Test Cases**:
1. **WebSocket Same-Channel Preservation**: Verify that web-to-web message delivery (dual-thread store + WebSocket push) continues to work identically after adding EventBridge publication
2. **WhatsApp Storage Preservation**: Verify that inbound WhatsApp messages are still stored in `THREAD#{userId}` via `putMessage()` with identical fields after adding EventBridge publication
3. **Handoff State Preservation**: Verify that `/ai` command, `startHandoff`, `extendHandoff`, `endHandoff` continue to work correctly in seller-reply-handler
4. **Notification Router Preservation**: Verify that `CustomerMessageSent` events continue to be routed to sellers via the notification-router

### Unit Tests

- Test seller-reply-handler publishes both `SellerReplySent` AND `message.created` events
- Test WebSocket sendMessage handler publishes `message.created` after dual-thread store
- Test WhatsApp worker publishes `message.created` after `putMessage()`
- Test fan-out `getActiveChannels()` queries GSI1 with `USER_CONN#` prefix
- Test fan-out `pushToWebSocket()` queries GSI1 for full connection list
- Test fan-out skips echo (originating channel filtered out)
- Test `/ai` command does not trigger `message.created` (not a real message)

### Property-Based Tests

- Generate random message payloads and verify that every stored message also produces a `message.created` EventBridge event with matching `recipientUserId` and `channel`
- Generate random connection registry states and verify fan-out correctly resolves connections via GSI1 query
- Generate random inputs that are NOT cross-channel and verify preservation of existing behavior (same DynamoDB writes, same WebSocket pushes)

### Integration Tests

- Test full seller web reply → EventBridge → fan-out → WhatsApp delivery flow
- Test full WhatsApp inbound → EventBridge → fan-out → WebSocket push flow
- Test full WebSocket sendMessage → EventBridge → fan-out → WhatsApp delivery flow
- Test CDK synth produces correct env vars and IAM permissions for all modified Lambdas
