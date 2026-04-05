# Implementation Plan: VyaparGyan Next Features

## Overview

This plan covers 7 features with 20 engineering tasks that extend VyaparGyan into a fully omnichannel, AI-driven commerce platform. Tasks are organized by feature with property-based test sub-tasks mapped to the 28 correctness properties from the design document. The project uses TypeScript throughout, with Jest + fast-check for testing.

### Execution Order

```
Feature 1 (WhatsApp Routing):    1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
Feature 2 (Omnichannel Sync):    2.1 → 2.2 → 2.3 → 2.4
Feature 3 (AI Inventory):        3.1 → 3.2 → 3.3
Feature 4 (Admin Expansion):     4.6 → 4.1 → 4.2 → 4.3 → 4.4 → 4.5
Feature 5 (UPI):                 5.1
Feature 6 (Abandoned Cart):      6.1
Feature 7 (Voice Reports):       7.1
```

### Parallelization

- Features 1 + 4 can run in parallel (different Lambda domains)
- Feature 3 depends on Feature 2.2 (omnichannel campaign needs message routing)
- Features 5, 6, 7 are independent and can be built in any order after core features

## Tasks

### Feature 1: Role-Based Smart WhatsApp Routing

- [ ] 1. Implement phone normalization and role-based routing
  - [x] 1.1 Phone number lookup and role detection
    - Create `services/api/src/utils/phone-normalize.ts` with `normalizeIndianPhone()` utility
      - Strip `+91` prefix, `91` prefix (12 digits), leading `0` (11 digits), spaces, dashes, parentheses
      - Validate result is exactly 10 digits starting with 6-9
      - International numbers: store with country code as-is
      - Throw error for invalid input
    - Create `services/api/src/services/user-lookup.ts` with `resolveUserByPhone()` service
      - Normalize phone via `normalizeIndianPhone()`
      - Query DynamoDB GSI1 (GSI1PK = `PHONE#{normalized}`, GSI1SK = `PROFILE`)
      - Return `{ userId, role, profile }` or `null` for unregistered
    - Modify `services/api/src/handlers/whatsapp/webhook.ts` to add role routing
      - After phone lookup: seller → Seller_Copilot, customer → Customer_Discovery, null → Onboarding
      - Cache resolved role in WhatsApp session DynamoDB record to avoid repeated GSI lookups
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.1.P1 Write property test: Phone normalization produces valid 10-digit output
    - **Property 1: Phone normalization produces valid 10-digit output**
    - For any Indian phone in formats (+91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX, XXXXXXXXXX, with spaces/dashes), `normalizeIndianPhone()` returns exactly 10 digits starting with 6-9, or throws for invalid input
    - Test file: `services/api/src/__tests__/properties/phone-normalize.property.test.ts`
    - Use `indianPhoneArb` generator from design
    - **Validates: Requirement 1.1**

  - [x] 1.1.P2 Write property test: Role-based routing is exhaustive and correct
    - **Property 2: Role-based routing is exhaustive and correct**
    - For any resolved role ∈ {seller, customer, null}, routing maps seller → Seller_Copilot, customer → Customer_Discovery, null → Onboarding with no unhandled values
    - Test file: `services/api/src/__tests__/properties/role-routing.property.test.ts`
    - **Validates: Requirements 1.5, 1.6, 1.7**

  - [x] 1.2 Onboarding flow for unregistered users
    - Create onboarding state handler in `services/api/src/handlers/whatsapp/states/onboarding-handler.ts`
      - First message: send welcome message with platform description + registration link (`/register?ref=whatsapp&phone={phone}`)
      - Subsequent messages (within 24h): send shorter reminder instead of full onboarding
    - Modify `services/api/src/services/session-service.ts` to support onboarding session with 24h TTL
      - TTL = `floor(createdAt / 1000) + 86400`
      - After TTL expiry, next message re-triggers full onboarding
    - Limit to one full welcome + reminders per 24h window
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.2.P3 Write property test: Registration link contains correct query parameters
    - **Property 3: Registration link contains correct query parameters**
    - For any normalized phone, the registration link contains `?ref=whatsapp&phone={phone}` with exact URL-encoded phone value
    - Test file: `services/api/src/__tests__/properties/phone-normalize.property.test.ts` (append)
    - **Validates: Requirement 2.2**

  - [x] 1.2.P4 Write property test: Onboarding session TTL is exactly 24 hours
    - **Property 4: Onboarding session TTL is exactly 24 hours**
    - For any session creation timestamp, TTL = `floor(createdAt / 1000) + 86400`
    - Test file: `services/api/src/__tests__/properties/phone-normalize.property.test.ts` (append)
    - **Validates: Requirement 2.4**

