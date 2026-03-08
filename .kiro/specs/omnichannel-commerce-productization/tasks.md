# Implementation Tasks: Omnichannel Commerce Productization

## Phase 1: Foundation — Data Model, Auth & Core Services

- [x] 1. DynamoDB Entity Schemas & Shared Types
  - [x] 1.1 Add new entity types and interfaces to `packages/shared-contracts/src/types.ts`: UserProfile, UnifiedSession, Cart (with CartItem), MessageThread, OTP, ApprovalRecord, ConsentRecord (WhatsApp opt-in + service window), TemplateRegistry, Campaign (extended), AuditLog, RestockNotification — matching Section 1.1–1.11 of design
  - [x] 1.2 Create Zod validation schemas in `services/api/src/shared/schemas.ts` for all new entities and API request/response types defined in Section 2 (SendOTPSchema, VerifyOTPSchema, RegisterSchema, SyncQuerySchema, SendMessageSchema, AddToCartSchema, ApprovalsQuerySchema, CreateCampaignSchema, RejectSchema)
  - [x] 1.3 Update `services/api/src/adapters/dynamodb-adapter.ts` with new access patterns: USER#{userId} CRUD, SESSION#{userId} ACTIVE, CART#{userId} ACTIVE with version-based conditional writes, THREAD#{userId} MSG#{ts}#{id} queries, OTP#{phone} LATEST, APPROVAL#{approvalId}, CONSENT#{userId}, TEMPLATE#{templateSid}, CAMPAIGN#{campaignId}, AUDIT#{auditId}, RESTOCK_NOTIFY#{productId} USER#{userId}
  - [x] 1.4 Implement lazy data migration logic in `services/api/src/services/migration-service.ts`: dual-read fallback from CUSTOMER#{phone} to USER#{userId}, session migration from old SESSION#{customerId} SK:WHATSAPP#{phone} to SESSION#{userId} SK:ACTIVE, cart extraction from session.context JSON blob to CART#{userId} ACTIVE entity — per Section 1.0

- [x] 2. Cognito & Auth Infrastructure
  - [x] 2.1 Update `infra/cdk/lib/stacks/auth-stack.ts` to add `customer` group to Cognito User Pool alongside existing `admin` and `seller` groups
  - [x] 2.2 Add Cognito JWT authorizer to `infra/cdk/lib/stacks/api-stack.ts` using `HttpUserPoolAuthorizer` — new routes use JWT from day one, existing routes get dual-auth support per Section 10.1
  - [x] 2.3 Update `services/api/src/core/auth.ts` with `extractUserId()` that tries JWT claims first (`event.requestContext.authorizer.jwt.claims.sub`), falls back to `x-user-id` header for legacy routes during migration

- [x] 3. OTP Service & Auth Handlers (Req 1, 2)
  - [x] 3.1 Create `services/api/src/services/otp-service.ts`: generateOTP (crypto random 6-digit), storeOTP (SHA-256 hash, 10-min TTL), verifyOTP (hash compare + expiry check), checkCooldown (60s), checkLockout (3 failures → 1h lock)
  - [x] 3.2 Create `services/api/src/handlers/auth/otp-send-handler.ts`: validate phone (Indian mobile regex), check cooldown/lockout, generate OTP, store in DDB, send via TwilioAdapter SMS
  - [x] 3.3 Create `services/api/src/handlers/auth/otp-verify-handler.ts`: validate OTP against stored hash, update USER#{userId} phoneVerificationStatus, increment failure counter on invalid, set lockout on 3rd failure
  - [x] 3.4 Create `services/api/src/handlers/auth/register-handler.ts`: create Cognito user with role group, create USER#{userId} PROFILE in DDB with GSI1 PHONE#{phone} and GSI2 ROLE#{role}, check duplicate via GSI1, send welcome template via Twilio
  - [x] 3.5 Add API Gateway routes in CDK for POST /api/v1/auth/otp/send, POST /api/v1/auth/otp/verify, POST /api/v1/auth/register — unauthenticated

