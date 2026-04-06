# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Bridge-First Architecture Causes Cross-Channel Message Loss and Stale Seller UI
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bridge-first architecture prevents backend messages from appearing in the UI
  - **Scoped PBT Approach**: Scope the property to concrete failing cases:
    - Case A (Chat Page): Simulate a message stored in `THREAD#{userId}` via DynamoDB (e.g., WhatsApp inbound or seller reply). Assert that the chat page's data-fetching logic retrieves it via `/api/v1/chat/sync` rather than only reading from `sessionStorage` bridge. On unfixed code, the chat page reads from `getSessionMessages(DEMO_SESSION_ID)` and polls the bridge every 1.5s — backend-only messages never appear.
    - Case B (Seller Inbox): Simulate conversations in `THREAD#{sellerId}` via the `/api/v1/seller/inbox` endpoint. Assert that the inbox page uses API data as the primary source, not `buildSeedSessions()` from the bridge. On unfixed code, the inbox builds sessions from `getSessionMessages()` and only appends non-overlapping API sessions.
    - Case C (Duplicate Messages): Generate a message with bridge ID `cust-{timestamp}` and backend ID `msg-uuid` for the same logical content. Assert `deduplicateMessages()` produces exactly one entry. On unfixed code, dedup is by `messageId` only — two different IDs for the same message pass through.
    - Case D (Dashboard Hardcoded): Assert that the seller dashboard page (`apps/web/app/seller/page.tsx`) makes an API call to fetch metrics. On unfixed code, the page renders static JSX with hardcoded values (`₹45,231`, `127`, etc.) and zero API calls.
    - Case E (WebSocket Zombie): Simulate a WebSocket where `readyState !== OPEN` but no `close` event fires. Assert that the system detects this and resumes polling. On unfixed code, the heartbeat timer may not fire and `useWebSocket` only starts polling on `connectionState === 'disconnected'`.
  - Test file: `apps/web/lib/__tests__/omnichannel-bug-condition.property.test.ts`
  - Test framework: Jest with `fast-check` for property-based generation
  - Run test on UNFIXED code — expect FAILURE (this confirms the bug exists)
  - Document counterexamples found (e.g., "backend message in THREAD#cust-001 never appears in chat page state", "deduplicateMessages([{messageId:'cust-123'},{messageId:'msg-uuid'}]) returns 2 instead of 1")
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Bridge Fallback, Polling Suppression, Cart Ops, Rich Messages, and Seed Data
  - **IMPORTANT**: Follow observation-first methodology
  - **Observe on UNFIXED code**:
    - Bridge fallback: When API is unavailable, `getSessionMessages(DEMO_SESSION_ID)` returns seed messages and `bridgeToCustomer()` converts them correctly
    - Polling suppression: When `connectionState === 'connected'`, the bridge polling interval is cleared (chat page) and inbox polling returns early
    - Cart operations: `optimisticUpdateItem`, `optimisticRemoveItem` produce correct cart state mutations
    - Rich message rendering: `MessageList` renders `product_card`, `order_status`, `ai_suggestion`, `quick_reply` message types via dedicated components
    - Seed data: `buildSeedSessions()` returns 3 sessions (Demo Customer, Priya Sharma, Rahul Verma) as fallback
    - Demo orders: `getDemoSellerOrders()` returns 5 demo orders with correct statuses as fallback
    - Dual-send: Seller inbox `handleSend` sends via HTTP API (primary) and WebSocket (secondary)
  - Write property-based tests:
    - For all valid `BridgeMessage[]` arrays, `bridgeToCustomer()` preserves message count and flips direction correctly
    - For all `connectionState` values, polling is suppressed if and only if state is `'connected'`
    - For all seed session builds, exactly 3 sessions are returned with expected IDs
    - For all demo order builds, exactly 5 orders are returned with valid statuses
    - For all `deduplicateMessages()` inputs with unique `messageId` values, output length equals input length (no false dedup)
  - Test file: `apps/web/lib/__tests__/omnichannel-preservation.property.test.ts`
  - Test framework: Jest with `fast-check` for property-based generation
  - Verify tests PASS on UNFIXED code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 3. Fix: Switch to API-first architecture with bridge fallback and add missing seller UI feedback

  - [x] 3.1 Customer chat page — switch from bridge-first to API-first with sync polling as primary data source
    - In `apps/web/app/(customer)/chat/page.tsx`:
    - Replace bridge polling (`setInterval` every 1.5s reading `getSessionMessages`) with `createSyncClient()` from `sync-client.ts` as the primary message source
    - On mount, call `getHistory()` to load initial messages from backend; merge with bridge messages using content+timestamp dedup for legacy messages
    - Use sync client `onMessages` callback to update `localMessages` state continuously
    - Keep bridge as write-through for optimistic UI: `appendMessage()` still called on send for instant display
    - Fall back to bridge-only mode when `getHistory()` and sync client both fail (API unavailable)
    - _Bug_Condition: isBugCondition(input) where source='chat_page' AND action='load_messages' AND primaryDataSource='sessionStorage_bridge'_
    - _Expected_Behavior: Messages from THREAD#{userId} appear in web chat via sync polling endpoint_
    - _Preservation: Bridge fallback when API unavailable (Req 3.1), rich message rendering (Req 3.6)_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.6_

  - [x] 3.2 Message deduplication — add correlation ID support for bridge/backend message matching
    - In `apps/web/app/(customer)/chat/page.tsx`:
    - When sending a message, generate a stable `correlationId` (e.g., `crypto.randomUUID()`) and pass it to both the bridge entry and the API `sendMessage()` call
    - In `apps/web/lib/websocket-client.ts`:
    - Enhance `deduplicateMessages()` to also deduplicate by `correlationId` field when present, in addition to `messageId`
    - Add content+timestamp based fallback dedup for legacy messages without correlation IDs
    - _Bug_Condition: message.sourceId != normalizedId(message) AND duplicateDisplayed(message)_
    - _Expected_Behavior: Same logical message with different IDs (bridge `cust-{ts}` vs backend `msg-uuid`) appears exactly once_
    - _Preservation: Existing dedup by messageId still works for non-correlated messages_
    - _Requirements: 2.5_

  - [x] 3.3 Seller inbox — switch to API-first conversation loading with bridge fallback
    - In `apps/web/app/seller/inbox/page.tsx`:
    - On mount, fetch from `/api/v1/seller/inbox` via `listConversations()` from `api-inbox.ts` FIRST
    - Use API conversations as the primary session list; use `buildSeedSessions()` only as fallback when API returns empty or fails
    - Replace bridge polling (`setInterval` every 1.5s reading `getSessionMessages`) with periodic API polling for the selected conversation's messages via `getMessages()` from `api-inbox.ts`
    - Keep bridge write-through for optimistic UI on send
    - _Bug_Condition: isBugCondition(input) where source='seller_inbox' AND action='load_conversations' AND primaryDataSource='sessionStorage_bridge'_
    - _Expected_Behavior: Conversations from THREAD#{sellerId} appear via /api/v1/seller/inbox endpoint_
    - _Preservation: Seed conversations as fallback (Req 3.4), dual-send via HTTP+WS (Req 3.7)_
    - _Requirements: 2.3, 2.7, 3.4, 3.7_

  - [x] 3.4 Seller inbox — add sync status indicators
    - In `apps/web/app/seller/inbox/page.tsx`:
    - Add a `synced: boolean` field to `InboxSession` interface
    - Set `synced: true` for sessions loaded from API, `synced: false` for bridge-only/seed sessions
    - Render a subtle cloud icon (✓ synced / ⚠ local-only) next to each conversation in the session list
    - _Bug_Condition: syncStatusIndicator = 'absent' for seller inbox conversations_
    - _Expected_Behavior: Visual sync status indicator shows whether messages are synced with backend or local-only_
    - _Requirements: 2.7_

  - [x] 3.5 Seller inbox — persist read receipts to backend
    - In `apps/web/lib/api-inbox.ts`:
    - Add `markConversationRead(customerUserId: string): Promise<void>` function that calls `POST /api/v1/seller/inbox/{customerUserId}/read`
    - In `services/api/src/handlers/seller/seller-inbox-handler.ts`:
    - Add a read receipt handler (or extend existing handler) for `POST /api/v1/seller/inbox/{userId}/read` that updates `deliveryStatus` to `'read'` for all inbound messages in `THREAD#{sellerId}` from that customer
    - In `apps/web/app/seller/inbox/page.tsx`:
    - In `handleSelectSession()`, call `markConversationRead(id)` to persist the read status to backend (fire-and-forget, don't block UI)
    - _Bug_Condition: readReceiptPersisted = false when seller marks conversation as read_
    - _Expected_Behavior: Read receipt persists to backend, unread count stays 0 across page refreshes_
    - _Requirements: 2.8_

  - [x] 3.6 Seller dashboard — add API data fetching with loading/fallback states
    - In `apps/web/lib/api-client.ts` (or new `api-dashboard.ts`):
    - Add `fetchSellerDashboard(): Promise<DashboardMetrics>` function that calls `GET /api/v1/seller/dashboard` (or `/api/v1/seller/analytics`)
    - In `apps/web/app/seller/page.tsx`:
    - Add `useEffect` to fetch dashboard metrics on mount
    - Add loading state with skeleton placeholders while fetching
    - Display real data on success; fall back to current hardcoded values on API failure
    - Keep existing MetricCard component and layout unchanged
    - _Bug_Condition: metricsSource(input) = 'hardcoded' for seller dashboard_
    - _Expected_Behavior: Dashboard fetches real metrics from backend API, falls back to demo values on failure_
    - _Preservation: Demo data as fallback (Req 3.5 spirit)_
    - _Requirements: 2.6_

  - [x] 3.7 Seller orders — ensure inline quick actions trigger toast feedback
    - In `apps/web/app/seller/orders/page.tsx`:
    - Verify that mobile card quick-action buttons and desktop table inline action buttons both route through the `handleAction` callback that calls `addToast()`
    - The desktop table inline buttons already call `handleAction` (confirmed in code). For mobile cards, the current code shows "Tap to review" for pending orders — add inline Accept/Reject buttons on mobile cards for pending orders that call `handleAction` directly
    - Ensure all action paths (accept, reject, preparing, shipped, delivered) produce toast feedback
    - _Bug_Condition: toastFeedback = 'absent' for inline quick actions on seller orders_
    - _Expected_Behavior: Toast notification confirms action result for both modal and inline quick-action buttons_
    - _Requirements: 2.9_

  - [x] 3.8 WebSocket — add readyState health check for zombie state detection
    - In `apps/web/lib/websocket-client.ts`:
    - In the heartbeat interval callback (inside `startHeartbeat()`), add a check: if `this.ws?.readyState !== WebSocket.OPEN`, immediately call `this.ws.close()` to trigger the `onclose` handler and start reconnection
    - This catches zombie states where the socket is in CLOSING or CLOSED state but no `close` event fired (browser tab backgrounding, network change)
    - _Bug_Condition: websocket.readyState != OPEN AND pollingState = 'suppressed'_
    - _Expected_Behavior: System detects WebSocket failure and resumes sync polling within bounded interval_
    - _Requirements: 2.4_

  - [x] 3.9 useWebSocket hook — start polling immediately as default, suppress only when WS confirmed healthy
    - In `apps/web/hooks/useWebSocket.ts`:
    - Change `handleStateChange` so that polling starts on mount (regardless of WebSocket state) instead of only when `connectionState === 'disconnected'`
    - Stop polling only when WebSocket transitions to `'connected'` state AND has received at least one heartbeat ack (confirmed healthy)
    - This ensures messages flow via sync polling during WebSocket connection setup, reconnection, and any transient failure states
    - _Bug_Condition: pollingState = 'suppressed' during WebSocket connection setup or silent failure_
    - _Expected_Behavior: Polling runs by default, suppressed only when WS is confirmed connected and healthy_
    - _Preservation: When WS is connected and healthy, polling is suppressed (Req 3.2)_
    - _Requirements: 2.4, 3.2_

  - [x] 3.10 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Backend Messages Appear in Web Chat, Seller Inbox Shows API Conversations, No Duplicates, Dashboard Fetches Real Metrics, WebSocket Failure Resumes Polling
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1: `pnpm --filter @vyapargyan/web test -- --run apps/web/lib/__tests__/omnichannel-bug-condition.property.test.ts`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 3.11 Verify preservation tests still pass
    - **Property 2: Preservation** - Bridge Fallback, Polling Suppression, Cart Ops, Rich Messages, and Seed Data
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2: `pnpm --filter @vyapargyan/web test -- --run apps/web/lib/__tests__/omnichannel-preservation.property.test.ts`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite: `pnpm --filter @vyapargyan/web test -- --run`
  - Run API tests: `pnpm --filter @vyapargyan/api test`
  - Ensure both bug condition and preservation property tests pass
  - Ensure no regressions in existing tests
  - Ask the user if questions arise
