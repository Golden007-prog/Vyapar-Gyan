# Bugfix Requirements Document

## Introduction

The Real-Time Omnichannel Chat Synchronization feature is partially broken. Web chat messages appear in the seller Inbox (one-way works), but the full bi-directional sync is NOT functioning:

1. **Seller web reply → Customer WhatsApp**: Seller replies from the web Inbox but the customer never receives the message on WhatsApp.
2. **WhatsApp message → Web dashboard real-time update**: Customer sends a WhatsApp message but it does not appear in the seller's web Inbox in real-time (only visible after manual refresh/poll).

Root cause analysis reveals five interconnected defects across the sync chain:

- The WebSocket `sendMessage` handler stores messages in DynamoDB and pushes to WebSocket connections directly, but never publishes a `message.created` event to EventBridge — so the fan-out Lambda is never triggered for cross-channel delivery.
- The WhatsApp worker stores inbound messages via `putMessage()` directly but never calls the `message-router` service — so no `message.created` event is published to EventBridge for real-time WebSocket push.
- The fan-out Lambda queries `CONNECTION#{userId}` for WebSocket connections, but the Connection Registry uses `CONN#{connectionId}` as PK with `USER_CONN#{userId}` on GSI1 — so WebSocket connection lookups always return zero results.
- The fan-out Lambda requires `WEBSOCKET_API_ENDPOINT` env var to push messages via API Gateway Management API, but the events-stack does not pass this variable — so even if connections were found, WebSocket push would be skipped.
- The seller reply handler publishes `SellerReplySent` (source: `vyapargyan.chat`) which routes to the notification-router worker, but that worker only handles `CustomerMessageSent` events — it does not handle seller-to-customer WhatsApp delivery. The `message.created` fan-out path (source: `vyapargyan.messaging`) is never triggered for seller replies.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a seller sends a reply from the web Inbox via the seller-reply-handler THEN the system stores the message in DynamoDB and publishes a `SellerReplySent` event (source: `vyapargyan.chat`), but the notification-router only handles `CustomerMessageSent` events, so the seller reply is never delivered to the customer's WhatsApp

1.2 WHEN a seller sends a message via the WebSocket `sendMessage` handler THEN the system stores the message in dual threads and pushes to WebSocket connections directly, but never publishes a `message.created` event to EventBridge, so the fan-out Lambda is never triggered for cross-channel delivery (web → WhatsApp)

1.3 WHEN a customer sends a WhatsApp message THEN the WhatsApp worker stores the message in `THREAD#{userId}` via `putMessage()` directly but never calls the `message-router` service to publish a `message.created` event to EventBridge, so the fan-out Lambda is never triggered for real-time WebSocket push to the seller's web dashboard

1.4 WHEN the fan-out Lambda attempts to find active WebSocket connections for a recipient THEN it queries DynamoDB with `PK = CONNECTION#{userId}`, but the Connection Registry stores items with `PK = CONN#{connectionId}` and uses `GSI1PK = USER_CONN#{userId}` for user lookups, so the query always returns zero results and WebSocket push is skipped

1.5 WHEN the fan-out Lambda attempts to push a message to a WebSocket connection THEN it reads `WEBSOCKET_API_ENDPOINT` from environment variables, but the events-stack CDK definition does not pass this variable to the fan-out Lambda, so the endpoint is undefined and WebSocket push is skipped with a warning log

### Expected Behavior (Correct)

2.1 WHEN a seller sends a reply from the web Inbox via the seller-reply-handler THEN the system SHALL publish a `message.created` event (source: `vyapargyan.messaging`) to EventBridge with the correct recipientUserId, channel `web`, and message content, so the fan-out Lambda delivers the message to the customer's WhatsApp

2.2 WHEN a seller sends a message via the WebSocket `sendMessage` handler THEN the system SHALL call the `message-router` service (or directly publish a `message.created` event to EventBridge) after storing the message, so the fan-out Lambda can deliver the message to the recipient's other active channels (e.g., WhatsApp)

2.3 WHEN a customer sends a WhatsApp message THEN the WhatsApp worker SHALL call the `message-router` service's `routeMessage()` (or publish a `message.created` event to EventBridge) after storing the inbound message, so the fan-out Lambda pushes the message to the seller's active WebSocket connections in real-time

2.4 WHEN the fan-out Lambda looks up active WebSocket connections for a recipient THEN it SHALL query the GSI1 index with `GSI1PK = USER_CONN#{recipientUserId}` to correctly find all active connections stored by the connect handler

2.5 WHEN the fan-out Lambda is deployed via CDK THEN the events-stack SHALL pass the `WEBSOCKET_API_ENDPOINT` environment variable (constructed from the WebSocket API ID and stage) so the Lambda can push messages via the API Gateway Management API

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a customer sends a web chat message THEN the system SHALL CONTINUE TO display the message in the seller's Inbox (this path currently works)

3.2 WHEN the WhatsApp worker processes an inbound message THEN the system SHALL CONTINUE TO store the message in `THREAD#{userId}` via `putMessage()` for persistence and later retrieval

3.3 WHEN the WebSocket `sendMessage` handler receives a message THEN the system SHALL CONTINUE TO store the message in dual threads (sender and recipient) and push to recipient WebSocket connections directly for immediate web-to-web delivery

3.4 WHEN the fan-out Lambda receives a `message.created` event and the originating channel matches the only active channel THEN the system SHALL CONTINUE TO skip delivery (no echo) to avoid duplicate messages

3.5 WHEN the seller-reply-handler processes a reply THEN the system SHALL CONTINUE TO manage human handoff state (start/extend/end handoff, `/ai` command) correctly

3.6 WHEN the WebSocket connect handler authenticates a client THEN the system SHALL CONTINUE TO store Connection Registry items with `PK = CONN#{connectionId}` and `GSI1PK = USER_CONN#{userId}` using the existing schema

3.7 WHEN the notification-router receives a `CustomerMessageSent` event THEN the system SHALL CONTINUE TO route customer messages to sellers based on the seller's preferred channel setting
