I need a COMPLETE fix of VyaparGyan — bugs, frontend-backend connection, UI/UX, and deployment. Multiple things are broken. Work through this document section by section. Do NOT skip ahead. Show me results at each checkpoint before proceeding.

## Environment
- AWS Account: 856888988795
- Region: ap-south-1
- DynamoDB Table: dev-vyapargyan-main
- Cognito Pool: ap-south-1_Hp1Vjdo7V
- Frontend: https://golden007-prog.github.io/Vyapar-Gyan/
- Twilio Bot: +1 (947) 234-9399
- Seller (Dragon Store Owner): +91 89270 49085
- Customer (Enigma): +91 70011 24396

---

# SECTION A: FRONTEND → BACKEND CONNECTION (do this FIRST)

The frontend at golden007-prog.github.io/Vyapar-Gyan/ is NOT connecting to the deployed backend. Web chat messages stay client-side only in localStorage — they never reach DynamoDB or the seller's Inbox. This is the #1 blocker. Fix it first.

## A1: Get the current API Gateway endpoints from AWS

```bash
aws apigatewayv2 get-apis --region ap-south-1 --query "Items[?ProtocolType=='HTTP'].[Name,ApiEndpoint]" --output table
aws apigatewayv2 get-apis --region ap-south-1 --query "Items[?ProtocolType=='WEBSOCKET'].[Name,ApiEndpoint]" --output table
aws cognito-idp list-user-pool-clients --user-pool-id ap-south-1_Hp1Vjdo7V --region ap-south-1 --query "UserPoolClients[*].[ClientId,ClientName]" --output table
```

Show me the output.

## A2: Check what the frontend currently has for env vars

```bash
cat apps/web/.env 2>/dev/null
cat apps/web/.env.local 2>/dev/null
cat apps/web/.env.production 2>/dev/null
cat apps/web/.env.development 2>/dev/null
cat .github/workflows/deploy-gh-pages.yml | grep -A5 "env\|ENV\|NEXT_PUBLIC"
grep -r "NEXT_PUBLIC_API\|NEXT_PUBLIC_WS\|NEXT_PUBLIC_COGNITO\|apiUrl\|wsUrl\|websocketUrl\|API_BASE" apps/web/src/ --include="*.ts" --include="*.tsx" -l
```

Show me the output.

## A3: Set correct environment variables

Create or update `apps/web/.env.production` with the EXACT values from A1:
```
NEXT_PUBLIC_API_URL=https://{http-api-id}.execute-api.ap-south-1.amazonaws.com
NEXT_PUBLIC_WS_URL=wss://{websocket-api-id}.execute-api.ap-south-1.amazonaws.com/dev
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-south-1_Hp1Vjdo7V
NEXT_PUBLIC_COGNITO_CLIENT_ID={client-id-from-A1}
NEXT_PUBLIC_COGNITO_REGION=ap-south-1
```

ALSO update the GitHub Actions workflow `.github/workflows/deploy-gh-pages.yml` if it sets env vars during build.

## A4: Find and DISABLE demo mode / localStorage chat

The frontend has a "demo mode" or "chat-bridge" that stores messages in localStorage instead of sending to the backend. Find it and disable it:

```bash
grep -rn "demo\|Demo\|DEMO\|localStorage\|sessionStorage\|chat-bridge\|chatBridge\|mockMessage\|mockChat\|fakeMessage\|localMessage" apps/web/src/ --include="*.ts" --include="*.tsx" | head -40
```

Read every file found. If there is:
- A `DEMO_MODE` or `USE_LOCAL_STORAGE` flag → set it to `false` for production
- A chat-bridge module that intercepts `sendMessage` and writes to localStorage → bypass it when `NEXT_PUBLIC_API_URL` is set
- A condition like `if (!wsConnected) { saveToLocalStorage(msg) }` → change to `if (!wsConnected) { sendViaHTTPApi(msg) }` as fallback

