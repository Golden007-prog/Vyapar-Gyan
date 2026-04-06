# Ultimate Fix Deploy — Bugfix Design

## Overview

Seven interconnected bugs break the end-to-end omnichannel message flow in VyaparGyan. Messages sent from web chat never reach the seller's Inbox because: (1) the frontend may use demo/localStorage paths, (2) `chat-send-handler.ts` only publishes `CustomerMessageSent` but not `message.created` for the fan-out Lambda, and (7) the fan-out Lambda's `WEBSOCKET_API_ENDPOINT` may be empty at deploy time. On the WhatsApp side: (3) greetings like "Hello" fall through to store search instead of showing the discovery menu, (4) store name searches have no DynamoDB scan fallback, (5) EventBridge publishing silently fails when `EVENT_BUS_NAME` is empty, and (6) `getUserByPhone()` can return SESSION records instead of USER PROFILE records. The fix targets each root cause with minimal, surgical changes.

## Glossary

- **Bug_Condition (C)**: The set of conditions across 7 bugs that cause messages to be lost, misrouted, or silently dropped in the omnichannel pipeline
- **Property (P)**: The desired behavior — messages flow end-to-end from customer (web or WhatsApp) to seller Inbox in real-time
- **Preservation**: Existing behaviors that must remain unchanged — WhatsApp browsing/ordering flows, direct intent routing, pincode search, polling sync, human handoff
- **chat-send-handler.ts**: Lambda handler at `services/api/src/handlers/chat/chat-send-handler.ts` that stores web chat messages and publishes EventBridge events
- **worker.ts**: WhatsApp worker Lambda at `services/api/src/handlers/whatsapp/worker.ts` that processes inbound WhatsApp messages from SQS
- **customer-discovery.ts**: Handler at `services/api/src/handlers/whatsapp/customer-discovery.ts` that manages store discovery flow for WhatsApp customers
- **fanout.ts**: Fan-out Lambda at `services/api/src/handlers/messaging/fanout.ts` that pushes messages to recipient channels via WebSocket and WhatsApp
- **dynamodb-adapter.ts**: Data access layer at `services/api/src/adapters/dynamodb-adapter.ts` with `getUserByPhone()` function
- **events-stack.ts**: CDK stack at `infra/cdk/lib/stacks/events-stack.ts` that configures EventBridge, SQS, and Lambda workers
- **api-chat.ts**: Frontend chat API client at `apps/web/lib/api-chat.ts`

## Bug Details

### Bug Condition

The bugs manifest across the omnichannel message pipeline when: (1) the frontend is in demo mode and intercepts messages locally, (2) web chat messages are stored but not fan-out published, (3) WhatsApp greetings are misrouted to store search, (4) store name searches fail without fallback, (5) EventBridge publishing silently fails, (6) phone lookups return wrong record types, or (7) the fan-out Lambda cannot reach the WebSocket API.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type OmnichannelMessage
  OUTPUT: boolean

  // Bug 1.1: Frontend demo mode intercepts messages
  LET demoIntercept = input.channel == 'web'
    AND process.env.NEXT_PUBLIC_DEMO_MODE == 'true'
    AND frontendUsesLocalStoragePath(input)

  // Bug 1.2: chat-send-handler missing message.created event
  LET missingFanoutEvent = input.channel == 'web'
    AND input.handler == 'chat-send-handler'
    AND NOT publishesMessageCreatedEvent(input)

  // Bug 1.3: WhatsApp greeting misrouted to store search
  LET greetingMisrouted = input.channel == 'whatsapp'
    AND isGreeting(input.text)  // "Hello", "Hi", "Hey", "Namaste", etc.
    AND (session.isNew OR session.state == 'greeting')
    AND isDiscoveryTrigger(input)  // true because session is new/greeting
    AND customerDiscoveryTreatsAsSearch(input.text)

  // Bug 1.4: Store name search has no DynamoDB fallback
  LET storeSearchFails = input.channel == 'whatsapp'
    AND isStoreNameQuery(input.text)
    AND searchByCity(input.text) returns empty
    AND searchGlobal(input.text) returns empty
    AND NOT hasDynamoDBScanFallback()

  // Bug 1.5: EventBridge publish silently fails
  LET ebPublishFails = process.env.EVENT_BUS_NAME is empty or undefined
    AND eventBridgePutEvents is called

  // Bug 1.6: getUserByPhone returns SESSION instead of USER PROFILE
  LET wrongRecordReturned = getUserByPhone(phone) is called
    AND GSI1 returns both USER# and SESSION# records
    AND profilePriorityFilter fails to match
    AND fallback returns session record without proper role fields

  // Bug 1.7: Fan-out Lambda WEBSOCKET_API_ENDPOINT is empty
  LET wsEndpointEmpty = handler == 'fanout'
    AND process.env.WEBSOCKET_API_ENDPOINT is empty
    AND targetChannel includes 'web'

  RETURN demoIntercept OR missingFanoutEvent OR greetingMisrouted
    OR storeSearchFails OR ebPublishFails OR wrongRecordReturned
    OR wsEndpointEmpty
