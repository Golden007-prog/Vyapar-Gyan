# Bugfix Requirements Document

## Introduction

VyaparGyan's omnichannel commerce platform has six interconnected bugs that break the end-to-end message flow between customers (WhatsApp and web chat) and sellers (web Inbox). Web chat messages never reach the backend, WhatsApp greetings trigger store search instead of showing a discovery menu, store name searches fail silently, EventBridge publishing is unreliable, phone-based user lookup can return SESSION records instead of USER profiles, and the fan-out Lambda may not push messages to seller WebSocket connections. Together these bugs render the platform non-functional for real-time omnichannel commerce.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a customer sends a message via web chat AND `NEXT_PUBLIC_DEMO_MODE=true` is set in `.env.production` THEN the frontend may use demo/localStorage paths (e.g. `demo-cart.ts` sessionStorage) instead of sending messages to the real API Gateway backend, causing messages to stay client-side only

1.2 WHEN the web chat `chat-send-handler.ts` publishes a `CustomerMessageSent` event to EventBridge (source: `vyapargyan.chat`) THEN there is no corresponding `message.created` event (source: `vyapargyan.messaging`) published for the fan-out Lambda, so the message is stored in DynamoDB but never pushed to the seller's WebSocket Inbox

1.3 WHEN a customer sends "Hello" or "Hi" via WhatsApp AND the session is new or in greeting state THEN the `isDiscoveryTrigger` check in `worker.ts` routes to `handleCustomerDiscovery` which does not recognize greetings — the text "Hello" falls through all menu/numeric/location checks and hits `searchByCity("hello")` then `searchGlobal("Hello")`, both returning empty, resulting in "No stores found for Hello" instead of showing the Store Discovery menu

1.4 WHEN a customer types "Dragon Store" via WhatsApp THEN the `searchByCity` query uses `GSI3PK = CITY#dragon store` which won't match, and `searchGlobal` requires OpenSearch which may not be configured (`OPENSEARCH_ENDPOINT` env var not set), and there is no DynamoDB scan fallback for store name search, resulting in "No stores found for Dragon Store"

1.5 WHEN the WhatsApp worker publishes EventBridge events inside a try-catch with fire-and-forget pattern AND the `EVENT_BUS_NAME` env var is empty or the bus name is wrong THEN the `PutEventsCommand` fails silently (error is logged but swallowed), and the message never reaches the fan-out Lambda or notification router

1.6 WHEN `getUserByPhone()` in `dynamodb-adapter.ts` queries GSI1 with `PHONE#{phoneNumber}` THEN both USER PROFILE records (PK: `USER#`, SK: `PROFILE`) and SESSION records (PK: `SESSION#`, SK: `ACTIVE`) are returned because both have `GSI1PK = PHONE#{phone}` — if the SESSION record is returned first and the profile-priority filter fails to find a match, the fallback returns the first item with a `role` field, which may be a session record without proper role/sellerStatus fields, causing incorrect routing (seller gets customer flow)

1.7 WHEN the fan-out Lambda (`handlers/messaging/fanout.ts`) receives a `message.created` event AND the `WEBSOCKET_API_ENDPOINT` env var is empty (passed as `props.webSocketEndpoint || ''` in events-stack.ts) THEN the Lambda cannot call API Gateway Management API to push messages to connected WebSocket clients, so messages stored in DynamoDB never appear in the seller's real-time Inbox

### Expected Behavior (Correct)

2.1 WHEN a customer sends a message via web chat THEN the system SHALL send the message to the backend API Gateway endpoint via authenticated HTTP POST (using Cognito JWT), store it in DynamoDB `THREAD#{userId}`, and publish both `CustomerMessageSent` and `message.created` events to EventBridge — localStorage/sessionStorage SHALL NOT be used as primary message storage in production

2.2 WHEN the web chat `chat-send-handler.ts` stores a message THEN the system SHALL publish a `message.created` event (source: `vyapargyan.messaging`, detailType: `message.created`) in addition to the `CustomerMessageSent` event, so the fan-out Lambda receives it and pushes the message to the seller's WebSocket connection

2.3 WHEN a customer sends "Hello", "Hi", "Hey", "Namaste", or any common greeting via WhatsApp THEN the system SHALL display the Store Discovery home menu with 4 options (1. My favorite stores, 2. Search by pincode/city, 3. Search all stores, 4. Browse last visited store) instead of treating the greeting as a store search query

2.4 WHEN a customer types a store name like "Dragon Store" via WhatsApp THEN the system SHALL perform a case-insensitive search across seller profiles in DynamoDB (scanning `storeName`, `businessName`, `displayName` fields) as a fallback when GSI-based city search and OpenSearch global search return no results, and SHALL find matching stores

2.5 WHEN the WhatsApp worker publishes EventBridge events THEN the system SHALL validate that `EVENT_BUS_NAME` is set and non-empty before publishing, SHALL await the publish result, and SHALL log a structured error with the bus name and event details if publishing fails — the message processing itself SHALL still complete successfully

2.6 WHEN `getUserByPhone()` queries GSI1 THEN the system SHALL reliably return the USER PROFILE record (PK starting with `USER#`, SK = `PROFILE`) by filtering results to prioritize profile records over session records, ensuring sellers are correctly identified by their `role` and `sellerStatus` fields for proper routing

2.7 WHEN the fan-out Lambda receives a `message.created` event THEN the system SHALL have a valid `WEBSOCKET_API_ENDPOINT` configured, SHALL look up active WebSocket connections for the recipient, and SHALL push the message to all connected clients via API Gateway Management API — the seller's web Inbox SHALL display the message in real-time

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a customer sends a message via WhatsApp AND the session is in `browsing` or `ordering` state THEN the system SHALL CONTINUE TO route the message to the browsing or checkout handler respectively, without re-showing the discovery menu

3.2 WHEN a customer sends a direct intent message like "check stock of Amul Butter" or "price of Tata Salt" in greeting state THEN the system SHALL CONTINUE TO route to the browsing handler for intent detection and fulfillment, bypassing the greeting flow

3.3 WHEN a seller sends a message via WhatsApp THEN the system SHALL CONTINUE TO route to the seller copilot handler with the correct user profile, providing the seller management menu

3.4 WHEN a customer sends a numeric reply ("1", "2", etc.) THEN the system SHALL CONTINUE TO resolve it against the stored menu context in the session for proper navigation

3.5 WHEN the WhatsApp worker processes an inbound message THEN the system SHALL CONTINUE TO store the message in `THREAD#{userId}` via `putMessage()` regardless of whether EventBridge publishing succeeds or fails

3.6 WHEN a customer searches by 6-digit pincode THEN the system SHALL CONTINUE TO query GSI2 (`LOCATION#{pincode}`) for location-based store discovery

3.7 WHEN the web chat polling sync client receives messages THEN the system SHALL CONTINUE TO deduplicate messages by messageId and use exponential backoff on errors

3.8 WHEN a human handoff is active for a session THEN the system SHALL CONTINUE TO bypass AI routing and pipe messages directly to the seller's Inbox via EventBridge fan-out