The rule: messages MUST go to the backend. localStorage is NOT acceptable as primary storage.

## A5: Verify WebSocket client connects correctly

```bash
cat apps/web/src/lib/websocket-client.ts 2>/dev/null || find apps/web/src -name "*websocket*" -o -name "*ws-client*" -o -name "*socket*" | head -5
```

Read the WebSocket client. Verify:
- URL comes from `process.env.NEXT_PUBLIC_WS_URL` or equivalent
- JWT token is included: `wss://{api-id}.execute-api.ap-south-1.amazonaws.com/dev?token={jwt}`
- Reconnection logic works (exponential backoff)
- If WebSocket fails, messages fall back to HTTP POST, NOT localStorage

## A6: Verify API client sends authenticated requests

```bash
find apps/web/src -name "*api*" -name "*.ts" | head -10
grep -rn "fetch\|axios\|Authorization\|Bearer\|getToken\|idToken" apps/web/src/lib/ apps/web/src/utils/ --include="*.ts" | head -20
```

Read the API client. Verify:
- Base URL comes from `process.env.NEXT_PUBLIC_API_URL`
- Cognito JWT token is included in `Authorization: Bearer {token}` header
- Base URL is NOT localhost or a placeholder

## A7: Verify chat component sends to backend

```bash
grep -rn "sendMessage\|handleSend\|onSubmit\|handleSubmit" apps/web/src/components/chat/ apps/web/src/app/ --include="*.tsx" -l
```

Read the chat send handler. It must:
1. Call WebSocket `sendMessage()` if connected
2. OR call HTTP API POST if WebSocket is disconnected
3. NOT just push to a React state array or localStorage

## CHECKPOINT A: After fixes A1-A7, rebuild and test locally

```bash
cd apps/web && pnpm build
```

If build succeeds, do a quick sanity check: are the env vars baked into the build?
```bash
grep -r "execute-api" apps/web/.next/ 2>/dev/null | head -5 || grep -r "execute-api" apps/web/out/ 2>/dev/null | head -5
```

Show me the results before proceeding to Section B.

---

# SECTION B: WHATSAPP BACKEND FIXES

## B1: WhatsApp Worker must publish message.created events to EventBridge

Read `services/api/src/handlers/whatsapp/worker.ts` and verify it publishes events. If NOT, add EventBridge publishing at TWO points:

### B1a: INBOUND — When customer/seller message is received
After storing the message in DynamoDB, publish:
```typescript
await eventBridge.putEvents({
  Entries: [{
    Source: 'vyapargyan.messaging',
    DetailType: 'message.created',
    EventBusName: process.env.EVENT_BUS_NAME,
    Detail: JSON.stringify({
      messageId: message.messageId,
      threadId: `THREAD#${message.senderUserId}`,
      senderUserId: message.senderUserId,
      senderType: message.senderType,
      recipientUserId: resolvedRecipientId,
      channel: 'whatsapp',
      content: message.content,
      metadata: { waMessageId: message.waMessageId, twilioSid: message.twilioSid }
    })
  }]
}).promise();
```

### B1b: OUTBOUND — When bot sends a response
After every Twilio sendMessage call, also publish:
```typescript
await eventBridge.putEvents({
  Entries: [{
    Source: 'vyapargyan.messaging',
    DetailType: 'message.created',
    Detail: JSON.stringify({
      messageId: generatedMessageId,
      threadId: `THREAD#${recipientUserId}`,
      senderUserId: 'system',
      senderType: 'system',
      recipientUserId: recipientUserId,
      channel: 'system',
      content: botResponseText,
      metadata: {}
    })
  }]
}).promise();
```

### B1c: Verify Lambda has EventBridge permissions
Check CDK — worker Lambda needs `events:PutEvents` on the bus. Add if missing.

### B1d: Verify EVENT_BUS_NAME env var
```bash
aws events list-event-buses --region ap-south-1 --query "EventBuses[*].Name" --output text
```
Make sure this bus name is passed to the worker Lambda as `EVENT_BUS_NAME`.

## B2: Fix Role-Based Routing

### B2a: Verify phone lookup GSI entries exist
```bash
# Customer
aws dynamodb query --table-name dev-vyapargyan-main --region ap-south-1 --index-name GSI1 \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"PHONE#+918927049085"}}' --output json