- [ ] 2. Checkpoint — Ensure phone normalization, role routing, and onboarding tests pass
  - Ensure all tests pass, ask the user if questions arise.


  - [x] 1.3 Seller Copilot — home menu and stock check
    - Create `services/api/src/handlers/whatsapp/seller-copilot.ts`
      - Display home menu on first seller message: (1) Check stock, (2) Configure trend alerts, (3) Review pending campaigns, (4) Quick inventory summary
      - Stock check: use Gemini to extract product intent from natural language query
      - Query DynamoDB `SellerStockIndex` (GSI PK: `sellerId`, SK: `stockAddedDate`) with filter on product name
      - Return product name, current stock quantity, last restock date for each match
      - "No matching products found" for invalid queries
      - "menu" or "home" returns to copilot home from any sub-state
    - Modify `services/api/src/handlers/whatsapp/worker.ts` to add seller state handling and route to seller-copilot
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 1.3.P5 Write property test: Stock check response contains all required fields
    - **Property 5: Stock check response contains all required fields**
    - For any non-empty product list, formatted response contains product name, stock quantity, and last restock date for every product
    - Test file: `services/api/src/__tests__/properties/phone-normalize.property.test.ts` (or new file)
    - **Validates: Requirement 3.3**

  - [x] 1.4 Seller Copilot — Grok trend alert configuration
    - Create `services/api/src/services/trend-scheduler.ts`
      - `createOrUpdateSchedule(sellerId, interval)`: map interval to EventBridge Scheduler rate expression (30m → `rate(30 minutes)`, 1h → `rate(1 hour)`, 8h → `rate(8 hours)`, 24h → `rate(24 hours)`)
      - Create/update EventBridge Scheduler rule targeting trend-analyzer-worker Lambda
      - Store config in DynamoDB: PK=`SELLER#{id}`, SK=`TREND_CONFIG` with interval, enabled, schedulerRuleArn, phoneNumber
      - `disableSchedule(sellerId)`: delete EventBridge Scheduler rule, update DynamoDB config enabled=false
    - Modify `services/api/src/handlers/whatsapp/seller-copilot.ts` to handle "trends"/"alerts" and "stop alerts" commands
      - Present interval options: 30m, 1h, 8h, 24h
      - On selection: create/update scheduler rule
      - "stop alerts": disable scheduler
    - Modify `infra/cdk/lib/stacks/events-stack.ts` to add scheduler permissions for trend-scheduler
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 1.5 Seller Copilot — campaign approval via WhatsApp
    - Modify `services/api/src/handlers/whatsapp/seller-copilot.ts` to add campaign review state
      - List pending campaigns with numbered entries: campaign name, affected products, suggested discount, expected revenue impact
      - Parse seller reply: "N", "approve N", "approve #N" → approve; "dismiss N", "dismiss #N" → dismiss
      - Approval: publish `campaign.approved` event on EventBridge, send confirmation message
      - Dismissal: update campaign status to rejected in DynamoDB
      - Empty list: respond "All caught up! No pending campaigns."
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 1.5.P6 Write property test: Campaign list formatting preserves all campaign details
    - **Property 6: Campaign list formatting preserves all campaign details**
    - For any non-empty pending campaign list, formatted message contains numbered entry with campaign name, affected products, suggested discount, expected revenue impact. Empty list → "All caught up!"
    - Test file: `services/api/src/__tests__/properties/campaign-commands.property.test.ts`
    - **Validates: Requirements 5.1, 5.5**

  - [x] 1.5.P7 Write property test: Campaign command parsing extracts correct action and index
    - **Property 7: Campaign command parsing extracts correct action and index**
    - For any reply matching "N", "approve N", "approve #N", "dismiss N", "dismiss #N" (N = positive integer), parser extracts correct action and index. Invalid patterns rejected.
    - Test file: `services/api/src/__tests__/properties/campaign-commands.property.test.ts` (append)
    - **Validates: Requirements 5.2, 5.3**

  - [x] 1.6 Customer Discovery — favorites, pincode, and global search
    - Create `services/api/src/handlers/whatsapp/customer-discovery.ts`
      - Customer home menu: (1) My favorite stores, (2) Search stores by pincode/city, (3) Search all stores, (4) Browse last visited store
      - Favorites: query `CUSTOMER#{id} / FAVORITE#*` from DynamoDB, list store names
      - Pincode (6-digit): query sellers GSI2 by `LOCATION#{pincode}`
      - City name: query GSI3 by `CITY#{city_lowercase}` (case-insensitive)
      - Global search: forward to OpenSearch `sellers` index with fuzzy matching
      - Store selection: transition to existing BROWSING state with `sellerId` context
      - "Add to favorites" option after store selection
    - Create `services/api/src/repositories/favorites.ts` for favorites CRUD
    - Modify `services/api/src/handlers/whatsapp/worker.ts` to add customer routing to customer-discovery
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 1.6.P8 Write property test: Location input correctly classified as pincode or city
    - **Property 8: Location input correctly classified as pincode or city**
    - For any input: exactly 6 digits → pincode search; otherwise → city name search (case-insensitive: "Mumbai" = "mumbai")
    - Test file: `services/api/src/__tests__/properties/campaign-commands.property.test.ts` (or new file)
    - **Validates: Requirements 6.3, 6.4**

  - [x] 1.6.P9 Write property test: Store selection transitions session to BROWSING with correct sellerId
    - **Property 9: Store selection transitions session to BROWSING with correct sellerId**
    - For any store selection, session state → BROWSING and session context contains selected store's `sellerId`
    - Test file: `services/api/src/__tests__/properties/role-routing.property.test.ts` (append)
    - **Validates: Requirement 6.6**

