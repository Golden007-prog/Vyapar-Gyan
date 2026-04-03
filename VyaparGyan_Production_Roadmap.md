# VyaparGyan — Production Roadmap & Kiro Specs

> AI-powered multi-seller marketplace for Indian local retailers.  
> Goal: Take VyaparGyan from demo to production-ready for real sellers.

---

# Table of Contents

1. [Quick Start with Kiro](#quick-start-with-kiro)
2. [Phase 1: Mobile-First UI Overhaul](#phase-1-mobile-first-ui-overhaul)
   - [Design Spec](#phase-1--design-spec)
   - [Engineering Tasks](#phase-1--engineering-tasks)
3. [Phase 2: OpenSearch Integration](#phase-2-opensearch-integration)
   - [Design Spec](#phase-2--design-spec)
   - [Engineering Tasks](#phase-2--engineering-tasks)
4. [Phase 3: Chat & Messaging Quality](#phase-3-chat--messaging-quality)
5. [Phase 4: OCR, CSV & Production Hardening](#phase-4-ocr-csv--production-hardening)
6. [Cost Estimates](#cost-estimates)
7. [Testing Checklist](#testing-checklist)

---

# Quick Start with Kiro

## Setup

Copy this file into your project:

```bash
cp VyaparGyan_Production_Roadmap.md .kiro/specs/
```

Or split into separate spec folders if preferred:

```bash
mkdir -p .kiro/specs/mobile-first-ui .kiro/specs/opensearch-integration
# Then copy relevant sections into design.md and tasks.md per folder
```

## Recommended Kiro Workflow

### Step 1 — Spec Mode: Review the design

Open Kiro → Spec mode → load the design spec section for the phase you're working on. Ask Kiro to refine design decisions based on your current component structure.

### Step 2 — Vibe Mode: Build task by task

Work through tasks in order. Paste each task into Kiro Vibe mode with this prompt template:

```
I'm working on VyaparGyan (AI-powered marketplace for Indian sellers).
Here's the task spec:

[paste task]

My current file structure is:
- apps/web/src/app/ (Next.js 14 app router)
- apps/web/src/components/ (React components)
- services/api/src/handlers/ (Lambda handlers)
- infra/cdk/lib/stacks/ (CDK infrastructure)
- Tailwind CSS for styling

Please implement this task. Start by reading the relevant existing files
to understand current patterns, then make the changes.
```

## MCP Tools Available

| Phase | Useful MCP Tools |
|-------|-----------------|
| Phase 1 (UI) | Standard file editing — no special MCP tools needed |
| Phase 2 (OpenSearch) | `aws-iac` → validate CDK templates, check best practices; `commerce-catalog-mcp` → verify product data structure; `search_cdk_documentation` → OpenSearch Serverless CDK examples; `read_iac_documentation_page` → OSIS config docs |
| Phase 3 (Chat) | `twilio-mcp` → test WhatsApp message delivery; `commerce-ops-mcp` → check WhatsApp session state |
| Phase 4 (OCR/CSV) | `commerce-catalog-mcp` → verify product imports; `commerce-ops-mcp` → check inventory logs |

## Execution Order

```
Phase 1: Mobile-First UI          ← START HERE (Week 1-2)
  Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

Phase 2: OpenSearch Integration   (Week 2-4)
  Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8(optional)

Phase 3: Chat & Messaging         (Week 3-5, parallel with Phase 2)
  Task 1 → 2 → 3 → 4

Phase 4: OCR, CSV & Hardening     (Week 4-6)
  Task 1 → 2 → 3 → 4 → 5
```

---

# Phase 1: Mobile-First UI Overhaul

## Phase 1 — Design Spec

### Context

VyaparGyan targets Indian local retailers who primarily use smartphones (Android, budget devices, spotty 3G/4G connectivity). The current desktop-first sidebar layout is unusable on mobile. This phase converts the seller dashboard, customer chat, and admin panel to mobile-first responsive design.

### Current State

- **Seller Dashboard**: 8-item sidebar (Overview, Inventory Hub, Orders, Customer Inbox, AI Insights, Approvals, Campaigns + Switch Account/Sign Out) — collapses poorly on mobile
- **Customer Chat**: WhatsApp-style interface but top nav consumes too much vertical space on mobile
- **Admin Panel**: Platform Overview with sidebar nav (Overview, Sellers, Audit Log, System Health)
- **Tech Stack**: Next.js 14, Tailwind CSS, 22 pages, 14 components
- **Deployment**: GitHub Pages (static export) connected to live AWS backend

### Design Decisions

#### 1. Responsive Navigation Strategy

**Mobile (<768px)**: Bottom tab bar with 5 primary actions

- Seller: Overview | Inventory | Orders | Inbox | More (AI Insights, Approvals, Campaigns, Settings)
- Customer: Catalog | Chat | Cart | Orders | Account
- Admin: Overview | Sellers | Audit | Health | Settings

**Tablet (768px–1024px)**: Collapsible sidebar with icons only, expand on hover/tap

**Desktop (>1024px)**: Current sidebar layout (no changes needed)

**Rationale**: Bottom nav is the standard Android/iOS pattern. Indian sellers are already familiar with it from WhatsApp, Paytm, and PhonePe. The "More" overflow menu handles secondary actions without cluttering the tab bar.

#### 2. Stat Cards Responsive Layout

- **Mobile**: Full-width stacked cards, larger text (₹45,231 at 24px min), 48px minimum tap target
- **Tablet**: 2×2 grid
- **Desktop**: 4-column row (current layout)

#### 3. Chat Interface Mobile Optimization

- Full-screen chat view on mobile (hide top nav, show minimal back-arrow header)
- Virtual keyboard handling: resize viewport, auto-scroll to latest message
- Message input bar pinned to bottom with send button (min 44×44px tap target)
- Swipe right to go back to chat list

#### 4. Data Tables → Mobile Cards

Product list, order list, and similar tables transform to swipeable card lists on mobile. Each card shows product image (if available), name, price, stock count, status badge. Swipe actions: Edit (left), Delete (right) with confirmation. Pull-to-refresh for all list views.

#### 5. PWA Foundation

- Service worker for offline product catalog browsing
- App manifest with VyaparGyan branding
- Queue inventory updates for background sync
- Install prompt after 3rd visit

### Technical Approach

**Breakpoints (Tailwind):**

```
sm: 640px   (large phones)
md: 768px   (tablets — navigation switches)
lg: 1024px  (desktop — full sidebar)
```

**Shared Layout Component Structure:**

```
apps/web/src/components/layout/
├── AppShell.tsx          # Detects breakpoint, renders correct nav
├── BottomNav.tsx         # Mobile bottom tab bar
├── Sidebar.tsx           # Desktop sidebar (existing, extracted)
├── MobileHeader.tsx      # Minimal top bar with back + title + avatar
└── MoreMenu.tsx          # Overflow sheet for secondary nav items
```

**Key Dependencies:** No new packages required — Tailwind responsive utilities are sufficient. `next-pwa` for PWA support (optional, Phase 1.5). `react-swipeable` for swipe gestures (or native touch events).

### Out of Scope

- Redesigning the visual style/branding (colors, fonts stay as-is)
- Adding new features — this is purely responsive adaptation
- WhatsApp Twilio integration changes
- Backend/Lambda modifications

---

## Phase 1 — Engineering Tasks

### Task 1: Extract and create AppShell layout component

**Requirements:**

- Extract current sidebar into a reusable `Sidebar.tsx` component
- Create `AppShell.tsx` that conditionally renders `Sidebar` (desktop) or `BottomNav` (mobile)
- Use Tailwind `md:hidden` / `hidden md:flex` for breakpoint switching
- AppShell wraps all authenticated pages via Next.js layout groups

**Acceptance Criteria:**

- [ ] `AppShell.tsx` renders `BottomNav` below 768px, `Sidebar` above
- [ ] No layout shift when switching between breakpoints
- [ ] AppShell is used in `apps/web/src/app/(dashboard)/layout.tsx`
- [ ] Role-aware: shows seller nav for sellers, admin nav for admins, customer nav for customers

**Files to Create/Modify:**

- `apps/web/src/components/layout/AppShell.tsx` (new)
- `apps/web/src/components/layout/BottomNav.tsx` (new)
- `apps/web/src/components/layout/Sidebar.tsx` (extract from existing)
- `apps/web/src/components/layout/MobileHeader.tsx` (new)
- `apps/web/src/app/(dashboard)/layout.tsx` (modify)

---

### Task 2: Build BottomNav component

**Requirements:**

- 5-tab bottom navigation bar, fixed to bottom of viewport
- Tabs for Seller role: Overview, Inventory, Orders, Inbox, More
- Tabs for Customer role: Catalog, Chat, Cart, Orders, Account
- Tabs for Admin role: Overview, Sellers, Audit, Health, More
- Active tab highlighted with brand color
- "More" tab opens a bottom sheet with remaining nav items
- Each tab: icon (Lucide React) + label text (12px)
- Safe area padding for devices with home indicators (`env(safe-area-inset-bottom)`)

**Acceptance Criteria:**

- [ ] Bottom nav visible only on screens < 768px
- [ ] All 5 tabs are tappable with minimum 48px height
- [ ] Active route highlighted correctly on page navigation
- [ ] "More" opens a sheet overlay with secondary items
- [ ] Safe area inset respected on iPhone/Android

**Implementation Notes:**

```tsx
// Use Next.js usePathname() for active route detection
// Lucide icons: Home, Package, ShoppingCart, MessageSquare, MoreHorizontal
// z-index: 50 to stay above content
// backdrop-blur-sm on More sheet overlay
```

---

### Task 3: Responsive stat cards

**Requirements:**

- Stat cards (Total Sales, Active Products, Active AI Campaigns, Monthly Revenue) become full-width stacked on mobile
- Min height 80px per card on mobile
- Primary value (₹45,231) at minimum 24px font
- Secondary text ("+12.5% from last month") at 13px
- Icon stays right-aligned within card

**Acceptance Criteria:**

- [ ] Cards stack vertically on mobile (<768px)
- [ ] 2×2 grid on tablet (768px-1024px)
- [ ] 4-column row on desktop (>1024px)
- [ ] All tap targets ≥ 48px
- [ ] Numbers are readable on small screens (no truncation)

**Files to Modify:**

- `apps/web/src/components/dashboard/StatCards.tsx` (or equivalent)
- Seller dashboard overview page

---

### Task 4: Mobile data tables → card lists

**Requirements:**

- Product list (Inventory Hub) transforms from table to card list on mobile
- Order list transforms similarly
- Each product card: product name, category badge, price, stock count, stock age, status badge
- Each order card: order ID, customer, amount, status, date
- Pull-to-refresh functionality
- Tap card to open detail view

**Acceptance Criteria:**

- [ ] Table renders on desktop (>768px), card list on mobile
- [ ] Cards have 16px padding, 8px gap between cards
- [ ] Status badges use existing color scheme (Active=green, Inactive=gray, Low stock=amber)
- [ ] Pull-to-refresh triggers data refetch
- [ ] Smooth transition, no layout jank

**Files to Create/Modify:**

- `apps/web/src/components/inventory/ProductCardMobile.tsx` (new)
- `apps/web/src/components/orders/OrderCardMobile.tsx` (new)
- Inventory Hub page (modify)
- Orders page (modify)

---

### Task 5: Full-screen mobile chat

**Requirements:**

- On mobile, chat view takes full screen (no sidebar, minimal header)
- Header: back arrow + store name + online status (48px height)
- Message list fills remaining viewport
- Input bar fixed to bottom: text input + send button + voice note button
- Auto-scroll to latest message on new message
- Virtual keyboard handling: viewport resizes, input stays visible

**Acceptance Criteria:**

- [ ] Chat view is full-screen on mobile with back navigation
- [ ] Input bar stays above virtual keyboard when focused
- [ ] Messages auto-scroll to bottom on new message
- [ ] Send button and voice button are minimum 44×44px
- [ ] Back arrow returns to chat list (customer) or inbox (seller)

**CSS Considerations:**

```css
.chat-container {
  height: 100dvh; /* dynamic viewport height */
  display: flex;
  flex-direction: column;
}
.message-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.input-bar {
  position: sticky;
  bottom: 0;
  padding-bottom: env(safe-area-inset-bottom);
}
```

---

### Task 6: Khata Book OCR mobile camera flow

**Requirements:**

- On mobile, "Khata Book OCR" button opens camera directly (not file picker)
- Use `<input type="file" accept="image/*" capture="environment">` for native camera
- After capture: show preview with crop/rotate controls
- "Extract with AI" sends to existing Gemini Vision endpoint
- Progress indicator during extraction
- Side-by-side result view: photo left, extracted data right (stacked on mobile)

**Acceptance Criteria:**

- [ ] Camera opens directly on mobile tap
- [ ] Preview shows captured image before submission
- [ ] Crop and rotate controls functional
- [ ] Extraction progress shown (skeleton or spinner)
- [ ] Results display clearly on mobile (stacked layout)

---

### Task 7: Smart CSV Upload mobile optimization

**Requirements:**

- CSV upload modal becomes full-screen on mobile
- Step indicator (Upload → AI Analysis → Mapping → Preview → Done) uses compact dots on mobile
- File selection supports both file picker and "paste from clipboard"
- Preview table scrolls horizontally with sticky first column
- Error rows highlighted with clear "Fix" affordance

**Acceptance Criteria:**

- [ ] Upload flow works end-to-end on mobile
- [ ] Step indicator fits on mobile width
- [ ] Preview table is horizontally scrollable
- [ ] Errors are visible and actionable on mobile
- [ ] "Analyze with AI" button is full-width on mobile

---

### Task 8: PWA manifest and basic service worker

**Requirements:**

- Add `manifest.json` with VyaparGyan branding (name, short_name, icons, theme_color, background_color)
- Basic service worker: cache static assets (JS, CSS, images) + app shell
- Offline fallback page: "You're offline. Your inventory changes will sync when you reconnect."
- Add to home screen prompt logic (after 3rd visit)

**Acceptance Criteria:**

- [ ] Lighthouse PWA score ≥ 80
- [ ] App installable on Android Chrome
- [ ] Offline fallback page displays correctly
- [ ] Static assets cached and served from cache on revisit
- [ ] Theme color matches VyaparGyan branding in status bar

**Files to Create:**

- `apps/web/public/manifest.json`
- `apps/web/public/sw.js` (or use next-pwa)
- `apps/web/public/offline.html`
- PWA icons at 192×192 and 512×512

---

# Phase 2: OpenSearch Integration

## Phase 2 — Design Spec

### Context

VyaparGyan currently relies on DynamoDB scans for product search, which limits search to exact key matches. Real sellers and customers need full-text search (fuzzy matching, multilingual Hindi/English), autocomplete, and eventually semantic search ("something for tough stains" → Surf Excel). AWS offers a zero-ETL integration between DynamoDB and OpenSearch that syncs data automatically.

### Architecture

```
┌─────────────────┐     PITR + Streams     ┌──────────────────────┐
│  DynamoDB        │ ───────────────────▶   │  OpenSearch Ingestion│
│  (main table)    │   zero-ETL pipeline    │  Pipeline (OSIS)     │
└─────────────────┘                         └──────────┬───────────┘
                                                       │
                                                       ▼
                                            ┌──────────────────────┐
                                            │  OpenSearch Serverless│
                                            │  (search collection)  │
                                            │  - products index     │
                                            │  - sellers index      │
                                            └──────────┬───────────┘
                                                       │
                                                       ▼
┌─────────────────┐    API Gateway     ┌───────────────────────────┐
│  Frontend        │ ◄────────────────  │  Search Lambda            │
│  (search bar)    │    /search         │  - full-text queries      │
│                  │    /autocomplete   │  - fuzzy matching         │
└─────────────────┘                    │  - faceted filtering       │
                                       └───────────────────────────┘
```

### Design Decisions

#### 1. OpenSearch Serverless vs Managed Domain

**Decision**: OpenSearch Serverless (search collection type)

**Rationale:**

- No cluster management — scales to zero when idle
- Pay-per-OCU — ideal for pre-scale marketplace
- Supports all search features needed (full-text, fuzzy, k-NN vector)
- Native zero-ETL support from DynamoDB
- Estimated cost at current scale: ~$2-5/day (2 OCU minimum when active)

#### 2. Zero-ETL Pipeline Configuration

**Source**: DynamoDB main table with PITR + Streams (NEW_AND_OLD_IMAGES)  
**Sink**: OpenSearch Serverless search collection

Only product and seller records are indexed (filter by PK/SK pattern in OSIS pipeline). Order data stays in DynamoDB only.

**Pipeline YAML strategy:**

```yaml
version: "2"
dynamodb-pipeline:
  source:
    dynamodb:
      tables:
        - table_arn: "arn:aws:dynamodb:us-east-1:ACCOUNT:table/vyapargyan-dev-main"
          stream:
            start_position: "LATEST"
          export:
            s3_bucket: "vyapargyan-dev-opensearch-export"
            s3_region: "us-east-1"
  route:
    - products: '/PK startsWith "SELLER#" and SK startsWith "PRODUCT#"'
    - sellers: '/PK startsWith "SELLER#" and SK == "PROFILE"'
  sink:
    - opensearch:
        hosts: ["<collection-endpoint>"]
        index: "products"
        routes: ["products"]
    - opensearch:
        hosts: ["<collection-endpoint>"]
        index: "sellers"
        routes: ["sellers"]
```

#### 3. Index Design

**products index mapping:**

```json
{
  "mappings": {
    "properties": {
      "sellerId": { "type": "keyword" },
      "productName": { "type": "text", "analyzer": "standard", "fields": { "keyword": { "type": "keyword" } } },
      "description": { "type": "text" },
      "category": { "type": "keyword" },
      "tags": { "type": "keyword" },
      "price": { "type": "float" },
      "stockQuantity": { "type": "integer" },
      "status": { "type": "keyword" },
      "createdAt": { "type": "date" }
    }
  }
}
```

**sellers index mapping:**

```json
{
  "mappings": {
    "properties": {
      "sellerId": { "type": "keyword" },
      "storeName": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "description": { "type": "text" },
      "categories": { "type": "keyword" },
      "city": { "type": "keyword" },
      "status": { "type": "keyword" }
    }
  }
}
```

#### 4. Search API Design

**GET /search?q={query}&category={cat}&seller={id}&page={n}&size={m}**

- Full-text search across productName, description, tags
- Fuzzy matching (fuzziness: "AUTO") for typo tolerance
- Category and seller faceted filtering
- Pagination with search_after for deep paging

**GET /autocomplete?q={prefix}&limit={n}**

- Prefix matching on productName
- Returns top N suggestions with category context
- Debounced at 300ms on frontend

#### 5. Semantic Search (Phase 2b — after basic search works)

- Connect OpenSearch to Amazon Bedrock Titan Text Embeddings v2 via ML Connector
- Auto-generate 1024-dim vector embeddings for product name + description
- k-NN search with cosine similarity
- Hybrid scoring: 0.7 × BM25 + 0.3 × k-NN
- Enables intent-based search in Hindi and English

### CDK Infrastructure — New Stack: SearchStack

```typescript
// New resources needed:
// 1. OpenSearch Serverless collection (search type)
// 2. Data access policy (Lambda role → collection)
// 3. Network policy (public access for API, or VPC endpoint)
// 4. Encryption policy (AWS-owned key)
// 5. S3 bucket for PITR export
// 6. OpenSearch Ingestion pipeline
// 7. IAM roles for OSIS (read DynamoDB, write OpenSearch)
// 8. Enable PITR on existing DynamoDB table
// 9. Enable DynamoDB Streams (NEW_AND_OLD_IMAGES) on existing table
// 10. Search Lambda function
// 11. API Gateway route for /search and /autocomplete
```

**Dependencies on Existing Stacks:**

- **DatabaseStack**: Must export table ARN and stream ARN
- **ApiStack**: Must add new search routes to API Gateway

### Out of Scope

- Elasticsearch (legacy) — using OpenSearch only
- Custom ETL pipelines — using native zero-ETL integration
- Admin search (admin searches DynamoDB directly for now)
- Voice search integration (handled by existing Gemini voice pipeline)

---

## Phase 2 — Engineering Tasks

### Task 1: Enable DynamoDB PITR and Streams

**Requirements:**

- Enable Point-in-Time Recovery (PITR) on the main DynamoDB table
- Enable DynamoDB Streams with NEW_AND_OLD_IMAGES
- Update DatabaseStack CDK to include these settings
- Create S3 bucket for PITR export data

**Acceptance Criteria:**

- [ ] PITR enabled on vyapargyan-dev-main table
- [ ] DynamoDB Streams enabled with NEW_AND_OLD_IMAGES
- [ ] S3 export bucket created with lifecycle policy (delete after 30 days)
- [ ] CDK diff shows only additive changes (no table replacement)
- [ ] Existing data access patterns unaffected

**Files to Modify:**

- `infra/cdk/lib/stacks/database-stack.ts`
- `infra/cdk/lib/config/dev.ts` (add S3 bucket name)

**⚠️ Risk:** Enabling Streams on an existing table is non-destructive, but verify in dev first. PITR has cost implications (~$0.20/GB-month for table storage).

---

### Task 2: Create OpenSearch Serverless collection via CDK

**Requirements:**

- Create OpenSearch Serverless collection (type: SEARCH)
- Encryption policy using AWS-owned key
- Network policy allowing public access (for Lambda → collection)
- Data access policy granting search Lambda role read/write access
- Data access policy granting OSIS pipeline role write access

**Acceptance Criteria:**

- [ ] Collection created and accessible
- [ ] Encryption policy applied
- [ ] Network policy allows Lambda access
- [ ] Data access policies configured for both Lambda and OSIS roles
- [ ] Collection endpoint exported as stack output

**Files to Create:**

- `infra/cdk/lib/stacks/search-stack.ts` (new)
- `infra/cdk/bin/app.ts` (add SearchStack)

**CDK Constructs:**

```typescript
// Use L1 constructs — OpenSearch Serverless L2 constructs are limited
new CfnCollection(this, 'ProductSearch', {
  name: 'vyapargyan-dev-products',
  type: 'SEARCH',
});
```

---

### Task 3: Create OpenSearch Ingestion pipeline

**Requirements:**

- OSIS pipeline with DynamoDB source plugin
- Route product records to `products` index
- Route seller profile records to `sellers` index
- Filter out non-product/non-seller records (orders, sessions, etc.)
- Configure auto-scaling: min 1 OCU, max 4 OCU
- Dead-letter queue to S3

**Acceptance Criteria:**

- [ ] Pipeline created and running
- [ ] Product records sync to `products` index within ~30 seconds
- [ ] Seller records sync to `sellers` index
- [ ] Non-product records are filtered out
- [ ] DLQ captures failed events
- [ ] Initial PITR snapshot loads successfully

**Files to Create/Modify:**

- `infra/cdk/lib/stacks/search-stack.ts` (add pipeline)
- `infra/cdk/lib/constructs/osis-pipeline.ts` (new construct)

**Validation:**

```bash
# After deployment, verify sync by creating a test product
aws dynamodb put-item --table-name vyapargyan-dev-main \
  --item '{"PK":{"S":"SELLER#test"},"SK":{"S":"PRODUCT#test1"},"productName":{"S":"Test Soap"}}'

# Then check OpenSearch
curl -X GET "$COLLECTION_ENDPOINT/products/_search?q=soap"
```

---

### Task 4: Create search Lambda handler

**Requirements:**

- New Lambda handler: `searchProducts`
- Accepts query params: q, category, seller, page, size
- Queries OpenSearch Serverless using `@opensearch-project/opensearch` SDK
- Full-text search with multi_match across productName, description, tags
- Fuzzy matching (fuzziness: "AUTO")
- Category and seller filtering via bool query
- Returns paginated results with total count

**Acceptance Criteria:**

- [ ] Lambda responds to GET /search?q=soap with matching products
- [ ] Fuzzy matching finds "soapr" → "soap"
- [ ] Category filter works: /search?q=soap&category=Groceries
- [ ] Pagination works with page/size params
- [ ] Response includes: items[], total, page, pageSize
- [ ] Cold start < 3s, warm response < 500ms

**Files to Create:**

- `services/api/src/handlers/catalog/search.ts` (new)
- `services/api/src/services/opensearch-client.ts` (new)

**Handler Skeleton:**

```typescript
export const handler = async (event: APIGatewayProxyEventV2) => {
  const { q, category, seller, page = '1', size = '20' } = event.queryStringParameters || {};
  
  const body = {
    query: {
      bool: {
        must: q ? [{
          multi_match: {
            query: q,
            fields: ['productName^3', 'description', 'tags^2'],
            fuzziness: 'AUTO',
            type: 'best_fields'
          }
        }] : [{ match_all: {} }],
        filter: [
          ...(category ? [{ term: { category } }] : []),
          ...(seller ? [{ term: { sellerId: seller } }] : []),
          { term: { status: 'Active' } }
        ]
      }
    },
    from: (parseInt(page) - 1) * parseInt(size),
    size: parseInt(size)
  };

  const result = await opensearchClient.search({ index: 'products', body });
  // ... format and return
};
```

---

### Task 5: Create autocomplete Lambda handler

**Requirements:**

- New Lambda handler: `autocompleteProducts`
- Accepts query params: q (prefix), limit (default 5)
- Uses prefix query on productName.keyword with completion suggester
- Returns array of suggestions: { name, category, sellerId }
- Response time < 200ms

**Acceptance Criteria:**

- [ ] Typing "am" returns "Amul Butter 500g" as suggestion
- [ ] Results limited to `limit` param
- [ ] Only active products returned
- [ ] Response format: `{ suggestions: [{ name, category, sellerId }] }`

**Files to Create:**

- `services/api/src/handlers/catalog/autocomplete.ts` (new)

---

### Task 6: Add API Gateway routes for search

**Requirements:**

- Add GET /search route to API Gateway
- Add GET /autocomplete route to API Gateway
- Both routes require JWT authentication (Cognito)
- Both routes accessible by all roles (admin, seller, customer)
- Rate limiting: 100 req/s for search, 200 req/s for autocomplete

**Acceptance Criteria:**

- [ ] /search route deployed and accessible
- [ ] /autocomplete route deployed and accessible
- [ ] JWT auth required on both routes
- [ ] Rate limiting configured

**Files to Modify:**

- `infra/cdk/lib/stacks/api-stack.ts`

---

### Task 7: Frontend search UI

**Requirements:**

- Search bar component with debounced input (300ms)
- Autocomplete dropdown showing suggestions as user types
- Search results page with product cards in responsive grid
- Category facet sidebar (desktop) / filter chips (mobile)
- "No results" state with suggestions
- Loading skeleton during search
- Integrate with customer catalog view and seller inventory

**Acceptance Criteria:**

- [ ] Search bar visible in customer catalog and seller inventory
- [ ] Autocomplete dropdown appears after 2+ characters
- [ ] Selecting a suggestion navigates to filtered results
- [ ] Results display in responsive grid (1 col mobile, 2 tablet, 3-4 desktop)
- [ ] Category filters narrow results
- [ ] Empty state shown when no results match
- [ ] Loading state shown during API call

**Files to Create:**

- `apps/web/src/components/search/SearchBar.tsx` (new)
- `apps/web/src/components/search/AutocompleteDropdown.tsx` (new)
- `apps/web/src/components/search/SearchResults.tsx` (new)
- `apps/web/src/components/search/CategoryFilters.tsx` (new)
- `apps/web/src/app/(dashboard)/search/page.tsx` (new)

---

### Task 8: Semantic search with Bedrock Titan (Phase 2b — Optional)

**Requirements:**

- Create OpenSearch ML Connector to Amazon Bedrock Titan Text Embeddings v2
- Create ingest pipeline that auto-generates embeddings on product sync
- Add k-NN field to products index mapping (1024 dimensions, cosine)
- Update search Lambda to support hybrid search: BM25 + k-NN
- Score blending: 0.7 × text_score + 0.3 × vector_score

**Acceptance Criteria:**

- [ ] ML Connector created and tested
- [ ] New products automatically get vector embeddings
- [ ] Searching "something for tough stains" returns cleaning products
- [ ] Hindi queries return relevant results
- [ ] Hybrid scoring produces better results than text-only

**Dependencies:** Tasks 1–7 must be complete. Bedrock Titan Embeddings model access enabled in us-east-1.

---

# Phase 3: Chat & Messaging Quality

## Task 1: WebSocket real-time messaging

**Requirements:**

- Replace polling with API Gateway WebSocket API + Lambda
- Maintain connection state in DynamoDB (connectionId, userId, connectedAt with TTL)
- Push new messages, order updates, and AI insights instantly to both seller and customer
- Handle reconnection gracefully on mobile (exponential backoff)
- Heartbeat every 30s to detect stale connections

**Acceptance Criteria:**

- [ ] Messages delivered in < 500ms (sender → receiver)
- [ ] Reconnection after network loss within 5s
- [ ] Connection state tracked in DynamoDB with 24h TTL
- [ ] Graceful fallback to polling if WebSocket fails
- [ ] CDK stack creates WebSocket API, routes ($connect, $disconnect, $default, sendMessage)

**Files to Create/Modify:**

- `infra/cdk/lib/stacks/websocket-stack.ts` (new)
- `services/api/src/handlers/websocket/connect.ts` (new)
- `services/api/src/handlers/websocket/disconnect.ts` (new)
- `services/api/src/handlers/websocket/sendMessage.ts` (new)
- `apps/web/src/lib/websocket-client.ts` (new)
- `apps/web/src/hooks/useWebSocket.ts` (new)

**Architecture:**

```
Client ←──WebSocket──→ API Gateway WS ←──→ Lambda handlers
                                              │
                                              ▼
                                         DynamoDB
                                    (connections table)
```

---

## Task 2: Message delivery receipts & read status

**Requirements:**

- Track message states: sent → delivered → read
- Show single check (sent), double check (delivered), blue double check (read)
- For Twilio WhatsApp messages, consume status callbacks (sent, delivered, read, failed)
- Sync Twilio delivery status to web chat messages in real-time via WebSocket

**Acceptance Criteria:**

- [ ] Message status visible in chat UI (check marks)
- [ ] Twilio status webhooks update message records in DynamoDB
- [ ] Status changes pushed to sender's WebSocket in real-time
- [ ] Failed messages shown with retry option

**Files to Create/Modify:**

- `services/api/src/handlers/whatsapp/statusCallback.ts` (new or modify)
- `apps/web/src/components/chat/MessageStatus.tsx` (new)

---

## Task 3: Rich message types

**Requirements:**

- Support in chat: product cards (image + price + "Add to cart" button), order status cards, AI suggestion cards, and quick-reply buttons
- Render natively on web with proper card styling
- Map to WhatsApp interactive message templates for Twilio outbound
- Message type field in DynamoDB: text, product_card, order_status, ai_suggestion, quick_reply

**Acceptance Criteria:**

- [ ] Product card renders in chat with image, name, price, and action button
- [ ] Order status card shows order ID, status, and tracking
- [ ] Quick-reply buttons send predefined messages on tap
- [ ] Same message renders appropriately on both web and WhatsApp

---

## Task 4: Typing indicators & presence

**Requirements:**

- Show "Dragon Store is typing..." with animated dots
- Track seller online/offline status via WebSocket heartbeats
- Display last-seen time on customer side when seller is offline
- Auto-reply with estimated response time when seller is offline

**Acceptance Criteria:**

- [ ] Typing indicator appears within 200ms of seller starting to type
- [ ] Online/offline status accurate within 60s
- [ ] Last-seen timestamp displayed when seller goes offline
- [ ] Auto-reply message sent after 30s if seller is offline

---

# Phase 4: OCR, CSV & Production Hardening

## Task 1: OCR confidence scoring & review flow

**Requirements:**

- Gemini Vision extractions return confidence per field (product name, quantity, price)
- Low-confidence fields (< 0.8) highlighted in amber for seller review
- Side-by-side view: original Khata photo on left, extracted data table on right
- Seller can edit extracted values before committing to inventory
- "Accept All" and "Edit & Accept" actions

**Acceptance Criteria:**

- [ ] Confidence scores displayed per extracted field
- [ ] Low-confidence fields visually highlighted
- [ ] Side-by-side layout on desktop, stacked on mobile
- [ ] Editable fields before inventory commit
- [ ] Audit trail: original OCR output preserved even after edits

---

## Task 2: CSV validation with detailed error feedback

**Requirements:**

- Smart CSV Upload AI analysis step returns row-level errors
- Error types: missing required field, invalid data type, duplicate product, price out of range
- Interactive error table with row number, field, error description, suggested fix
- "Auto-fix" button for obvious corrections (e.g., remove currency symbols from price)
- Allow partial import of valid rows (skip error rows)

**Acceptance Criteria:**

- [ ] Row-level errors displayed after AI analysis
- [ ] Each error shows: row number, column, value, error, suggestion
- [ ] Auto-fix resolves > 50% of common errors
- [ ] Partial import works — valid rows imported, errors skipped
- [ ] Summary: "Imported 45/50 rows. 5 rows had errors."

---

## Task 3: Hindi/regional language OCR improvements

**Requirements:**

- Add explicit language hints to Gemini Vision prompts for Khata books
- Post-processing pipeline: normalize Hindi numerals (१२३ → 123), handle mixed-script product names, map common abbreviations (kg, pkt, dz, pc)
- Maintain a lookup table of common Hindi product names → English mappings
- Support Devanagari + Latin mixed entries

**Acceptance Criteria:**

- [ ] Hindi numerals converted correctly
- [ ] Mixed Hindi-English product names extracted accurately
- [ ] Common abbreviations expanded (pkt → packet, dz → dozen)
- [ ] OCR accuracy > 85% on sample Khata book images

---

## Task 4: Error boundaries & retry logic

**Requirements:**

- Wrap all AI API calls (Gemini, Bedrock, Grok) with exponential backoff (3 retries, 1s/2s/4s)
- Circuit breaker pattern: after 5 consecutive failures, stop calling for 60s
- React error boundaries around every dashboard section
- Graceful fallbacks: if AI Insights fails, show "Insights temporarily unavailable" instead of blank screen
- Toast notifications for transient errors with retry button

**Acceptance Criteria:**

- [ ] AI API failures don't crash the page
- [ ] Retry logic handles 429 (rate limit) and 503 (service unavailable)
- [ ] Circuit breaker prevents cascading failures
- [ ] Every dashboard section has an error boundary with fallback UI
- [ ] User can manually retry failed operations

**Files to Create:**

- `services/api/src/utils/retry.ts` (new)
- `services/api/src/utils/circuit-breaker.ts` (new)
- `apps/web/src/components/common/ErrorBoundary.tsx` (new)
- `apps/web/src/components/common/ErrorFallback.tsx` (new)

---

## Task 5: Seller-facing observability dashboard

**Requirements:**

- New "System Health" tab in seller dashboard
- Metrics: API response times (p50, p95), OCR success rate, message delivery rate, AI insight generation count
- Pull from CloudWatch metrics via new Lambda handler
- Time range selector: last 1h, 6h, 24h, 7d
- Simple line charts for trends

**Acceptance Criteria:**

- [ ] System Health tab accessible from seller dashboard
- [ ] 4 metric cards with current values
- [ ] Trend charts for each metric
- [ ] Time range selection works
- [ ] Data refreshes every 60s

---

# Cost Estimates

## Dev Environment — Monthly Additional Costs

| Service | Estimated Cost |
|---------|---------------|
| OpenSearch Serverless (2 OCU min) | $60–150/month |
| OpenSearch Ingestion (1 OCU) | $30–50/month |
| DynamoDB PITR storage | ~$5/month (small table) |
| DynamoDB Streams reads | ~$2/month |
| S3 export bucket | < $1/month |
| API Gateway WebSocket | ~$3/month (low traffic) |
| **Total additional** | **~$100–210/month** |

> **Cost tip**: Stop the OSIS pipeline when not actively testing to save OCU costs. In production, keep it running for real-time sync.

## Production Scaling Notes

- OpenSearch Serverless auto-scales OCUs based on traffic — monitor costs weekly
- WebSocket connections: API Gateway charges per million connection-minutes (~$0.25/million)
- Bedrock Titan Embeddings: ~$0.0001 per 1K tokens (very cheap for product descriptions)

---

# Testing Checklist

## Mobile UI Testing

- [ ] Chrome DevTools → Toggle Device Toolbar → iPhone 12, Pixel 5, iPad
- [ ] Test on real Android device (seller's perspective)
- [ ] Lighthouse mobile score > 80
- [ ] All touch targets ≥ 48px (Chrome Accessibility audit)
- [ ] PWA installable on Android Chrome
- [ ] Offline fallback page displays correctly

## OpenSearch Testing

- [ ] Create product via API → appears in search within 60s
- [ ] Update product → search reflects change within 60s
- [ ] Delete product → removed from search within 60s
- [ ] Fuzzy search works for common typos
- [ ] Hindi product names searchable
- [ ] Autocomplete returns results within 200ms

## Chat Testing

- [ ] WebSocket connects on page load
- [ ] Messages delivered in < 500ms
- [ ] Reconnection after network loss
- [ ] Twilio status webhooks update message status
- [ ] Rich message cards render correctly

## Production Hardening

- [ ] AI API failures handled gracefully (no blank screens)
- [ ] Circuit breaker activates after repeated failures
- [ ] OCR confidence scoring visible on review screen
- [ ] CSV partial import works with error summary
- [ ] Error boundaries catch component-level crashes
