# VyaparGyan — Final Judge-Demo Plan

**Date:** 2026-03-08  
**Status:** Implementation staging-ready (31/34 requirements passing, 0 blockers)  
**GitHub:** https://github.com/Golden007-prog/Vyapar-Gyan.git

---

## 1. Judge Demo Scope

### Mandatory Demo Features (MUST show)
1. Landing page → role-based login → dashboard routing
2. Seller registration with WhatsApp number + OTP verification
3. Seller dashboard: overview metrics, AI insights, approval inbox
4. Admin dashboard: platform overview, seller management (approve/reject), system health
5. Customer catalog browsing with search/filters
6. Customer web chat with cart side panel and checkout
7. Seller unified inbox (split-pane, cross-channel messages)
8. Twilio WhatsApp inbound/outbound message (pre-seeded conversation)
9. AI insight → seller approval → automated WhatsApp campaign
10. Order lifecycle visibility (OrderTimeline, StatusPill)

### Optional Wow Features (show if stable)
- Voice note transcription via Gemini (show as recorded backup)
- Khata book OCR image upload (show as recorded backup)
- Bedrock seller copilot chat
- Real-time cart sync across web + WhatsApp

### Features to Hide / Feature-Flag
- Grok market trend analyzer (degraded status in mock — show system health page instead)
- WebSocket migration path (not implemented, polling works fine)
- Account deletion flow (works but risky to demo live)

### Features NOT to Show Live
- Payment webhook flow (Razorpay sandbox can be flaky — show architecture diagram instead)
- Media retry queue / DLQ mechanics (backend-only, no visual)
- CDK deployment process

---

## 2. Final Demo Storyline

**Target duration: 8–10 minutes. Judges understand the product in under 3 minutes.**

### Act 1: The Problem (30 seconds)
**Presenter says:** "Local Indian retailers manage inventory on paper ledgers, sell through word-of-mouth, and have zero digital presence. VyaparGyan is their AI-powered business manager."

**UI shows:** Landing page with hero section, 4 feature cards.

### Act 2: Seller Onboarding (90 seconds)
**Presenter says:** "A new seller signs up with their WhatsApp number."

| Step | UI Shows | Backend Event | Expected Result |
|------|----------|---------------|-----------------|
| Click "Login to Dashboard" | Login page | — | Clean auth UI with +91 prefix |
| Click "Register" | Role selection (Customer / Seller) | — | Two clear role cards |
| Select "Seller", fill form | Registration form with business name, GST, phone | Cognito signUp + DDB profile creation | Form validates Indian phone, GST format |
| OTP screen | 6-digit OTP input with auto-advance | Cognito confirmSignUp | Paste-friendly, 60s cooldown timer |
| Login with new credentials | Redirect to /seller | JWT issued, cookie set | Seller dashboard loads |

**Fallback:** Use pre-seeded seller account if OTP delivery is slow.

### Act 3: Seller Dashboard Tour (90 seconds)
**Presenter says:** "The seller sees their AI business manager immediately."

| Step | UI Shows | What's Happening |
|------|----------|-----------------|
| Overview page | Metrics: ₹45K sales, 127 products, 2 AI campaigns, ₹1.2L revenue | Pre-seeded mock data |
| AI Insights page | Dead stock alert (15 products, 20% discount suggestion) + Price optimization (8 items) | Backend: Grok/Gemini analysis results |
| Click "Approve & Execute" on dead stock insight | Status changes to "Approved — Campaign will be executed shortly" | EventBridge → campaign-execution-worker → Twilio sends WhatsApp to past customers |
| Approvals page | Pending approval cards with priority scores, type badges | Approval engine with weighted scoring |
| Campaigns page | Campaign tracker table with delivery rates, conversion estimates | Campaign analytics from DDB |

### Act 4: Customer Experience (90 seconds)
**Presenter says:** "Now let's see what the customer sees."