- [ ] 3. Checkpoint — Ensure all Feature 1 (WhatsApp Routing) tests pass
  - Ensure all tests pass, ask the user if questions arise.


### Feature 2: Real-Time Omnichannel Chat Synchronization

- [ ] 4. Implement unified messaging and bi-directional sync
  - [x] 2.1 Unified message storage with channel tracking
    - Add `channel` field (`"whatsapp"` | `"web"` | `"system"`) to all message records in DynamoDB
    - Modify `services/api/src/handlers/whatsapp/worker.ts` to write messages with `channel = "whatsapp"`
    - Modify `services/api/src/handlers/chat/chat-sync-handler.ts` (WebSocket sendMessage) to write with `channel = "web"`
    - System-generated messages (AI responses, auto-replies) use `channel = "system"`
    - Modify `services/api/src/repositories/message-repository.ts` to include channel in message schema
    - Modify `apps/web/components/Chat/MessageList.tsx` to render channel indicator icon (WhatsApp/Web icon) per message
    - Add `apps/web/components/ui/ChannelIndicator.tsx` updates for WhatsApp vs Web distinction
    - Ensure message queries return all channels in chronological order with no duplicates
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 2.1.P10 Write property test: Message thread query returns all channels in chronological order
    - **Property 10: Message thread query returns all channels in chronological order**
    - For any set of messages across channels with varying timestamps, thread query returns all messages sorted by timestamp ascending regardless of channel
    - Test file: `services/api/src/__tests__/properties/message-thread.property.test.ts`
    - **Validates: Requirement 7.4**

  - [x] 2.1.P11 Write property test: Message deduplication prevents duplicate storage
    - **Property 11: Message deduplication prevents duplicate storage**
    - For any message with a given messageId, storing it twice results in exactly one record (idempotent write)
    - Test file: `services/api/src/__tests__/properties/message-thread.property.test.ts` (append)
    - **Validates: Requirement 7.6**

  - [x] 2.2 Bi-directional message push (WhatsApp ↔ Web)
    - Create `services/api/src/handlers/messaging/fanout.ts` — Fan-out Lambda
      - Receive `message.created` EventBridge event
      - Determine recipient(s) from event detail
      - Check recipient's active channels: WebSocket (`CONNECTION#{userId}` records), WhatsApp (phone + active session)
      - Push to each active channel except originating channel (avoid echo)
    - Create `services/api/src/services/message-router.ts`
      - `routeMessage(params)`: store message in DynamoDB → publish `message.created` to EventBridge → return immediately (fan-out is async)
      - Deduplication via messageId as idempotency key
    - Modify `infra/cdk/lib/stacks/events-stack.ts` to add `message.created` EventBridge rule targeting fan-out Lambda
    - Customer WhatsApp message → seller web Inbox within 1s
    - Seller web reply → customer WhatsApp within 2s + customer web chat (if online)
    - Sync delivery status (sent, delivered, read) across channels
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 2.2.P12 Write property test: Fan-out routes to all active channels except originator
    - **Property 12: Fan-out routes to all active channels except originator**
    - For any message.created event with originating channel and recipient active channels, fan-out pushes to every active channel except originator
    - Test file: `services/api/src/__tests__/properties/message-thread.property.test.ts` (append)
    - **Validates: Requirement 8.4**

  - [x] 2.3 Gemini intent extraction for contextual routing
    - Create `services/api/src/services/intent-extraction.ts`
      - Use Gemini prompt to extract: product intent (name, quantity, action), store intent (name), language
      - Return structured JSON: `{ product: { name, quantity, action }, store: { name }, language }`
      - If store intent detected → query OpenSearch for matching seller → route to seller context
      - If product intent without store → search all sellers via OpenSearch
      - Store extraction results in session: `context.lastIntent = { product, store, language }`
    - Modify `services/api/src/handlers/whatsapp/worker.ts` to integrate intent extraction before routing
    - Support Hindi and English (and 6 other Indian languages)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 2.3.P13 Write property test: Store intent routes session to correct seller
    - **Property 13: Store intent routes session to correct seller**
    - For any detected store name matching a seller, session routes to that seller's catalog context with correct `sellerId`
    - Test file: `services/api/src/__tests__/properties/intent-extraction.property.test.ts`
    - **Validates: Requirement 9.2**

  - [x] 2.3.P14 Write property test: Intent extraction response conforms to schema
    - **Property 14: Intent extraction response conforms to schema**
    - For any Gemini intent extraction JSON response, parsed result contains: product (name, quantity, action — each nullable), store (name — nullable), language (one of 8 supported codes)
    - Test file: `services/api/src/__tests__/properties/intent-extraction.property.test.ts` (append)
    - **Validates: Requirement 9.6**

  - [x] 2.4 Human handoff protocol
    - Modify `services/api/src/services/session-service.ts` to add handoff logic
      - Add `isHumanHandoff`, `handoffSellerId`, `handoffStartedAt`, `handoffExpiresAt` fields to session record
      - When seller sends first reply from web Inbox: set `isHumanHandoff: true`, `handoffExpiresAt = now + 30min`
      - On each seller reply: reset `handoffExpiresAt` to now + 30min
      - `/ai` command: set `isHumanHandoff: false`
      - Auto-reset: if `handoffExpiresAt <= now`, treat as AI mode
    - Modify `services/api/src/handlers/whatsapp/worker.ts` to check handoff before AI processing
      - If `isHumanHandoff && handoffExpiresAt > now` → skip AI, pipe to seller inbox
    - Create `apps/web/components/Inbox/HandoffIndicator.tsx` — "AI mode" / "Human mode" indicator in seller Inbox header
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 2.4.P15 Write property test: Human handoff controls AI bypass
    - **Property 15: Human handoff controls AI bypass**
    - For any session where `isHumanHandoff=true` AND `handoffExpiresAt > now`, messages skip AI. When `handoffExpiresAt <= now`, handoff auto-resets to false.
    - Test file: `services/api/src/__tests__/properties/handoff.property.test.ts`
    - **Validates: Requirements 10.2, 10.4**

