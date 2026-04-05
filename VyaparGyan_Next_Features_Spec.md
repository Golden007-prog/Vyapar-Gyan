# VyaparGyan — Next Features Kiro Spec

> Covers: Role-Based WhatsApp Routing, Omnichannel Chat Sync, AI Inventory & Campaigns, Admin Dashboard Expansion, and Future Roadmap (UPI, Abandoned Cart, Voice Reports).

---

# Table of Contents

1. [Feature 1: Role-Based Smart WhatsApp Routing](#feature-1-role-based-smart-whatsapp-routing)
2. [Feature 2: Real-Time Omnichannel Chat Synchronization](#feature-2-real-time-omnichannel-chat-synchronization)
3. [Feature 3: AI-Powered Inventory & Campaign Operations](#feature-3-ai-powered-inventory--campaign-operations)
4. [Feature 4: Admin Dashboard Expansion](#feature-4-admin-dashboard-expansion)
5. [Feature 5: UPI Intent Integration](#feature-5-upi-intent-integration)
6. [Feature 6: Automated Abandoned Cart Nudges](#feature-6-automated-abandoned-cart-nudges)
7. [Feature 7: Voice-Activated Financial Reports](#feature-7-voice-activated-financial-reports)

---

# Feature 1: Role-Based Smart WhatsApp Routing

## Design Spec

### Context

The VyaparGyan WhatsApp bot (Twilio + Gemini 2.0) currently handles basic greeting and browsing flows. This feature upgrades the bot to dynamically adapt its interface based on the user's role in DynamoDB — providing completely different experiences for unregistered users, sellers, and customers.

### Current State

- WhatsApp webhook handler exists (`services/api/src/handlers/whatsapp/`)
- Session service manages conversation state machine (greeting → browsing → ordering)
- Twilio adapter handles message send/receive
- Cognito groups define roles (admin/seller/customer)
- DynamoDB stores user profiles with role information

### Architecture

```
Incoming WhatsApp Message (Twilio Webhook)
    │
    ▼
Lambda: whatsappWebhook
    │
    ├─ Lookup phone in DynamoDB ──→ Not found ──→ Onboarding Flow
    │                                              (prompt to register via web app)
    │
    ├─ Role = SELLER ──→ Seller Copilot Flow
    │                     ├─ Stock updates ("how much Amul Butter left?")
    │                     ├─ Grok trend alert config (30m/1h/8h/24h intervals)
    │                     ├─ Campaign approval ("approve campaign #12")
    │                     └─ Quick inventory actions
    │
    └─ Role = CUSTOMER ──→ Customer Discovery Flow
                           ├─ Favorite stores list
                           ├─ Pincode/City store search
                           ├─ Global shop search
                           └─ Catalog browsing within selected store
```

### Design Decisions

**1. Role Detection Strategy**

Lookup by phone number via GSI (GSI1PK = `PHONE#{normalized_phone}`, GSI1SK = `PROFILE`). Returns the user's Cognito group membership. Phone normalization: strip +91, strip spaces, ensure 10-digit format for Indian numbers. International numbers stored with country code.

**2. Session State Machine Extension**

Current states: `GREETING → BROWSING → PRODUCT_DETAIL → CART → CHECKOUT`

New states per role:

```
UNREGISTERED:
  ONBOARDING_GREETING → ONBOARDING_PROMPT → (exits to web registration)

SELLER:
  SELLER_HOME → STOCK_CHECK → (returns to SELLER_HOME)
  SELLER_HOME → TREND_CONFIG → TREND_INTERVAL_SELECT → (returns to SELLER_HOME)
  SELLER_HOME → CAMPAIGN_REVIEW → CAMPAIGN_APPROVE → (returns to SELLER_HOME)
  SELLER_HOME → INVENTORY_ACTION → (returns to SELLER_HOME)

CUSTOMER:
  CUSTOMER_HOME → STORE_SELECT → (existing BROWSING flow with store context)
  CUSTOMER_HOME → STORE_SEARCH_PINCODE → STORE_RESULTS → STORE_SELECT
  CUSTOMER_HOME → STORE_SEARCH_GLOBAL → STORE_RESULTS → STORE_SELECT
  CUSTOMER_HOME → FAVORITES → STORE_SELECT
```

**3. Seller Copilot — Grok Trend Alerts**

Sellers can configure automated market trend alerts at intervals: 30 minutes, 1 hour, 8 hours, or 24 hours. Implementation uses EventBridge Scheduler (one-time or recurring) per seller, triggering the existing trend analyzer worker. Alert results are sent back to the seller's WhatsApp via Twilio.

**4. Customer Store Discovery**

Three discovery paths:
- **Favorites**: Stored in DynamoDB as `CUSTOMER#{id}` / `FAVORITE#{sellerId}` records
- **Pincode/City search**: Query sellers by location (GSI on `city` or `pincode` attribute)
- **Global search**: OpenSearch full-text search on seller store names

---

## Engineering Tasks

### Task 1.1: Phone number lookup and role detection

**Requirements:**
- New utility: `resolveUserByPhone(phone: string)` → returns `{ userId, role, profile } | null`
- Query GSI1 with normalized phone number
- Handle international format (+91), local format (0-prefix), and raw 10-digit
- Cache result in session record to avoid repeated lookups

**Acceptance Criteria:**
- [ ] Indian numbers normalized correctly: +917001124396 → 7001124396
- [ ] GSI1 query returns user profile with role
- [ ] Unknown numbers return null (triggers onboarding)
- [ ] Result cached in WhatsApp session DynamoDB record

**Files to Create/Modify:**
- `services/api/src/utils/phone-normalize.ts` (new)
- `services/api/src/services/user-lookup.ts` (new)
- `services/api/src/handlers/whatsapp/webhook.ts` (modify — add role routing)

---

### Task 1.2: Onboarding flow for unregistered users

**Requirements:**
- When phone number not found in DynamoDB, send friendly onboarding message
- Message includes: welcome text, brief platform description, registration link (deep link to `/register` page)
- If user sends another message without registering, gently remind them
- Store onboarding session state with 24h TTL to avoid spamming

**Acceptance Criteria:**
- [ ] Unregistered number receives onboarding message with registration link
- [ ] Subsequent messages get a gentle reminder (not the full onboarding again)
- [ ] Session expires after 24h, next message re-triggers onboarding
- [ ] Registration link includes `?ref=whatsapp&phone={phone}` for pre-fill

**WhatsApp Message Template:**
```
🙏 Namaste! Welcome to VyaparGyan.

I'm your AI-powered marketplace assistant. To get started, please create your account:

👉 {registration_link}

You can register as a Customer (browse & shop) or Seller (manage your store).

Once registered, come back here and I'll help you right away!
```

---

### Task 1.3: Seller Copilot — home menu and stock check

**Requirements:**
- When role = SELLER, show Seller Copilot home menu with options:
  1. Check stock (type product name)
  2. Configure trend alerts
  3. Review pending campaigns
  4. Quick inventory summary
- Stock check: Gemini extracts product intent from seller's message, queries DynamoDB for matching products, returns stock quantity + last restock date
- Natural language queries: "how much Amul Butter left?", "check stock for USB cables"

**Acceptance Criteria:**
- [ ] Seller sees copilot menu on first message
- [ ] "Check stock" queries return matching products with quantity
- [ ] Gemini handles natural language product queries
- [ ] Returns "No matching products" for invalid queries
- [ ] Seller can type "menu" or "home" to return to copilot home

**Files to Create/Modify:**
- `services/api/src/handlers/whatsapp/seller-copilot.ts` (new)
- `services/api/src/handlers/whatsapp/worker.ts` (modify — add seller state handling)

---

### Task 1.4: Seller Copilot — Grok trend alert configuration

**Requirements:**
- Seller types "trends" or "alerts" to enter trend config
- Bot presents interval options: 30m, 1h, 8h, 24h
- On selection, create/update an EventBridge Scheduler rule for this seller
- Scheduler triggers trend analyzer worker Lambda at selected interval
- Worker uses Grok + Gemini to analyze market trends for seller's product categories
- Results sent back to seller's WhatsApp as a formatted summary
- Seller can type "stop alerts" to disable

**Acceptance Criteria:**
- [ ] Seller can select trend alert interval
- [ ] EventBridge Scheduler rule created with correct cron/rate
- [ ] Trend analysis runs at configured interval
- [ ] Results delivered to seller's WhatsApp via Twilio
- [ ] "Stop alerts" disables the scheduler rule
- [ ] Seller's current alert config stored in DynamoDB (SELLER#{id} / TREND_CONFIG)

**Files to Create/Modify:**
- `services/api/src/services/trend-scheduler.ts` (new)
- `services/api/src/handlers/whatsapp/seller-copilot.ts` (modify)
- `infra/cdk/lib/stacks/events-stack.ts` (modify — add scheduler permissions)

---

### Task 1.5: Seller Copilot — campaign approval via WhatsApp

**Requirements:**
- When pending campaigns exist, show list in WhatsApp: campaign name, affected products, suggested discount, expected revenue impact
- Seller replies with campaign number to approve ("1" or "approve 1")
- Approval triggers existing campaign execution flow via EventBridge
- Seller can reply "dismiss 2" to reject a campaign
- After approval, send confirmation with campaign summary

**Acceptance Criteria:**
- [ ] Pending campaigns listed with numbers
- [ ] Approval triggers campaign.approved event on EventBridge
- [ ] Dismissal updates campaign status to rejected
- [ ] Confirmation message sent after approval
- [ ] No pending campaigns shows "All caught up!" message

---

### Task 1.6: Customer Discovery — favorites, pincode, and global search

**Requirements:**
- Customer home menu:
  1. My favorite stores
  2. Search stores by pincode/city
  3. Search all stores
  4. Browse [last visited store]
- **Favorites**: Query `CUSTOMER#{id} / FAVORITE#*` from DynamoDB, list store names
- **Pincode/City**: Accept 6-digit pincode or city name, query sellers GSI by location
- **Global search**: Forward query to OpenSearch sellers index
- After store selection, transition to existing BROWSING state with `sellerId` context

**Acceptance Criteria:**
- [ ] Customer sees discovery menu on first message
- [ ] Favorites list shows saved stores
- [ ] Pincode search returns nearby sellers (or "no stores found")
- [ ] City name search works (case-insensitive)
- [ ] Global search uses OpenSearch fuzzy matching
- [ ] Store selection transitions to browsing flow for that store
- [ ] "Add to favorites" option available after store selection

**Files to Create/Modify:**
- `services/api/src/handlers/whatsapp/customer-discovery.ts` (new)
- `services/api/src/repositories/favorites.ts` (new)
- `services/api/src/handlers/whatsapp/worker.ts` (modify — add customer routing)

---

# Feature 2: Real-Time Omnichannel Chat Synchronization

## Design Spec

### Context

Currently, WhatsApp messages and web chat messages exist as separate channels. This feature creates true bi-directional synchronization — every message on WhatsApp appears in the web dashboard, and seller replies from the web dashboard are delivered to WhatsApp.

### Architecture

```
Customer (WhatsApp)                    Customer (Web Chat)
      │                                      │
      ▼                                      ▼
Twilio Webhook ──→ Lambda ──→ DynamoDB ←── WebSocket API
      │                          │                │
      │                          ▼                │
      │                   EventBridge             │
      │                   "message.created"       │
      │                          │                │
      │                          ▼                │
      │                  Fan-out Lambda           │
      │                   ├─ Push to WebSocket (web dashboard)
      │                   └─ Push to Twilio (WhatsApp)
      │                                           │
      ▼                                           ▼
Seller Inbox (Web) ◄──────── WebSocket ────────► Reply
      │                                           │
      └─ Seller types reply ──→ Lambda ──→ Twilio (customer's WhatsApp)
                                       └──→ DynamoDB (dual-thread write)
                                       └──→ WebSocket (customer's web chat)
```

### Design Decisions

**1. Unified Message Storage**

All messages — regardless of channel — stored in the same DynamoDB thread structure:
```
PK: THREAD#{userId}
SK: MSG#{timestamp}#{messageId}
Attributes: content, senderType, channel (whatsapp|web|system), metadata
```

Channel field tracks origin. Both web and WhatsApp UI render the same thread.

**2. Intent Extraction and Contextual Routing**

When a customer mentions a specific product or store (e.g., "I want 2 packets of Maggi from Dragon Store"), Gemini extracts:
- **Product intent**: product name, quantity
- **Store intent**: seller name/store name

The session is then routed to the matched seller's context, and the conversation appears in that seller's Inbox.

**3. Human Handoff Protocol**

When a seller types a reply in the web Inbox:
1. Session `isHumanHandoff` flag is set to `true`
2. AI bot stops auto-responding for this session
3. All subsequent customer messages route directly to seller's inbox (no AI processing)
4. Seller can type `/ai` to re-enable AI responses
5. Handoff flag resets after 30 minutes of seller inactivity

---

## Engineering Tasks

### Task 2.1: Unified message storage with channel tracking

**Requirements:**
- Add `channel` field to all message records: `whatsapp` | `web` | `system`
- WhatsApp webhook writes messages with channel = `whatsapp`
- WebSocket sendMessage writes with channel = `web`
- System-generated messages (AI responses, auto-replies) use channel = `system`
- Both web chat and WhatsApp UI render all messages from the same thread

**Acceptance Criteria:**
- [ ] WhatsApp messages appear in seller's web Inbox in real-time
- [ ] Web chat messages include channel indicator (WhatsApp icon or Web icon)
- [ ] Existing message queries return all channels
- [ ] No duplicate messages when same user is on both channels

**Files to Modify:**
- `services/api/src/handlers/whatsapp/worker.ts` (add channel field)
- `services/api/src/handlers/websocket/sendMessage.ts` (add channel field)
- `services/api/src/shared/schemas/websocket-schemas.ts` (add channel to MessageType)
- `apps/web/src/components/chat/MessageList.tsx` (render channel indicator)

---

### Task 2.2: Bi-directional message push (WhatsApp ↔ Web)

**Requirements:**
- When customer sends WhatsApp message: store in DynamoDB → push to seller's WebSocket connections
- When seller replies from web Inbox: store in DynamoDB → send to customer's WhatsApp via Twilio → push to customer's WebSocket connections
- Use EventBridge `message.created` event to trigger fan-out Lambda
- Fan-out Lambda checks recipient's active channels and pushes accordingly

**Acceptance Criteria:**
- [ ] Customer WhatsApp message appears in seller web Inbox within 1s
- [ ] Seller web reply delivered to customer's WhatsApp within 2s
- [ ] Seller web reply also visible in customer's web chat (if online)
- [ ] Message delivery status synced across channels

**Files to Create/Modify:**
- `services/api/src/handlers/messaging/fanout.ts` (new)
- `services/api/src/services/message-router.ts` (new)
- `infra/cdk/lib/stacks/events-stack.ts` (add message.created rule)

---

### Task 2.3: Gemini intent extraction for contextual routing

**Requirements:**
- When customer sends a message, run through Gemini intent extraction:
  - Product intent: extract product name, quantity, action (search/buy/check price)
  - Store intent: extract seller/store name
- If store intent detected, route session to that seller's catalog context
- If product intent detected without store context, search across all sellers via OpenSearch
- Store extraction results in session record for conversation continuity

**Acceptance Criteria:**
- [ ] "I want 2 packets of Maggi from Dragon Store" extracts: product=Maggi, qty=2, store=Dragon Store
- [ ] Session routes to Dragon Store seller context
- [ ] Conversation appears in Dragon Store seller's Inbox
- [ ] "check stocks for tata salt" without store context searches all sellers
- [ ] Intent extraction works in Hindi and English

**Files to Create/Modify:**
- `services/api/src/services/intent-extraction.ts` (new)
- `services/api/src/handlers/whatsapp/worker.ts` (integrate intent extraction)

**Gemini Prompt Template:**
```
Extract shopping intent from this customer message. Return JSON:
{
  "product": { "name": string|null, "quantity": number|null, "action": "search"|"buy"|"check_price"|null },
  "store": { "name": string|null },
  "language": "en"|"hi"|"ta"|"te"|"mr"|"bn"|"gu"|"kn"
}
Message: "{customer_message}"
```

---

### Task 2.4: Human handoff protocol

**Requirements:**
- When seller sends first reply from web Inbox, set `isHumanHandoff: true` on the session
- While handoff active, WhatsApp webhook skips AI processing and pipes messages directly to seller's Inbox
- Seller can type `/ai` in web Inbox to re-enable AI responses
- Auto-reset handoff after 30 minutes of seller inactivity (use DynamoDB TTL or Lambda check)
- Show "AI mode" / "Human mode" indicator in seller Inbox header

**Acceptance Criteria:**
- [ ] Seller typing reply activates human handoff
- [ ] Customer messages during handoff skip AI and go directly to seller
- [ ] `/ai` command re-enables AI responses
- [ ] Handoff auto-resets after 30 min seller inactivity
- [ ] Mode indicator visible in seller Inbox

**Files to Create/Modify:**
- `services/api/src/services/session-service.ts` (add handoff logic)
- `services/api/src/handlers/whatsapp/worker.ts` (check handoff before AI)
- `apps/web/src/components/inbox/HandoffIndicator.tsx` (new)

---

# Feature 3: AI-Powered Inventory & Campaign Operations

## Design Spec

### Context

Sellers currently upload inventory via the web dashboard (CSV Upload + Khata Book OCR). This feature extends these capabilities to WhatsApp — sellers can send CSV files, Excel files, or Khata book photos directly in chat. Additionally, the AI Insights system is enhanced with omnichannel campaign deployment (Web Chat + WhatsApp simultaneously).

### Current State (from screenshots)

- AI Insights page shows: Dead Stock Alert, Price Optimization, Restock Alert, Holi Season Demand Forecast
- Campaign notification modal allows channel selection: Web Chat, WhatsApp, or Both
- Customer targeting with order history visible
- Inventory Hub has Khata Book OCR and Smart CSV Upload

---

## Engineering Tasks

### Task 3.1: WhatsApp inventory upload (CSV/Excel/Khata photo)

**Requirements:**
- Detect file attachments in WhatsApp messages (Twilio media webhook)
- For CSV/Excel: download via Twilio media URL → run through existing Smart CSV mapping Lambda
- For images (JPG/PNG/WebP): run through existing Khata Book OCR Lambda (Gemini Vision)
- Return extraction results as WhatsApp message with item list
- Seller confirms: "looks good" → items added to inventory
- Seller can edit: "change item 3 price to 250" → update before commit

**Acceptance Criteria:**
- [ ] CSV file sent via WhatsApp triggers Smart CSV mapping
- [ ] Image sent via WhatsApp triggers Khata Book OCR
- [ ] Extracted items listed in WhatsApp message with numbering
- [ ] Seller confirmation commits to DynamoDB
- [ ] Seller can request edits before committing
- [ ] Progress messages sent during processing ("Processing your file...")
- [ ] Errors reported clearly ("Row 5: missing price")

**Files to Create/Modify:**
- `services/api/src/handlers/whatsapp/inventory-upload.ts` (new)
- `services/api/src/handlers/whatsapp/worker.ts` (add media detection routing)

---

### Task 3.2: Omnichannel campaign deployment

**Requirements:**
- When seller approves a campaign from AI Insights (or WhatsApp copilot), they choose notification channel: Web Chat, WhatsApp, or Both
- Campaign execution Lambda dispatches to selected channels:
  - **Web Chat**: Create system message in customer's thread, push via WebSocket
  - **WhatsApp**: Send via Twilio with discount details
  - **Both**: Execute both paths
- Track delivery per channel per customer
- Campaign report shows: sent (web), sent (WhatsApp), delivered, read, converted (ordered)

**Acceptance Criteria:**
- [ ] Campaign modal shows Web Chat / WhatsApp / Both buttons (already in UI)
- [ ] Web Chat delivery creates message in customer thread
- [ ] WhatsApp delivery sends via Twilio
- [ ] "Both" executes both channels
- [ ] Per-customer delivery status tracked by channel
- [ ] Campaign report on Campaigns page shows channel breakdown

**Files to Create/Modify:**
- `services/api/src/handlers/campaigns/execute.ts` (modify — add channel routing)
- `services/api/src/services/campaign-service.ts` (add multi-channel dispatch)
- `apps/web/src/app/(dashboard)/seller/campaigns/page.tsx` (add channel report columns)

---

### Task 3.3: Enhanced AI Insights with actionable cards

**Requirements:**
- Each AI Insight card includes:
  - Severity badge: HIGH (red), MEDIUM (amber), LOW (blue)
  - AI source: which model generated it (GROK, GEMINI, BEDROCK)
  - Confidence percentage
  - Expected financial impact (₹ formatted)
  - Affected product count
  - Market research summary (1–2 lines)
- "Approve & Send" button opens campaign notification modal
- "Dismiss" moves to dismissed list (undo available for 24h)
- "Refresh" re-runs AI analysis for all active products

**Acceptance Criteria:**
- [ ] All insight types rendered with severity, source, confidence, impact
- [ ] Approve triggers campaign creation flow
- [ ] Dismiss moves insight to dismissed list
- [ ] Refresh re-triggers trend analyzer and dead-stock agent
- [ ] Dismissed insights recoverable within 24h

**Note:** From the screenshots, this appears largely built already. This task covers any remaining polish and the dismissed insights recovery.

---

# Feature 4: Admin Dashboard Expansion

## Design Spec

### Context

The Admin panel currently has: Platform Overview (GMV, sellers, customers, AI insights), Seller Management (approve/reject/suspend), Audit Log, System Health Monitor, and Settings. This expansion adds customer analytics, dispute resolution, financial tracking, AI campaign oversight, and a global catalog manager.

### Current State (from screenshots)

- Platform Overview: ₹84.5L GMV, 342 sellers, 12,847 customers, 1,523 AI insights
- Seller Management: 9 sellers with Active/Pending/Suspended statuses, Approve/Reject actions
- System Health: 6 external services monitored (Twilio, Gemini, Grok, Bedrock, Razorpay, DynamoDB)
- Audit Log: Filter by Actor ID, Resource Type, Action Type, Date Range

---

## Engineering Tasks

### Task 4.1: Customer Directory & Analytics page

**Requirements:**
- New admin page: `/admin/customers`
- Customer list with columns: Name, Phone, Registered Date, Total Orders, LTV (lifetime value), Stores Visited, Last Active
- Search and filter: by name, phone, date range, LTV range
- Customer detail view: order history, chat history, favorite stores, channel preference (web/WhatsApp/both)
- Cross-pollination metric: how many different sellers each customer has ordered from
- Summary cards: Total Customers, New This Month, Avg LTV, Avg Orders/Customer

**Acceptance Criteria:**
- [ ] Customer list page renders with all columns
- [ ] Search by name/phone works
- [ ] Filter by date range and LTV range works
- [ ] Customer detail shows order and chat history
- [ ] Cross-pollination metric calculated correctly
- [ ] Summary cards at top of page

**Files to Create:**
- `services/api/src/handlers/admin/customers.ts` (new — list, detail)
- `apps/web/src/app/(dashboard)/admin/customers/page.tsx` (new)
- `apps/web/src/app/(dashboard)/admin/customers/[id]/page.tsx` (new)
- `apps/web/src/components/admin/CustomerTable.tsx` (new)
- `apps/web/src/components/admin/CustomerDetail.tsx` (new)

**Lambda Handler:**
```typescript
// GET /admin/customers?search=&page=&size=&sort=&ltv_min=&ltv_max=
// Queries DynamoDB GSI for CUSTOMER# records
// Aggregates order data for LTV calculation
// Returns paginated list with computed metrics
```

---

### Task 4.2: Dispute Resolution & Support Hub

**Requirements:**
- New admin page: `/admin/disputes`
- List of flagged orders/disputes with: Order ID, Customer, Seller, Issue Type, Status, Created Date
- Issue types: Wrong Item, Not Delivered, Quality Issue, Refund Request, Payment Failed
- Dispute detail view:
  - Order details (items, amount, payment status)
  - Chat transcript between customer and seller (read-only)
  - Uploaded images/evidence
  - Resolution actions: Refund (full/partial), Replace, Dismiss, Escalate
  - Admin notes field
  - Resolution history timeline
- Auto-flag rules: orders with negative customer feedback, payment failures, delivery delays >48h

**Acceptance Criteria:**
- [ ] Dispute list page with filtering by status and issue type
- [ ] Dispute detail shows complete context (order + chat + evidence)
- [ ] Admin can take resolution actions (refund, replace, dismiss)
- [ ] Resolution triggers appropriate actions (Razorpay refund, notification to customer/seller)
- [ ] Admin notes saved and visible in audit log

**Files to Create:**
- `services/api/src/handlers/admin/disputes.ts` (new — list, detail, resolve)
- `apps/web/src/app/(dashboard)/admin/disputes/page.tsx` (new)
- `apps/web/src/app/(dashboard)/admin/disputes/[id]/page.tsx` (new)
- `apps/web/src/components/admin/DisputeDetail.tsx` (new)
- `apps/web/src/components/admin/ResolutionActions.tsx` (new)

---

### Task 4.3: Financials & Commission Tracking

**Requirements:**
- New admin page: `/admin/financials`
- Summary cards: Total Platform Revenue, Total Commission Earned, Pending Settlements, Failed Payouts
- Razorpay Route transactions table: Date, Order ID, Seller, Order Amount, Commission (%), Commission Amount, Transfer Status
- Transfer statuses: Completed, Pending, Failed, Reversed
- Failed payout retry: admin can trigger Razorpay transfer retry for failed payouts
- Date range filter and CSV export
- Charts: daily commission trend (line chart), commission by seller (bar chart)

**Acceptance Criteria:**
- [ ] Financials page shows all summary cards
- [ ] Transactions table with all Razorpay Route movements
- [ ] Filter by date range, seller, status works
- [ ] Failed payout retry triggers Razorpay transfer API
- [ ] CSV export downloads filtered data
- [ ] Commission trend chart renders with date range

**Files to Create:**
- `services/api/src/handlers/admin/financials.ts` (new — summary, transactions, retry, export)
- `apps/web/src/app/(dashboard)/admin/financials/page.tsx` (new)
- `apps/web/src/components/admin/CommissionChart.tsx` (new)
- `apps/web/src/components/admin/TransactionsTable.tsx` (new)

---

### Task 4.4: AI Campaign Oversight

**Requirements:**
- New admin page: `/admin/campaigns`
- All campaigns across all sellers with: Campaign Name, Seller, Channel, Status, Sent Count, Open Rate, Conversion Rate, Revenue Impact
- Campaign detail: per-customer delivery log (sent time, delivered, read, ordered)
- Aggregate metrics: Total Campaigns (30d), Avg Open Rate, Avg Conversion Rate, Total Revenue from Campaigns
- Filter by seller, channel, date range, status
- Flag/block campaigns that have low performance or high complaint rate

**Acceptance Criteria:**
- [ ] Campaign list shows all sellers' campaigns
- [ ] Per-campaign detail with customer-level delivery stats
- [ ] Aggregate metrics at top of page
- [ ] Filters work correctly
- [ ] Admin can flag/block underperforming campaigns

**Files to Create:**
- `services/api/src/handlers/admin/campaigns.ts` (new)
- `apps/web/src/app/(dashboard)/admin/campaigns/page.tsx` (new)
- `apps/web/src/components/admin/CampaignAnalytics.tsx` (new)

---

### Task 4.5: Global Catalog Manager

**Requirements:**
- New admin page: `/admin/catalog`
- Master list of product categories with: Category Name, Product Count, Active Sellers Using
- CRUD operations: add, rename, merge, deactivate categories
- Merge: combine two categories into one (all products reassigned)
- Category alias management: multiple names map to one canonical category (for OCR/intent extraction alignment)
  - Example: "Grocery" = "Groceries" = "किराना" = "kirana"
- Preview impact before merge: "Merging 'Dairy' into 'Groceries' will affect 45 products from 3 sellers"

**Acceptance Criteria:**
- [ ] Category list with product count and seller count
- [ ] Add new category works
- [ ] Rename updates all product records
- [ ] Merge shows impact preview before executing
- [ ] Alias management for OCR/intent extraction
- [ ] Deactivate hides category from customer-facing catalog

**Files to Create:**
- `services/api/src/handlers/admin/catalog-manager.ts` (new)
- `apps/web/src/app/(dashboard)/admin/catalog/page.tsx` (new)
- `apps/web/src/components/admin/CategoryManager.tsx` (new)
- `apps/web/src/components/admin/MergePreview.tsx` (new)

---

### Task 4.6: Update Admin sidebar navigation

**Requirements:**
- Add new nav items to admin sidebar: Customers, Disputes, Financials, Campaigns, Catalog
- Current sidebar: Overview, Sellers, Audit, Health, Settings
- New sidebar: Overview, Sellers, Customers, Disputes, Financials, Campaigns, Catalog, Audit, Health, Settings
- Mobile bottom nav for admin: Overview, Sellers, Disputes, Financials, More (Customers, Campaigns, Catalog, Audit, Health, Settings)

**Acceptance Criteria:**
- [ ] All new pages accessible from sidebar
- [ ] Active state highlights correctly
- [ ] Mobile bottom nav updated with most important admin actions
- [ ] No broken links

**Files to Modify:**
- `apps/web/src/components/layout/Sidebar.tsx` (add admin nav items)
- `apps/web/src/components/layout/BottomNav.tsx` (add admin mobile nav)

---

# Feature 5: UPI Intent Integration

## Design Spec

### Context

Indian customers prefer UPI payments via GPay, PhonePe, or Paytm. Instead of redirecting to a Razorpay checkout page, generate a UPI intent URI or Razorpay payment link that opens the customer's preferred UPI app directly from WhatsApp.

---

## Engineering Tasks

### Task 5.1: Generate Razorpay payment links for WhatsApp checkout

**Requirements:**
- When customer reaches checkout in WhatsApp flow, generate a Razorpay Payment Link (not standard checkout)
- Payment Link includes: amount, description, customer phone, expiry (30 min)
- Send payment link in WhatsApp message with order summary
- Razorpay webhook confirms payment → update order status → notify customer + seller
- Optional: generate UPI intent URI (`upi://pay?pa={vpa}&pn={name}&am={amount}&tn={txnNote}`) for direct app open

**Acceptance Criteria:**
- [ ] Checkout in WhatsApp generates Razorpay Payment Link
- [ ] Payment link sent in WhatsApp message with order summary
- [ ] Link expires after 30 minutes
- [ ] Successful payment triggers order confirmation to customer + seller
- [ ] Failed/expired payment sends reminder with new link

**Files to Create/Modify:**
- `services/api/src/services/payment-link.ts` (new)
- `services/api/src/handlers/whatsapp/worker.ts` (modify checkout state)
- `services/api/src/handlers/payments/webhook.ts` (handle payment_link.paid event)

---

# Feature 6: Automated Abandoned Cart Nudges

## Design Spec

### Context

Customers often add items to cart but don't complete checkout. Use EventBridge Scheduler to send automated reminders after inactivity.

---

## Engineering Tasks

### Task 6.1: Cart abandonment detection and automated reminders

**Requirements:**
- When items are added to cart, start a 2-hour inactivity timer via EventBridge Scheduler
- If checkout completes, cancel the timer
- If timer fires (2h with no activity):
  - First nudge: "You have {n} items in your cart worth ₹{amount}. Ready to checkout?"
  - Send via customer's preferred channel (WhatsApp if they have a session, Web Chat otherwise)
- If still no activity after 24h, send second nudge with a small incentive (if applicable)
- Track nudge effectiveness: nudge sent → cart recovered (checkout completed within 1h of nudge)

**Acceptance Criteria:**
- [ ] Cart update starts/resets 2h timer
- [ ] Checkout cancels timer
- [ ] First nudge sent after 2h inactivity
- [ ] Nudge sent via correct channel (WhatsApp or Web)
- [ ] Second nudge at 24h if still abandoned
- [ ] Cart recovery tracking in admin analytics

**Files to Create/Modify:**
- `services/api/src/handlers/cart/abandonment-scheduler.ts` (new)
- `services/api/src/handlers/workers/cart-nudge.ts` (new or modify existing cart abandonment worker)
- `infra/cdk/lib/stacks/events-stack.ts` (add scheduler rule + target)
- `services/api/src/services/cart-service.ts` (modify — trigger scheduler on cart update)

---

# Feature 7: Voice-Activated Financial Reports

## Design Spec

### Context

Sellers send voice notes in their native language asking business questions like "Aaj ka total sales kitna hua?" (How much is today's total sales?). The system transcribes, understands the query, runs the database query, and returns the answer — both as text and as a spoken audio reply.

---

## Engineering Tasks

### Task 7.1: Voice query pipeline for financial reports

**Requirements:**
- Detect voice note from seller in WhatsApp (existing Twilio media download)
- Transcribe using Gemini 2.0 (existing voice pipeline)
- Extract financial query intent via Gemini:
  - "today's sales" → query orders for today, sum amounts
  - "this week's revenue" → query orders for last 7 days
  - "best selling product" → aggregate by product, sort by quantity
  - "pending orders" → count orders with status = pending
- Execute DynamoDB query based on extracted intent
- Format response in the language the seller spoke
- Generate TTS audio response via Gemini TTS (existing pipeline)
- Send both text and audio response via Twilio

**Acceptance Criteria:**
- [ ] Hindi voice note "aaj ka total sales kitna hua" returns today's sales total
- [ ] English voice note "what's my revenue this week" returns weekly revenue
- [ ] Response includes formatted text + audio voice note
- [ ] Supports 8 Indian languages (existing Gemini multilingual support)
- [ ] Unknown queries gracefully handled: "I couldn't understand that. Try asking about sales, orders, or stock."
- [ ] Response time < 8 seconds end-to-end

**Files to Create/Modify:**
- `services/api/src/services/financial-query.ts` (new)
- `services/api/src/handlers/whatsapp/voice-pipeline.ts` (modify — add financial query routing)
- `services/api/src/handlers/whatsapp/seller-copilot.ts` (integrate voice reports)

**Gemini Intent Extraction Prompt:**
```
You are a financial query parser for a retail store. Extract the query intent from this transcribed seller message.
Return JSON:
{
  "queryType": "daily_sales" | "weekly_revenue" | "monthly_revenue" | "best_sellers" | "pending_orders" | "stock_summary" | "unknown",
  "timeRange": { "start": "ISO date", "end": "ISO date" } | null,
  "language": "hi" | "en" | "ta" | "te" | "mr" | "bn" | "gu" | "kn"
}
Transcribed message: "{transcription}"
Today's date: "{today}"
```

---

# Kiro Execution Guide

## Recommended Order

```
Feature 1 (WhatsApp Routing):    Task 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
Feature 2 (Omnichannel Sync):    Task 2.1 → 2.2 → 2.3 → 2.4
Feature 3 (AI Inventory):        Task 3.1 → 3.2 → 3.3
Feature 4 (Admin Expansion):     Task 4.6 → 4.1 → 4.2 → 4.3 → 4.4 → 4.5
Feature 5 (UPI):                 Task 5.1
Feature 6 (Abandoned Cart):      Task 6.1
Feature 7 (Voice Reports):       Task 7.1
```

**Parallelization opportunities:**
- Features 1 + 4 can run in parallel (different Lambda domains)
- Feature 3 depends on Feature 2.2 (omnichannel campaign needs message routing)
- Features 5, 6, 7 are independent and can be built in any order after core features

## Kiro Setup

```bash
cp VyaparGyan_Next_Features_Spec.md .kiro/specs/next-features/design.md
```

Then in Kiro Spec mode, load the file and work through features sequentially. Switch to Vibe mode per task.

## MCP Tools Usage

| Feature | MCP Tools |
|---------|-----------|
| WhatsApp Routing | `twilio-mcp` → test message delivery; `commerce-ops-mcp` → check session state |
| Omnichannel Sync | `commerce-ops-mcp` → verify message threads; `twilio-mcp` → send test messages |
| AI Inventory | `commerce-catalog-mcp` → verify product imports |
| Admin Expansion | `commerce-admin-mcp` → check seller data, disputes; `commerce-ops-mcp` → order/payment data |
| UPI | `commerce-ops-mcp` → verify payment records |
| Abandoned Cart | `commerce-ops-mcp` → check cart state |
| Voice Reports | `commerce-ops-mcp` → verify financial queries |