# Also try without +91
aws dynamodb query --table-name dev-vyapargyan-main --region ap-south-1 --index-name GSI1 \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"PHONE#8927049085"}}' --output json

# Repeat for customer phone
aws dynamodb query --table-name dev-vyapargyan-main --region ap-south-1 --index-name GSI1 \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"PHONE#+917001124396"}}' --output json

aws dynamodb query --table-name dev-vyapargyan-main --region ap-south-1 --index-name GSI1 \
  --key-condition-expression "GSI1PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"PHONE#7001124396"}}' --output json
```

### B2b: Check phone normalization format
What does `normalizeIndianPhone("+918927049085")` return? Read `services/api/src/utils/phone-normalize.ts`. The output format MUST match the GSI1PK format stored in DynamoDB. If normalize returns "8927049085" but GSI1PK stores "PHONE#+918927049085", they won't match.

### B2c: Fix if records are missing or format mismatches
Create records with the CORRECT format that matches what the code queries:
```bash
# Determine the correct format by reading normalizeIndianPhone output
# Then create records matching that format
```

### B2d: Verify role routing in worker.ts
Read `services/api/src/handlers/whatsapp/worker.ts`. Before ANY state routing, it MUST:
```typescript
const resolvedUser = await resolveUserByPhone(incomingPhone);
if (!resolvedUser) return handleOnboarding(context);
if (resolvedUser.role === 'seller') return handleSellerCopilot(context, resolvedUser);
if (resolvedUser.role === 'customer') return handleCustomerDiscovery(context, resolvedUser);
```

## B3: Fix Customer Discovery — "Hello" treated as store search

When customer sends "Hello", the bot responds "No stores found for Hello" instead of showing the Store Discovery menu.

Read `services/api/src/handlers/whatsapp/customer-discovery.ts`:
- Add greeting detection BEFORE store search: if message is "hello", "hi", "hey", "namaste", "hola" → show Store Discovery menu
- Only search for stores when customer explicitly selects option 3 or provides a store name AFTER seeing the menu

The correct flow:
```
Customer: "Hello"
Bot: "Hello, Enigma! 👋
Let's get you shopping. How would you like to find a store today?
1️⃣ My favorite stores
2️⃣ Search stores by pincode/city
3️⃣ Search all stores
4️⃣ Browse Dragon Store (last visited)
💬 Reply with a number or type a store name to search."

Customer: "3" or "Dragon Store"
Bot: [searches and finds Dragon Store]

Customer: "1"
Bot: [shows favorite stores list]
```

## B4: Fix Store Search — "Dragon Store" returns "No stores found"

When customer types "Dragon Store", the bot can't find it.

### Diagnose:
```bash
# Check Dragon Store seller profile in DynamoDB
aws dynamodb scan --table-name dev-vyapargyan-main --region ap-south-1 \
  --filter-expression "contains(storeName, :name) OR contains(#n, :name)" \
  --expression-attribute-values '{":name":{"S":"Dragon"}}' \
  --expression-attribute-names '{"#n":"displayName"}' \
  --projection-expression "PK,SK,storeName,displayName,city,pincode,GSI1PK,GSI2PK,#s" \
  --expression-attribute-names '{"#n":"displayName","#s":"status"}' \
  --output json 2>/dev/null | head -50