- [ ] 5. Checkpoint — Ensure all Feature 2 (Omnichannel Sync) tests pass
  - Ensure all tests pass, ask the user if questions arise.


### Feature 3: AI-Powered Inventory & Campaign Operations

- [ ] 6. Implement WhatsApp inventory upload and omnichannel campaigns
  - [x] 3.1 WhatsApp inventory upload (CSV/Excel/Khata photo)
    - Create `services/api/src/handlers/whatsapp/inventory-upload.ts`
      - Detect file type from Twilio media webhook metadata (`MediaContentType0`)
      - CSV/Excel: download via Twilio media URL → run through existing Smart CSV mapping (`gemini-adapter.mapCsvColumns()`)
      - Image (JPG/PNG/WebP): run through existing Khata OCR (`gemini-adapter.parseKhataBookImage()`)
      - Upload to S3: `s3://media-bucket/inventory-uploads/{sellerId}/{timestamp}/{filename}`
      - Send extracted items as numbered list in WhatsApp message
      - Seller confirms ("looks good") → batch write to DynamoDB product records
      - Seller edits ("change item 3 price to 250") → update pending extraction, re-display
      - Progress messages during processing ("Processing your file...")
      - Error reporting with specific row/issue ("Row 5: missing price")
    - Modify `services/api/src/handlers/whatsapp/worker.ts` to add media detection routing to inventory-upload handler
    - Store pending extraction in session context (`pendingInventory` field)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [x] 3.1.P16 Write property test: File type detection classifies media correctly
    - **Property 16: File type detection classifies media correctly**
    - For any Twilio media content type string: text/csv, application/csv → csv; application/vnd.ms-excel, spreadsheetml.sheet → excel; image/jpeg, image/png, image/webp → image; others → unknown
    - Test file: `services/api/src/__tests__/properties/file-detection.property.test.ts`
    - **Validates: Requirement 11.1**

  - [x] 3.1.P17 Write property test: Inventory extraction formatted as numbered list
    - **Property 17: Inventory extraction formatted as numbered list**
    - For any non-empty extracted items list, formatted message contains sequentially numbered entry for each item with name, price, and quantity
    - Test file: `services/api/src/__tests__/properties/inventory-formatting.property.test.ts`
    - **Validates: Requirement 11.4**

  - [x] 3.1.P18 Write property test: Inventory edit command parsing extracts item, field, and value
    - **Property 18: Inventory edit command parsing extracts item, field, and value**
    - For any edit command matching "change item N price to X" or "update item N quantity to X", parser extracts correct item index, field name, and new value
    - Test file: `services/api/src/__tests__/properties/inventory-formatting.property.test.ts` (append)
    - **Validates: Requirement 11.6**

  - [x] 3.2 Omnichannel campaign deployment
    - Modify `services/api/src/services/campaign-service.ts` to add multi-channel dispatch
      - `dispatchCampaign(campaignId, channel: 'web' | 'whatsapp' | 'both')`
      - Web Chat: create system message in customer thread + push via WebSocket
      - WhatsApp: send via Twilio with discount details
      - Both: execute both delivery paths
    - Modify `services/api/src/handlers/workers/campaign-execution-worker.ts` to add channel routing
    - Track delivery per customer per channel: sent, delivered, read, converted
    - Add campaign delivery records: `CAMPAIGN#{id} / DELIVERY#{custId}` with channel, sentAt, deliveredAt, readAt, convertedAt, status
    - Modify `apps/web/app/seller/campaigns/page.tsx` to add per-channel report columns
    - _Depends on: Task 2.2 (message router for fan-out)_
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 3.2.P19 Write property test: "Both" channel dispatch executes both delivery paths
    - **Property 19: "Both" channel dispatch executes both delivery paths**
    - For any campaign with channel="both" and target customer list, dispatcher executes both Web Chat and WhatsApp delivery for every customer
    - Test file: `services/api/src/__tests__/properties/campaign-commands.property.test.ts` (append)
    - **Validates: Requirement 12.4**

  - [x] 3.3 Enhanced AI Insight cards
    - Modify `apps/web/app/seller/insights/page.tsx` to enhance insight card rendering
      - Severity badge: HIGH (red), MEDIUM (amber), LOW (blue)
      - AI source label: GROK, GEMINI, or BEDROCK
      - Confidence percentage, expected financial impact (₹ format), affected product count
      - 1-2 line market research summary
    - "Approve & Send" → open campaign notification modal (existing flow)
    - "Dismiss" → move insight to dismissed list in DynamoDB (add `dismissedAt` field)
    - "Refresh" → re-trigger trend analyzer worker and dead-stock agent
    - Add undo/recovery for dismissed insights within 24h
    - Modify `services/api/src/handlers/seller/get-insights.ts` to support dismissed list and recovery
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [ ] 7. Checkpoint — Ensure all Feature 3 (AI Inventory & Campaigns) tests pass
  - Ensure all tests pass, ask the user if questions arise.


