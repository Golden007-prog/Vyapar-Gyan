# VyaparGyan — Project Overview

## What is VyaparGyan?

VyaparGyan is an AI-powered multi-seller marketplace aggregator built for local Indian retailers. Sellers manage products and orders via a web dashboard while customers browse and purchase through omnichannel messaging (WhatsApp and web chat). The platform acts as an intelligent business manager — providing proactive AI insights for inventory optimization, dynamic pricing, and automated marketing campaigns.

**Live Demo:** https://golden007-prog.github.io/Vyapar-Gyan/

### Demo Accounts

| Role | Phone | Password |
|------|-------|----------|
| Seller (Dragon Store Owner) | +91 8927049085 | DemoSeller@123 |
| Customer (Enigma) | +91 7001124396 | DemoCustomer@123 |
| Admin (Platform) | 9000000001 | DemoAdmin@123 |

**WhatsApp Bot:** +1 (947) 234-9399

## Architecture

```
Frontend (Next.js 14, GitHub Pages)
    ↕ HTTPS
API Gateway HTTP API + WebSocket API (ap-south-1)
    ↕
Lambda Handlers (Node.js 20, ARM64, TypeScript)
    ↕
DynamoDB (single-table) | OpenSearch Serverless | S3 | Cognito | EventBridge | SQS
    ↕
External: Twilio (WhatsApp) | Razorpay (Payments) | Gemini (AI/OCR) | Grok (Market Research) | Bedrock (Orchestration)
```

## What Has Been Built

### Phase 1 — Platform Foundation

The core serverless infrastructure and application layer.

**Infrastructure (8 CDK Stacks):**
- DatabaseStack — DynamoDB single-table with GSI1, GSI2, streams, PITR, 24h TTL
- StorageStack — S3 buckets for product images, documents, Khata book uploads
- AuthStack — Cognito User Pool with customer/seller/admin groups, JWT auth
- EventsStack — EventBridge bus, SQS queues, worker Lambdas (media processing, campaigns, approvals, cart abandonment, payment reminders, session cleanup, health checks)
- APIStack — HTTP API Gateway with 30+ Lambda handlers, JWT authorizer, CORS
- WebSocketStack — WebSocket API Gateway with 4 Lambda handlers for real-time messaging
- BedrockStack — AI agent for dead-stock detection and discount campaign generation
- SearchStack — OpenSearch Serverless collection, OSIS zero-ETL pipeline, search Lambdas

**Backend Handlers (services/api):**
- Auth: login, register, token refresh, verification
- Seller: products CRUD, inventory management, orders, inbox, campaigns, approvals, insights, CSV/Khata upload
- Customer: catalog browsing, product detail, cart, checkout, orders, chat, account
- Admin: seller moderation, analytics, audit, system health, dispute resolution
- WhatsApp: webhook handler, worker (state machine), status webhook, voice pipeline
- Payments: Razorpay webhook with commission splitting
- AI: trend analyzer worker (Grok/Gemini), campaign worker (Bedrock), dead-stock agent
- Workers: media processing, campaign execution, approval execution, scheduled messages, cart abandonment, payment reminders, session cleanup, audit export

**Adapters:**
- DynamoDB adapter (single-table design with multi-seller partition strategy)
- S3 adapter (presigned URLs, media uploads)
- Twilio adapter (WhatsApp messaging, voice)
- Razorpay adapter (payments, commission splitting)
- Gemini adapter (OCR, voice transcription, TTS, image analysis, market research)
- Grok adapter (market trend analysis)
- Bedrock adapter (AI orchestration)
- OpenSearch adapter (full-text search, autocomplete)
- EventBridge adapter (domain events)

**Services:**
- Session service (WhatsApp conversation state machine)
- Cart service (add, update, remove, checkout)
- Order service (lifecycle management, commission splitting)
- Campaign service (create, schedule, execute WhatsApp discount campaigns)
- Approval service (seller approval workflows)
- Consent service (WhatsApp opt-in/opt-out)
- Migration service (data migration utilities)
- Template registry service (WhatsApp message templates)
- OTP service (phone verification)
- WhatsApp sender (message dispatch)

### Phase 2 — Omnichannel Commerce & Mobile-First UI

**WhatsApp Commerce:**
- Automated WhatsApp assistant via Twilio (greeting, browsing, ordering states)
- Voice note pipeline: download → transcribe (Gemini) → process → TTS response → send audio
- Status webhook for delivery tracking (sent/delivered/read/failed)
- Cross-channel message sync between web chat and WhatsApp

