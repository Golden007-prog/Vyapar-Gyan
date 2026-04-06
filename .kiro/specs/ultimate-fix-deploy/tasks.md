# Implementation Plan

- [x] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Omnichannel Message Pipeline Bugs
  - **CRITICAL**: These tests MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior — they will validate the fixes when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate each of the 7 bugs exists
  - **Scoped PBT Approach**: For deterministic bugs, scope properties to concrete failing cases
  - Test file: `services/api/src/__tests__/ultimate-fix-exploration.test.ts`
  - Test command: `pnpm --filter @vyapargyan/api test -- ultimate-fix-exploration`
  - **Test 1.1 — Missing message.created Event**: Mock EventBridge `PutEventsCommand` in `chat-send-handler.ts`, call handler with valid message payload, assert that `PutEventsCommand` is called with Entries array containing BOTH `{Source: 'vyapargyan.chat', DetailType: 'CustomerMessageSent'}` AND `{Source: 'vyapargyan.messaging', DetailType: 'message.created'}`. On unfixed code, only 1 entry is published — test FAILS.
  - **Test 1.2 — Greeting Misrouted to Store Search**: Import `handleCustomerDiscovery` from `customer-discovery.ts`, mock `whatsappSender.sendMessage`, call with text "Hello" on a new session. Assert that `sendMessage` is called with the Store Discovery menu text (contains "My favorite stores"). On unfixed code, "Hello" falls through to city search → test FAILS.
  - **Test 1.3 — Property-based greeting detection**: Generate random greetings from set ["hello", "hi", "hey", "namaste", "Hello", "HI", "Hey", "NAMASTE", "Namaste"]. For each, call `handleCustomerDiscovery` and assert Store Discovery menu is shown. On unfixed code, all greetings fall through → test FAILS.
  - **Test 1.4 — getUserByPhone returns USER PROFILE only**: Mock DynamoDB `QueryCommand` to return both `{PK: 'SESSION#user-1', SK: 'ACTIVE', GSI1SK: 'SESSION#user-1', role: 'seller'}` and `{PK: 'USER#user-1', SK: 'PROFILE', GSI1SK: 'USER#user-1', role: 'seller', sellerStatus: 'approved'}`. Call `getUserByPhone('+917001124396')`. Assert result has `PK` starting with `USER#` and `SK === 'PROFILE'`. On unfixed code, the query has no `begins_with(GSI1SK, 'USER#')` filter so SESSION records may be returned — test may FAIL depending on item order.
  - **Test 1.5 — EventBridge validates non-empty EVENT_BUS_NAME**: Set `process.env.EVENT_BUS_NAME = ''`, mock logger.error, simulate the EventBridge publish path in WhatsApp worker. Assert that a structured error is logged containing 'EVENT_BUS_NAME'. On unfixed code, empty string is used silently without validation → test FAILS.
  - **Test 1.6 — Store name DynamoDB scan fallback**: Mock `searchByCity` and `searchGlobal` to return empty arrays. Call `handleCustomerDiscovery` with text "Dragon Store". Assert that a DynamoDB `ScanCommand` is attempted as fallback. On unfixed code, no scan fallback exists → test FAILS with "No stores found".
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bugs exist)
  - Document counterexamples found to understand root causes
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Routing and Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Test file: `services/api/src/__tests__/ultimate-fix-preservation.test.ts`
  - Test command: `pnpm --filter @vyapargyan/api test -- ultimate-fix-preservation`
  - **Observe on UNFIXED code first, then write property-based tests:**
  - **Test 2.1 — Direct intent bypasses greeting**: Observe that `routeMessage` with text "check stock of Amul Butter" in greeting state routes to `browsingHandler` (not `greetingHandler`). Write property: for all direct-intent strings matching stock/price/search patterns, routing in greeting state always goes to browsing handler.
  - **Test 2.2 — Numeric replies route correctly**: Observe that `routeMessage` with text "1", "2", "3" routes to `browsingHandler` for menu resolution. Write property: for all single/double digit numeric strings, routing always goes to browsing handler regardless of session state.
  - **Test 2.3 — Pincode search uses GSI2**: Observe that `classifyLocationInput("400001")` returns `{type: 'pincode', value: '400001'}`. Write property: for all 6-digit strings, `classifyLocationInput` returns type 'pincode'. For all non-6-digit strings, returns type 'city'.
  - **Test 2.4 — Non-greeting messages in browsing/ordering state**: Observe that messages in `browsing` state route to `browsingHandler`, messages in `ordering` state route to `checkoutHandler`. Write property: for all non-greeting text messages, session state determines handler routing — browsing→browsingHandler, ordering/checkout/payment→checkoutHandler.
  - **Test 2.5 — Message storage independent of EventBridge**: Observe that `putMessage()` is called before EventBridge publish in `handleCustomerMessage`. Write test: verify `putMessage` is called regardless of EventBridge publish success or failure.
  - **Test 2.6 — Seller routing preserved**: Observe that when `getUserByPhone` returns a user with `role: 'seller'` and `sellerStatus: 'approved'`, the message routes to `handleSellerMessage`. Write property: for all phone numbers resolving to approved sellers, routing always goes to seller copilot handler.
  - Verify all tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 3. Fix for omnichannel message pipeline bugs (7 interconnected fixes)

  - [x] 3.1 Bug 1.1 — Set NEXT_PUBLIC_DEMO_MODE=false in .env.production
    - In `apps/web/.env.production`, change `NEXT_PUBLIC_DEMO_MODE=true` to `NEXT_PUBLIC_DEMO_MODE=false`
    - Verify `ChatComposer.tsx` always uses `api-chat.sendMessage()` for the primary send path and does not short-circuit to `chat-bridge.appendMessage()` when demo mode is enabled
    - _Bug_Condition: input.channel == 'web' AND NEXT_PUBLIC_DEMO_MODE == 'true' AND frontendUsesLocalStoragePath(input)_
    - _Expected_Behavior: Frontend always POSTs to /api/v1/chat/messages via authenticated HTTP_
    - _Preservation: Web chat polling sync client continues to deduplicate by messageId_
    - _Requirements: 2.1_

  - [x] 3.2 Bug 1.2 — Add message.created EventBridge event to chat-send-handler
    - In `services/api/src/handlers/chat/chat-send-handler.ts`, add a second entry to the `PutEventsCommand` Entries array
    - New entry: `{Source: 'vyapargyan.messaging', DetailType: 'message.created', EventBusName: EVENT_BUS_NAME, Detail: JSON.stringify({messageId, threadId: 'THREAD#'+userId, senderUserId: userId, senderType: 'customer', recipientUserId: sellerId ?? 'seller-123', channel: 'web', content})}`
    - Also add EVENT_BUS_NAME validation (non-empty check) before the PutEventsCommand call, consistent with Bug 1.5 fix
    - _Bug_Condition: input.channel == 'web' AND handler == 'chat-send-handler' AND NOT publishesMessageCreatedEvent_
    - _Expected_Behavior: PutEventsCommand publishes both CustomerMessageSent and message.created events_
    - _Preservation: Existing CustomerMessageSent event format and payload unchanged_
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 3.3 Bug 1.3 — Add greeting detection to handleCustomerDiscovery
    - In `services/api/src/handlers/whatsapp/customer-discovery.ts`, add a greeting regex pattern: `/^(hi|hello|hey|namaste|namaskar|hola|good\s*(morning|afternoon|evening)|howdy|sup|yo)$/i`
    - Add greeting check AFTER the existing menu/home/discover/stores check and BEFORE numeric selections
    - When greeting detected, call `sendHomeMenu(phoneNumber, sessionId)` and return
    - Export `sendHomeMenu` as a named export (or make the greeting pattern testable) for test verification
    - _Bug_Condition: isGreeting(input.text) AND (session.isNew OR session.state == 'greeting') AND customerDiscoveryTreatsAsSearch_
    - _Expected_Behavior: Greeting triggers sendHomeMenu() showing Store Discovery menu with 4 options_
    - _Preservation: Non-greeting text still routes to city search, pincode search, or global search_
    - _Requirements: 2.3_

  - [x] 3.4 Bug 1.4 — Add DynamoDB scan fallback for store name search
    - In `services/api/src/handlers/whatsapp/customer-discovery.ts`, add `ScanCommand` to the imports from `@aws-sdk/lib-dynamodb`
    - Add new `searchByStoreName(query: string)` function that performs a DynamoDB Scan with FilterExpression: `begins_with(PK, 'USER#') AND SK = 'PROFILE' AND (contains(storeName, query) OR contains(businessName, query))`
    - In `handleCustomerDiscovery`, after `searchGlobal()` returns empty and before the "No stores found" message, call `searchByStoreName(text)` and display results if found
    - Limit scan to 20 results
    - _Bug_Condition: isStoreNameQuery(input.text) AND searchByCity returns empty AND searchGlobal returns empty AND NOT hasDynamoDBScanFallback_
    - _Expected_Behavior: DynamoDB scan finds stores matching storeName/businessName fields_
    - _Preservation: Existing searchByCity (GSI3) and searchByPincode (GSI2) queries unchanged_
    - _Requirements: 2.4_

  - [x] 3.5 Bug 1.5 — Validate EVENT_BUS_NAME before EventBridge publish in worker.ts
    - In `services/api/src/handlers/whatsapp/worker.ts`, in `handleCustomerMessage()`, add validation before the `PutEventsCommand` call
    - Check `if (!eventBusName)` and log structured error: `logger.error('EVENT_BUS_NAME is empty — skipping EventBridge publish', { messageId, userId, recipientSellerId })`
    - Wrap the existing `PutEventsCommand` in the else branch so it only executes when bus name is valid
    - Message processing (putMessage, session resolution, routing) must continue regardless
    - _Bug_Condition: process.env.EVENT_BUS_NAME is empty AND eventBridgePutEvents is called_
    - _Expected_Behavior: Structured error logged, publish skipped, message processing continues_
    - _Preservation: Messages stored in THREAD#{userId} regardless of EventBridge success/failure_
    - _Requirements: 2.5, 3.5_

  - [x] 3.6 Bug 1.6 — Fix getUserByPhone to filter USER# records only
    - In `services/api/src/adapters/dynamodb-adapter.ts`, update `getUserByPhone()` function
    - Change `KeyConditionExpression` from `'GSI1PK = :pk'` to `'GSI1PK = :pk AND begins_with(GSI1SK, :userPrefix)'`
    - Add `':userPrefix': 'USER#'` to `ExpressionAttributeValues`
    - Reduce `Limit` from `10` to `1` (only one USER PROFILE per phone number)
    - Remove the in-memory fallback `items.find(item => item.role)` since the query now guarantees only USER records
    - Keep the `profileItem` check as a safety net
    - _Bug_Condition: getUserByPhone returns SESSION record instead of USER PROFILE_
    - _Expected_Behavior: Query-level filter ensures only USER# records returned, Limit: 1_
    - _Preservation: Seller routing based on role/sellerStatus fields unchanged_
    - _Requirements: 2.6_

  - [x] 3.7 Bug 1.7 — Fix empty WEBSOCKET_API_ENDPOINT in events-stack and fanout
    - In `infra/cdk/lib/stacks/events-stack.ts`, remove the empty default: change `WEBSOCKET_API_ENDPOINT: props.webSocketEndpoint || ''` to `WEBSOCKET_API_ENDPOINT: props.webSocketEndpoint || 'PENDING_WEBSOCKET_STACK'`
    - In `services/api/src/handlers/messaging/fanout.ts`, improve the endpoint validation to reject empty strings and sentinel values, and log at `error` level instead of `warn`
    - _Bug_Condition: handler == 'fanout' AND WEBSOCKET_API_ENDPOINT is empty AND targetChannel includes 'web'_
    - _Expected_Behavior: Sentinel value detected, error-level log emitted, graceful degradation_
    - _Preservation: Fan-out Lambda behavior unchanged when WEBSOCKET_API_ENDPOINT is correctly set_
    - _Requirements: 2.7_

  - [x] 3.8 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Omnichannel Message Pipeline Fixed
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - When these tests pass, it confirms the expected behavior is satisfied for all 7 bugs
    - Run: `pnpm --filter @vyapargyan/api test -- ultimate-fix-exploration`
    - **EXPECTED OUTCOME**: Tests PASS (confirms all 7 bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.9 Verify preservation tests still pass
    - **Property 2: Preservation** - Existing Routing and Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run: `pnpm --filter @vyapargyan/api test -- ultimate-fix-preservation`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all preservation tests still pass after all 7 fixes (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite: `pnpm --filter @vyapargyan/api test`
  - Verify exploration tests pass (bug conditions resolved)
  - Verify preservation tests pass (no regressions)
  - Verify existing test suites still pass
  - Ensure all tests pass, ask the user if questions arise.
  - Update overview.md and README.md
  - Upadated files, deploy, push {github}, check (https://golden007-prog.github.io/Vyapar-Gyan)
  - wait 8 min , test chat, and other functions via https://golden007-prog.github.io/Vyapar-Gyan 