END FUNCTION
```

### Examples

- **Bug 1.1**: Customer types "Hello, I need Amul Butter" in web chat → message is stored in sessionStorage via `chat-bridge.ts` demo path instead of POSTing to `/api/v1/chat/messages` → seller never sees it
- **Bug 1.2**: Customer sends "Check price of Tata Salt" via web chat → `chat-send-handler.ts` stores in DynamoDB and publishes `CustomerMessageSent` → but no `message.created` event → fan-out Lambda never triggers → seller's WebSocket Inbox stays empty
- **Bug 1.3**: Customer sends "Hello" via WhatsApp on a new session → `isDiscoveryTrigger` is true (new session) → `handleCustomerDiscovery` receives "Hello" → not a menu command, not numeric, not a pincode → `classifyLocationInput("Hello")` returns `{type: 'city', value: 'hello'}` → `searchByCity("hello")` returns empty → `searchGlobal("Hello")` returns empty → customer sees "No stores found for Hello"
- **Bug 1.4**: Customer types "Dragon Store" via WhatsApp → `classifyLocationInput("Dragon Store")` returns `{type: 'city', value: 'dragon store'}` → `searchByCity("dragon store")` queries `GSI3PK = CITY#dragon store` → no match → `searchGlobal("Dragon Store")` fails (no OpenSearch) → "No stores found" — even though a seller named "Dragon Store" exists in DynamoDB
- **Bug 1.5**: WhatsApp worker publishes to EventBridge with `EVENT_BUS_NAME = ''` → `PutEventsCommand` fails → error is caught and logged → message processing continues but fan-out never happens
- **Bug 1.6**: `getUserByPhone("+917001124396")` queries GSI1 → returns `[{PK: "SESSION#user-1", SK: "ACTIVE", ...}, {PK: "USER#user-1", SK: "PROFILE", role: "seller", ...}]` → if SESSION record is first and has a `role` field from session state, the fallback `items.find(item => item.role)` returns the session record → seller is misidentified
- **Bug 1.7**: Fan-out Lambda receives `message.created` event → `pushToWebSocket()` checks `process.env.WEBSOCKET_API_ENDPOINT` → empty string → logs warning and returns → seller's WebSocket connection never receives the message

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- WhatsApp messages in `browsing`, `ordering`, or `payment` state must continue to route to their respective handlers without re-showing the discovery menu
- Direct intent messages ("check stock of Amul Butter", "price of Tata Salt") in greeting state must continue to bypass greeting and route to browsing handler
- Seller WhatsApp messages must continue to route to seller copilot with correct user profile
- Numeric replies ("1", "2", etc.) must continue to resolve against stored menu context
- Messages must continue to be stored in `THREAD#{userId}` via `putMessage()` regardless of EventBridge success/failure
- Pincode search (6-digit) must continue to query GSI2 (`LOCATION#{pincode}`)
- Web chat polling sync client must continue to deduplicate by messageId with exponential backoff
- Human handoff sessions must continue to bypass AI routing and pipe to seller Inbox