**Mobile-First UI (Next.js):**
- Responsive layouts with bottom navigation for mobile
- MobileProductCard and MobileOrderCard components
- Touch-optimized interactions, swipe gestures
- PWA support with service worker and offline page
- Customer pages: catalog, product detail, chat, cart, checkout, orders, account
- Seller pages: dashboard, inventory hub (with CSV upload and Khata OCR), orders, inbox, AI insights, campaigns, approvals
- Admin pages: dashboard, seller management, audit log, system health

### Phase 3 — OpenSearch Integration (Full-Text Search)

**Backend:**
- OpenSearch Serverless collection (SEARCH type) provisioned via CDK
- OSIS zero-ETL pipeline: DynamoDB Streams → OpenSearch (products + sellers indexes)
- S3 export bucket for PITR backfill and dead-letter records
- Search handler Lambda: multi_match queries with fuzzy matching, category/seller/price filters, pagination
- Autocomplete handler Lambda: prefix-based suggestions from product names
- OpenSearch adapter with AWS SigV4 signing for Serverless auth
- Search transforms with Zod schemas for query/response mapping

**Frontend:**
- SearchBar component with debounced input and autocomplete dropdown
- AutocompleteDropdown with keyboard navigation and click-outside dismiss
- CategoryFilters with horizontal scrollable pill chips
- SearchResults grid with product cards, pagination, loading skeletons
- Integrated into customer catalog page and seller inventory page
- Client-side fallback filtering when OpenSearch API is unavailable

**Property Tests (fast-check):**
- Search query transform round-trip
- Response mapping preserves all fields
- Autocomplete prefix matching
- Search handler pagination and filtering

### Phase 4 — Chat & Messaging Quality (Real-Time WebSocket)