```

### Likely causes:
1. Seller record exists but doesn't have `storeName` attribute (might be `displayName` or `businessName`)
2. Store search queries OpenSearch but Dragon Store isn't indexed
3. Store search uses a GSI that doesn't exist or has wrong PK format
4. Search is case-sensitive

### Fix:
- Read `customer-discovery.ts` store search function
- Make search case-insensitive: `storeName.toLowerCase().includes(query.toLowerCase())`
- Add DynamoDB scan fallback if OpenSearch search returns empty
- Verify Dragon Store record has the field the search is looking for

## B5: Fix Seller Copilot greeting

When seller (+918927049085) messages the bot, they should get:
```
Hello, Dragon Store Owner! 🏪
What would you like to manage today?
1️⃣ Check stock
2️⃣ Configure trend alerts
3️⃣ Review pending campaigns
4️⃣ Quick inventory summary
Reply with a number or describe what you need.
```

Read `services/api/src/handlers/whatsapp/seller-copilot.ts` and verify this greeting is sent when a seller sends any first message (hello, hi, or any text).

## CHECKPOINT B: Deploy backend and test WhatsApp

```bash
cd infra/cdk
npx cdk deploy --all --context env=dev --context account=856888988795 --context region=ap-south-1 --require-approval never
```

After deploy, test:
```bash
# Check worker logs after sending WhatsApp message
aws logs tail /aws/lambda/$(aws lambda list-functions --region ap-south-1 --query "Functions[?contains(FunctionName, 'whatsapp-worker') || contains(FunctionName, 'whatsapp_worker')].FunctionName" --output text | head -1) --since 5m --region ap-south-1 --format short | tail -30

# Check fan-out Lambda logs
aws logs tail /aws/lambda/$(aws lambda list-functions --region ap-south-1 --query "Functions[?contains(FunctionName, 'fanout')].FunctionName" --output text | head -1) --since 5m --region ap-south-1 --format short | tail -30
```

Show me the logs before proceeding to Section C.

---

# SECTION C: VERIFY FAN-OUT LAMBDA AND EVENTBRIDGE

## C1: Verify fan-out Lambda is deployed
```bash
aws lambda list-functions --region ap-south-1 --query "Functions[?contains(FunctionName, 'fanout') || contains(FunctionName, 'fan-out')].FunctionName" --output text
```

## C2: Verify EventBridge rules exist
```bash
# Get the event bus name
BUS_NAME=$(aws events list-event-buses --region ap-south-1 --query "EventBuses[?Name!='default'].Name" --output text | head -1)
echo "Event bus: $BUS_NAME"

# List all rules on the bus
aws events list-rules --event-bus-name $BUS_NAME --region ap-south-1 --query "Rules[*].[Name,State]" --output table
```

## C3: Verify fan-out Lambda has correct permissions
```bash
FANOUT_NAME=$(aws lambda list-functions --region ap-south-1 --query "Functions[?contains(FunctionName, 'fanout')].FunctionName" --output text | head -1)
aws lambda get-function --function-name $FANOUT_NAME --region ap-south-1 --query "Configuration.Environment.Variables" --output json
```

The fan-out Lambda needs these env vars:
- `TABLE_NAME` — DynamoDB table name
- `WEBSOCKET_ENDPOINT` — WebSocket API Management URL (https://{api-id}.execute-api.ap-south-1.amazonaws.com/dev)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (or Secrets Manager ARN)
- `TWILIO_PHONE_NUMBER` — the bot phone number

## C4: Verify WebSocket API has correct routes
```bash
WS_API_ID=$(aws apigatewayv2 get-apis --region ap-south-1 --query "Items[?ProtocolType=='WEBSOCKET'].ApiId" --output text | head -1)
aws apigatewayv2 get-routes --api-id $WS_API_ID --region ap-south-1 --query "Items[*].RouteKey" --output table
```

Should show: `$connect`, `$disconnect`, `$default`, `sendMessage`

## C5: Verify Twilio webhook URL
Check what URL Twilio is calling for WhatsApp webhooks:
```bash
grep -rn "WEBHOOK_URL\|TWILIO_WEBHOOK\|whatsapp.*url\|twilio.*endpoint" infra/cdk/lib/ services/api/src/utils/ apps/web/.env* --include="*.ts" --include="*.env*" | head -10
```

The Twilio webhook URL should be: `https://{http-api-id}.execute-api.ap-south-1.amazonaws.com/whatsapp/webhook`

