# Omnichannel Seller Fix — Bugfix Design

## Overview

The omnichannel chat system has a fundamental architectural flaw: the web chat and seller inbox use a client-side `sessionStorage` bridge (`chat-bridge.ts`) as the primary message store, while the backend stores messages in DynamoDB (`THREAD#{userId}`). These two data paths are disconnected — messages written to DynamoDB by the WhatsApp worker or seller reply handler never reach the bridge, and bridge-only messages never reach DynamoDB. The seller dashboard compounds this with hardcoded demo metrics, missing sync indicators, non-persistent read receipts, and missing toast feedback on order actions.

The fix strategy is to make the backend API the primary data source for both customer web chat and seller inbox, demoting the bridge to a fallback-only role when the API is unavailable. On the seller tab, we wire up real API calls for dashboard metrics, add sync status indicators, persist read receipts, and ensure toast feedback on all order actions.

## Glossary

- **Bug_Condition (C)**: The set of conditions where the sessionStorage bridge is used as the primary message source instead of the backend API, causing cross-channel message loss, stale data, and missing UI feedback
- **Property (P)**: Messages stored in `THREAD#{userId}` in DynamoDB are retrievable and displayed in both customer web chat and seller inbox via the sync polling endpoint or WebSocket push
- **Preservation**: Existing bridge-based fallback behavior when the backend API is unavailable, WebSocket polling suppression when connected, cart operations, rich message rendering, and demo seed data
- **chat-bridge.ts**: Client-side sessionStorage wrapper in `apps/web/lib/chat-bridge.ts` that stores `BridgeMessage[]` per session — currently the primary (broken) message source
- **sync-client.ts**: Polling client in `apps/web/lib/sync-client.ts` that calls `GET /api/v1/chat/sync` with exponential backoff — currently only activated as WebSocket fallback, not as primary data source
- **THREAD#{userId}**: DynamoDB partition key pattern for message storage, queried by `queryMessages()` in `dynamodb-adapter.ts`
- **seller-reply-handler.ts**: Backend handler that stores seller replies in both `THREAD#{sellerId}` and `THREAD#{customerUserId}`, publishes `SellerReplySent` and `message.created` events

## Bug Details

### Bug Condition

The bug manifests across two areas: (A) cross-channel message sync is broken because the frontend reads from sessionStorage bridge instead of the backend API, and (B) the seller tab UI uses hardcoded data and lacks feedback mechanisms.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { source: 'chat_page' | 'seller_inbox' | 'seller_dashboard' | 'seller_orders', action: string }
  OUTPUT: boolean

  // Area A: Message sync broken
  IF input.source = 'chat_page' AND input.action = 'load_messages'
    RETURN primaryDataSource(input) = 'sessionStorage_bridge'
           AND backendHasMessages(input.userId)
  
  IF input.source = 'chat_page' AND input.action = 'poll_updates'
    RETURN pollingSource(input) = 'bridge_interval'
           AND NOT pollingSource(input) = 'sync_endpoint'

  IF input.source = 'seller_inbox' AND input.action = 'load_conversations'
    RETURN primaryDataSource(input) = 'sessionStorage_bridge'
           AND backendHasConversations(input.sellerId)

  IF input.source = 'chat_page' AND input.action = 'receive_message'
    RETURN message.sourceId != normalizedId(message)
           AND duplicateDisplayed(message)

  IF input.source = 'chat_page' AND input.action = 'websocket_silent_fail'
    RETURN websocket.readyState != OPEN
           AND pollingState = 'suppressed'

  // Area B: Seller tab UI issues
  IF input.source = 'seller_dashboard' AND input.action = 'load_metrics'
    RETURN metricsSource(input) = 'hardcoded'

  IF input.source = 'seller_inbox' AND input.action = 'view_conversations'
    RETURN syncStatusIndicator = 'absent'

  IF input.source = 'seller_inbox' AND input.action = 'mark_read'
    RETURN readReceiptPersisted = false

  IF input.source = 'seller_orders' AND input.action = 'inline_quick_action'
    RETURN toastFeedback = 'absent'

  RETURN false