**Scope:**
All inputs that do NOT trigger any of the 7 bug conditions should be completely unaffected. This includes:
- WhatsApp messages in non-greeting states (browsing, checkout, tracking)
- Web chat messages when demo mode is disabled
- Phone lookups that return only USER PROFILE records
- EventBridge publishing when `EVENT_BUS_NAME` is correctly set
- Fan-out Lambda when `WEBSOCKET_API_ENDPOINT` is correctly set

## Hypothesized Root Cause

Based on code analysis, the confirmed root causes are:

1. **Bug 1.1 — Frontend Demo Mode**: `.env.production` has `NEXT_PUBLIC_DEMO_MODE=true`. The `api-chat.ts` `sendMessage()` function always calls the real API, but other frontend code paths (e.g., `ChatComposer`, `WebChat`) may check this flag and use `chat-bridge.ts` sessionStorage instead of the API. The fix is to either remove the demo flag or ensure the chat page always uses the real API path.

2. **Bug 1.2 — Missing `message.created` Event**: `chat-send-handler.ts` only publishes one EventBridge entry with `Source: 'vyapargyan.chat'` and `DetailType: 'CustomerMessageSent'`. The fan-out Lambda listens for `Source: 'vyapargyan.messaging'` and `DetailType: 'message.created'`. No such event is published by the web chat handler, so fan-out never triggers for web-originated messages.

3. **Bug 1.3 — Greeting Misrouted to Store Search**: In `worker.ts`, `isDiscoveryTrigger` is `true` for new sessions or greeting state. `handleCustomerDiscovery` in `customer-discovery.ts` has no greeting detection — it checks for menu commands, numeric selections, pincode, city, and global search, but "Hello" matches none of these. It falls through to `classifyLocationInput("Hello")` → city search → global search → "No stores found".

4. **Bug 1.4 — No DynamoDB Scan Fallback for Store Name**: `customer-discovery.ts` only has `searchByCity()` (GSI3) and `searchGlobal()` (OpenSearch). When both return empty and the input is not a pincode, there's no fallback to scan DynamoDB seller records by `storeName`/`businessName`. OpenSearch may not be configured (`OPENSEARCH_ENDPOINT` not set).

5. **Bug 1.5 — Silent EventBridge Failure**: In `worker.ts` `handleCustomerMessage()`, the EventBridge publish uses `process.env.EVENT_BUS_NAME ?? ''` — if the env var is unset, it defaults to empty string. The `PutEventsCommand` with an empty `EventBusName` fails, but the error is caught and logged without re-throwing, so message processing continues silently without fan-out.

6. **Bug 1.6 — getUserByPhone Returns SESSION Records**: The `getUserByPhone()` function queries GSI1 with `PHONE#{phoneNumber}`. Both USER PROFILE records (`GSI1SK: USER#userId`) and SESSION records (`GSI1SK: SESSION#userId`) share the same `GSI1PK`. The current code has a profile-priority filter that checks `item.PK.startsWith('USER#') && item.SK === 'PROFILE'`, which should work. However, the `Limit: 10` may not return the profile record if many session records exist, and the fallback `items.find(item => item.role)` could match a session record that has inherited role-like fields.

7. **Bug 1.7 — Empty WEBSOCKET_API_ENDPOINT**: In `events-stack.ts`, the fan-out Lambda is created with `WEBSOCKET_API_ENDPOINT: props.webSocketEndpoint || ''`. The `EventsStack` is instantiated in `app.ts` WITHOUT passing `webSocketEndpoint` (because `WebSocketStack` is created after `EventsStack`). A post-hoc `addEnvironment` call in `app.ts` overrides this with `webSocketStack.webSocketCallbackUrl`, but this creates a fragile dependency on deployment ordering. The initial empty string in the CDK construct is the root issue.