### Feature 4: Admin Dashboard Expansion

- [x] 8. Update admin navigation and implement admin pages
  - [x] 4.6 Update Admin sidebar navigation
    - Modify `apps/web/app/admin/layout.tsx` to update sidebar navigation
      - New order: Overview, Sellers, Customers, Disputes, Financials, Campaigns, Catalog, Audit, Health, Settings
      - Add nav items for: `/admin/customers`, `/admin/disputes`, `/admin/financials`, `/admin/campaigns`, `/admin/catalog`
    - Update mobile bottom navigation bar for admin
      - Primary: Overview, Sellers, Disputes, Financials
      - "More" menu: Customers, Campaigns, Catalog, Audit, Health, Settings
    - Ensure active state highlights correctly on all new pages
    - Verify no broken links
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [x] 4.1 Customer Directory & Analytics page
    - Create `services/api/src/handlers/admin/customers.ts`
      - `GET /admin/customers?search=&page=&size=&sort=&ltv_min=&ltv_max=&date_from=&date_to=` — paginated customer list
      - `GET /admin/customers/:id` — customer detail with order history, chat history, favorites, channel preference
      - Query CUSTOMER# records, aggregate order data for LTV calculation
      - Cross-pollination metric: count distinct sellers per customer from orders
      - Summary cards: Total Customers, New This Month, Avg LTV, Avg Orders/Customer
    - Create `apps/web/app/admin/customers/page.tsx` — customer list page
      - Columns: Name, Phone, Registered Date, Total Orders, LTV, Stores Visited, Last Active
      - Search by name/phone, filter by date range and LTV range
      - Summary cards at top
    - Create `apps/web/app/admin/customers/[id]/page.tsx` — customer detail page
      - Order history, chat history, favorite stores, channel preference (web/WhatsApp/both)
    - Add API route in `infra/cdk/lib/stacks/api-stack.ts`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [x] 4.2 Dispute Resolution & Support Hub
    - Create `services/api/src/handlers/admin/disputes.ts`
      - `GET /admin/disputes?status=&issue_type=&page=&size=` — dispute list
      - `GET /admin/disputes/:id` — dispute detail with order, chat transcript, evidence
      - `POST /admin/disputes/:id/resolve` — resolution actions (refund, replace, dismiss, escalate)
      - `PUT /admin/disputes/:id/notes` — admin notes
    - Create DynamoDB schema for disputes: `DISPUTE#{id} / METADATA` with orderId, customerId, sellerId, issueType, status, adminNotes, resolution, evidenceUrls
    - Issue types: Wrong Item, Not Delivered, Quality Issue, Refund Request, Payment Failed
    - Resolution actions: Refund (full/partial via Razorpay refund API), Replace, Dismiss, Escalate
    - Auto-flag rules via EventBridge: negative feedback, payment failures, delivery delays >48h
    - Create `apps/web/app/admin/disputes/page.tsx` — dispute list with status/type filters
    - Create `apps/web/app/admin/disputes/[id]/page.tsx` — dispute detail with resolution actions, admin notes, timeline
    - Add API routes in `infra/cdk/lib/stacks/api-stack.ts`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x] 4.3 Financials & Commission Tracking
    - Create `services/api/src/handlers/admin/financials.ts`
      - `GET /admin/financials/summary` — Total Platform Revenue, Total Commission Earned, Pending Settlements, Failed Payouts
      - `GET /admin/financials/transactions?date_from=&date_to=&seller=&status=&page=&size=` — Razorpay Route transactions table
      - `POST /admin/financials/transactions/:id/retry` — retry failed payout via Razorpay transfer API
      - `GET /admin/financials/export?date_from=&date_to=&seller=&status=` — CSV export of filtered transactions
    - DynamoDB schema: `TRANSFER#{id} / METADATA` with orderId, sellerId, orderAmount, commissionRate, commissionAmount, transferStatus, razorpayTransferId
    - New GSI: `TransferSellerIndex` (PK: sellerId, SK: createdAt)
    - Create `apps/web/app/admin/financials/page.tsx`
      - Summary cards, transactions table (Date, Order ID, Seller, Order Amount, Commission %, Commission Amount, Transfer Status)
      - Filters: date range, seller, status
      - Failed payout retry button
      - CSV export button
      - Daily commission trend line chart + commission-by-seller bar chart
    - Add API routes in `infra/cdk/lib/stacks/api-stack.ts`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

  - [x] 4.4 AI Campaign Oversight
    - Create `services/api/src/handlers/admin/campaigns.ts`
      - `GET /admin/campaigns?seller=&channel=&status=&date_from=&date_to=&page=&size=` — all campaigns across all sellers
      - `GET /admin/campaigns/:id` — per-customer delivery log (sent time, delivered, read, ordered)
      - `POST /admin/campaigns/:id/flag` — flag underperforming campaign
      - `POST /admin/campaigns/:id/block` — block campaign
    - Aggregate metrics: Total Campaigns (30d), Avg Open Rate, Avg Conversion Rate, Total Revenue from Campaigns
    - Create `apps/web/app/admin/campaigns/page.tsx`
      - Columns: Campaign Name, Seller, Channel, Status, Sent Count, Open Rate, Conversion Rate, Revenue Impact
      - Filters: seller, channel, date range, status
      - Aggregate metrics at top
      - Flag/block actions for low-performance campaigns
    - Add API routes in `infra/cdk/lib/stacks/api-stack.ts`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 4.5 Global Catalog Manager
    - Create `services/api/src/handlers/admin/catalog-manager.ts`
      - `GET /admin/catalog/categories` — master list with product count, active sellers using
      - `POST /admin/catalog/categories` — add new category
      - `PUT /admin/catalog/categories/:id` — rename (propagate to all product records)
      - `POST /admin/catalog/categories/merge` — merge two categories (with impact preview)
      - `DELETE /admin/catalog/categories/:id` — soft deactivate (hide from customer-facing, preserve associations)
      - `GET /admin/catalog/categories/merge-preview?source=&target=` — preview affected products/sellers count
      - `GET /admin/catalog/categories/:id/aliases` — list aliases
      - `POST /admin/catalog/categories/:id/aliases` — add alias
      - `DELETE /admin/catalog/categories/:id/aliases/:alias` — remove alias
    - DynamoDB schema: `CATEGORY#{id} / ALIAS#{alias}` with alias, language, canonicalName
    - Merge execution: batch update products with `categoryId = sourceId` → `targetId`, move aliases, deactivate source
    - Create `apps/web/app/admin/catalog/page.tsx`
      - Category list with product count and seller count
      - Add, rename, merge, deactivate operations
      - Merge impact preview modal
      - Alias management (multiple names → one canonical, e.g., "Grocery" = "Groceries" = "किराना" = "kirana")
    - Add API routes in `infra/cdk/lib/stacks/api-stack.ts`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [x] 4.5.P20 Write property test: Category rename propagates to all products
    - **Property 20: Category rename propagates to all products**
    - For any rename operation, all product records referencing old category name are updated to new name, and count of updated products equals count of products with old category
    - Test file: `services/api/src/__tests__/properties/category-operations.property.test.ts`
    - **Validates: Requirement 18.3**

  - [x] 4.5.P21 Write property test: Merge preview correctly counts affected products and sellers
    - **Property 21: Merge preview correctly counts affected products and sellers**
    - For any two categories (source, target), merge preview returns exact count of products with `categoryId = sourceId` and exact count of distinct sellers among those products
    - Test file: `services/api/src/__tests__/properties/category-operations.property.test.ts` (append)
    - **Validates: Requirement 18.4**

  - [x] 4.5.P22 Write property test: Category aliases resolve to canonical name
    - **Property 22: Category aliases resolve to canonical name**
    - For any set of aliases mapped to a canonical category, looking up any alias returns the same canonical category name
    - Test file: `services/api/src/__tests__/properties/category-operations.property.test.ts` (append)
    - **Validates: Requirement 18.5**

  - [x] 4.5.P23 Write property test: Deactivated categories excluded from customer queries
    - **Property 23: Deactivated categories excluded from customer queries**
    - For any set of categories where some are deactivated, customer-facing query returns only active categories
    - Test file: `services/api/src/__tests__/properties/category-operations.property.test.ts` (append)
    - **Validates: Requirement 18.6**