- [x] 4. Core Services Layer
  - [x] 4.1 Create `services/api/src/services/session-service.ts`: resolveOrCreateSession (by userId or phone via GSI1), updateSessionState, markExpired, restore session with existing cart on return
  - [x] 4.2 Create `services/api/src/services/cart-service.ts`: getCart, addItem (with DDB conditional write on cartVersion), updateQuantity, removeItem, validateCheckout (stock check), clearCart — all with optimistic concurrency and EventBridge CartUpdated publish
  - [x] 4.3 Create `services/api/src/services/consent-service.ts`: checkSendPermission (transactional bypass, opt-out check, quiet hours 22:00-09:00 IST, frequency cap 3/24h, service window check), recordInboundMessage (update serviceWindowExpiresAt), handleOptOut (STOP/Unsubscribe/रुको keywords)
  - [x] 4.4 Create `services/api/src/services/audit-service.ts`: logAction (create AUDIT#{auditId} with actor, action, resource, old/new values, GSI1 ACTOR#{actorId} and GSI2 RESOURCE#{type}#{id})
  - [x] 4.5 Create `services/api/src/services/template-registry-service.ts`: getTemplate, validateParameters (against Zod parameterSchema), listTemplates by category — reads from TEMPLATE#{templateSid} METADATA

## Phase 2: Messaging Pipeline — Chat, Sync & WhatsApp Compliance

- [x] 5. Chat & Sync Handlers (Req 3, 4, 12, 13)
  - [x] 5.1 Create `services/api/src/handlers/chat/chat-sync-handler.ts`: poll endpoint returning new messages (THREAD#{userId} since lastSyncTimestamp), cart state (if cartVersion differs), typing indicators, presence — return 304 if no updates, ETag header from cartVersion
  - [x] 5.2 Create `services/api/src/handlers/chat/chat-send-handler.ts`: store message in THREAD#{userId}, publish CustomerMessageSent event to EventBridge for cross-channel routing to seller
  - [x] 5.3 Create `services/api/src/handlers/chat/chat-typing-handler.ts`: store ephemeral typing indicator with short TTL
  - [x] 5.4 Create `services/api/src/handlers/chat/chat-history-handler.ts`: paginated query on THREAD#{userId} with cursor-based pagination, merge legacy message patterns if ENABLE_LEGACY_MESSAGE_QUERY flag is on (Section 1.0)
  - [x] 5.5 Add API Gateway routes in CDK for GET /api/v1/chat/sync, POST /api/v1/chat/messages, POST /api/v1/chat/typing, GET /api/v1/chat/history — all JWT-protected

- [x] 6. Cart API Handlers (Req 4)
  - [x] 6.1 Create `services/api/src/handlers/cart/cart-get-handler.ts`: return CART#{userId} ACTIVE with current version
  - [x] 6.2 Create `services/api/src/handlers/cart/cart-add-handler.ts`: validate product exists and in stock, add to cart with conditional write on cartVersion, return updated cart
  - [x] 6.3 Create `services/api/src/handlers/cart/cart-update-handler.ts`: update quantity with version check, recalculate subtotal
  - [x] 6.4 Create `services/api/src/handlers/cart/cart-remove-handler.ts`: remove item with version check, return 409 on conflict
  - [x] 6.5 Create `services/api/src/handlers/cart/cart-checkout-handler.ts`: validate all items in stock via conditional reads, create order via existing order-service, clear cart on success, reject with alternatives on stock failure
  - [x] 6.6 Add API Gateway routes in CDK for GET /api/v1/cart, POST /api/v1/cart/items, PUT /api/v1/cart/items/{productId}, DELETE /api/v1/cart/items/{productId}, POST /api/v1/cart/checkout — all JWT-protected

- [x] 7. WhatsApp Status Webhook & TwilioAdapter Changes (Req 6, 14)
  - [x] 7.1 Update `services/api/src/adapters/twilio-adapter.ts`: add `statusCallback` URL parameter to `sendWithRetry()` method's `messages.create()` call, extend `SendMessageResult` interface with `statusCallbackConfigured` field — per Section 5.3
  - [x] 7.2 Create `services/api/src/handlers/whatsapp/status-webhook-handler.ts`: verify Twilio signature, parse raw StatusCallback fields (MessageSid, MessageStatus, ErrorCode, ErrorMessage, To), update THREAD message deliveryStatus, idempotency check on MessageSid+MessageStatus — per Section 5.4
  - [x] 7.3 Add API Gateway route in CDK for POST /api/v1/whatsapp/status — unauthenticated with Twilio signature verification
  - [x] 7.4 Add `API_BASE_URL` environment variable to CDK config and all Lambda functions that send Twilio messages

- [x] 8. Notification Router & Cross-Channel Bridging (Req 11, 12, 14)
  - [x] 8.1 Create `services/api/src/handlers/workers/notification-router-worker.ts`: consume CustomerMessageSent events, look up seller/customer preferredChannel, route to WhatsApp (via TwilioAdapter with service window check) or web (already in THREAD), handle bidirectional bridging — per Section 3.3
  - [x] 8.2 Add EventBridge rule `{prefix}-customer-message-route` targeting notification router worker for source: vyapargyan.chat, detail-type: CustomerMessageSent

- [x] 9. WhatsApp Worker Updates (Req 3, 6, 11, 13)
  - [x] 9.1 Update existing `services/api/src/handlers/whatsapp/webhook.ts`: add idempotency check (IDEMPOTENCY#{messageSid} conditional write) before publishing to EventBridge, per Req 13
  - [x] 9.2 Update existing `services/api/src/handlers/whatsapp/worker.ts`: resolve user via GSI1 PHONE#{phone} → USER#{userId} (with lazy migration fallback per Section 1.0), use new SESSION#{userId} and CART#{userId} entities, store messages in THREAD#{userId}, update CONSENT#{userId} SERVICE_WINDOW on inbound
  - [x] 9.3 Update seller routing in worker: replace hardcoded test number check with GSI1 phone lookup → check if user has role=seller and sellerStatus=approved, route to copilot vs customer flow per Req 11
  - [x] 9.4 Add opt-out keyword detection in worker: check for STOP/Unsubscribe/रुको/बंद करो → call consentService.handleOptOut() per Req 6

## Phase 3: Approval Engine, Campaigns & Seller Features

- [x] 10. Approval Engine (Req 5, 9)
  - [x] 10.1 Create `services/api/src/services/approval-service.ts`: createApproval (with priorityScore calculation: revenueImpact×0.4 + stockAge×0.3 + timeSensitivity×0.3), transitionStatus, executeApproval (publish EventBridge event), getApprovalsBySeller (GSI1 query)
  - [x] 10.2 Create `services/api/src/handlers/seller/approvals-list-handler.ts`: query GSI1 SELLER#{sellerId} filtered by status, sorted by priorityScore descending, cursor-based pagination
  - [x] 10.3 Create `services/api/src/handlers/seller/approval-detail-handler.ts`: return full approval with affected products, current vs proposed values
  - [x] 10.4 Create `services/api/src/handlers/seller/approval-approve-handler.ts`: update status to approved, set approvedAt/approvedBy, publish ApprovalApproved event, log to audit
  - [x] 10.5 Create `services/api/src/handlers/seller/approval-reject-handler.ts`: update status to rejected, store rejectionReason, publish ApprovalRejected event, log to audit
  - [x] 10.6 Create `services/api/src/handlers/seller/approval-edit-handler.ts`: store originalPayload, save modified payload, set status to edited_approved, publish ApprovalEditedApproved event
  - [x] 10.7 Create `services/api/src/handlers/seller/approval-schedule-handler.ts`: set scheduledFor timestamp, transition to scheduled status
  - [x] 10.8 Create `services/api/src/handlers/workers/approval-execution-worker.ts`: consume ApprovalApproved/ApprovalEditedApproved events, execute action (price update via TransactWriteItems, campaign creation, stock alert notification), log execution to audit
  - [x] 10.9 Add API Gateway routes in CDK for GET /api/v1/seller/approvals, GET /api/v1/seller/approvals/{id}, PUT approve/reject/edit-approve/schedule — all JWT-protected seller role
  - [x] 10.10 Add EventBridge rule `{prefix}-approval-execution` targeting approval-execution-worker for ApprovalApproved and ApprovalEditedApproved events

- [x] 11. Campaign System (Req 10)
  - [x] 11.1 Create `services/api/src/services/campaign-service.ts`: createCampaign, estimateReach (query audience filters against DDB), scheduleCampaign (publish CampaignScheduled event), trackMetrics (sent/delivered/read/conversion counts)
  - [x] 11.2 Create `services/api/src/handlers/seller/campaign-create-handler.ts`: create CAMPAIGN#{campaignId} with audience filters, link to approvalId if from approval flow
  - [x] 11.3 Create `services/api/src/handlers/seller/campaign-schedule-handler.ts`: validate service windows or template selection, publish CampaignScheduled event
  - [x] 11.4 Create `services/api/src/handlers/seller/campaign-analytics-handler.ts`: return delivery/read/click/conversion rates
  - [x] 11.5 Create `services/api/src/handlers/seller/campaign-reach-handler.ts`: estimate audience count from filters
  - [x] 11.6 Create `services/api/src/handlers/workers/campaign-execution-worker.ts`: consume CampaignScheduled events, iterate audience with consent checks (opt-out, frequency cap, quiet hours), send via TwilioAdapter with idempotency keys, update campaign metrics — coexists with existing campaign-worker.ts per Section 6.5
  - [x] 11.7 Add EventBridge rule `{prefix}-campaign-execution` targeting campaign-execution-worker for CampaignScheduled events
  - [x] 11.8 Add API Gateway routes in CDK for campaign endpoints — JWT-protected seller role

- [x] 12. Seller Inbox & Reply (Req 11, 21)
  - [x] 12.1 Create `services/api/src/handlers/seller/seller-inbox-handler.ts`: list conversations from THREAD#{sellerId} grouped by customer, with unread count, last message preview, channel indicator
  - [x] 12.2 Create `services/api/src/handlers/seller/seller-messages-handler.ts`: paginated messages for a specific customer conversation
  - [x] 12.3 Create `services/api/src/handlers/seller/seller-reply-handler.ts`: store reply in THREAD#{sellerId} and THREAD#{userId}, publish event for cross-channel delivery via notification router
  - [x] 12.4 Create `services/api/src/handlers/seller/seller-context-handler.ts`: return customer profile, order history, total spend, preferred channel
  - [x] 12.5 Add API Gateway routes in CDK for GET /api/v1/seller/inbox, GET /api/v1/seller/inbox/{userId}/messages, POST /api/v1/seller/inbox/{userId}/reply, GET /api/v1/seller/inbox/{userId}/context — JWT-protected seller role

- [x] 13. Seller Copilot Tool Extensions (Req 11)
  - [x] 13.1 Update `services/api/src/services/whatsapp/seller-copilot.ts`: add 5 new tools to SELLER_TOOLS array — viewPendingApprovals, approveAction, rejectAction, viewRecentOrders, replyToCustomer — per Section 6.4
  - [x] 13.2 Implement tool handlers: viewPendingApprovals (query approval-service), approveAction/rejectAction (call approval-service with audit), viewRecentOrders (query seller orders), replyToCustomer (resolve customer by name, determine channel, route via notification router)
  - [x] 13.3 Update copilot system prompt to distinguish seller-to-system commands from seller-to-customer messages, log classification decisions to audit trail

## Phase 4: AI Processing — Voice, Image & Media Pipeline

- [x] 14. Media Processing Infrastructure
  - [x] 14.1 Add media processing SQS queue and DLQ to `infra/cdk/lib/stacks/events-stack.ts`: `{prefix}-media-processing-retry` (visibility 300s, retention 4d, maxReceive 3) with `{prefix}-media-processing-dlq` (retention 14d)
  - [x] 14.2 Add scheduled messages SQS queue and DLQ to events-stack: `{prefix}-scheduled-messages` (visibility 60s, retention 7d, maxReceive 3) with `{prefix}-scheduled-messages-dlq`
  - [x] 14.3 Add EventBridge rule `{prefix}-media-processing` routing source: vyapargyan.media events to media processing queue
  - [x] 14.4 Add scheduled EventBridge rules: payment reminder (rate 15min), cart abandonment (cron 8:30 PM IST), session cleanup (cron 11:30 PM IST), health check (cron 11:30 AM IST), scheduled messages trigger (cron 09:01 IST), audit export (1st of month)

- [x] 15. GeminiAdapter Extensions (Req 7, 8)
  - [x] 15.1 Add `transcribeVoiceNote(audioBuffer, languageHint, browsingContext)` method to `services/api/src/adapters/gemini-adapter.ts`: call Gemini 1.5 Flash with audio + structured output prompt, return VoiceTranscription interface (transcript, products with confidence, detectedLanguage) — per Section 6.1
  - [x] 15.2 Add `analyzeProductImage(imageBuffer, mimeType)` method to gemini-adapter: call Gemini Vision with inlineData, return ProductImageAnalysis interface (category, color, material, style, brand, description) — per Section 6.1
  - [x] 15.3 Add VoiceTranscription and ProductImageAnalysis interfaces to shared types

- [x] 16. Media Processing Worker (Req 7, 8, 15)
  - [x] 16.1 Create `services/api/src/handlers/workers/media-processing-worker.ts`: consume SQS messages, branch on mediaType (voice_note → transcribeVoiceNote, image_search → analyzeProductImage), handle retries (3 attempts via SQS redrivePolicy), send fallback messages on final failure
  - [x] 16.2 Implement voice note flow: download from S3, call geminiAdapter.transcribeVoiceNote(), if confidence ≥ 80% → search catalog + add to cart, if < 80% → send clarification with quick-reply options
  - [x] 16.3 Implement image search flow: download from S3, call geminiAdapter.analyzeProductImage(), weighted catalog search (category 40%, color 20%, material 15%, style 15%, brand 10%), return top 5 as carousel or suggest category browse if no match > 40%
  - [x] 16.4 Add "🔄 Analyzing your request..." processing indicator sent within 2 seconds of media receipt (Req 15 fallback)

- [x] 17. WhatsApp Worker Media Integration
  - [x] 17.1 Update WhatsApp worker to detect voice note messages: download audio from Twilio MediaUrl, store in S3 voice/{userId}/{ts}.ogg, publish VoiceNoteReceived event to media processing queue
  - [x] 17.2 Update WhatsApp worker to detect image messages: download image, validate format (JPEG/PNG/WebP) and size (≤5MB), store in S3 image-search/{userId}/{ts}.{ext}, publish ImageSearchRequested event

## Phase 5: Account Management & Scheduled Workers

- [x] 18. Account Management Handlers (Req 19)
  - [x] 18.1 Create `services/api/src/handlers/account/account-profile-handler.ts`: GET returns USER#{userId} PROFILE
  - [x] 18.2 Create `services/api/src/handlers/account/account-preferences-handler.ts`: PUT updates preferredChannel, displayName, language preferences
  - [x] 18.3 Create `services/api/src/handlers/account/phone-change-handler.ts`: initiate new OTP flow for new number, update USER record and GSI1 on verification, update Cognito phone_number attribute
  - [x] 18.4 Create `services/api/src/handlers/account/whatsapp-disconnect-handler.ts`: set whatsappConnected=false, update preferredChannel to web, preserve message history
  - [x] 18.5 Create `services/api/src/handlers/account/account-delete-handler.ts`: soft-delete (set status=deleted, deletedAt), disable Cognito user, clear PII after 30-day grace period, log to audit
  - [x] 18.6 Add API Gateway routes in CDK for GET /api/v1/account/profile, PUT /api/v1/account/preferences, POST /api/v1/account/phone/change, POST /api/v1/account/whatsapp/disconnect, DELETE /api/v1/account — all JWT-protected

- [x] 19. Catalog API Handlers (Req 12)
  - [x] 19.1 Create `services/api/src/handlers/catalog/catalog-products-handler.ts`: browse products with search, category filter, price range, sort — optional JWT for personalization
  - [x] 19.2 Create `services/api/src/handlers/catalog/catalog-product-detail-handler.ts`: product detail with images, stock status, seller info
  - [x] 19.3 Create `services/api/src/handlers/catalog/catalog-categories-handler.ts`: list categories — unauthenticated
  - [x] 19.4 Create `services/api/src/handlers/catalog/catalog-search-handler.ts`: text search across product names and descriptions
  - [x] 19.5 Add API Gateway routes in CDK for catalog endpoints — optional JWT

- [x] 20. Admin Handlers (Req 20)
  - [x] 20.1 Create `services/api/src/handlers/admin/admin-audit-handler.ts`: query audit logs by actor (GSI1), by resource (GSI2), with date range filters and pagination
  - [x] 20.2 Create `services/api/src/handlers/admin/admin-media-reprocess-handler.ts`: read messages from media DLQ, re-enqueue to media processing queue
  - [x] 20.3 Create `services/api/src/handlers/admin/admin-messaging-config-handler.ts`: GET/PUT quiet hours, frequency caps, template registry settings
  - [x] 20.4 Add API Gateway routes in CDK for admin endpoints — JWT-protected admin role

- [x] 21. Scheduled Workers
  - [x] 21.1 Create `services/api/src/handlers/workers/payment-reminder-worker.ts`: query orders with status=pending_payment older than configured threshold, send reminder via TwilioAdapter with consent check, auto-cancel after 48h
  - [x] 21.2 Create `services/api/src/handlers/workers/cart-abandonment-worker.ts`: query carts with updatedAt > 24h, send reminder to customers with active service window or via template
  - [x] 21.3 Create `services/api/src/handlers/workers/session-cleanup-worker.ts`: scan sessions with lastActivityAt > 24h, mark state=closed, preserve cart and messages per TTL
  - [x] 21.4 Create `services/api/src/handlers/workers/scheduled-message-worker.ts`: process deferred quiet-hours messages from scheduled-messages queue at 09:01 IST
  - [x] 21.5 Create `services/api/src/handlers/workers/health-check-worker.ts`: verify connectivity to Twilio, Gemini, Bedrock, Grok, Razorpay APIs, publish SystemHealthScore metric
  - [x] 21.6 Create `services/api/src/handlers/workers/audit-export-worker.ts`: monthly export of audit logs older than 90 days to S3, optional cleanup

## Phase 6: Frontend — Customer Experience

- [x] 22. Auth Pages
  - [x] 22.1 Create `apps/web/app/(auth)/login/page.tsx`: login form with phone + password, Cognito Amplify signIn, redirect by role (customer→chat, seller→dashboard, admin→admin)
  - [x] 22.2 Create `apps/web/app/(auth)/register/page.tsx`: role selection (customer/seller), registration form with conditional seller fields (businessName, GST), Cognito signUp
  - [x] 22.3 Create `apps/web/app/(auth)/verify/page.tsx`: OTP input screen with 6-digit code, resend button with 60s cooldown timer, success redirect

- [x] 23. Customer Catalog & Product Pages (Req 12)
  - [x] 23.1 Create `apps/web/app/(customer)/catalog/page.tsx`: responsive product grid with search bar, category filters, price range slider, sort options, infinite scroll
  - [x] 23.2 Create `apps/web/app/(customer)/catalog/[productId]/page.tsx`: product detail with image carousel, price, stock status, seller name, "Add to Cart" and "Ask Seller" buttons
  - [x] 23.3 Create `apps/web/lib/api-catalog.ts`: API client functions for catalog endpoints (listProducts, getProduct, listCategories, searchProducts)

- [x] 24. Customer Chat & Cart (Req 3, 4, 12, 22, 23, 24, 25)
  - [x] 24.1 Create `apps/web/app/(customer)/chat/page.tsx`: full-screen chat layout with MessageList, ChatComposer, and collapsible CartSidePanel
  - [x] 24.2 Create `apps/web/components/Chat/MessageList.tsx`: render MessageBubble components with DeliveryStatusIcon (sent/delivered/read/failed) and ChannelIndicator (WhatsApp/web icon)
  - [x] 24.3 Create `apps/web/components/Chat/ChatComposer.tsx`: text input with send button, image upload button, character counter
  - [x] 24.4 Create `apps/web/components/Chat/CartSidePanel.tsx`: collapsible panel with CartItemRow (thumbnail, name, quantity selector, price), CartSummary (subtotal, GST, total), CheckoutButton, EmptyCartState
  - [x] 24.5 Create `apps/web/components/Chat/TypingIndicator.tsx`: animated "Seller is typing..." indicator
  - [x] 24.6 Create `apps/web/lib/sync-client.ts`: polling client with 2s interval, exponential backoff on errors (2s→4s→8s→16s→30s), ETag/304 handling, React Query integration with refetchInterval
  - [x] 24.7 Create `apps/web/lib/api-chat.ts`: API client functions for chat endpoints (syncMessages, sendMessage, sendTyping, getHistory)
  - [x] 24.8 Create `apps/web/lib/api-cart.ts`: API client functions for cart endpoints (getCart, addItem, updateItem, removeItem, checkout) with optimistic update support

- [x] 25. Customer Orders & Account Pages
  - [x] 25.1 Create `apps/web/app/(customer)/orders/page.tsx`: order history list with StatusPill components (pending→confirmed→shipped→delivered color coding)
  - [x] 25.2 Create `apps/web/app/(customer)/orders/[orderId]/page.tsx`: order detail with timeline visualization (ordered→paid→confirmed→shipped→delivered)
  - [x] 25.3 Create `apps/web/app/(customer)/account/page.tsx`: profile display, preference toggles (preferredChannel, language), phone change flow, WhatsApp disconnect, account deletion with confirmation modal

## Phase 7: Frontend — Seller Dashboard Enhancements

- [x] 26. Seller Approval Inbox Page (Req 5, 9)
  - [x] 26.1 Create `apps/web/app/seller/approvals/page.tsx`: approval list with ApprovalCard components (type badge, product count, impact in ₹, rationale preview, timestamp), sorted by priorityScore, filter tabs (Pending | Approved | Rejected | All)
  - [x] 26.2 Create `apps/web/components/Approvals/ApprovalDetailModal.tsx`: full AI rationale, affected products table (current vs proposed values), impact breakdown, action buttons (Approve, Edit & Approve, Reject with reason input, Schedule with date picker)
  - [x] 26.3 Create `apps/web/components/Approvals/ApprovalHistory.tsx`: timeline of past approval actions with timestamps and outcomes
  - [x] 26.4 Create `apps/web/lib/api-approvals.ts`: API client functions for approval endpoints (listApprovals, getApproval, approve, reject, editApprove, schedule)

- [x] 27. Seller Unified Inbox Enhancement (Req 21)
  - [x] 27.1 Enhance `apps/web/app/seller/inbox/page.tsx`: split-pane layout with ConversationList (left) and ChatPanel (right), filter tabs (Active | Resolved | All), search bar, unread badge, channel icon per conversation
  - [x] 27.2 Create `apps/web/components/Inbox/ConversationRow.tsx`: customer name, channel icon (WhatsApp/web), message preview, unread count badge, relative timestamp
  - [x] 27.3 Create `apps/web/components/Inbox/CustomerContextSidebar.tsx`: collapsible right sidebar showing customer profile, order history, total spend, preferred channel
  - [x] 27.4 Create `apps/web/components/Inbox/QuickActions.tsx`: action buttons — Send Payment Link, Share Product, Create Order, View History
  - [x] 27.5 Create `apps/web/lib/api-inbox.ts`: API client functions for seller inbox endpoints (listConversations, getMessages, sendReply, getCustomerContext)

- [x] 28. Campaign Composer Page (Req 10)
  - [x] 28.1 Create `apps/web/app/seller/campaigns/new/page.tsx`: multi-step campaign composer — audience filters (past purchasers, cart abandoners, high spenders, category interest), message editor with emoji and WhatsApp preview, estimated reach display, schedule picker
  - [x] 28.2 Enhance `apps/web/app/seller/campaigns/page.tsx`: add campaign analytics cards (delivery rate, read rate, click-through, conversion, attributed revenue), link to detail view
  - [x] 28.3 Create `apps/web/lib/api-campaigns.ts`: API client functions for campaign endpoints (createCampaign, scheduleCampaign, estimateReach, getCampaignAnalytics)

## Phase 8: Frontend — Admin & UX Polish

- [x] 29. Admin Audit Log Page (Req 20)
  - [x] 29.1 Create `apps/web/app/admin/audit/page.tsx`: searchable audit log table with filters (actor, resource type, action type, date range), expandable rows showing old/new values diff
  - [x] 29.2 Create `apps/web/lib/api-admin.ts`: API client functions for admin endpoints (queryAuditLogs, reprocessMedia, getMessagingConfig, updateMessagingConfig)

- [x] 30. UX Polish — Status Pills, Timelines, Empty States (Req 22, 23, 24, 25, 26, 27)
  - [x] 30.1 Create `apps/web/components/ui/StatusPill.tsx`: reusable colored pill component for order status (pending=yellow, confirmed=blue, shipped=purple, delivered=green, cancelled=red), approval status, delivery status
  - [x] 30.2 Create `apps/web/components/ui/OrderTimeline.tsx`: vertical timeline component showing order lifecycle events with timestamps and status transitions
  - [x] 30.3 Create `apps/web/components/ui/EmptyState.tsx`: reusable empty state component with illustration, title, description, and CTA button — used across inbox, approvals, orders, cart
  - [x] 30.4 Create `apps/web/components/ui/ChannelIndicator.tsx`: small icon component showing WhatsApp or web origin on messages
  - [x] 30.5 Add loading skeletons to all list pages (approvals, inbox, orders, campaigns, catalog) for perceived performance

- [x] 31. Onboarding Flow (Req 28)
  - [x] 31.1 Create `apps/web/components/Onboarding/OnboardingWizard.tsx`: step-by-step wizard for new sellers — business info → document upload → phone verification → WhatsApp opt-in → pending approval confirmation
  - [x] 31.2 Create `apps/web/components/Onboarding/WhatsAppOptIn.tsx`: explicit opt-in checkbox with explanation text, stores CONSENT#{userId} WHATSAPP_OPTIN record on confirmation (Req 33)

## Phase 9: Infrastructure, Observability & Testing

- [x] 32. CDK Stack Updates — Lambda Functions & Routes
  - [x] 32.1 Add all new Lambda function definitions to `infra/cdk/lib/stacks/api-stack.ts`: auth handlers (3), chat handlers (4), cart handlers (5), approval handlers (6), campaign handlers (5), seller inbox handlers (4), catalog handlers (4), account handlers (5), admin handlers (3), status webhook (1) — with correct timeout, memory, and environment variables per Section 3.1
  - [x] 32.2 Add all new API Gateway routes to api-stack with correct auth (JWT for protected, none for auth/webhooks) per Section 2 and RBAC matrix Section 9.3
  - [x] 32.3 Add all new worker Lambda definitions: media-processing-worker, approval-execution-worker, campaign-execution-worker, payment-reminder-worker, scheduled-message-worker, cart-abandonment-worker, session-cleanup-worker, audit-export-worker, health-check-worker, notification-router-worker — with SQS event source mappings and EventBridge targets per Section 3.2
  - [x] 32.4 Enable X-Ray active tracing on all messaging pipeline Lambda functions per Section 10.3

- [x] 33. CloudWatch Observability (Req 34)
  - [x] 33.1 Add custom metric publishing to Lambda handlers: WhatsAppWebhookLatency, MessageProcessingLatency, CartSyncLatency, AIProcessingLatency, TwilioSendLatency, PollResponseLatency, MessagesReceived/Sent by channel, CartUpdates, ApprovalActions, AIFailureRate, MediaDLQDepth, WhatsAppDLQDepth, SystemHealthScore — per Section 10.2
  - [x] 33.2 Add CloudWatch alarms to CDK: WhatsAppDLQHigh (>5 in 5min), MediaDLQHigh (>10 in 5min), MessageProcessingErrors (>5%), TwilioSendFailures (>3%), AIFailureHigh (>5% per service) — all with SNS notification targets
  - [x] 33.3 Create CloudWatch dashboard `OmnichannelHealth` in CDK: message volume by channel, error rates, DLQ depths, AI latency (p50/p95/p99), active sessions, cart sync latency

- [x] 34. Testing
  - [x] 34.1 Write unit tests for core services: otp-service, cart-service, consent-service, approval-service, session-service, audit-service, template-registry-service, migration-service — mock DynamoDB and external adapters
  - [x] 34.2 Write unit tests for GeminiAdapter new methods: transcribeVoiceNote and analyzeProductImage — mock Gemini API responses
  - [x] 34.3 Write integration tests for critical flows: OTP send/verify, cart add/update/checkout with version conflicts, approval create/approve/execute, chat sync polling with 304 optimization
  - [x] 34.4 Write unit tests for notification-router-worker: verify bidirectional web↔WhatsApp routing logic, service window checks, channel preference resolution
  - [x] 34.5 Write unit tests for status-webhook-handler: verify Twilio signature validation, delivery status mapping, idempotency on MessageSid+MessageStatus

## Correctness Properties

- [x] 35. Property-Based Tests
  - [x] 35.1 Cart version concurrency property: for any sequence of concurrent cart operations (add, update, remove) from multiple channels, the final cart state must be consistent — no lost updates, itemCount equals items.length, subtotal equals sum of (price × quantity) for all items
  - [x] 35.2 OTP security property: for any phone number, at most one valid OTP exists at any time, OTP hash is never stored in plaintext, lockout activates after exactly 3 failures, cooldown prevents resend within 60 seconds
  - [x] 35.3 Consent enforcement property: for any outbound promotional message, the system must verify opt-in status, service window, frequency cap (≤3/24h), and quiet hours (22:00-09:00 IST) — no promotional message is sent when any check fails
  - [x] 35.4 Approval execution property: for any AI-generated action, execution only occurs when a corresponding approval record exists with status "approved" or "edited_approved" — no action executes in draft, pending_review, or rejected status
  - [x] 35.5 Message idempotency property: for any duplicate webhook delivery (same MessageSid), the system processes the message exactly once — no duplicate THREAD entries, no duplicate cart modifications, no duplicate EventBridge events
  - [x] 35.6 Cross-channel session consistency property: for any user with both WhatsApp and web sessions, there exists exactly one SESSION#{userId} ACTIVE record and one CART#{userId} ACTIVE record — switching channels never creates duplicate sessions or carts