END FUNCTION
```

### Examples

- **WhatsApp → Web Chat**: Customer sends "Hi" on WhatsApp → worker stores in `THREAD#cust-001` → web chat page reads from `sessionStorage` bridge → message never appears. Expected: web chat polls `/api/v1/chat/sync` and displays the message with a WhatsApp channel indicator.
- **Web Chat → WhatsApp**: Customer sends "Show products" in web chat → API stores in DynamoDB → bot responds → response stored in `THREAD#cust-001` → web chat bridge polling doesn't query DynamoDB → response never appears. Expected: sync polling picks up the response.
- **Seller Reply → Customer**: Seller replies "Order shipped!" from inbox → `seller-reply-handler.ts` stores in `THREAD#cust-001` → customer web chat reads bridge → reply never appears. Expected: customer's sync polling picks up the reply.
- **Duplicate Messages**: Customer sends via web chat → bridge stores as `cust-1749123456` → API stores as `msg-uuid-abc` → both appear in merged list → `deduplicateMessages()` sees different IDs → duplicate displayed. Expected: content-based or correlation-ID deduplication prevents this.
- **Dashboard Metrics**: Seller opens dashboard → sees hardcoded "₹45,231 Total Sales" → no API call made. Expected: dashboard fetches from `/api/v1/seller/dashboard` and displays real data.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- When the backend API is unavailable, the sessionStorage bridge SHALL continue to provide a functional demo chat experience (Req 3.1)
- When WebSocket is connected and healthy, polling SHALL remain suppressed to avoid redundant requests (Req 3.2)
- Cart operations (add, update, remove, checkout) SHALL continue through the existing cart API flow (Req 3.3)
- Seed conversations (Priya Sharma, Rahul Verma) SHALL continue as fallback when no API conversations are available (Req 3.4)
- Demo order data SHALL continue as fallback on the orders page (Req 3.5)
- Rich message types (product cards, order status, AI suggestions, quick replies) SHALL continue rendering in MessageList (Req 3.6)
- Seller inbox SHALL continue dual-send via HTTP API (primary) and WebSocket (secondary) (Req 3.7)

**Scope:**
All inputs that do NOT involve message loading, message polling, dashboard metrics, sync status display, read receipt persistence, or order action feedback should be completely unaffected by this fix. This includes:
- Authentication and authorization flows
- Catalog browsing and product detail pages
- Customer account management
- Admin panel functionality
- Campaign management
- Approval workflows

## Hypothesized Root Cause

Based on the code analysis, the root causes are:

1. **Bridge-First Architecture in Chat Page**: `apps/web/app/(customer)/chat/page.tsx` loads messages from `getSessionMessages(DEMO_SESSION_ID)` on mount and polls the bridge every 1.5s. The `getHistory()` API call is a one-shot attempt that merges results but the bridge polling loop overwrites state. The sync client (`sync-client.ts`) is only activated when WebSocket disconnects, not as the primary polling mechanism.

2. **Bridge-First Architecture in Seller Inbox**: `apps/web/app/seller/inbox/page.tsx` builds sessions from `getSessionMessages()` and polls the bridge every 1.5s. The API call to `/api/v1/seller/inbox` only adds new sessions that don't overlap with seed data — it doesn't replace the bridge as the primary source.

3. **Missing Message ID Correlation**: When a customer sends a message, the bridge assigns `cust-{timestamp}` as the ID, while the backend assigns a UUID. `deduplicateMessages()` in `websocket-client.ts` deduplicates by `messageId` only, so the same logical message with two different IDs appears twice.

4. **WebSocket Zombie State Gap**: The `WebSocketClient` has heartbeat detection (30s ping, 60s ack timeout), but there's a gap: if the WebSocket enters a state where `readyState` is not `OPEN` but no `close` event fires (browser tab backgrounding, network change), the heartbeat timer may not fire and polling won't resume. The `useWebSocket` hook only starts polling on `connectionState === 'disconnected'`.

5. **Hardcoded Dashboard**: `apps/web/app/seller/page.tsx` renders static JSX with hardcoded values (`₹45,231`, `127`, etc.) and makes zero API calls.

6. **Local-Only Read Receipts**: `handleSelectSession()` in the inbox page sets `unread: 0` in local state but never calls a backend API to persist the read status.

7. **Missing Toast on Inline Quick Actions**: The orders page has a toast system but inline quick-action buttons on mobile order cards may not route through the same `handleAction` callback that triggers toasts.

## Correctness Properties

Property 1: Bug Condition - Backend Messages Appear in Web Chat