If it's wrong, tell me what the correct URL should be — I'll update it in the Twilio console.

## CHECKPOINT C: Show me all verification results before proceeding.

---

# SECTION D: UI/UX IMPROVEMENTS (after all bugs are fixed)

## D1: Channel indicators in seller Inbox
Each message in the seller's Inbox should show which channel it came from:
- 📱 WhatsApp icon — for messages from WhatsApp
- 🌐 Web icon — for messages from web chat  
- 🤖 Bot icon — for AI/system auto-replies

Read `apps/web/src/components/chat/MessageList.tsx` or the Inbox message component. Add a small icon next to each message based on the `channel` field (whatsapp/web/system).

## D2: Seller online/offline status in customer chat
The customer chat header shows "Dragon Store — Offline · Web + WhatsApp". Improve:
- Green dot + "Online" when seller has active WebSocket connection (query PRESENCE#{sellerId} from DynamoDB)
- "Last seen: X min ago" when recently active
- Gray dot + "Offline" when inactive 30+ minutes

## D3: Message delivery status indicators in customer chat
Customer's sent messages should show:
- 🕐 Clock — queued/sending
- ✓ Single check — sent (reached server)
- ✓✓ Double gray — delivered (reached seller)
- ✓✓ Double blue — read (seller opened)
- ❌ Red — failed (with retry button)

This should already exist from the MessageStatus component built earlier. Verify it's rendering correctly.

## D4: Loading states and error handling
- WebSocket connecting: show "Connecting..." with spinner in chat header
- WebSocket disconnected: show "Reconnecting..." with yellow banner
- Message send failed: show red retry button on the failed message
- API call failed: show toast notification with error message
- Page loading: show skeleton loaders, not blank screens

## D5: Seller Inbox empty state
When seller clicks "Demo Customer" but no messages have synced:
Instead of blank white space, show:
```
💬 Messages from this customer will appear here.
They can reach you via Web Chat or WhatsApp.
```

## D6: Mobile responsiveness check
Test these pages at 375px viewport width:
- Login page ✅
- Customer chat: input bar visible above virtual keyboard
- Seller Inbox: conversation list full-screen, tap to open chat
- Admin pages: bottom nav works

---

# SECTION E: FINAL DEPLOYMENT AND COMPREHENSIVE TESTING

## E1: Run all tests
```bash
pnpm --filter @vyapargyan/api test
```
All tests must pass. Fix any that break due to the bug fixes.

## E2: CDK deploy (if not already done in checkpoint B)
```bash
cd infra/cdk
npx cdk deploy --all --context env=dev --context account=856888988795 --context region=ap-south-1 --require-approval never
```

## E3: Build and push frontend
```bash
cd apps/web && pnpm build && cd ../..
git add .
git commit -m "fix: complete bug fixes + frontend-backend connection + UI/UX improvements

Backend fixes:
- WhatsApp worker publishes message.created events to EventBridge
- Role-based routing: seller gets Copilot, customer gets Discovery
- Fixed phone normalization GSI format mismatch
- Customer greeting shows Store Discovery menu (not store search)
- Dragon Store findable via case-insensitive search

Frontend fixes:
- Connected to real backend (disabled demo/localStorage mode)
- Correct API Gateway and WebSocket URLs in .env.production
- Cognito auth tokens passed in all API/WebSocket requests

UI/UX:
- Channel indicators in seller Inbox (WhatsApp/Web/Bot icons)
- Message delivery status checkmarks in customer chat
- Seller online/offline status with last seen
- Loading states, error toasts, skeleton loaders
- Meaningful empty states in Inbox
- Mobile responsiveness verified"

git push origin main
```

## E4: Wait for GitHub Pages deployment (2-3 minutes)

## E5: End-to-end smoke tests — report PASS/FAIL for EACH

### Test A: WhatsApp Customer Flow
1. Send "Hello" from +917001124396 to WhatsApp bot (+19472349399)
   - EXPECTED: Store Discovery menu with 4 options (NOT "no stores found")
2. Reply "3" then "Dragon Store"
   - EXPECTED: Enters Dragon Store catalog
3. Type "Amul Butter"
   - EXPECTED: Product card with price ₹280 and stock 45

### Test B: WhatsApp Seller Flow
1. Send "Hello" from +918927049085 to WhatsApp bot
   - EXPECTED: Seller Copilot menu (Check stock, Trend alerts, Campaigns, Summary)
2. Reply "1" or "check stock Amul Butter"
   - EXPECTED: Stock info for Amul Butter

### Test C: Web Chat → Seller Inbox Sync
1. Login as Customer (Enigma) at golden007-prog.github.io/Vyapar-Gyan/ (+917001124396 / DemoCustomer@123)
2. Go to Chat → Dragon Store → type "hello from web chat"
3. Login as Seller in another tab (+918927049085 / DemoSeller@123)
4. Go to Inbox → click Demo Customer
   - EXPECTED: "hello from web chat" appears in real-time (NOT "No messages yet")

### Test D: Seller Web Reply → Customer Chat
1. In seller Inbox, type "Welcome to Dragon Store!" and send
2. Check customer Chat tab
   - EXPECTED: "Welcome to Dragon Store!" appears within 2 seconds

### Test E: WhatsApp → Seller Web Inbox
1. Send WhatsApp from +917001124396: "I need Surf Excel"
2. Check seller web Inbox
   - EXPECTED: "I need Surf Excel" appears with WhatsApp 📱 icon

### Test F: Seller Web Reply → Customer WhatsApp
1. From seller web Inbox, reply to the WhatsApp message: "Surf Excel 1kg is ₹199, shall I add to cart?"
2. Check customer WhatsApp
   - EXPECTED: Reply arrives within 2 seconds

### Test G: Human Handoff
1. When seller replies from web Inbox, check Inbox header
   - EXPECTED: Shows "Human mode" indicator
2. Customer sends another WhatsApp message
   - EXPECTED: Goes directly to seller Inbox (AI bot does NOT respond)
3. Seller types `/ai` in Inbox
   - EXPECTED: Switches back to "AI mode"

For any FAILED test, immediately check CloudWatch:
```bash
aws logs tail /aws/lambda/dev-vyapargyan-whatsapp-worker --since 5m --region ap-south-1 --format short | tail -30
aws logs tail /aws/lambda/dev-vyapargyan-message-fanout --since 5m --region ap-south-1 --format short | tail -30
```

Fix the issue and re-test. Do NOT report a test as complete until it PASSES.

---

# EXECUTION ORDER (strict — no skipping)

```
SECTION A: Frontend-Backend Connection
  A1 → A2 → A3 → A4 → A5 → A6 → A7 → CHECKPOINT A (build test)

SECTION B: WhatsApp Backend Fixes  
  B1 → B2 → B3 → B4 → B5 → CHECKPOINT B (deploy + WhatsApp test)

SECTION C: Infrastructure Verification
  C1 → C2 → C3 → C4 → C5 → CHECKPOINT C (show results)

SECTION D: UI/UX Improvements
  D1 → D2 → D3 → D4 → D5 → D6

SECTION E: Final Deploy + Testing
  E1 → E2 → E3 → E4 → E5 (all 7 tests must PASS)
```

Start with Section A, Step A1. Show me the output before proceeding to A2.