## Correctness Properties

Property 1: Bug Condition — Web Chat Messages Reach Backend API

_For any_ web chat message sent by a customer, the frontend SHALL POST the message to the backend API Gateway endpoint `/api/v1/chat/messages` using authenticated HTTP, regardless of the `NEXT_PUBLIC_DEMO_MODE` flag, and the backend SHALL publish both `CustomerMessageSent` and `message.created` EventBridge events.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition — WhatsApp Greetings Show Discovery Menu

_For any_ WhatsApp message that is a common greeting ("Hello", "Hi", "Hey", "Namaste", etc.) received on a new session or in greeting state, the system SHALL display the Store Discovery home menu with 4 options instead of treating the greeting as a store search query.

**Validates: Requirements 2.3**

Property 3: Bug Condition — Store Name Search Has DynamoDB Fallback

_For any_ WhatsApp store name query where GSI city search and OpenSearch both return empty results, the system SHALL perform a DynamoDB scan of seller records matching `storeName` or `businessName` fields (case-insensitive) and return matching stores.

**Validates: Requirements 2.4**

Property 4: Bug Condition — EventBridge Publishing Validates Bus Name

_For any_ EventBridge publish operation, the system SHALL validate that `EVENT_BUS_NAME` is set and non-empty before calling `PutEventsCommand`, and SHALL log a structured error if validation fails.

**Validates: Requirements 2.5**

Property 5: Bug Condition — getUserByPhone Returns USER PROFILE

_For any_ call to `getUserByPhone(phoneNumber)`, the function SHALL return the USER PROFILE record (PK starting with `USER#`, SK = `PROFILE`) by adding a `begins_with(GSI1SK, 'USER#')` filter to the GSI1 query, ensuring SESSION records are never returned.

**Validates: Requirements 2.6**

Property 6: Bug Condition — Fan-out Lambda Has Valid WebSocket Endpoint

_For any_ `message.created` event processed by the fan-out Lambda where the target channel is `web`, the Lambda SHALL have a valid non-empty `WEBSOCKET_API_ENDPOINT` environment variable and SHALL successfully push the message to connected WebSocket clients.

**Validates: Requirements 2.7**

Property 7: Preservation — Existing Routing and Behavior Unchanged

_For any_ input where none of the 7 bug conditions hold (non-greeting WhatsApp messages in browsing/ordering state, direct intent messages, pincode searches, polling sync, human handoff), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing routing, state transitions, and message delivery.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:


**Bug 1.1 — Frontend Demo Mode**

**File**: `apps/web/.env.production`

**Change**: Set `NEXT_PUBLIC_DEMO_MODE=false` (or remove the line entirely) so the frontend always uses the real API backend in production builds.

**File**: `apps/web/lib/api-chat.ts`

**Change**: No changes needed — `sendMessage()` already calls the real API. Verify that `ChatComposer` and `WebChat` components do not short-circuit to `chat-bridge.ts` when demo mode is enabled.

**File**: `apps/web/components/Chat/ChatComposer.tsx` (if needed)

**Change**: Ensure the `sendMessage` path always calls `api-chat.sendMessage()` and never falls back to `chat-bridge.appendMessage()` for the primary send flow.

---

**Bug 1.2 — Missing `message.created` Event in chat-send-handler**

**File**: `services/api/src/handlers/chat/chat-send-handler.ts`

**Specific Changes**:
1. Add a second EventBridge entry to the existing `PutEventsCommand` call with `Source: 'vyapargyan.messaging'` and `DetailType: 'message.created'`
2. The detail payload should include: `messageId`, `threadId` (`THREAD#${userId}`), `senderUserId` (userId), `senderType` ('customer'), `recipientUserId` (sellerId), `channel` ('web'), `content`
3. This mirrors the pattern already used in `worker.ts` `handleCustomerMessage()` which publishes both events

