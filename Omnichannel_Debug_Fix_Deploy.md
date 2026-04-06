I need you to do a complete end-to-end debug, fix, and deploy of the Real-Time Omnichannel Chat Synchronization feature. It's partially working — web chat messages show in the seller Inbox, but the full bi-directional sync (seller web reply → customer WhatsApp, and WhatsApp message → web dashboard) is NOT functioning. I need you to systematically diagnose every component, fix what's broken, deploy everything, and verify it works.

## Context

- AWS Account: 257656107715
- Region: ap-south-1
- DynamoDB Table: dev-vyapargyan-main
- Cognito Pool: ap-south-1_Hp1Vjdo7V
- EventBridge Bus: vyapargyan-dev-bus (or whatever it's named — check CDK)
- Twilio WhatsApp Bot Number: +1 (947) 234-9399
- Seller Phone: +918927049085
- Customer Phone: +917001124396
- Frontend: https://golden007-prog.github.io/Vyapar-Gyan/
- GitHub Pages deploys via: .github/workflows/deploy-gh-pages.yml

## Step 1: Diagnose — Check every component in the sync chain

Run these diagnostic commands and report the results:

### 1.1 Check if fan-out Lambda exists
```bash
aws lambda list-functions --region ap-south-1 --query "Functions[?contains(FunctionName, 'fanout') || contains(FunctionName, 'fan-out') || contains(FunctionName, 'message')].[FunctionName, LastModified, Runtime]" --output table
```

### 1.2 Check EventBridge bus and rules
```bash
# List all event buses
aws events list-event-buses --region ap-south-1 --output table

# List all rules on each bus (try both default and custom bus names)
aws events list-rules --region ap-south-1 --output table
aws events list-rules --event-bus-name vyapargyan-dev --region ap-south-1 --output table 2>/dev/null
aws events list-rules --event-bus-name dev-vyapargyan --region ap-south-1 --output table 2>/dev/null
```

### 1.3 Check WebSocket API exists and has routes
```bash
aws apigatewayv2 get-apis --region ap-south-1 --query "Items[?ProtocolType=='WEBSOCKET'].[Name, ApiId, ApiEndpoint]" --output table
```

### 1.4 Check all deployed Lambda functions related to messaging
```bash
aws lambda list-functions --region ap-south-1 --query "Functions[?contains(FunctionName, 'vyapargyan') || contains(FunctionName, 'dev-')].[FunctionName]" --output table
```

### 1.5 Check Twilio webhook URL configuration
Look at the Twilio webhook URL in your environment config or CDK — is it pointing to the current API Gateway endpoint?

### 1.6 Check CloudWatch logs for errors
```bash
# Check WhatsApp webhook handler logs
aws logs describe-log-groups --region ap-south-1 --log-group-name-prefix "/aws/lambda/dev" --query "logGroups[*].logGroupName" --output table

# Tail recent logs for any errors
aws logs tail /aws/lambda/dev-vyapargyan-whatsapp-webhook --since 30m --region ap-south-1 2>/dev/null || echo "Not found"
aws logs tail /aws/lambda/dev-vyapargyan-whatsapp-worker --since 30m --region ap-south-1 2>/dev/null || echo "Not found"
```

## Step 2: Verify CDK stacks have all required resources

### 2.1 Check events-stack.ts has message.created rule
Read `infra/cdk/lib/stacks/events-stack.ts` and verify it includes:
- An EventBridge rule matching `source: "vyapargyan.messaging"` and `detail-type: "message.created"`
- That rule targets the fan-out Lambda
- The fan-out Lambda has permissions to: query DynamoDB (connection records), invoke API Gateway WebSocket management API (for pushing to WebSocket connections), and call Twilio API

### 2.2 Check api-stack.ts has fan-out Lambda
Read `infra/cdk/lib/stacks/api-stack.ts` and verify the fan-out Lambda handler is defined.

### 2.3 Check websocket-stack.ts has correct handlers
Read `infra/cdk/lib/stacks/websocket-stack.ts` and verify:
- sendMessage handler publishes `message.created` to EventBridge after storing in DynamoDB
- $default handler handles heartbeat, typing, markRead, and sync actions

### 2.4 Check the fan-out Lambda handler code
Read `services/api/src/handlers/messaging/fanout.ts` and verify:
- It receives EventBridge events
- It checks recipient's active channels (WebSocket connections via DynamoDB, WhatsApp via phone number)
- It pushes to WebSocket via API Gateway Management API
- It pushes to WhatsApp via Twilio adapter
- It skips the originating channel (no echo)

### 2.5 Check message-router service
Read `services/api/src/services/message-router.ts` and verify:
- `routeMessage()` stores message in DynamoDB with dual-thread write
- It publishes `message.created` event to EventBridge
- It includes the `channel` field (whatsapp/web/system)

### 2.6 Check WhatsApp worker integration
Read `services/api/src/handlers/whatsapp/worker.ts` and verify:
- After processing a WhatsApp message, it calls `messageRouter.routeMessage()` (not just storing directly in DynamoDB)
- The channel is set to "whatsapp"
- The recipientUserId is set correctly (seller's userId for customer messages)

### 2.7 Check WebSocket sendMessage handler
Read `services/api/src/handlers/websocket/sendMessage.ts` (or equivalent) and verify:
- After storing a seller's reply, it calls `messageRouter.routeMessage()` or publishes `message.created` to EventBridge
- The channel is set to "web"

## Step 3: Fix all issues found

Based on the diagnosis, fix every issue. Common problems to check:

### 3.1 Missing EventBridge rule
If the `message.created` rule doesn't exist in events-stack.ts, add it:
```typescript
const messageCreatedRule = new events.Rule(this, 'MessageCreatedRule', {
  eventBus: bus,
  eventPattern: {
    source: ['vyapargyan.messaging'],
    detailType: ['message.created'],
  },
  targets: [new targets.LambdaFunction(fanoutLambda)],
});
```

### 3.2 Missing fan-out Lambda
If the fan-out Lambda isn't defined in CDK, add it with correct permissions:
- DynamoDB read (for CONNECTION# records)
- API Gateway Management API (for WebSocket push: execute-api:ManageConnections)
- Twilio credentials access (Secrets Manager or environment variables)

### 3.3 WhatsApp worker not publishing events
If the WhatsApp worker stores messages directly in DynamoDB without publishing to EventBridge, modify it to use the message-router service.

### 3.4 WebSocket handler not publishing events
If the WebSocket sendMessage handler doesn't publish to EventBridge, add the event publication.

### 3.5 Incorrect API Gateway WebSocket endpoint
The fan-out Lambda needs the WebSocket API endpoint URL to push messages. Verify the endpoint is passed as an environment variable.

### 3.6 Missing IAM permissions
The fan-out Lambda needs:
- `dynamodb:Query` on the main table (for connection lookups)
- `execute-api:ManageConnections` on the WebSocket API (for pushing messages)
- `events:PutEvents` on the EventBridge bus (if it also publishes events)

### 3.7 Frontend WebSocket URL
Check `apps/web/src/lib/websocket-client.ts` — is the WebSocket URL pointing to the correct API Gateway WebSocket endpoint in ap-south-1? It should be `wss://{api-id}.execute-api.ap-south-1.amazonaws.com/{stage}`

### 3.8 CORS / Environment variables
Check `apps/web/.env.production` or equivalent — does it have the correct:
- `NEXT_PUBLIC_API_URL` pointing to the HTTP API Gateway
- `NEXT_PUBLIC_WS_URL` pointing to the WebSocket API Gateway
- `NEXT_PUBLIC_COGNITO_USER_POOL_ID` = ap-south-1_Hp1Vjdo7V
- `NEXT_PUBLIC_COGNITO_CLIENT_ID` = correct client ID

## Step 4: Deploy everything

After all fixes:

### 4.1 Run tests to make sure nothing broke
```bash
pnpm --filter @vyapargyan/api test
```
All 674 tests must pass.

### 4.2 CDK diff to preview changes
```bash
cd infra/cdk && npx cdk diff --all --context env=dev --context account=257656107715 --context region=ap-south-1
```
Report the diff — what's being added/changed.

### 4.3 CDK deploy
```bash
npx cdk deploy --all --context env=dev --context account=257656107715 --context region=ap-south-1 --require-approval never
```
Wait for all 8 stacks to deploy successfully.

### 4.4 Verify deployment
```bash
# Verify fan-out Lambda exists
aws lambda get-function --function-name dev-vyapargyan-fanout --region ap-south-1 --query "Configuration.[FunctionName, LastModified, State]" --output table 2>/dev/null || echo "MISSING"

# Verify EventBridge rule exists and is enabled
aws events list-rules --region ap-south-1 --query "Rules[?contains(Name, 'message') || contains(Name, 'Message')].[Name, State]" --output table

# Verify WebSocket API endpoint
aws apigatewayv2 get-apis --region ap-south-1 --query "Items[?ProtocolType=='WEBSOCKET'].[ApiEndpoint]" --output text
```

### 4.5 Build and push frontend
```bash
cd apps/web && pnpm build
cd ../..
git add .
git commit -m "fix: complete omnichannel sync - fan-out Lambda, EventBridge rules, WebSocket integration"
git push origin main
```
Wait for GitHub Actions to deploy to GitHub Pages.

## Step 5: End-to-end verification

After both backend (CDK) and frontend (GitHub Pages) are deployed, verify the complete flow:

### 5.1 Test Web Chat → Seller Inbox
1. Open https://golden007-prog.github.io/Vyapar-Gyan/login in browser tab 1
2. Login as Customer (Enigma): +917001124396 / DemoCustomer@123
3. Go to Chat → Dragon Store
4. Type "hello from web"
5. Open browser tab 2, login as Seller: +918927049085 / DemoSeller@123
6. Go to Inbox → Demo Customer should show "hello from web" in real-time

### 5.2 Test Seller Web Reply → Customer Chat
1. In seller's Inbox (tab 2), type a reply: "Hi! Welcome to Dragon Store"
2. In customer's Chat (tab 1), the reply should appear within 2 seconds

### 5.3 Test WhatsApp → Seller Web Inbox
1. Send a WhatsApp message from customer phone (+917001124396) to VyaparGyan bot (+1 947 234-9399): "I want Amul Butter"
2. In seller's web Inbox (tab 2), the WhatsApp message should appear with a WhatsApp icon indicator

### 5.4 Test Seller Web Reply → Customer WhatsApp
1. In seller's web Inbox, reply to the WhatsApp customer message
2. Customer should receive the reply on WhatsApp within 2 seconds

### 5.5 Test Human Handoff
1. When seller replies from web Inbox, verify the Inbox header shows "Human mode"
2. Send another WhatsApp message from customer — it should go directly to seller Inbox (no AI processing)
3. Type `/ai` in seller Inbox — verify it switches back to "AI mode"

Report the result of each test. If any test fails, check CloudWatch logs for the relevant Lambda and fix the issue.

Do all 5 steps in order. Do not skip any diagnostic check. Fix everything before deploying. The goal is a fully working omnichannel sync: WhatsApp ↔ Web, real-time, bi-directional.