- [x] 9. Checkpoint — Ensure all Feature 4 (Admin Expansion) tests pass
  - Ensure all tests pass, ask the user if questions arise.


### Feature 5: UPI Intent Integration

- [x] 10. Implement UPI payment links for WhatsApp checkout
  - [x] 5.1 Generate Razorpay payment links for WhatsApp checkout
    - Create `services/api/src/services/payment-link.ts`
      - `generateWhatsAppPaymentLink(order)`: create Razorpay Payment Link with amount, description, customer phone, 30-minute expiry, UPI enabled
      - Format WhatsApp message with order summary (items, quantities, total ₹) + payment link URL
    - Modify `services/api/src/handlers/whatsapp/worker.ts` checkout state to generate payment link instead of standard checkout
    - Modify `services/api/src/handlers/payment/razorpay-webhook.ts` to handle `payment_link.paid` event
      - Update order status to confirmed
      - Deduct inventory (existing logic)
      - Send confirmation to customer (WhatsApp + Web) and seller (WhatsApp + Web)
    - Handle payment link expiry: EventBridge Scheduler (30min) → check if order still pending → create new link → send reminder
    - Handle payment failure: send failure reason to customer + offer new link
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

  - [x] 5.1.P24 Write property test: Payment message contains order summary and link
    - **Property 24: Payment message contains order summary and link**
    - For any order with items, quantities, and total, formatted WhatsApp message contains all item names, quantities, total in ₹ format, and payment link URL
    - Test file: `services/api/src/__tests__/properties/payment-formatting.property.test.ts`
    - **Validates: Requirement 20.2**