```typescript
// Add to the existing PutEventsCommand Entries array:
{
  Source: 'vyapargyan.messaging',
  DetailType: 'message.created',
  EventBusName: EVENT_BUS_NAME,
  Detail: JSON.stringify({
    messageId,
    threadId: `THREAD#${userId}`,
    senderUserId: userId,
    senderType: 'customer',
    recipientUserId: sellerId ?? 'seller-123',
    channel: 'web',
    content,
  }),
},
```

---

**Bug 1.3 — WhatsApp Greeting Misrouted to Store Search**

**File**: `services/api/src/handlers/whatsapp/customer-discovery.ts`

**Function**: `handleCustomerDiscovery`

**Specific Changes**:
1. Add greeting detection at the top of the function, BEFORE the menu/numeric/location checks
2. Define a greeting pattern: `/^(hi|hello|hey|namaste|namaskar|hola|good\s*(morning|afternoon|evening)|howdy|sup|yo)$/i`
3. When a greeting is detected, call `sendHomeMenu(phoneNumber, sessionId)` and return — this shows the Store Discovery menu instead of treating the greeting as a search query

```typescript
// Add after the existing menu/home check and before numeric selections:
const GREETING_PATTERN = /^(hi|hello|hey|namaste|namaskar|hola|good\s*(morning|afternoon|evening)|howdy|sup|yo)$/i;
if (GREETING_PATTERN.test(lower)) {
  await sendHomeMenu(phoneNumber, sessionId);
  return;
}
```

---

**Bug 1.4 — No DynamoDB Scan Fallback for Store Name Search**

**File**: `services/api/src/handlers/whatsapp/customer-discovery.ts`

**Specific Changes**:
1. Add a new `searchByStoreName()` function that performs a DynamoDB Scan with a FilterExpression matching `storeName` or `businessName` (case-insensitive via `contains` or lowercased comparison)
2. In `handleCustomerDiscovery`, after `searchGlobal()` returns empty and before the "No stores found" message, call `searchByStoreName(text)` as a last-resort fallback
3. Limit the scan to 20 results to prevent runaway reads

```typescript
async function searchByStoreName(query: string): Promise<StoreResult[]> {
  try {
    const table = await tableName();
    const lowerQuery = query.toLowerCase();
    const res = await docClient.send(
      new ScanCommand({
        TableName: table,
        FilterExpression:
          '(begins_with(PK, :sellerPrefix) AND SK = :profile) AND ' +
          '(contains(#sn, :q) OR contains(#bn, :q))',
        ExpressionAttributeNames: { '#sn': 'storeName', '#bn': 'businessName' },
        ExpressionAttributeValues: {
          ':sellerPrefix': 'USER#',
          ':profile': 'PROFILE',
          ':q': lowerQuery,
        },
        Limit: 20,
      }),
    );
    return (res.Items ?? []).map(item => ({
      sellerId: item.userId as string,
      storeName: (item.storeName || item.businessName || 'Unknown Store') as string,
      city: item.city as string | undefined,
      pincode: item.pincode as string | undefined,
    }));
  } catch (err) {
    logger.error('Store name search failed', { query, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}
```

Note: The `contains` filter on lowercased query handles case-insensitive matching for store names stored in mixed case. A `ScanCommand` import is already available in the adapter but needs to be imported in `customer-discovery.ts`.

---

**Bug 1.5 — Silent EventBridge Failure When EVENT_BUS_NAME Is Empty**

**File**: `services/api/src/handlers/whatsapp/worker.ts`

**Function**: `handleCustomerMessage` (EventBridge publish block)

**Specific Changes**:
1. Before the `PutEventsCommand`, validate that `eventBusName` is non-empty
2. If empty, log a structured error with `EVENT_BUS_NAME` context and skip the publish (don't attempt a call that will fail)
3. Also apply the same validation in `chat-send-handler.ts`

```typescript
const eventBusName = process.env.EVENT_BUS_NAME ?? '';
if (!eventBusName) {
  logger.error('EVENT_BUS_NAME is empty — skipping EventBridge publish', {
    messageId: message.id,
    userId,
    recipientSellerId,
  });
} else {
  // existing PutEventsCommand call with eventBusName
}
```

---

**Bug 1.6 — getUserByPhone Returns SESSION Records**

**File**: `services/api/src/adapters/dynamodb-adapter.ts`

**Function**: `getUserByPhone`

**Specific Changes**:
1. Add `begins_with(GSI1SK, :userPrefix)` to the KeyConditionExpression to filter out SESSION records at the DynamoDB query level
2. This ensures only USER PROFILE records (GSI1SK starting with `USER#`) are returned, never SESSION records (GSI1SK starting with `SESSION#`)
3. Keep the existing in-memory profile-priority filter as a safety net

```typescript
export async function getUserByPhone(phoneNumber: string): Promise<UserProfile | null> {
  const table = await tableName();
  const res = await docClient.send(
    new QueryCommand({
      TableName: table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :userPrefix)',
      ExpressionAttributeValues: {
        ':pk': `PHONE#${phoneNumber}`,
        ':userPrefix': 'USER#',
      },
      Limit: 1,
    }),
  );
  return (res.Items?.[0] as UserProfile) ?? null;
}
```

---

**Bug 1.7 — Fan-out Lambda WEBSOCKET_API_ENDPOINT Is Empty**

**File**: `infra/cdk/lib/stacks/events-stack.ts`

**Specific Changes**:
1. Remove the `WEBSOCKET_API_ENDPOINT: props.webSocketEndpoint || ''` line from the fan-out Lambda's initial environment block — this avoids setting an empty string that may not be overridden
2. The actual value is already set post-hoc in `app.ts` via `eventsStack.messageFanoutFunction.addEnvironment('WEBSOCKET_API_ENDPOINT', webSocketStack.webSocketCallbackUrl)` — this is the correct pattern since WebSocketStack is created after EventsStack

Alternatively, keep the initial env var but change the default to a sentinel value that the fan-out Lambda can detect:

```typescript
// In events-stack.ts constructor:
WEBSOCKET_API_ENDPOINT: props.webSocketEndpoint || 'PENDING_WEBSOCKET_STACK',
```

**File**: `services/api/src/handlers/messaging/fanout.ts`

**Function**: `pushToWebSocket`

**Specific Changes**:
1. Improve the empty-endpoint check to also reject sentinel/placeholder values
2. Log at `error` level instead of `warn` when the endpoint is missing, since this is a deployment configuration issue

```typescript
if (!wsEndpoint || wsEndpoint === 'PENDING_WEBSOCKET_STACK') {
  logger.error('WEBSOCKET_API_ENDPOINT not configured — cannot push to WebSocket', {
    recipientUserId,
    wsEndpoint,
  });
  return;
}
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each of the 7 bugs BEFORE implementing fixes. Confirm or refute the root cause analysis.