_For any_ message stored in `THREAD#{userId}` in DynamoDB (whether from WhatsApp inbound, web chat send, or seller reply), the customer web chat page SHALL retrieve and display that message via the sync polling endpoint (`/api/v1/chat/sync`), with correct channel indicator and without duplicates.

**Validates: Requirements 2.1, 2.2, 2.3, 2.5**

Property 2: Preservation - Bridge Fallback When API Unavailable

_For any_ scenario where the backend API is unreachable (network error, 5xx response, auth failure), the web chat and seller inbox SHALL fall back to the sessionStorage bridge for message display and sending, preserving the existing demo chat experience without errors or blank screens.

**Validates: Requirements 3.1, 3.4, 3.6**

Property 3: Bug Condition - Seller Inbox Shows Backend Conversations

_For any_ conversation with messages in `THREAD#{sellerId}` in DynamoDB, the seller inbox page SHALL retrieve and display those conversations via the `/api/v1/seller/inbox` endpoint, with correct unread counts, channel indicators, and last message previews.

**Validates: Requirements 2.3, 2.7, 2.8**

Property 4: Preservation - Existing UI Behaviors Unchanged

_For any_ interaction that does not involve message loading, dashboard metrics, sync status, read receipts, or order action feedback, the fixed code SHALL produce exactly the same behavior as the original code, preserving cart operations, rich message rendering, WebSocket polling suppression, and dual-send redundancy.

**Validates: Requirements 3.2, 3.3, 3.5, 3.6, 3.7**

Property 5: Bug Condition - Dashboard Fetches Real Metrics

_For any_ seller dashboard page load, the system SHALL attempt to fetch metrics from the backend API and display real data, falling back to demo values only when the API is unavailable.

**Validates: Requirements 2.6**

Property 6: Bug Condition - WebSocket Failure Resumes Polling

_For any_ WebSocket connection that enters a failed state (silent failure, heartbeat timeout, or explicit close), the system SHALL detect the failure and resume sync polling within a bounded time interval.

**Validates: Requirements 2.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `apps/web/app/(customer)/chat/page.tsx`

**Changes**:
1. **Make sync polling the primary data source**: Replace bridge polling with `createSyncClient()` as the primary message source. On mount, call `getHistory()` to load initial messages. Use sync client for continuous polling. Keep bridge as write-through for optimistic UI and fallback.
2. **Add correlation ID for deduplication**: When sending a message, generate a stable `messageId` and pass it to both the bridge and the API. This ensures `deduplicateMessages()` can match them.
3. **Merge strategy**: On initial load, merge bridge messages with API history using content+timestamp based deduplication for legacy messages, and messageId for new messages.

**File**: `apps/web/app/seller/inbox/page.tsx`

**Changes**:
1. **Make API the primary conversation source**: On mount, fetch from `/api/v1/seller/inbox` first. Use seed data only as fallback when API returns empty or fails.
2. **Add sync status indicator**: Show a subtle icon (cloud check / cloud off) next to each conversation indicating whether it's synced with backend or local-only.
3. **Persist read receipts**: When selecting a conversation, call `POST /api/v1/seller/inbox/{userId}/read` to persist the read status.
4. **Poll API for updates**: Replace bridge polling with periodic API polling for new messages in the selected conversation.

**File**: `apps/web/app/seller/page.tsx`

**Changes**:
1. **Add API data fetching**: Add `useEffect` to fetch from `/api/v1/seller/dashboard` (or `/api/v1/seller/analytics`) on mount.
2. **Loading and fallback states**: Show skeleton loading while fetching, display real data on success, fall back to current hardcoded values on API failure.

**File**: `apps/web/app/seller/orders/page.tsx`

**Changes**:
1. **Ensure inline quick actions trigger toasts**: Verify that mobile card quick-action buttons route through the same `handleAction` callback that calls `addToast()`.

**File**: `apps/web/lib/websocket-client.ts`

**Changes**:
1. **Add readyState health check**: In the heartbeat interval, also check `ws.readyState !== WebSocket.OPEN` and trigger reconnection if the socket is in a zombie state.

**File**: `apps/web/hooks/useWebSocket.ts`

**Changes**:
1. **Start polling immediately as default**: Start sync polling on mount regardless of WebSocket state. Stop polling only when WebSocket is confirmed connected and healthy. This ensures messages are always flowing even during WebSocket connection setup.

**File**: `apps/web/lib/chat-bridge.ts`