| Step | UI Shows | What's Happening |
|------|----------|-----------------|
| Open /catalog | Product grid with search, filters, sort pills, infinite scroll | API: catalog-products-handler |
| Search "salt" | Filtered results | Debounced search, skeleton loading |
| Click product | Product detail with image, price, "Ask Seller" button | catalog-product-detail-handler |
| Navigate to /chat | Chat interface with message list, composer, cart button | Session created, sync-client polling |
| Type "I want to order Tata Salt" | Message appears, typing indicator, bot response | chat-send-handler → EventBridge → worker |
| Open cart side panel | Cart with item, quantity controls, checkout button | cart-service with version-checked writes |
| Click Checkout | "✅ Order placed!" system message | order-service → Razorpay link generation |

### Act 5: WhatsApp Integration (60 seconds)
**Presenter says:** "The same experience works on WhatsApp — India's #1 messaging app."

| Step | UI Shows | What's Happening |
|------|----------|-----------------|
| Show phone with WhatsApp conversation | Pre-seeded WhatsApp thread with bot responses | Twilio webhook → Lambda → session-service |
| Send "show me electronics" | Bot responds with product list | browsing-handler state machine |
| Show seller inbox | Same conversation appears in seller's unified inbox | Cross-channel message sync |

**Fallback:** If Twilio is slow, show pre-recorded WhatsApp interaction video.

### Act 6: Seller Inbox & Cross-Channel (60 seconds)
**Presenter says:** "Sellers see all customer conversations in one place — WhatsApp and web."

| Step | UI Shows | What's Happening |
|------|----------|-----------------|
| Seller inbox page | Split-pane: conversation list (left) + messages (right) | seller-inbox-handler with GSI1 query |
| Select a conversation | Message bubbles with channel indicators, delivery status | message-repository with status tracking |
| Type manual reply | Message sent, "Manual messages override the AI bot" note | seller-reply-handler → Twilio |

### Act 7: Admin Oversight (60 seconds)
**Presenter says:** "Platform admins have full visibility."

| Step | UI Shows | What's Happening |
|------|----------|-----------------|
| Admin overview | GMV ₹84.5L, 342 sellers, 12.8K customers, 1.5K AI insights | Pre-seeded analytics |
| Sellers page | Table with pending/active/suspended, approve/reject buttons | admin seller management |
| Click "Approve" on pending seller | Status badge changes to Active | update-seller-status handler |
| System Health page | 6 service cards (Twilio, Gemini, Grok, Bedrock, Razorpay, DynamoDB) with uptime/latency | health-check-worker results |
| Audit Log page | Filterable audit timeline | AUDIT entity with GSI queries |

### Act 8: Business Impact Close (30 seconds)
**Presenter says:** "VyaparGyan turns every local shop into an AI-managed digital business. Sellers get proactive insights, customers shop on WhatsApp, and the platform earns commission on every transaction — all serverless, all automated."

**UI shows:** Landing page CTA section.

---

## 3. Demo-Safe Feature Selection

| Feature | Status | Demo Strategy |
|---------|--------|---------------|
| Landing page | ✅ Polished | SHOW LIVE |
| Login / Registration / OTP | ✅ Working | SHOW LIVE (with pre-seeded fallback) |
| Seller dashboard overview | ✅ Mock data | SHOW LIVE |
| Seller AI insights | ✅ API-backed | SHOW LIVE |
| Seller approval inbox | ✅ API-backed | SHOW LIVE |
| Seller campaigns tracker | ✅ API-backed | SHOW LIVE |
| Seller unified inbox | ✅ API-backed | SHOW LIVE |
| Seller inventory hub | ✅ Working | SHOW LIVE |
| Seller orders | ✅ Working | SHOW LIVE |
| Admin overview | ✅ Mock data | SHOW LIVE |
| Admin seller management | ✅ Mock data with actions | SHOW LIVE |
| Admin system health | ✅ Mock data | SHOW LIVE |
| Admin audit log | ✅ API-backed | SHOW LIVE |
| Customer catalog | ✅ API-backed | SHOW LIVE |
| Customer web chat + cart | ✅ API-backed | SHOW LIVE |
| Customer orders + timeline | ✅ Working | SHOW LIVE |
| WhatsApp inbound message | ⚠️ Twilio dependency | SHOW AS PRESEEDED |
| WhatsApp outbound campaign | ⚠️ Twilio dependency | SHOW AS PRESEEDED |
| Voice note transcription | ⚠️ Gemini dependency | SHOW AS RECORDED BACKUP |
| Khata book OCR | ⚠️ Gemini dependency | SHOW AS RECORDED BACKUP |
| Bedrock seller copilot | ⚠️ Bedrock dependency | SHOW AS RECORDED BACKUP |
| Razorpay payment flow | ⚠️ Sandbox flaky | HIDE (show architecture diagram) |
| Account deletion | ✅ Working | HIDE |
| WebSocket migration | ❌ Not implemented | HIDE |