**Test Plan**: Write unit tests that simulate each bug condition and assert the expected (correct) behavior. Run on UNFIXED code to observe failures.

**Test Cases**:
1. **Web Chat Demo Mode Test**: Mock `NEXT_PUBLIC_DEMO_MODE=true` and verify `sendMessage()` calls the real API endpoint (will fail if demo path intercepts)
2. **Missing message.created Event Test**: Call `chat-send-handler.handler()` with a valid message and assert that `PutEventsCommand` includes an entry with `Source: 'vyapargyan.messaging'` and `DetailType: 'message.created'` (will fail on unfixed code — only `CustomerMessageSent` is published)
3. **Greeting Misroute Test**: Call `handleCustomerDiscovery()` with text "Hello" and assert that `sendHomeMenu` is called instead of `searchByCity` (will fail on unfixed code — "Hello" falls through to city search)
4. **Store Name Search Fallback Test**: Call `handleCustomerDiscovery()` with text "Dragon Store" where city search and OpenSearch return empty, and assert a DynamoDB scan fallback is attempted (will fail on unfixed code — no scan fallback exists)
5. **Empty EVENT_BUS_NAME Test**: Set `EVENT_BUS_NAME=''` and call the WhatsApp worker's EventBridge publish block, assert that a structured error is logged (will fail on unfixed code — empty string is used silently)
6. **getUserByPhone SESSION Record Test**: Seed GSI1 with both USER PROFILE and SESSION records for the same phone, assert that `getUserByPhone()` returns the USER PROFILE record (may pass on unfixed code if profile happens to be first, but the query-level fix makes it deterministic)
7. **Empty WEBSOCKET_API_ENDPOINT Test**: Set `WEBSOCKET_API_ENDPOINT=''` and call `pushToWebSocket()`, assert that an error-level log is emitted (will fail on unfixed code — only warns)