**Changes**:
1. **No breaking changes**: Keep all existing exports. The bridge remains available for fallback and optimistic UI writes.

**File**: `services/api/src/handlers/seller/seller-inbox-handler.ts` (potential)

**Changes**:
1. **Add read receipt endpoint**: Add a `POST /api/v1/seller/inbox/{userId}/read` handler that updates `deliveryStatus` to `'read'` for all inbound messages in `THREAD#{sellerId}` from that customer.

**File**: `apps/web/lib/api-inbox.ts` (new or extend)

**Changes**:
1. **Add `markConversationRead()` function**: API client function to call the read receipt endpoint.
2. **Add `fetchSellerDashboard()` function**: API client function for dashboard metrics.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate the message flow through bridge vs backend paths and assert that messages appear in the correct UI state. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Bridge-Only Read Test**: Simulate a message stored in DynamoDB `THREAD#{userId}` and verify the chat page displays it (will fail on unfixed code — chat page reads bridge only)
2. **Seller Reply Visibility Test**: Simulate a seller reply stored via `seller-reply-handler.ts` and verify the customer chat page displays it (will fail on unfixed code — customer reads bridge only)
3. **Duplicate Message Test**: Send a message via web chat that creates both a bridge entry (`cust-{ts}`) and a backend entry (`msg-uuid`), then verify only one message appears (will fail on unfixed code — dedup by messageId misses this)
4. **Dashboard API Call Test**: Load the seller dashboard and verify an API call is made to fetch metrics (will fail on unfixed code — no API call exists)
5. **Read Receipt Persistence Test**: Select a conversation in seller inbox, refresh the page, and verify unread count is still 0 (will fail on unfixed code — local state only)

**Expected Counterexamples**:
- Chat page shows 0 backend messages when bridge is empty but DynamoDB has messages
- Duplicate messages appear when both bridge and API return the same logical message with different IDs
- Dashboard always shows "₹45,231" regardless of actual sales data
- Possible causes: bridge-first architecture, missing ID correlation, hardcoded values, local-only state

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedComponent(input)
  ASSERT expectedBehavior(result)
  // For message sync: messages from THREAD#{userId} appear in UI
  // For dashboard: real metrics fetched from API
  // For read receipts: persisted to backend
  // For toasts: visual feedback shown
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalComponent(input) = fixedComponent(input)
  // Bridge fallback works when API unavailable
  // WebSocket suppresses polling when connected
  // Cart operations unchanged
  // Rich message rendering unchanged
  // Seed data appears as fallback
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-bug inputs (bridge fallback, cart operations, rich messages), then write property-based tests capturing that behavior.

**Test Cases**:
1. **Bridge Fallback Preservation**: Simulate API unavailability and verify chat still works via bridge — observe this works on unfixed code, then verify it continues after fix
2. **WebSocket Polling Suppression Preservation**: Verify that when WebSocket is connected, polling is suppressed — observe this works on unfixed code, then verify it continues after fix
3. **Cart Operation Preservation**: Verify add/update/remove/checkout cart operations work — observe this works on unfixed code, then verify it continues after fix
4. **Rich Message Rendering Preservation**: Verify product cards, order status cards, AI suggestions render correctly — observe this works on unfixed code, then verify it continues after fix

### Unit Tests

- Test `deduplicateMessages()` with mixed bridge/backend message IDs and correlation IDs
- Test sync client integration with chat page state management
- Test seller inbox API-first loading with seed data fallback
- Test dashboard metrics fetching with loading/error/success states
- Test read receipt API call on conversation selection
- Test toast feedback on inline order quick actions
- Test WebSocket readyState health check in heartbeat

### Property-Based Tests

- Generate random message sets with mixed bridge/backend IDs and verify deduplication produces no duplicates and no lost messages
- Generate random API availability scenarios and verify bridge fallback activates correctly
- Generate random WebSocket connection states and verify polling resumes on all failure modes
- Generate random dashboard API responses and verify correct rendering with fallback

### Integration Tests

- Test full message flow: WhatsApp inbound → DynamoDB → sync polling → web chat display
- Test full seller reply flow: inbox reply → DynamoDB → customer sync polling → customer chat display
- Test WebSocket → disconnect → polling resume → reconnect → polling suppress cycle
- Test seller dashboard with real API endpoint returning metrics
- Test read receipt persistence across page refreshes