---

## 4. Final Frontend Polish Plan

### Landing Page
- [x] Hero section with gradient, animated blobs — already polished
- [ ] Add a "Watch Demo" button linking to a 60-second Loom/video
- [ ] Replace "View Demo Store" link from `/store/seller-123` to a real seeded seller ID
- [ ] Add "Built with AWS" badge in footer for judge credibility

### Seller Dashboard
- [ ] Replace hardcoded "Welcome back, Seller!" with actual seller name from JWT claims
- [ ] Wire "Review Suggestion →" and "View Details →" links to /seller/insights
- [ ] Add notification badge on sidebar for pending approvals count
- [ ] Ensure mobile sidebar toggle works cleanly on small screens

### Admin Dashboard
- [ ] Fix dynamic Tailwind classes in activity feed (bg-${color}-100 won't work — use explicit classes)
- [ ] Wire "12 pending approval" link to /admin/sellers?status=pending
- [ ] Add "Last updated" timestamp to overview metrics

### Customer Chat
- [ ] Add welcome message with quick-reply buttons ("Browse Products", "Track Order", "Talk to Seller")
- [ ] Add product card rendering in message list (for bot product recommendations)
- [ ] Ensure cart badge count updates in real-time when items are added via chat

### Seller Inbox
- [ ] Add ChannelIndicator component (WhatsApp/Web icon) next to each conversation
- [ ] Add QuickActions component below message input (pre-built reply templates)
- [ ] Add CustomerContextSidebar toggle on desktop (order history, preferences)

### Registration / OTP
- [ ] Add WhatsApp opt-in checkbox during registration (WhatsAppOptIn component exists but not wired)
- [ ] Add "Demo mode" banner: "For demo, use code 123456" if OTP delivery is disabled
- [ ] Ensure verify page handles missing phone param gracefully (already does)

### Mobile Responsiveness
- [ ] Test all pages at 375px width (iPhone SE)
- [ ] Ensure seller sidebar collapses properly on mobile
- [ ] Ensure admin sidebar collapses properly on mobile
- [ ] Customer catalog: 2-column grid on mobile (already configured)
- [ ] Chat page: full-width on mobile, cart panel as overlay

### Empty States
- [x] EmptyState component exists and is used in approvals, inbox, orders, cart
- [ ] Add empty state to seller dashboard when no data exists

### Loading States
- [x] Skeleton components exist (CardSkeleton, ProductCardSkeleton)
- [x] Spinner loading states on all data-fetching pages
- [ ] Add shimmer animation to skeleton components for polish

### Error States
- [x] Error banners with retry buttons on all pages
- [ ] Add global error boundary component wrapping each layout

### Visual Consistency
- [ ] Ensure all pages use indigo-600 as primary color (some pages use blue-600)
- [ ] Standardize card border-radius to rounded-lg everywhere
- [ ] Ensure consistent font sizes: page titles 2xl, section titles lg, body sm
- [ ] Add subtle hover transitions to all clickable cards

---

## 5. GitHub Pages Judge Frontend Plan

### Recommended Strategy
Next.js with `output: 'export'` for static HTML generation, hosted on GitHub Pages, with API calls pointing to the deployed AWS API Gateway.

### Static Hosting Requirements
```js
// next.config.js additions
module.exports = {
  output: 'export',
  images: { unoptimized: true },
  basePath: '/Vyapar-Gyan',
  trailingSlash: true,
};
```

### Route Handling
- GitHub Pages doesn't support dynamic routes natively
- Add a custom 404.html that redirects to index.html (SPA fallback)
- All client-side routing works via Next.js app router (already client-side rendered)

### Environment / Config Strategy
```env
# .env.production (safe public variables only)
NEXT_PUBLIC_API_URL=https://api.vyapargyan.com
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_XXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXX
NEXT_PUBLIC_COGNITO_REGION=us-east-1
```

No secrets in the frontend build. All sensitive operations happen server-side.

### Demo URL Structure
- Primary: `https://golden007-prog.github.io/Vyapar-Gyan/`
- Fallback: `http://localhost:3000` running locally during demo

### Fallback Plan
If GitHub Pages build fails or API is unreachable:
1. Run `pnpm --filter @vyapargyan/web dev` locally
2. Use ngrok to expose localhost if needed for WhatsApp callbacks
3. Pre-record a full demo walkthrough as ultimate backup

---

## 6. Admin Dashboard Final Spec

### Key Widgets
| Widget | Data Source | Purpose |
|--------|-----------|---------|
| Platform GMV | Pre-seeded | Show marketplace scale |
| Active Sellers count | Pre-seeded | Show growth |
| Active Customers count | Pre-seeded | Show adoption |
| AI Insights Generated | Pre-seeded | Show AI value |
| Top Performing Sellers (5) | Pre-seeded table | Show marketplace health |
| Recent Platform Activity | Pre-seeded timeline | Show live operations |

### System Health Visibility (separate page)
- 6 service cards: Twilio, Gemini, Grok, Bedrock, Razorpay, DynamoDB
- Each shows: status badge, uptime %, response time, error rate
- Overall status banner (green/yellow/red)
- System metrics: API requests, avg response time, error rate, active webhooks
- Recent error log table with severity badges

### Seller Management
- Filterable table (pending/active/suspended/rejected)
- Search by name/phone
- Approve/Reject action buttons on pending sellers
- Stats cards: total, pending, active, suspended

### Audit Visibility
- Filterable audit log with actor, resource, timestamp
- Monthly S3 export indicator

### What NOT to Clutter
- No raw DynamoDB metrics
- No CloudWatch alarm details
- No CDK stack status
- No Lambda cold start metrics

---

## 7. Seller Dashboard Final Spec

### Today Overview
- Total Sales (₹), Active Products, Active AI Campaigns, Monthly Revenue
- Trend indicators (up/down arrows with percentages)

### AI Action Cards
- Dead Stock Alert (amber): product count, suggested discount, "Review Suggestion →"
- Price Optimization (green): product count, suggested increase, "View Details →"
- Cards link to /seller/insights

### Approval Inbox (/seller/approvals)
- Filter tabs: Pending | Approved | Rejected | All
- Cards with: type badge, AI rationale, affected products, estimated impact, priority score
- Detail modal with: approve, reject, edit & approve, schedule actions
- History timeline on non-pending tabs

### Unified Inbox (/seller/inbox)
- Left pane: conversation list with search, phone, channel type, last message preview, time
- Right pane: message bubbles with direction, delivery status, timestamps
- Message input with "override AI bot" note
- Empty state when no conversations

### Inventory Quick Actions (/seller/inventory)
- Product list with stock levels
- Upload button for CSV / Khata book image
- Low stock alerts

### Campaign Preview (/seller/campaigns)
- Metrics: total campaigns, messages sent, estimated conversions
- Table: insight trigger, offer, target customers, delivery rate bar, status, date

### Order/Cart Summary (/seller/orders)
- Order list with status pills
- Order detail with timeline

### Mobile Behavior
- Sidebar collapses to hamburger menu
- Inbox switches to stacked view (list → detail)
- All tables become scrollable horizontally

---

## 8. Customer and Seller Chat Final Spec

### Customer Chat (/chat)
**Components:** MessageList, ChatComposer, CartSidePanel, TypingIndicator

**Layout:**
- Full height (100vh - nav height)
- Chat area (flex-1) + Cart side panel (collapsible, 320px)
- Mobile: cart panel overlays as bottom sheet

**Features:**
- Optimistic message sending with delivery status (queued → sent → delivered → failed)
- Typing indicator with 5s auto-clear
- Cart button with item count badge
- Cart side panel: item rows with thumbnail/qty/price, summary, checkout button, empty state
- Sync client: 2s polling with ETag/304, exponential backoff
- Error banner with dismiss

**Quick Replies (to add):**
- "Browse Products", "Track Order", "Talk to Seller"

### Seller Inbox (/seller/inbox)
**Components:** ConversationRow, CustomerContextSidebar, QuickActions

**Layout:**
- Split-pane: 320px conversation list + flex-1 message area
- Mobile: stacked navigation

**Features:**
- Search conversations by phone/message content
- Channel type indicator (WhatsApp/Web)
- Message direction (inbound/outbound) with avatars
- Delivery status on outbound messages
- Manual reply input with "override AI bot" note

### Sync Behavior with WhatsApp
- Messages sent via web chat trigger EventBridge → notification-router-worker
- If customer has WhatsApp session, message is also delivered via Twilio
- Seller replies from inbox route to correct channel based on session
- All messages stored in THREAD#{userId} MSG# pattern

---

## 9. Registration and OTP Demo Flow

### Seller Registration
1. /register → Select "I'm a Seller"
2. Fill: name, phone (10-digit Indian), business name, GST (optional), password
3. Validation: phone format, GST format, password match, business name required
4. Submit → Cognito signUp + backend /api/v1/auth/register
5. Redirect to /verify?phone=XXXXXXXXXX&role=seller

### Customer Registration
1. /register → Select "I'm a Customer"
2. Fill: name, phone, password
3. Submit → same flow, fewer fields

### OTP Verification
1. 6-digit input with auto-advance between fields
2. Paste support (clipboard → auto-fill all 6 digits)
3. 60-second cooldown timer for resend
4. On success: green checkmark → redirect to /login after 1.5s
5. Error handling: CodeMismatchException, ExpiredCodeException, LimitExceededException

### Demo-Safe Fallback
- Pre-create 3 demo accounts before presentation:
  - Seller: `+91 8927049085` / `DemoSeller@123`
  - Customer: `+91 7001124396` / `DemoCustomer@123`
  - Admin: `9000000001` / `DemoAdmin@123`
- If OTP delivery is delayed (>10s), switch to pre-seeded account
- Add a visible "Demo Accounts" card on login page (removable via env flag)

---

## 10. Demo Reliability Plan

### Pre-Seeded Data
- 3 Cognito users (admin, seller, customer) with confirmed status
- 8 sellers in DDB (3 pending, 4 active, 1 suspended)
- 50+ products across 6 categories
- 5 AI insights (3 pending, 1 approved, 1 executed)
- 3 approval items with different types and priorities
- 2 completed campaigns with delivery metrics
- 10 orders across different statuses
- 5 WhatsApp conversation threads
- Audit log entries for last 7 days

### Cached / Pre-Loaded
- Admin dashboard analytics (mock data, no API dependency)
- System health page (mock data, no API dependency)
- Seller dashboard metrics (mock data)
- Admin sellers list (mock data)

### Backup Preparations
- Record 60-second full demo video (Loom or screen recording)
- Screenshot every key screen at 1920x1080
- Export WhatsApp conversation screenshots from test phone
- Save Bedrock copilot conversation transcript

### Feature Flags
```env
NEXT_PUBLIC_DEMO_MODE=true          # Enables demo account card on login
NEXT_PUBLIC_SHOW_VOICE_INPUT=false  # Hides voice button if Gemini is unreliable
NEXT_PUBLIC_SHOW_IMAGE_SEARCH=false # Hides image search if OCR is unreliable
```

### 1-Hour-Before Checklist
- [ ] Verify Cognito: all 3 demo accounts can log in
- [ ] Verify API Gateway: GET /api/v1/catalog/products returns 200
- [ ] Verify Twilio: send test WhatsApp message to demo phone
- [ ] Verify DynamoDB: scan returns seeded data
- [ ] Open all 3 dashboards in separate browser tabs (admin, seller, customer)
- [ ] Clear browser cache and cookies
- [ ] Test on presentation laptop's screen resolution
- [ ] Ensure stable internet connection (have mobile hotspot as backup)

### During Demo Monitoring
- Keep browser DevTools Network tab open (hidden from projector)
- Have terminal with `aws logs tail` ready for quick debugging
- Keep pre-seeded account credentials on a sticky note
- Have backup video ready to play if any live feature fails

### Backup Paths
| Failure | Backup |
|---------|--------|
| Twilio slow (>5s) | Show pre-recorded WhatsApp video |
| AI response slow (>10s) | Show pre-seeded insight cards (already approved) |
| Media recognition slow | Show recorded OCR demo |
| API Gateway down | Run Next.js locally with mock data |
| Cognito auth fails | Use pre-authenticated browser session |
| Internet drops | Switch to mobile hotspot, show recorded backup |

---

## 11. Smoke Test Checklist Before Demo

### Admin Dashboard
- [ ] /admin loads with 4 metric cards
- [ ] Top sellers table renders 5 rows
- [ ] Recent activity shows 4 items
- [ ] /admin/sellers loads with 8 sellers, filter works
- [ ] Approve button changes pending seller to active
- [ ] /admin/system loads with 6 service cards
- [ ] /admin/audit loads with filterable log

### Seller Dashboard
- [ ] /seller loads with welcome banner and 4 metrics
- [ ] AI insights cards render with approve/reject buttons
- [ ] /seller/insights loads pending insights
- [ ] /seller/approvals loads with filter tabs
- [ ] /seller/campaigns loads with metrics and table
- [ ] /seller/inventory loads product list
- [ ] /seller/orders loads order list
- [ ] /seller/inbox loads conversation list

### Customer Web Chat
- [ ] /chat loads with message list and composer
- [ ] Sending a message shows optimistic update
- [ ] Cart button shows badge count
- [ ] Cart side panel opens/closes
- [ ] Checkout produces success message

### Registration & OTP
- [ ] /register shows role selection
- [ ] Seller form validates phone, GST, password match
- [ ] /verify shows 6-digit OTP input
- [ ] OTP paste works
- [ ] Resend cooldown timer counts down

### WhatsApp
- [ ] Inbound WhatsApp message reaches webhook Lambda
- [ ] Outbound message appears on test phone
- [ ] Message appears in seller inbox

### Cart Sync
- [ ] Adding item via chat updates cart count
- [ ] Cart side panel reflects correct items
- [ ] Checkout clears cart

### Mobile Responsiveness
- [ ] Landing page renders at 375px
- [ ] Seller sidebar collapses on mobile
- [ ] Admin sidebar collapses on mobile
- [ ] Catalog shows 2-column grid on mobile
- [ ] Chat is full-width on mobile

### Staging Environment
- [ ] `pnpm cdk synth` succeeds
- [ ] All Lambda functions deployed
- [ ] API Gateway returns 200 on health endpoint
- [ ] DynamoDB table accessible
- [ ] S3 buckets accessible

---

## 12. Judge Submission Assets

| Asset | Format | Status |
|-------|--------|--------|
| Frontend demo URL | GitHub Pages or localhost:3000 | To deploy |
| GitHub repo | https://github.com/Golden007-prog/Vyapar-Gyan.git | Ready |
| Architecture diagram | PNG/SVG (AWS icons) | To create |
| One-page summary | PDF, 1 page | To create |
| Feature map | Visual grid of all features | To create |
| Seeded demo accounts | 3 accounts (admin/seller/customer) | To create in Cognito |
| Test phone numbers | 1 WhatsApp-enabled number | Already configured |
| Demo script | This document, Act 1–8 | Ready |
| Screenshots | 10 key screens at 1920x1080 | To capture |
| Backup recording | 60-second Loom video | To record |
| README with demo instructions | Updated README.md | To update |

---

## 13. Documentation Sync for Judges

### README.md Updates Needed
- Add "Demo Quick Start" section at top (3 steps to see the demo)
- Add architecture diagram (inline or linked)
- Update feature list to include omnichannel messaging, AI insights, approval engine, campaign automation
- Add "Demo Accounts" section with credentials
- Remove references to "legacy backend" and "being phased out"

### overview.md Updates Needed
- Add omnichannel messaging (WhatsApp + web chat)
- Add approval engine and campaign automation
- Add customer web experience (catalog, chat, cart, orders)
- Update architecture section with all current services

### product.md Updates Needed
- Already comprehensive — minor update to mention web chat alongside WhatsApp
- Add "Demo Flow" section describing the judge storyline

### tech.md Updates Needed
- Already comprehensive — no changes needed

### structure.md Updates Needed
- Add frontend pages inventory (22 pages)
- Add frontend components inventory (14 components)
- Add API client files (11 files)
- Update handler count to 55+

---

## 14. Final Build/Polish Order

### Priority 1: Must-Fix (Day 1)
1. Fix admin dashboard dynamic Tailwind classes (bg-${color} → explicit classes)
2. Wire seller dashboard "Review Suggestion →" links to /seller/insights
3. Add demo account credentials to login page (behind DEMO_MODE flag)
4. Pre-seed 3 Cognito demo accounts
5. Run seed script to populate DynamoDB with demo data
6. Test all 3 login flows end-to-end

### Priority 2: High-Impact Polish (Day 1–2)
7. Add WhatsApp opt-in checkbox to registration form
8. Add quick-reply buttons to customer chat welcome message
9. Add ChannelIndicator to seller inbox conversations
10. Standardize color scheme (indigo-600 everywhere, remove blue-600 inconsistencies)
11. Add notification badge to seller sidebar for pending approvals
12. Replace hardcoded "Welcome back, Seller!" with JWT name claim

### Priority 3: Nice-to-Have (Day 2)
13. Add "Built with AWS" badge to landing page footer
14. Add shimmer animation to skeleton loaders
15. Create architecture diagram (draw.io or Excalidraw)
16. Record 60-second backup demo video
17. Capture 10 key screenshots
18. Write one-page summary PDF

### Priority 4: Documentation (Day 2)
19. Update README.md with demo instructions
20. Update overview.md with current features
21. Update structure.md with frontend inventory

### Final Freeze Point
- All code changes frozen 4 hours before presentation
- Only documentation and seed data changes after freeze
- Final smoke test 1 hour before presentation

---

## 15. Final Go/No-Go Checklist

| # | Criterion | Required | Status |
|---|-----------|----------|--------|
| 1 | 3 demo accounts can log in | YES | ⬜ |
| 2 | Seller dashboard loads with data | YES | ⬜ |
| 3 | Admin dashboard loads with data | YES | ⬜ |
| 4 | Customer catalog shows products | YES | ⬜ |
| 5 | Customer chat sends/receives messages | YES | ⬜ |
| 6 | Cart side panel works (add/remove/checkout) | YES | ⬜ |
| 7 | Seller inbox shows conversations | YES | ⬜ |
| 8 | AI insight approve button works | YES | ⬜ |
| 9 | Admin can approve pending seller | YES | ⬜ |
| 10 | System health page renders all services | YES | ⬜ |
| 11 | WhatsApp test message delivered | NICE | ⬜ |
| 12 | OTP verification works end-to-end | NICE | ⬜ |
| 13 | Mobile responsiveness passes on 375px | NICE | ⬜ |
| 14 | Backup demo video recorded | YES | ⬜ |
| 15 | Architecture diagram ready | YES | ⬜ |
| 16 | README updated with demo instructions | YES | ⬜ |
| 17 | Stable internet confirmed | YES | ⬜ |
| 18 | Presentation laptop tested | YES | ⬜ |

**GO decision:** Items 1–10 and 14–18 must be ✅. Items 11–13 are nice-to-have.

**NO-GO triggers:**
- Any of items 1–10 failing
- No backup video recorded
- No stable internet available