**Expected Counterexamples**:
- `chat-send-handler` publishes only 1 EventBridge entry instead of 2
- `handleCustomerDiscovery("Hello")` calls `searchByCity("hello")` instead of `sendHomeMenu()`
- `getUserByPhone()` query returns SESSION records mixed with USER records

### Fix Checking

**Goal**: Verify that for all inputs where any bug condition holds, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedFunction(input)
  ASSERT expectedBehavior(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where none of the 7 bug conditions hold, the fixed functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalFunction(input) = fixedFunction(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-bug inputs (browsing state messages, direct intents, pincode searches), then write property-based tests capturing that behavior.

**Test Cases**:
1. **WhatsApp Routing Preservation**: Verify that messages in browsing/ordering/payment state continue to route to their respective handlers after the greeting detection fix
2. **Direct Intent Preservation**: Verify that "check stock of Amul Butter" in greeting state still routes to browsing handler (not intercepted by greeting detection)
3. **Pincode Search Preservation**: Verify that 6-digit pincode inputs still query GSI2 and return location-based results
4. **Numeric Reply Preservation**: Verify that "1", "2", "3", "4" still route correctly through customer discovery menu
5. **Polling Sync Preservation**: Verify that the sync client still deduplicates messages and uses exponential backoff

### Unit Tests

- Test `handleCustomerDiscovery()` with greeting inputs → should call `sendHomeMenu()`
- Test `handleCustomerDiscovery()` with store name inputs → should attempt DynamoDB scan fallback
- Test `chat-send-handler` publishes both `CustomerMessageSent` and `message.created` events
- Test `getUserByPhone()` with mixed GSI1 results → should return USER PROFILE only
- Test EventBridge publish validation rejects empty `EVENT_BUS_NAME`
- Test `pushToWebSocket()` logs error when `WEBSOCKET_API_ENDPOINT` is empty

### Property-Based Tests

- Generate random greeting strings and verify they all trigger `sendHomeMenu()` in customer discovery
- Generate random non-greeting, non-menu strings and verify they still route to search flows
- Generate random phone numbers with mixed GSI1 results (USER + SESSION records) and verify `getUserByPhone()` always returns the USER PROFILE
- Generate random message payloads and verify `chat-send-handler` always publishes exactly 2 EventBridge entries

### Integration Tests

- Test full web chat flow: send message → verify DynamoDB storage → verify both EventBridge events published → verify fan-out Lambda receives `message.created`
- Test full WhatsApp greeting flow: send "Hello" → verify Store Discovery menu is returned
- Test full WhatsApp store search flow: send "Dragon Store" → verify DynamoDB scan fallback finds the store
- Test cross-channel fan-out: customer sends via WhatsApp → verify seller's WebSocket connection receives the message via fan-out Lambda