### Feature 6: Automated Abandoned Cart Nudges

- [x] 11. Implement cart abandonment detection and automated reminders
  - [x] 6.1 Cart abandonment detection and automated reminders
    - Create `services/api/src/services/cart-abandonment-scheduler.ts`
      - `createOrResetTimer(userId, cartId)`: create EventBridge Scheduler one-time rule (fire in 2h), rule name `cart-nudge-{userId}-{cartId}`, target cart-abandonment-worker Lambda
      - `cancelTimer(userId, cartId)`: delete EventBridge Scheduler rule, remove timer record
      - Store timer in DynamoDB: `CART#{userId} / NUDGE_TIMER` with schedulerRuleName, firstNudgeSentAt, secondNudgeSentAt, cartRecovered, channel
    - Modify `services/api/src/services/cart-service.ts` to trigger scheduler on cart item add/update (create/reset timer)
    - Modify `services/api/src/handlers/cart/cart-checkout-handler.ts` to cancel timer on checkout completion
    - Modify `services/api/src/handlers/workers/cart-abandonment-worker.ts`
      - First nudge (2h): "You have {n} items in your cart worth ₹{amount}. Ready to checkout?"
      - Channel selection: WhatsApp if active session, Web Chat otherwise
      - Create 24h second nudge timer after first nudge
      - Second nudge (24h): include small incentive if applicable
    - Track nudge effectiveness: `CART#{userId} / NUDGE#{timestamp}` with nudgeType, channel, sentAt, cartRecovered, recoveredAt, cartValue, itemCount
    - Modify `infra/cdk/lib/stacks/events-stack.ts` to add scheduler rule + target for cart nudge
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6_

  - [x] 6.1.P25 Write property test: Cart nudge message contains correct item count and amount
    - **Property 25: Cart nudge message contains correct item count and amount**
    - For any non-empty cart, nudge message contains exact item count and total cart value in ₹ format
    - Test file: `services/api/src/__tests__/properties/cart-nudge.property.test.ts`
    - **Validates: Requirement 21.3**

  - [x] 6.1.P26 Write property test: Nudge channel selection follows preference rules
    - **Property 26: Nudge channel selection follows preference rules**
    - For any customer: if active WhatsApp session → nudge via WhatsApp; otherwise → nudge via Web Chat
    - Test file: `services/api/src/__tests__/properties/cart-nudge.property.test.ts` (append)
    - **Validates: Requirement 21.4**