**Backend:**
- WebSocket API Gateway (API Gateway v2) with 4 routes: $connect, $disconnect, $default, sendMessage
- Connect handler: JWT auth via Cognito GetUser, Connection Registry in DynamoDB (CONN#{connectionId}), presence tracking (PRESENCE#{userId})
- Disconnect handler: cleanup connection, update presence (online/offline with lastSeen)
- Default handler: heartbeat (TTL refresh + presence update), typing broadcast (excludes sender), markRead (dual-thread status update + push to sender), sync (missed messages since timestamp)
- SendMessage handler: Zod validation, dual-thread storage (THREAD#{senderId} + THREAD#{recipientId}), fan-out to all recipient connections, delivery status lifecycle (queued→sent→delivered→read→failed), GoneException handling, auto-reply for offline sellers
- Status webhook enhanced: pushes Twilio delivery status updates to sender's WebSocket connections in real-time
- Shared WebSocket schemas: MessageType enum (9 types), rich content schemas (text, product_card, order_status, ai_suggestion, quick_reply), action schemas, Connection Registry and Presence record types

**Frontend:**
- WebSocketClient class: connect/disconnect/send/onMessage/onStateChange, heartbeat (30s), exponential backoff reconnection (1s→2s→4s→8s→16s→30s cap), 5-failure disconnect, 60s heartbeat ack timeout, sync on reconnect
- useWebSocket React hook: connectionState, sendMessage, sendTyping (3s debounce), markRead, messages (deduplicated), typingUsers (5s auto-hide), presenceMap, polling fallback coexistence (suppress when connected, activate when disconnected)
- MessageStatus component: clock (queued), single check (sent), double gray checks (delivered), double blue checks (read), red alert (failed) with retry button
- ProductCard: product image, name, ₹-formatted price, description, "Add to cart" button
- OrderStatusCard: order number, color-coded status badge, item summary, total, relative time
- AISuggestionCard: title, body, Approve/Dismiss action buttons
- QuickReplyButtons: prompt text with horizontally scrollable pill buttons
- Enhanced TypingIndicator: multi-user support with animated dots and participant names
- MessageList: rich message rendering by messageType, IntersectionObserver for markRead, MessageStatus integration
- Customer chat page: WebSocket connection, seller presence indicator (green dot/last seen), typing, markRead
- Seller inbox page: WebSocket connection, customer presence, typing indicators, real-time messages

**Property Tests (17 correctness properties, fast-check):**
1. Connection Registry round-trip (connect then disconnect leaves no item)
2. Connection Registry item structure (PK/SK/GSI patterns, 24h TTL)
3. Invalid JWT rejection (401, no DynamoDB write)
4. Message dual-thread storage (both THREAD#{senderId} and THREAD#{recipientId})
5. Message fan-out to all user connections (exactly N pushes for N connections)
6. Delivery status transition (sent→delivered on successful push)
7. Exponential backoff calculation (min(2^(N-1)*1000, 30000))
8. Heartbeat TTL refresh (expiresAt = floor(T/1000) + 86400)
9. Twilio status mapping (sent→sent, delivered→delivered, read→read, failed→failed, undelivered→failed)
10. Rich message content serialization round-trip (JSON serialize/deserialize equality)
11. Message type and content schema validation (valid passes, invalid fails)
12. Typing debounce (at most 1 event per 3-second window)
13. Typing broadcast excludes sender (push to B's connections, zero to A's)
14. Seller presence determination (online iff connection + heartbeat within 60s)
15. Auto-reply to offline seller (system message with response time estimate)
16. Message deduplication (unique messageIds, correct count, first-occurrence order)
17. Reconnection sync timestamp (max timestamp used for sync action)

**Integration Tests:**
- connect → send → receive → markRead → status update (full lifecycle)
- Twilio status webhook → DynamoDB update → WebSocket push
- sync action → missed messages returned after reconnection

### Phase 5 — Omnichannel Intelligence & Platform Expansion

Seven features that extend VyaparGyan into a fully omnichannel, AI-driven commerce platform.

**Feature 1: Role-Based Smart WhatsApp Routing**
- Phone normalization utility (strips +91, 91, 0 prefixes, validates 10-digit Indian mobile)
- Role resolver via GSI1 phone lookup — routes seller → Seller Copilot, customer → Customer Discovery, unregistered → Onboarding
- Seller Copilot: home menu, natural language stock check (Gemini), trend alert scheduling (EventBridge Scheduler), campaign approval via WhatsApp
- Customer Discovery: favorites, pincode/city store search, global OpenSearch fuzzy search, store selection → browsing state
- Onboarding flow: welcome message with registration link, 24h TTL session, reminder throttling

**Feature 2: Real-Time Omnichannel Chat Synchronization**
- Unified message storage with `channel` field (whatsapp/web/system) on all message records
- EventBridge fan-out Lambda: `message.created` event → push to all active channels except originator
- Message router service: store → publish → async fan-out (deduplication via messageId)
- Gemini intent extraction: product intent, store intent, language detection (8 Indian languages) → contextual routing
- Human handoff protocol: seller reply from web → `isHumanHandoff=true`, 30-min auto-reset, `/ai` command to re-enable

**Feature 3: AI-Powered Inventory & Campaign Operations**
- WhatsApp inventory upload: CSV/Excel → Smart CSV mapping, image (JPG/PNG/WebP) → Khata OCR, confirmation/edit flow
- File type detection from Twilio media webhook metadata
- Omnichannel campaign dispatch: Web Chat, WhatsApp, or Both — per-customer per-channel delivery tracking
- Enhanced AI Insight cards: severity badge, AI source label, confidence %, financial impact, dismiss/undo within 24h

**Feature 4: Admin Dashboard Expansion (5 new pages)**
- `/admin/customers` — Customer directory with LTV, cross-pollination metrics, order/chat history
- `/admin/disputes` — Dispute resolution hub with order context, chat transcripts, refund/replace/dismiss/escalate actions, auto-flagging
- `/admin/financials` — Commission tracking, Razorpay Route transactions, failed payout retry, CSV export, trend charts
- `/admin/campaigns` — Platform-wide campaign oversight with per-customer delivery logs, flag/block actions
- `/admin/catalog` — Global category manager with aliases (multilingual), merge with impact preview, soft deactivation
- Updated admin sidebar navigation (10 items) with mobile bottom nav

**Feature 5: UPI Intent Integration**
- Razorpay Payment Link generation for WhatsApp checkout (30-min expiry, UPI enabled)
- Payment link message with order summary (items, quantities, ₹ total)
- `payment_link.paid` webhook handler: confirm order, deduct inventory, notify customer + seller
- Expiry handling: EventBridge Scheduler → new link + reminder
- Payment failure: notify customer with reason + offer new link

**Feature 6: Automated Abandoned Cart Nudges**
- EventBridge Scheduler one-time rules: 2h inactivity → first nudge, 24h → second nudge with incentive
- Channel selection: WhatsApp if active session, Web Chat otherwise
- Timer management: create/reset on cart add, cancel on checkout
- Nudge effectiveness tracking: sent timestamp, cart recovered status, channel used

**Feature 7: Voice-Activated Financial Reports**
- Financial query intent extraction via Gemini (daily_sales, weekly_revenue, monthly_revenue, best_sellers, pending_orders, stock_summary)
- DynamoDB query execution mapped to each intent type
- Multilingual response formatting: 8 Indian languages (Hindi, English, Tamil, Telugu, Marathi, Bengali, Gujarati, Kannada)
- Voice-in voice-out: transcribe → extract intent → query → format → TTS → send audio reply
- Target: end-to-end response within 8 seconds

**Property Tests (28 correctness properties, fast-check):**
- Phone normalization, role routing, registration link, onboarding TTL
- Stock check fields, campaign formatting, campaign command parsing
- Location classification, store selection state transition
- Message thread ordering, message deduplication, fan-out routing
- Store intent routing, intent extraction schema conformance
- Human handoff AI bypass
- File type detection, inventory formatting, inventory edit parsing
- Campaign "both" channel dispatch
- Category rename propagation, merge preview counts, alias resolution, deactivation exclusion
- Payment message formatting
- Cart nudge message content, nudge channel selection
- Financial query intent mapping, financial response language formatting

### Phase 6 — Omnichannel Pipeline Bugfix (7 Interconnected Fixes)

Systematic fix of 7 interconnected bugs that broke the end-to-end omnichannel message flow between customers (WhatsApp and web chat) and sellers (web Inbox). Used property-based testing with bug condition methodology to surface, verify, and preserve behavior.

**Bug Fixes:**
1. Frontend demo mode disabled in production (`NEXT_PUBLIC_DEMO_MODE=false`) — web chat messages now always POST to backend API
2. `chat-send-handler.ts` now publishes both `CustomerMessageSent` and `message.created` EventBridge events — fan-out Lambda receives web-originated messages
3. WhatsApp greeting detection added to `customer-discovery.ts` — "Hello", "Hi", "Namaste" etc. show Store Discovery menu instead of triggering store search
4. DynamoDB scan fallback for store name search — when GSI city search and OpenSearch return empty, scans seller profiles by `storeName`/`businessName`
5. `EVENT_BUS_NAME` validation in WhatsApp worker and chat-send-handler — structured error logging when empty, publish skipped gracefully
6. `getUserByPhone()` fixed with `begins_with(GSI1SK, 'USER#')` query filter and `Limit: 1` — SESSION records never returned
7. `WEBSOCKET_API_ENDPOINT` sentinel value (`PENDING_WEBSOCKET_STACK`) in events-stack CDK + error-level logging in fan-out Lambda

**Property-Based Tests (15 tests, fast-check):**
- 6 bug condition exploration tests (confirm bugs exist on unfixed code, verify fixes work)
- 9 preservation property tests (confirm no regressions after fixes)
  - Direct intent bypass, numeric reply routing, pincode classification
  - State-based handler routing, message storage independence, seller routing

## Test Coverage

| Area | Suites | Tests |
|------|--------|-------|
| Backend (services/api) | 65 | 809 |
| Frontend (apps/web) | 11 | 72 |
| **Total** | **76** | **881** |

## Deployment

**Frontend:** Static export via Next.js → GitHub Pages (auto-deploy on push to main)
- URL: https://golden007-prog.github.io/Vyapar-Gyan/
- CI: `.github/workflows/deploy-gh-pages.yml`

**Backend:** AWS CDK (8 stacks) → CloudFormation → ap-south-1
- Account: 856888988795
- Region: ap-south-1
- Deploy: `cd infra/cdk && npx cdk deploy --all --context env=dev --context account=856888988795 --context region=ap-south-1`

**MCP Servers:** 3 local servers for developer/operator tooling
- commerce-ops: orders, payments, inventory, WhatsApp sessions, CloudWatch logs
- commerce-catalog: products, categories, stock levels, media
- commerce-admin: seller approvals, disputes, audit logs, analytics

## Repository Structure

```
├── infra/cdk/           # 8 CDK stacks (database, storage, auth, events, api, websocket, bedrock, search)
├── services/api/        # Lambda handlers, adapters, services, repositories, shared schemas
├── apps/web/            # Next.js frontend (customer, seller, admin dashboards)
├── packages/shared-contracts/  # Shared TypeScript types
├── tools/mcp/           # 3 MCP servers for platform data access
├── scripts/             # Seed data, demo data
├── docs/                # Architecture docs, API contracts, deployment guides
└── .kiro/specs/         # Feature specifications (requirements, design, tasks)
```

## Tech Stack

- TypeScript everywhere (backend, frontend, infrastructure, MCP servers)
- AWS Lambda (Node.js 20, ARM64) + API Gateway (HTTP + WebSocket)
- DynamoDB (single-table) + OpenSearch Serverless + S3
- Cognito (auth) + EventBridge + SQS (async)
- Next.js 14 + Tailwind CSS (frontend)
- Twilio (WhatsApp) + Razorpay (payments) + Gemini + Grok + Bedrock (AI)
- CDK (IaC) + Jest + fast-check (testing) + GitHub Actions (CI/CD)