### Feature 7: Voice-Activated Financial Reports

- [x] 12. Implement voice query pipeline for financial reports
  - [x] 7.1 Voice query pipeline for financial reports
    - Create `services/api/src/services/financial-query.ts`
      - Financial intent extraction via Gemini prompt: extract `queryType` (daily_sales, weekly_revenue, monthly_revenue, best_sellers, pending_orders, stock_summary, unknown), `timeRange`, `language`, `confidence`
      - DynamoDB query mapping: `QUERY_MAP` record mapping each intent to the correct DynamoDB query function
        - `daily_sales`: query SellerOrdersIndex for today, sum subtotals
        - `weekly_revenue`: query SellerOrdersIndex for last 7 days
        - `monthly_revenue`: query `SELLER#{id} / METRICS#{year}-{month}`
        - `best_sellers`: aggregate by productId, sort by quantity, top 5
        - `pending_orders`: filter status = pending, count + total value
        - `stock_summary`: query SellerStockIndex, aggregate totals
      - Multilingual response formatting: templates for 8 languages (Hindi + Hinglish, English, Tamil, Telugu, Marathi, Bengali + Benglish, Gujarati, Kannada)
      - Unknown intent: respond "I couldn't understand that. Try asking about sales, orders, or stock."
    - Modify `services/api/src/handlers/whatsapp/worker.ts` voice pipeline to add financial query routing for sellers
      - Detect voice note from seller → transcribe (existing) → extract financial intent → execute query → format response → generate TTS audio → send text + audio via Twilio
    - Integrate with `services/api/src/handlers/whatsapp/seller-copilot.ts` for voice-based copilot interaction
    - Target: end-to-end response within 8 seconds
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6, 22.7, 22.8_

  - [x] 7.1.P27 Write property test: Financial query intent maps to correct DynamoDB query
    - **Property 27: Financial query intent maps to correct DynamoDB query**
    - For any valid intent ∈ {daily_sales, weekly_revenue, monthly_revenue, best_sellers, pending_orders, stock_summary}, query mapper selects correct DynamoDB query function with appropriate date range
    - Test file: `services/api/src/__tests__/properties/voice-query.property.test.ts`
    - **Validates: Requirement 22.3**

  - [x] 7.1.P28 Write property test: Financial response formatted in detected language
    - **Property 28: Financial response formatted in detected language**
    - For any query result and detected language ∈ {en, hi, ta, te, mr, bn, gu, kn}, formatted response uses correct language template and contains numeric values from query result
    - Test file: `services/api/src/__tests__/properties/voice-query.property.test.ts` (append)
    - **Validates: Requirements 22.4, 22.6**

- [x] 13. Final checkpoint — Ensure all tests pass across all 7 features
  - Ensure all tests pass, ask the user if questions arise.
  - Verify all 22 requirements have corresponding implementation tasks
  - Verify all 28 correctness properties have corresponding property test sub-tasks

## Notes

- Tasks marked with `*` are optional property-based test sub-tasks and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check library with minimum 100 iterations per property
- Checkpoints ensure incremental validation between feature boundaries
- Features 1 + 4 can be developed in parallel by different developers
- Feature 3 depends on Feature 2.2 (message router) for omnichannel campaign dispatch
- Features 5, 6, 7 are independent and can be built in any order after core features are stable
