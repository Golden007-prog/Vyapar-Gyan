# Requirements Document: Omnichannel Commerce Productization

## Introduction

This specification defines the production-ready omnichannel commerce experience for VyaparGyan — Phase 8 through Phase 12. Building on the existing foundation (Phases 1–7: infrastructure, WhatsApp integration via Twilio, seller copilot via Bedrock, AI insights via Grok/Gemini, automated campaigns, Razorpay payments, and seller/admin dashboards), this phase delivers a unified, policy-compliant, and scalable commerce platform.

### Current State Summary

**What exists today:**
- Single DynamoDB table with session (PK: SESSION#{customerId}, SK: WHATSAPP#{phone}), customer (PK: CUSTOMER#{phone}), product, order, payment, idempotency, and audit entities
- Twilio WhatsApp webhook → EventBridge → SQS → worker Lambda pipeline with fast-ack pattern
- Seller copilot via Bedrock Converse API (price updates, inventory checks via WhatsApp)
- Seller routing in webhook: phone lookup → seller copilot vs customer shopping flow
- Customer WhatsApp shopping flow: greeting → browsing → product_inquiry → ordering → payment → tracking
- Razorpay payment links with webhook-driven stock finalization (TransactWriteItems)
- AI trend analyzer (Grok/Gemini) and campaign worker (DynamoDB Streams on INSIGHT items)
- Next.js seller dashboard (products, orders, inbox, campaigns, insights) and admin dashboard
- Cognito auth with admin/seller/customer groups, JWT authorizer on API Gateway
- TwilioAdapter with sendWhatsAppMessage, sendSMS, retry with exponential backoff
- Hardcoded seller test routing (bypasses DB lookup for test number)

**What's partial or missing:**
- No OTP phone verification (customers auto-created from WhatsApp phone)
- No web chat for customers (only WhatsApp shopping flow exists)
- No cross-channel session sync (sessions are WhatsApp-only, PK tied to phone)
- No unified cart model (cart is embedded in session.context as JSON blob)
- No approval engine (insights go directly from AI → seller dashboard, no reusable workflow)
- No voice note transcription or image-based product search
- No template message registry or service window tracking for WhatsApp policy compliance
- No quiet hours, frequency caps, or opt-out management
- No delivery status sync (wa_status on messages but no real-time push to web)
- No account deletion, phone number change, or disconnect flows
- No typing indicators, presence, or real-time web push
- No media retry queues (voice/image failures go to main DLQ)
- Seller copilot is text-only (no voice, no image commands)

### What This Phase Delivers

1. Phone verification with OTP for all users
2. Unified session model spanning WhatsApp and web with real-time cart sync
3. Reusable approval engine for all AI-triggered seller actions
4. WhatsApp policy-compliant messaging (templates, service windows, quiet hours, frequency caps)
5. Voice note ordering via Gemini transcription
6. Image-based product search via Gemini Vision
7. Modern WhatsApp-style web chat for customers and sellers
8. Account management (phone change, disconnect, delete)
9. Reliability infrastructure (media retry queues, idempotency, DLQ, observability)
10. Production UX (status pills, timelines, empty states, typing indicators)

## Glossary

- **System**: The VyaparGyan omnichannel commerce platform
- **Customer**: End user browsing and purchasing products via WhatsApp or web chat
- **Seller**: Retailer managing products, inventory, and orders via web dashboard and WhatsApp
- **Admin**: Platform operator moderating sellers and resolving disputes
- **Session**: A conversation context that persists across WhatsApp and web channels, keyed by customer identity
- **Cart**: Shopping cart state synchronized across all channels in real-time, stored as a first-class DynamoDB entity
- **Channel**: Communication medium — WhatsApp (via Twilio) or web chat (via Next.js app)
- **Approval_Engine**: Reusable workflow system for seller review of all AI-generated and admin-triggered actions
- **Approval_Record**: A single actionable item in the approval engine with states: draft → pending_review → approved | rejected | edited_approved → executed
- **AI_Action**: System-generated recommendation requiring seller approval before execution (discount, campaign, price_change, stock_alert, reorder_suggestion)
- **Campaign**: Promotional message batch sent to targeted customers after seller approval
- **Service_Window**: 24-hour period after a customer's last inbound WhatsApp message, during which free-form replies are allowed per WhatsApp/Twilio policy
- **Template_Message**: Pre-approved WhatsApp message template registered with Twilio, required for outbound messages outside service windows
- **OTP**: 6-digit numeric one-time password for phone number verification, delivered via Twilio SMS
- **Voice_Note**: Audio message from customer, transcribed to text via Gemini for intent detection and cart operations
- **Image_Search**: Product discovery via customer-uploaded images analyzed by Gemini Vision for attribute extraction and catalog matching
- **Twilio**: Third-party messaging platform providing WhatsApp Business API and SMS delivery
- **Bedrock**: AWS AI service used for seller copilot conversation orchestration via Converse API
- **Gemini**: Google AI service for voice transcription, image recognition, OCR, and multilingual support
- **Grok**: xAI service for live market trend research powering dynamic pricing recommendations
- **Message_Thread**: Chronological history of messages in a session across all channels, stored as DynamoDB items with SK: MESSAGE#{timestamp}#{messageId}
- **Idempotency_Key**: Unique identifier (PK: IDEMPOTENCY#{messageId}) preventing duplicate message processing via DynamoDB conditional writes
- **Dead_Stock**: Inventory items with stockAddedDate older than configurable threshold (default 90 days) requiring liquidation
- **Quiet_Hours**: Time period when promotional messages are suppressed — 10:00 PM to 9:00 AM IST
- **Frequency_Cap**: Maximum 3 promotional messages per customer per rolling 24-hour window
- **Opt_Out**: Customer preference to stop receiving promotional messages, triggered by "STOP" or "Unsubscribe" keywords
- **Phone_Verification_Status**: Enum: unverified | pending_otp | verified | failed
- **Preferred_Channel**: User's default communication channel: whatsapp | web | both
- **Delivery_Status**: Message delivery state enum: queued | sent | delivered | read | failed
- **Seller_Routing**: Logic in webhook handler that checks if inbound WhatsApp phone belongs to a verified seller, routing to copilot vs customer flow
- **Real_Time_Sync**: Cart and message synchronization across channels within 2 seconds, implemented via HTTP polling with ETag optimization (WebSocket migration path planned)
- **Media_Retry_Queue**: Dedicated SQS queue for failed voice transcription and image recognition jobs, separate from the main WhatsApp DLQ
- **Consent_Record**: DynamoDB item tracking customer opt-in/opt-out preferences, service window timestamps, and frequency counters

## Requirements

### Requirement 1: OTP-Based Phone Verification

**User Story:** As a new user (customer or seller), I want to verify my phone number with OTP so that I can securely access the platform and link my WhatsApp identity.

#### Acceptance Criteria

1. WHEN a user initiates phone verification, THE System SHALL generate a cryptographically random 6-digit numeric OTP and store it in DynamoDB with PK: OTP#{phoneNumber}, SK: LATEST, including a 10-minute TTL expiration
2. WHEN OTP is generated, THE System SHALL send it via Twilio SMS to the provided phone number within 5 seconds of generation
3. WHEN a user submits an OTP, THE System SHALL validate it against the stored value and check that the current time is before the expiration timestamp
4. WHEN a valid OTP is submitted within 10 minutes, THE System SHALL update the user record to set phoneVerificationStatus to "verified" and link the phone number to the Cognito user account
5. WHEN an invalid OTP is submitted, THE System SHALL increment the failure counter on the OTP record and return an error message indicating the OTP is incorrect
6. WHEN OTP verification attempts exceed 3 failures for a phone number, THE System SHALL block new OTP requests for that phone number for 1 hour by setting a lockout timestamp
7. THE System SHALL enforce a 60-second cooldown between OTP resend requests for the same phone number by checking the createdAt timestamp of the most recent OTP record
8. WHEN a WhatsApp message arrives from an unverified phone number, THE System SHALL still process it in the customer shopping flow but mark the session as "unverified" and restrict checkout until verification completes

### Requirement 2: User Registration with Role Assignment

**User Story:** As a new user, I want to register with my role so that I can access features appropriate to my needs.

#### Acceptance Criteria

1. WHEN a customer registers, THE System SHALL collect phone number, display name, and password, then create a Cognito user account in the "customer" group
2. WHEN a seller registers, THE System SHALL additionally collect business name, business address, and GST number, then create a Cognito user account in the "seller" group with status "pending_approval"
3. WHEN a Cognito account is created, THE System SHALL create a user profile record in DynamoDB with PK: USER#{userId}, SK: PROFILE containing role, phoneNumber, phoneVerificationStatus, preferredChannel, createdAt, and updatedAt
4. THE System SHALL create a GSI1 entry with GSI1PK: PHONE#{phoneNumber}, GSI1SK: USER#{userId} for phone-based lookups across all user types
5. THE System SHALL create a GSI2 entry with GSI2PK: ROLE#{role}, GSI2SK: USER#{userId} for role-based queries
6. WHEN a seller registers, THE System SHALL set sellerStatus to "pending_approval" requiring admin review before the seller can list products or receive orders
7. WHEN registration completes with a verified phone, THE System SHALL send a welcome message to the phone number via Twilio WhatsApp using a pre-approved template
8. THE System SHALL prevent duplicate registrations by checking GSI1 (PHONE#{phoneNumber}) before creating a new user, returning a 409 Conflict if the phone is already registered

### Requirement 3: Unified Session Model Across Channels

**User Story:** As a customer, I want my conversation and cart to persist when I switch between WhatsApp and web so that I can continue shopping seamlessly on either channel.

#### Acceptance Criteria

1. WHEN a customer sends a WhatsApp message, THE System SHALL resolve the session by querying GSI1 with GSI1PK: PHONE#{phoneNumber} to find the user, then retrieving the session with PK: SESSION#{userId}, SK: ACTIVE
2. WHEN the same customer opens web chat, THE System SHALL resolve the session using the authenticated Cognito userId with the same PK: SESSION#{userId}, SK: ACTIVE key
3. THE System SHALL store session records with channel-agnostic fields: userId, state (greeting|browsing|product_inquiry|ordering|payment|tracking|idle|closed), lastActiveChannel, lastActivityAt, createdAt, and expiresAt (TTL)
4. THE System SHALL store the cart as a separate first-class entity with PK: CART#{userId}, SK: ACTIVE containing items array, subtotal, itemCount, and updatedAt — not embedded in the session JSON blob
5. WHEN a session is inactive for 24 hours, THE System SHALL mark it as "expired" by updating state to "closed" but preserve the cart entity for 7 days and message history for 30 days
6. THE System SHALL use DynamoDB TTL on session records (expiresAt field) to automatically delete expired sessions after 30 days
7. WHEN a customer returns after session expiry but within 7 days, THE System SHALL create a new session and restore the existing cart, sending a "Welcome back" message with cart summary
8. THE System SHALL store all messages with PK: THREAD#{userId}, SK: MSG#{timestamp}#{messageId} including a "channel" field (whatsapp|web) so that message history is unified regardless of origin channel

### Requirement 4: Real-Time Cart Synchronization

**User Story:** As a customer, I want my cart to update instantly across WhatsApp and web so that I see consistent state everywhere.

#### Acceptance Criteria

1. WHEN a customer adds a product to cart on any channel, THE System SHALL update the cart entity (PK: CART#{userId}, SK: ACTIVE) using a DynamoDB conditional write with version checking to prevent race conditions
2. WHEN a cart update succeeds, THE System SHALL publish a "CartUpdated" event to EventBridge with userId, cartVersion, and itemCount within 500 milliseconds
3. WHEN a web client polls for updates, THE System SHALL return the current cart state with an ETag header derived from cartVersion, responding with 304 Not Modified if unchanged
4. THE System SHALL implement HTTP polling at 2-second intervals for web clients, with exponential backoff on errors, and provide a documented migration path to WebSocket API Gateway in a future phase
5. WHEN a product in the cart goes out of stock (stockQuantity - reservedStock reaches 0), THE System SHALL remove it from the cart, decrement itemCount and subtotal, and notify the customer on their lastActiveChannel
6. WHEN a customer proceeds to checkout, THE System SHALL validate stock availability for all cart items using conditional reads, and reject checkout if any item has insufficient stock
7. IF stock is insufficient for one or more items during checkout, THEN THE System SHALL remove unavailable items from the cart, notify the customer with product names and suggest alternatives from the same category
8. THE System SHALL preserve cart contents for 7 days after last modification using a TTL field, and send a cart reminder message 24 hours after abandonment if the customer has an active service window

### Requirement 5: Unified Approval Engine for AI Actions

**User Story:** As a seller, I want to review and approve all AI recommendations in one place so that I maintain control over my business decisions before any automated action executes.

#### Acceptance Criteria

1. WHEN the AI generates any recommendation (discount, campaign, price_change, stock_alert, reorder_suggestion), THE System SHALL create an approval record with PK: APPROVAL#{approvalId}, SK: METADATA containing sellerId, type, status ("draft"), payload (proposed action details), aiRationale, estimatedImpact, affectedProductIds, createdAt
2. THE System SHALL set GSI1PK: SELLER#{sellerId}, GSI1SK: STATUS#{status}#TS#{createdAt} on approval records to enable seller-scoped queries filtered by status and sorted by creation time
3. WHEN the approval record is created, THE System SHALL transition status from "draft" to "pending_review" and publish an "ApprovalCreated" event to EventBridge for notification routing
4. WHEN a seller views an approval, THE System SHALL display: AI rationale text, list of affected products with current and proposed values, estimated revenue impact (numeric), action type, and creation timestamp
5. WHEN a seller approves an action, THE System SHALL update status to "approved", set approvedAt and approvedBy, and publish an "ApprovalApproved" event to EventBridge that triggers the execution Lambda
6. WHEN a seller rejects an action, THE System SHALL update status to "rejected", store the rejectionReason provided by the seller, and publish an "ApprovalRejected" event
7. WHEN a seller edits a recommendation before approving, THE System SHALL store the original payload as originalPayload, save the modified version as payload, set status to "edited_approved", and publish an "ApprovalEditedApproved" event
8. THE System SHALL enforce that no AI-generated action executes until an approval record with status "approved" or "edited_approved" exists in DynamoDB, verified by conditional expression on the execution Lambda

### Requirement 6: Template-Compliant WhatsApp Messaging

**User Story:** As a platform operator, I want all outbound WhatsApp messages to comply with Twilio and WhatsApp Business API policies so that we avoid account suspension.

#### Acceptance Criteria

1. WHEN a customer sends a WhatsApp message, THE System SHALL record the timestamp in a consent record (PK: CONSENT#{userId}, SK: SERVICE_WINDOW) and set serviceWindowExpiresAt to currentTime + 24 hours
2. WHEN a promotional or campaign message is scheduled for a customer, THE System SHALL check the consent record to verify serviceWindowExpiresAt is in the future
3. IF no active service window exists for the target customer, THEN THE System SHALL require use of a pre-approved Twilio template message, selecting the appropriate templateSid from the template registry (PK: TEMPLATE#{templateSid}, SK: METADATA)
4. THE System SHALL maintain a template registry in DynamoDB containing templateSid, templateName, parameterSchema (Zod schema for required variables), category (marketing|utility|authentication), language, and approvalStatus
5. WHEN a template message is sent, THE System SHALL validate all required parameters against the parameterSchema before calling Twilio's API, rejecting sends with missing or invalid parameters
6. THE System SHALL reject promotional messages scheduled during quiet hours (22:00–09:00 IST) by checking the target timezone offset, and queue them for delivery at 09:00 IST
7. THE System SHALL enforce frequency caps by maintaining a counter in the consent record (promotionalMessageCount with 24-hour TTL reset), rejecting sends when count reaches 3
8. WHEN a customer sends "STOP", "Unsubscribe", or "रुको" (Hindi), THE System SHALL update the consent record to set optedOut to true and suppressPromotional to true, while continuing to allow transactional messages (order confirmations, shipping updates, OTP)

### Requirement 7: Voice Note Ordering via Transcription

**User Story:** As a customer, I want to order products by sending voice notes so that I can shop hands-free in my native language.

#### Acceptance Criteria

1. WHEN a customer sends a voice note on WhatsApp, THE System SHALL download the audio file from the Twilio MediaUrl within 5 seconds of webhook receipt
2. WHEN the audio file is downloaded, THE System SHALL store it in S3 (s3://media-bucket/voice/{userId}/{timestamp}.ogg) and publish a "VoiceNoteReceived" event to the media processing SQS queue
3. WHEN the voice processing worker picks up the job, THE System SHALL call Gemini API with the audio file and a prompt specifying product name and quantity extraction, including the customer's recent browsing context for disambiguation
4. WHEN transcription completes, THE System SHALL extract product names and quantities using structured output parsing, assigning a confidence score (0–100) to each detected product intent
5. WHEN all detected products have confidence above 80 percent, THE System SHALL search the seller's catalog by name similarity, add matching products to the cart, and send a confirmation message listing added items with prices
6. IF any detected product has confidence below 80 percent, THEN THE System SHALL send a clarifying message listing the ambiguous items with quick-reply options for the customer to confirm or correct
7. WHEN transcription or intent detection fails after 3 retries on the media retry queue, THE System SHALL send a fallback message: "I couldn't understand the voice note. Could you type what you'd like to order?"
8. THE System SHALL support voice notes in English, Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, and Kannada by passing the appropriate language hint to Gemini's transcription API

### Requirement 8: Image-Based Product Search

**User Story:** As a customer, I want to find products by uploading images so that I can discover items visually without knowing exact product names.

#### Acceptance Criteria

1. WHEN a customer sends an image on WhatsApp or web chat, THE System SHALL download the image within 5 seconds and store it in S3 (s3://media-bucket/image-search/{userId}/{timestamp}.{ext})
2. WHEN the image is stored, THE System SHALL publish an "ImageSearchRequested" event to the media processing SQS queue with userId, s3Key, sessionId, and the seller context from the active session
3. WHEN the image processing worker picks up the job, THE System SHALL call Gemini Vision API to extract product attributes: category, color, material, style, brand (if visible), and a natural language description
4. WHEN attributes are extracted, THE System SHALL search the catalog using a weighted match across category (40%), color (20%), material (15%), style (15%), and brand (10%), returning products sorted by composite similarity score
5. THE System SHALL return up to 5 matching products, each with productId, name, price, thumbnailUrl, and similarityScore, formatted as a carousel (WhatsApp interactive list or web card grid)
6. WHEN no matches are found with similarityScore above 40 percent, THE System SHALL respond with the detected category name and offer to browse that category: "I see this looks like a [category]. Want to browse our [category] collection?"
7. WHEN image analysis fails after 3 retries on the media retry queue, THE System SHALL send a fallback message: "I couldn't analyze that image. Could you describe what you're looking for?"
8. THE System SHALL accept image formats JPEG, PNG, and WebP with maximum file size 5MB, rejecting oversized or unsupported formats with a clear error message

### Requirement 9: Seller Approval Inbox with Priority Sorting

**User Story:** As a seller, I want to see pending approvals sorted by urgency so that I can address time-sensitive items first.

#### Acceptance Criteria

1. WHEN a seller opens the approval inbox on web dashboard, THE System SHALL query GSI1 with GSI1PK: SELLER#{sellerId} and filter for status "pending_review", returning results sorted by priorityScore descending
2. THE System SHALL calculate priorityScore as a weighted composite: (estimatedRevenueImpact × 0.4) + (stockAgeDays × 0.3) + (timeSensitivityScore × 0.3), where timeSensitivityScore increases as the approval ages
3. THE System SHALL display each approval as a card showing: type badge (discount|campaign|price_change), affected product count, estimated impact in rupees, AI rationale summary (first 100 chars), and creation timestamp
4. WHEN a seller selects an approval card, THE System SHALL display the full detail view with: complete AI rationale, list of affected products with current vs proposed values, estimated revenue impact breakdown, and action buttons
5. THE System SHALL provide four action buttons: "Approve" (executes as-is), "Edit & Approve" (opens edit form), "Reject" (requires reason text), and "Schedule for Later" (date picker)
6. WHEN a seller approves a discount via the inbox, THE System SHALL update product prices in DynamoDB using TransactWriteItems (updating price and setting discountedPrice on each affected product)
7. WHEN a seller approves a campaign via the inbox, THE System SHALL create campaign records (PK: CAMPAIGN#{campaignId}, SK: METADATA) with status "scheduled" and target audience filters, then trigger the campaign scheduling Lambda
8. THE System SHALL display approval history below the inbox with timestamps, actions taken, outcomes, and a link to the audit log entry

### Requirement 10: Campaign Composer with Audience Targeting

**User Story:** As a seller, I want to compose campaigns with audience filters so that I can target the right customers with relevant promotions.

#### Acceptance Criteria

1. WHEN a seller creates a campaign (from approval inbox or standalone), THE System SHALL provide audience filter options: past purchasers of specific products, cart abandoners (cart age > 24h), high spenders (top 20% by total spend), and category interest (browsed category in last 30 days)
2. WHEN filters are applied, THE System SHALL query DynamoDB to calculate estimated reach by counting matching customer records, displaying the count before the seller confirms
3. THE System SHALL pre-fill campaign message text from the approved AI recommendation (if originating from approval), allowing the seller to edit the text, add emoji, and preview the WhatsApp rendering
4. WHEN a seller schedules a campaign, THE System SHALL validate that target customers have active service windows or that a valid Twilio template is selected for out-of-window sends
5. THE System SHALL exclude customers who have opted out (consent record optedOut = true) or who have reached the frequency cap (promotionalMessageCount >= 3 in rolling 24h)
6. WHEN campaign execution begins, THE System SHALL create individual message records with unique idempotency keys (PK: IDEMPOTENCY#{campaignId}#{customerId}) to prevent duplicate sends on retry
7. THE System SHALL track campaign metrics in real-time: sent count, delivered count, read count (via Twilio status callbacks), link click count (via redirect tracking), and order conversion count (orders created within 48h of send)
8. THE System SHALL provide a campaign analytics view showing delivery rate, read rate, click-through rate, conversion rate, and revenue attributed to the campaign

### Requirement 11: Seller WhatsApp Chat with Dynamic Routing

**User Story:** As a seller, I want to manage my store and reply to customers via WhatsApp so that I can operate on the go without opening the web dashboard.

#### Acceptance Criteria

1. WHEN a WhatsApp message is received, THE System SHALL query GSI1 with GSI1PK: PHONE#{phoneNumber} to check if the sender is a verified seller, replacing the current hardcoded test number routing
2. IF the sender is a verified seller, THEN THE System SHALL route the message to the seller copilot flow (Bedrock Converse API with seller tools)
3. IF the sender is not a verified seller, THEN THE System SHALL route the message to the customer shopping flow (existing state machine: greeting → browsing → ordering)
4. WHEN a seller sends a customer reply command (e.g., "reply to Rajesh: your order is shipped"), THE System SHALL parse the recipient, resolve the customer's preferred channel, and deliver the message with the seller's business name prefix
5. THE System SHALL extend the seller copilot tools to include: viewPendingApprovals, approveAction, rejectAction, viewRecentOrders, and replyToCustomer — in addition to existing updateProductPrice and checkInventory
6. WHEN a seller is offline (no WhatsApp activity for 30 minutes), THE System SHALL queue incoming customer messages and deliver a batch summary when the seller sends their next message
7. THE System SHALL sync all seller WhatsApp conversations to the web inbox by storing messages with PK: THREAD#{sellerId}, SK: MSG#{timestamp}#{messageId} with channel: "whatsapp"
8. THE System SHALL distinguish seller-to-system commands (tool invocations) from seller-to-customer messages by using Bedrock's intent classification, logging the classification for audit

### Requirement 12: Customer Web Chat with Authentication

**User Story:** As a customer, I want to browse products and chat with sellers on the web so that I can shop from my desktop or mobile browser.

#### Acceptance Criteria

1. WHEN a customer opens the web chat page, THE System SHALL check for a valid Cognito JWT token and display the authenticated experience with full message history and cart state
2. WHEN a customer is not authenticated, THE System SHALL allow guest browsing of the product catalog with search and filters, but require login before adding to cart or sending messages
3. THE System SHALL display the product catalog in a responsive grid with search bar, category filters, price range slider, and sort options (price ascending, price descending, newest, popularity)
4. WHEN a customer selects a product, THE System SHALL display a detail panel with images (carousel), name, price, stock status, seller name, and two action buttons: "Add to Cart" and "Ask Seller"
5. WHEN a customer clicks "Ask Seller", THE System SHALL open the chat interface with the product context pre-filled as a system message: "[Product Name] — ₹[Price] — [Stock Status]"
6. THE System SHALL route customer web messages to the seller's preferred channel by publishing a "CustomerMessageSent" event to EventBridge, which the notification Lambda delivers to WhatsApp or web inbox
7. WHEN a seller replies (from WhatsApp or web), THE System SHALL display the message in the customer's web chat within 2 seconds on the next poll cycle
8. THE System SHALL persist the web chat session across page refreshes by storing the sessionId in localStorage and rehydrating message history from DynamoDB on page load

### Requirement 13: Message Idempotency and Duplicate Prevention

**User Story:** As a platform operator, I want to prevent duplicate message processing so that customers don't receive repeated messages or experience cart corruption.

#### Acceptance Criteria

1. WHEN a Twilio WhatsApp webhook is received, THE System SHALL check for an existing idempotency record using PK: IDEMPOTENCY#{messageSid}, SK: PROCESSED with a DynamoDB conditional write (attribute_not_exists(PK))
2. IF the idempotency record already exists, THEN THE System SHALL return 200 OK with an empty TwiML response without processing the message or publishing to EventBridge
3. IF no idempotency record exists, THEN THE System SHALL create one with processedAt timestamp and 24-hour TTL before publishing the event to EventBridge for async processing
4. THE System SHALL use DynamoDB conditional writes with version attributes on cart updates (PK: CART#{userId}, SK: ACTIVE) to prevent race conditions when concurrent updates arrive from WhatsApp and web
5. WHEN message processing fails in the worker Lambda, THE System SHALL rely on SQS retry behavior (maxReceiveCount: 3) with the existing visibility timeout of 180 seconds before moving to the DLQ
6. WHEN all SQS retries are exhausted, THE System SHALL move the message to the WhatsApp DLQ and create a CloudWatch metric "WhatsAppDLQDepth" for alerting
7. WHEN an outbound Twilio message send fails, THE System SHALL retry up to 3 times with exponential backoff (2s, 4s, 8s) via the TwilioAdapter's existing retry logic, then mark the message record as "failed"
8. THE System SHALL log all retry attempts with requestId, messageSid, attempt number, error code, and error message in structured JSON format to CloudWatch Logs

### Requirement 14: Delivery Status Synchronization

**User Story:** As a customer, I want to see real-time message delivery status so that I know when my messages are received and read.

#### Acceptance Criteria

1. WHEN a message is sent via Twilio, THE System SHALL immediately set the message record's deliveryStatus to "sent" in DynamoDB
2. WHEN Twilio sends a status callback webhook (MessageStatus: delivered), THE System SHALL update the message record's deliveryStatus to "delivered" within 5 seconds of webhook receipt
3. WHEN Twilio sends a status callback webhook (MessageStatus: read), THE System SHALL update the message record's deliveryStatus to "read" within 5 seconds of webhook receipt
4. WHEN Twilio sends a status callback with MessageStatus "failed" or "undelivered", THE System SHALL update deliveryStatus to "failed" and store the ErrorCode and ErrorMessage from the callback
5. THE System SHALL configure Twilio's StatusCallback URL to point to a dedicated status webhook endpoint (POST /whatsapp/status) that processes status updates independently from the message webhook
6. WHEN a web client polls for message updates, THE System SHALL include deliveryStatus for all outbound messages in the response, enabling the UI to render status icons (single check → double check → blue double check)
7. THE System SHALL synchronize delivery status across channels: if a message was sent via WhatsApp and the customer views it on web, the web UI SHALL display the WhatsApp delivery status
8. THE System SHALL store status update history as attributes on the message record (sentAt, deliveredAt, readAt, failedAt) for debugging and analytics

### Requirement 15: Failed AI Processing Fallback

**User Story:** As a customer, I want to receive helpful responses when AI processing fails so that I can continue shopping without frustration.

#### Acceptance Criteria

1. WHEN voice transcription fails after 3 retries on the media retry queue, THE System SHALL send a fallback message asking the customer to type their request, and log the failure with requestId, s3Key, and error details
2. WHEN image recognition fails after 3 retries on the media retry queue, THE System SHALL send a fallback message asking the customer to describe the product in text
3. WHEN intent detection confidence is below 50 percent for any extracted product, THE System SHALL ask clarifying questions with quick-reply buttons showing the top 3 candidate products instead of guessing
4. WHEN Bedrock Converse API is unavailable or returns an error for the seller copilot, THE System SHALL fall back to a rule-based command parser that handles "update price", "check stock", and "view orders" commands
5. WHEN Gemini API is unavailable (HTTP 5xx or timeout after 15 seconds), THE System SHALL disable voice and image features for the affected session and send: "Voice and image features are temporarily unavailable. Please type your request."
6. THE System SHALL log all AI failures to CloudWatch with structured fields: requestId, aiService (gemini|bedrock|grok), operation, errorCode, errorMessage, latencyMs, and retryCount
7. WHEN AI processing takes longer than 10 seconds, THE System SHALL send a "processing" indicator message ("🔄 Analyzing your request...") to the customer's active channel to prevent perceived unresponsiveness
8. THE System SHALL publish a custom CloudWatch metric "AIFailureRate" per service (gemini, bedrock, grok) and create an alarm that triggers when the 5-minute failure rate exceeds 5 percent

### Requirement 16: Media Processing Retry Queue

**User Story:** As a platform operator, I want dedicated retry queues for failed media processing so that temporary AI failures don't lose customer requests.

#### Acceptance Criteria

1. THE System SHALL create a dedicated SQS queue "media-processing-retry" with visibility timeout of 300 seconds, separate from the main WhatsApp messages queue
2. WHEN voice transcription fails in the worker Lambda, THE System SHALL send the job to the media retry queue with the original message context: userId, sessionId, s3Key, mediaType ("voice"), attemptCount, and originalTimestamp
3. WHEN image recognition fails in the worker Lambda, THE System SHALL send the job to the media retry queue with the same context structure and mediaType ("image")
4. THE System SHALL configure the media retry queue with a redrive policy: maxReceiveCount of 3 with delays of 5 seconds, 30 seconds, and 120 seconds between retries (using SQS delay + visibility timeout)
5. WHEN all retries on the media retry queue are exhausted, THE System SHALL move the job to a dedicated media DLQ ("media-processing-dlq") and increment the CloudWatch metric "MediaDLQDepth"
6. THE System SHALL preserve the full original message context in retry messages so that when a retry succeeds, the result can be delivered to the correct customer session
7. THE System SHALL create a CloudWatch alarm when media DLQ depth exceeds 10 items, sending an SNS notification to the ops team
8. THE System SHALL provide an admin API endpoint (POST /admin/media/reprocess) that allows manual reprocessing of failed media jobs from the DLQ by re-publishing them to the media retry queue

### Requirement 17: Out-of-Stock Reroute with Alternatives

**User Story:** As a customer, I want to be offered alternatives when a product goes out of stock so that I can complete my purchase.

#### Acceptance Criteria

1. WHEN a customer adds a product to cart, THE System SHALL validate current stock availability by reading the product record and checking (stockQuantity - reservedStock) > 0
2. WHEN a product in the cart goes out of stock (detected during periodic stock check or checkout validation), THE System SHALL remove it from the cart entity, update subtotal and itemCount, and notify the customer on their lastActiveChannel
3. WHEN a product goes out of stock, THE System SHALL search for alternatives by querying the CategoryIndex GSI for products in the same categoryId with stockQuantity > 0, sorted by price proximity to the original product
4. THE System SHALL rank alternatives by a composite score: price similarity (40%), same seller preference (30%), and stock availability (30%), returning up to 3 alternatives
5. THE System SHALL display alternatives as a product carousel (WhatsApp interactive list or web card grid) with name, price, seller name, and "Add to Cart" action
6. WHEN a customer selects an alternative, THE System SHALL add it to the cart at the same quantity as the removed item and send a confirmation
7. WHEN no alternatives are available in the same category with stock, THE System SHALL offer to notify the customer when the original product is restocked by creating a restock notification record (PK: RESTOCK_NOTIFY#{productId}, SK: USER#{userId})
8. THE System SHALL track out-of-stock events by publishing "ProductOutOfStock" events to EventBridge, and alert sellers when a product has gone out of stock more than 3 times in 30 days

### Requirement 18: Payment Reminder Flow with Service Window Compliance

**User Story:** As a seller, I want the system to send payment reminders to customers with pending orders so that I reduce cancellations.

#### Acceptance Criteria

1. WHEN an order is created with status "confirmed" (seller accepted) but payment is not received within 1 hour, THE System SHALL schedule a payment reminder via an EventBridge scheduled rule
2. WHEN the reminder is triggered, THE System SHALL check the customer's consent record for an active service window (serviceWindowExpiresAt > currentTime)
3. IF a service window exists, THEN THE System SHALL send the reminder as a free-form WhatsApp message including: order number, item summary, total amount, payment link, and expiry countdown
4. IF no service window exists, THEN THE System SHALL send the reminder using the pre-approved "payment_reminder" Twilio template with order number, amount, and payment link as template parameters
5. THE System SHALL send a maximum of 2 payment reminders per order: the first at 1 hour after confirmation, the second at 12 hours after confirmation
6. WHEN an order is not paid within 24 hours of confirmation, THE System SHALL auto-cancel the order by calling the existing unreserveOrderStock function (TransactWriteItems to unreserve stock and set status to "cancelled")
7. WHEN an order is auto-cancelled, THE System SHALL notify both the customer ("Your order has been cancelled due to non-payment") and the seller ("Order #{orderNumber} auto-cancelled — stock unreserved") on their respective channels
8. THE System SHALL track payment reminder effectiveness by recording reminderSentAt, reminderCount, and paidAfterReminder (boolean) on the order record for analytics

### Requirement 19: Account Settings and Phone Number Management

**User Story:** As a user, I want to change my phone number, disconnect WhatsApp, or delete my account so that I maintain control over my data and communication preferences.

#### Acceptance Criteria

1. WHEN a user initiates a phone number change, THE System SHALL send OTP to the new phone number and require verification before updating
2. WHEN the new phone OTP is verified, THE System SHALL atomically update the user record's phoneNumber, update the GSI1 entry (delete old PHONE#{oldPhone}, create PHONE#{newPhone}), and update the Cognito user's phone_number attribute
3. WHEN a user disconnects their WhatsApp, THE System SHALL set the user's whatsappConnected flag to false, stop routing WhatsApp messages to their session, and preserve web access and all historical data
4. WHEN a user requests account deletion, THE System SHALL display a confirmation screen listing consequences: loss of order history access, cancellation of pending campaigns, and anonymization of personal data
5. WHEN account deletion is confirmed, THE System SHALL mark the user record as deleted (status: "deleted", deletedAt: timestamp), anonymize PII fields (replace name with "Deleted User", phone with hash), and revoke the Cognito user account
6. THE System SHALL cancel all pending campaigns targeting a deleted user within 1 minute by querying campaign records and removing the user from target lists
7. THE System SHALL preserve order history for deleted users for 7 years by retaining order records with anonymized customer fields, satisfying compliance requirements
8. WHEN a deleted user's phone number is used for a new registration, THE System SHALL allow creation of a new account with a new userId, without linking to the deleted account's history

### Requirement 20: Audit Logging for All Seller and Admin Actions

**User Story:** As a platform operator, I want to track all seller-approved actions and admin operations so that I can investigate disputes and ensure accountability.

#### Acceptance Criteria

1. WHEN a seller approves, rejects, or edits an AI action via the approval engine, THE System SHALL create an audit log record with PK: AUDIT#{auditId}, SK: TS#{timestamp} containing actorId, actorRole, actionType, resourceType, resourceId, oldValues, newValues, and approvalId
2. THE System SHALL set GSI1PK: ACTOR#{actorId}, GSI1SK: TS#{timestamp} for actor-specific audit queries, and GSI2PK: RESOURCE#{resourceType}#{resourceId}, GSI2SK: TS#{timestamp} for resource-specific queries
3. WHEN a seller modifies a campaign message or audience, THE System SHALL log both the original version and the modified version in the audit record's oldValues and newValues fields
4. WHEN a seller sends a manual message to a customer (via web inbox or WhatsApp reply command), THE System SHALL log the message content, recipient userId, and channel in an audit record
5. WHEN an admin approves, suspends, or rejects a seller, THE System SHALL create an audit record with the admin's userId, the seller's userId, the action taken, and any notes provided
6. THE System SHALL store audit logs with no TTL (permanent retention) and configure a monthly EventBridge scheduled rule to export audit records older than 90 days to S3 in JSON Lines format for long-term archival
7. THE System SHALL provide an admin API endpoint (GET /admin/audit) that supports filtering by actorId, resourceType, resourceId, actionType, and date range, with cursor-based pagination
8. WHEN a dispute is raised, THE System SHALL provide a "View Audit Trail" button that queries all audit records for the disputed order's resourceId, displaying them as a chronological timeline

### Requirement 21: Seller Unified Inbox with Channel Indicators

**User Story:** As a seller, I want to see all customer conversations in one inbox with channel indicators so that I can manage support efficiently regardless of how customers contact me.

#### Acceptance Criteria

1. WHEN a seller opens the unified inbox on the web dashboard, THE System SHALL query for all active conversations where the seller is a participant, sorted by lastMessageAt descending
2. THE System SHALL display each conversation as a row with: customer name, channel icon (WhatsApp or web), last message preview (truncated to 60 chars), unread message count badge, and relative timestamp
3. WHEN a seller selects a conversation, THE System SHALL display the full message history with channel indicators (WhatsApp icon or web icon) next to each message, delivery status icons for outbound messages, and timestamps
4. THE System SHALL provide filter tabs: "Active" (has unread messages or last message within 24h), "Resolved" (seller marked as resolved), and "All"
5. WHEN a new customer message arrives (detected via polling), THE System SHALL move the conversation to the top of the active list and increment the unread badge count
6. THE System SHALL provide a search bar that searches conversations by customer name, phone number, or message content using a DynamoDB scan with filter expressions (with pagination for large result sets)
7. THE System SHALL display a customer context sidebar when a conversation is selected, showing: customer name, phone, total orders count, total spend amount, last order date, and preferred channel
8. WHEN a seller replies from the inbox, THE System SHALL route the message to the customer's lastActiveChannel (WhatsApp or web) and store it in the unified thread with channel: "web" (since the seller sent from web)

### Requirement 22: Cart Side Panel with Real-Time Updates

**User Story:** As a customer on web chat, I want to see my cart update in real-time during conversation so that I can track my purchases while chatting.

#### Acceptance Criteria

1. THE System SHALL display the cart as a collapsible side panel on the right side of the web chat interface, defaulting to collapsed on mobile (< 768px) and expanded on desktop
2. WHEN a product is added to cart (from chat, catalog, or voice/image ordering), THE System SHALL animate the cart icon with a bounce effect and update the item count badge
3. THE System SHALL display each cart item with: product thumbnail (64x64), product name, quantity selector (- / count / +), unit price, and line subtotal
4. WHEN quantity changes via the quantity selector, THE System SHALL update the cart entity in DynamoDB and recalculate subtotal and total in real-time (optimistic UI update, reconciled on next poll)
5. THE System SHALL display cart summary at the bottom: subtotal, estimated tax (GST), shipping estimate, and total, with a prominent "Checkout" button
6. WHEN a product in the cart goes out of stock, THE System SHALL highlight the item row in red, disable the quantity selector, show "Out of Stock" badge, and disable the Checkout button until the item is removed
7. THE System SHALL allow customers to remove items with a single tap on an "×" button, with a 3-second undo toast notification before the removal is committed to DynamoDB
8. WHEN the cart is empty, THE System SHALL display an empty state illustration with text "Your cart is empty" and a "Browse Products" button that navigates to the catalog view

### Requirement 23: Typing Indicators and Online Presence

**User Story:** As a user, I want to see when the other party is typing or online so that I know they are engaged in the conversation.

#### Acceptance Criteria

1. WHEN a user types in the web chat composer, THE System SHALL publish a typing indicator event to a lightweight endpoint (POST /chat/typing) with userId and conversationId
2. THE System SHALL display "Seller is typing..." or "Customer is typing..." as an animated indicator below the last message for 3 seconds after the last typing event
3. WHEN typing stops for 3 seconds (no new typing events), THE System SHALL clear the typing indicator from the other party's view
4. WHEN a message is sent, THE System SHALL immediately clear the typing indicator for both parties
5. THE System SHALL throttle typing indicator API calls to maximum 1 request per second per user to prevent excessive API Gateway invocations
6. WHEN a seller is online (last activity within 5 minutes), THE System SHALL display a green dot next to their name in the customer's chat header
7. WHEN a seller is offline (last activity more than 5 minutes ago), THE System SHALL display "Last seen [relative time]" in the chat header
8. THE System SHALL update presence status by recording lastActivityAt on the user's session record whenever they send a message, open a page, or interact with the UI, checked during polling cycles

### Requirement 24: Empty States with Suggested Actions

**User Story:** As a user, I want to see helpful suggestions when screens are empty so that I know what to do next.

#### Acceptance Criteria

1. WHEN a seller's inbox has no conversations, THE System SHALL display an illustration with text "No conversations yet" and a "Share your store link" button that copies the store URL to clipboard
2. WHEN a customer's cart is empty, THE System SHALL display an illustration with text "Your cart is empty" and a "Browse Products" button linking to the catalog
3. WHEN a seller has no pending approvals, THE System SHALL display a checkmark illustration with text "All caught up — no pending approvals" and a link to "View approval history"
4. WHEN a customer has no orders, THE System SHALL display text "No orders yet — start shopping to see your orders here" with a "Browse Products" button
5. WHEN a catalog search returns no results, THE System SHALL display "No products found for '[query]'" with suggestions: "Try a different search term" and links to popular categories
6. WHEN a seller has no products listed, THE System SHALL display text "Add your first product to start selling" with an "Add Product" button that opens the product creation form
7. THE System SHALL use friendly, encouraging language in all empty states with a consistent illustration style (line art, brand colors)
8. WHEN a campaign has no recipients (all filtered out by opt-out or frequency caps), THE System SHALL display "No eligible recipients" with an explanation of why customers were excluded and a suggestion to adjust filters

### Requirement 25: Status Pills for Orders, Messages, and Campaigns

**User Story:** As a user, I want to see clear color-coded status indicators so that I can quickly understand the state of any item.

#### Acceptance Criteria

1. THE System SHALL display message delivery status as compact pills with icons: "Sent" (single gray check), "Delivered" (double gray checks), "Read" (double blue checks), "Failed" (red × icon)
2. THE System SHALL display order status as colored pills: pending (yellow), confirmed (blue), processing (blue), shipped (green), delivered (dark green), cancelled (red), refunded (orange)
3. THE System SHALL display campaign status as pills: draft (gray), scheduled (yellow), sending (blue), sent (green), failed (red)
4. THE System SHALL display approval status as pills: pending_review (yellow), approved (green), rejected (red), edited_approved (green with edit icon), executed (dark green)
5. THE System SHALL use a consistent color palette across all status types: green (#22C55E) for success, yellow (#EAB308) for pending, red (#EF4444) for error, blue (#3B82F6) for in-progress, gray (#6B7280) for neutral
6. WHEN a status changes in real-time (detected via polling), THE System SHALL animate the pill transition with a brief color fade effect (200ms CSS transition)
7. THE System SHALL render status pills in both list views (compact, text only) and detail views (icon + text), maintaining consistent colors
8. THE System SHALL display a tooltip on hover (desktop) or long-press (mobile) explaining the status meaning, e.g., "Delivered — Message was received by the customer's device"

### Requirement 26: Order Event Timeline

**User Story:** As a customer or seller, I want to see a timeline of order events so that I can track the full history of an order.

#### Acceptance Criteria

1. WHEN a user views an order detail, THE System SHALL display a vertical timeline of events: created, confirmed (seller accepted), payment received, processing, shipped, delivered — with completed steps highlighted and future steps grayed
2. THE System SHALL show timestamps for each completed event in relative format ("2 hours ago") with absolute time on hover ("15 Jan 2026, 2:30 PM IST")
3. THE System SHALL highlight the current active state with a pulsing colored indicator (blue dot) and a connecting line to previous completed states (solid green line)
4. THE System SHALL display event details inline: "Payment received via UPI — ₹2,500", "Shipped via Delhivery — Tracking #DL123456", "Delivered — Signed by Rajesh"
5. THE System SHALL include system events in the timeline: "Payment reminder sent", "Auto-cancelled due to non-payment", "Stock unreserved"
6. THE System SHALL use icons for each event type: 📦 for shipping, 💳 for payment, ✅ for confirmation, 🛒 for creation, 🚚 for delivery
7. THE System SHALL display the timeline in chronological order with the most recent event at the top and the creation event at the bottom
8. WHEN an order has an estimated delivery date (set by seller during shipping), THE System SHALL display it as a future timeline node with a dashed connector line

### Requirement 27: Onboarding Flow with Phone Verification

**User Story:** As a new user, I want to complete onboarding with phone verification so that I can start using the platform securely.

#### Acceptance Criteria

1. WHEN a new user opens the registration page, THE System SHALL display a role selection screen: "I'm a Customer" and "I'm a Seller" with clear descriptions of each role's capabilities
2. WHEN a customer registers, THE System SHALL collect phone number and display name on step 1, send OTP on step 2, and verify OTP on step 3 — completing registration in 3 steps
3. WHEN a seller registers, THE System SHALL collect phone number and display name on step 1, business details (business name, address, GST number) on step 2, send OTP on step 3, and verify on step 4
4. THE System SHALL display an OTP input screen with 6 individual digit boxes, a 10-minute countdown timer, and a "Resend OTP" button that activates after 60 seconds
5. WHEN a valid OTP is entered, THE System SHALL create the Cognito user account, create the DynamoDB user profile, and redirect: customers to the product catalog, sellers to the dashboard with a "Pending Approval" banner
6. WHEN onboarding completes with a verified phone, THE System SHALL send a welcome WhatsApp message using the "welcome_customer" or "welcome_seller" Twilio template
7. THE System SHALL validate all input fields in real-time: phone number format (Indian mobile: 10 digits starting with 6-9), GST number format (15-character alphanumeric), and business name (2-100 characters)
8. THE System SHALL handle registration errors gracefully: duplicate phone (show "This number is already registered — try logging in"), Cognito errors (show generic "Registration failed, please try again"), and network errors (show retry button)

### Requirement 28: Quiet Hours and Frequency Cap Enforcement

**User Story:** As a platform operator, I want to enforce quiet hours and frequency caps so that we respect customer preferences and comply with messaging policies.

#### Acceptance Criteria

1. WHEN the current time is between 22:00 and 09:00 IST, THE System SHALL suppress all promotional messages by checking the IST offset (UTC+5:30) before any outbound promotional send
2. THE System SHALL queue suppressed promotional messages in a "scheduled-messages" SQS queue with a deliverAfter attribute set to 09:00 IST, processed by a scheduled Lambda at 09:01 IST daily
3. WHEN a customer has received 3 promotional messages in a rolling 24-hour window, THE System SHALL suppress additional promotional messages by checking the consent record's promotionalMessageCount and lastPromotionalResetAt
4. THE System SHALL increment promotionalMessageCount on the consent record after each successful promotional send, and reset it to 0 when (currentTime - lastPromotionalResetAt) exceeds 24 hours
5. WHEN a customer sends "STOP", "Unsubscribe", "रुको", or "बंद करो", THE System SHALL update the consent record to set optedOut: true and send a confirmation: "You've been unsubscribed from promotional messages. You'll still receive order updates."
6. THE System SHALL allow transactional messages (order confirmations, shipping updates, payment receipts, OTP) regardless of opt-out status, quiet hours, or frequency caps
7. THE System SHALL provide an admin API endpoint (GET /admin/messaging/config) to view current quiet hours and frequency cap settings, and (PUT /admin/messaging/config) to update them per environment
8. THE System SHALL log all suppressed messages with suppression reason (quiet_hours | frequency_cap | opted_out | no_service_window) in a structured CloudWatch log entry for analytics and compliance reporting

### Requirement 29: Session Recovery After Timeout

**User Story:** As a customer, I want to resume my shopping session after a break so that I don't lose my cart or conversation context.

#### Acceptance Criteria

1. WHEN a session has been inactive for 24 hours (lastActivityAt + 24h < currentTime), THE System SHALL mark the session state as "closed" during the next interaction or via the daily cleanup Lambda
2. WHEN a customer sends a message after session expiry, THE System SHALL create a new session (PK: SESSION#{userId}, SK: ACTIVE) and check for an existing cart entity (PK: CART#{userId}, SK: ACTIVE)
3. IF a cart exists and was last modified within 7 days, THEN THE System SHALL restore it and send: "Welcome back! Your cart with [itemCount] items (₹[subtotal]) is ready. Type 'cart' to view or 'clear' to start fresh."
4. IF a cart exists but was last modified more than 7 days ago, THEN THE System SHALL delete the cart entity and start a fresh session with: "Welcome back! Your previous cart has expired. Let's start fresh — what are you looking for?"
5. THE System SHALL preserve message history (PK: THREAD#{userId}) for 30 days after session expiry using DynamoDB TTL, allowing customers to scroll back through previous conversations
6. WHEN a session times out during an active checkout flow (state: "ordering" or "payment"), THE System SHALL preserve the cart and pending order, allowing the customer to resume checkout on their next message
7. THE System SHALL send a cart abandonment reminder 24 hours after the last cart modification if: the cart has items, the customer has an active service window, and the customer has not opted out of promotional messages
8. THE System SHALL use DynamoDB TTL on session records (expiresAt = lastActivityAt + 30 days) to automatically clean up expired sessions without a dedicated cleanup Lambda for the deletion step

### Requirement 30: Real-Time Sync Implementation

**User Story:** As a platform operator, I want to implement real-time sync efficiently so that the system scales cost-effectively while providing responsive UX.

#### Acceptance Criteria

1. THE System SHALL implement real-time sync for web clients using HTTP long-polling with a 2-second interval, where each poll request includes a lastSyncTimestamp and cartVersion
2. WHEN a poll request is received, THE System SHALL query DynamoDB for: new messages since lastSyncTimestamp (PK: THREAD#{userId}, SK > MSG#{lastSyncTimestamp}), current cart state (if cartVersion differs), and typing indicators
3. WHEN no updates exist since lastSyncTimestamp and cartVersion matches, THE System SHALL return 304 Not Modified with appropriate Cache-Control headers to minimize data transfer
4. WHEN updates exist, THE System SHALL return a JSON response containing: newMessages array, cartState (if changed), typingIndicators array, and presenceUpdates array, with a new lastSyncTimestamp and cartVersion
5. THE System SHALL use DynamoDB conditional reads with ConsistentRead: false (eventually consistent) for polling to minimize read capacity consumption, accepting up to 1-second staleness
6. THE System SHALL implement client-side exponential backoff when poll requests fail: 2s → 4s → 8s → 16s → 30s (max), resetting to 2s on successful response
7. THE System SHALL document a migration path to API Gateway WebSocket API in the design document, identifying the specific DynamoDB Streams → Lambda → WebSocket connection manager pattern to be used
8. THE System SHALL support concurrent polling from multiple tabs/devices for the same user by using the userId (not sessionId) as the sync key, ensuring all clients receive the same updates

### Requirement 31: Seller Dashboard Chat Integration

**User Story:** As a seller, I want to chat with customers directly from my dashboard so that I can handle inquiries without switching to WhatsApp.

#### Acceptance Criteria

1. THE System SHALL provide a chat panel within the seller dashboard that displays the selected customer conversation with full message history, channel indicators, and delivery status
2. WHEN a seller types and sends a message from the dashboard chat, THE System SHALL store it in the unified thread (PK: THREAD#{customerId}, SK: MSG#{timestamp}#{messageId}) with channel: "web" and senderRole: "seller"
3. WHEN a seller sends a message from the dashboard, THE System SHALL deliver it to the customer's lastActiveChannel: if WhatsApp, via Twilio; if web, available on the customer's next poll
4. THE System SHALL display the customer's current cart contents in a sidebar panel next to the chat, allowing the seller to see what the customer is considering
5. THE System SHALL provide quick-action buttons in the chat toolbar: "Send Payment Link", "Share Product", "Create Order", and "View Order History"
6. WHEN a seller clicks "Share Product", THE System SHALL open a product search modal, and on selection, send a product card message to the customer with image, name, price, and "Add to Cart" action
7. THE System SHALL show a notification badge on the chat icon in the seller dashboard navigation when new unread customer messages arrive
8. THE System SHALL support multiple concurrent conversations by displaying a conversation list on the left and the active conversation on the right in a split-pane layout

### Requirement 32: Customer Account Preferences

**User Story:** As a customer, I want to manage my communication preferences so that I control how the platform contacts me.

#### Acceptance Criteria

1. WHEN a customer opens account settings on web, THE System SHALL display: current phone number (masked: ****9085), email, preferred channel toggle (WhatsApp | Web | Both), and promotional message opt-in/out toggle
2. THE System SHALL allow customers to change their preferred channel, updating the user record's preferredChannel field and routing future seller replies accordingly
3. WHEN a customer toggles promotional messages off, THE System SHALL update the consent record to set optedOut: true and display confirmation: "You won't receive promotional messages. Order updates will continue."
4. WHEN a customer toggles promotional messages on, THE System SHALL update the consent record to set optedOut: false and display confirmation: "You'll now receive promotional offers from sellers you've interacted with."
5. THE System SHALL display a "Connected Channels" section showing WhatsApp connection status (connected/disconnected) with the verified phone number, and a "Disconnect WhatsApp" button
6. THE System SHALL provide a "Delete Account" section with a red "Delete My Account" button that opens a confirmation modal listing consequences before proceeding
7. WHEN a customer changes their preferred channel, THE System SHALL take effect immediately for new messages, without affecting messages already in transit
8. THE System SHALL display the customer's order history summary in account settings: total orders, total spend, and member since date

### Requirement 33: WhatsApp Opt-In Collection During Onboarding

**User Story:** As a platform operator, I want to collect explicit WhatsApp opt-in during registration so that we comply with Twilio's opt-in requirements.

#### Acceptance Criteria

1. WHEN a user completes phone verification during onboarding, THE System SHALL display a WhatsApp opt-in screen: "Would you like to receive order updates and offers on WhatsApp?" with "Yes, opt me in" and "No thanks" buttons
2. WHEN a user opts in, THE System SHALL create a consent record (PK: CONSENT#{userId}, SK: WHATSAPP_OPTIN) with optedIn: true, optedInAt: timestamp, and optInMethod: "registration"
3. WHEN a user declines opt-in, THE System SHALL create a consent record with optedIn: false and set the user's preferredChannel to "web"
4. THE System SHALL not send any WhatsApp messages (including welcome messages) to users who have not opted in, except for OTP verification SMS which uses SMS channel
5. WHEN a customer sends the first WhatsApp message to the platform number, THE System SHALL treat this as implicit opt-in and create/update the consent record with optInMethod: "user_initiated"
6. THE System SHALL store opt-in records with full audit trail: optedInAt, optInMethod (registration|user_initiated|settings), optedOutAt (if applicable), and optOutMethod
7. THE System SHALL display the current opt-in status in account settings with the ability to opt out at any time
8. THE System SHALL include opt-in status in the admin user detail view so that support agents can verify a customer's consent status during dispute resolution

### Requirement 34: Observability and Alerting for Omnichannel Flows

**User Story:** As a platform operator, I want comprehensive observability across all messaging channels so that I can detect and resolve issues quickly.

#### Acceptance Criteria

1. THE System SHALL publish custom CloudWatch metrics for: WhatsAppWebhookLatency, MessageProcessingLatency, CartSyncLatency, AIProcessingLatency, TwilioSendLatency, and PollResponseLatency — all in milliseconds
2. THE System SHALL publish count metrics for: MessagesReceived (by channel), MessagesSent (by channel), CartUpdates, ApprovalActions, CampaignsSent, OTPsSent, and AIFallbacks (by service)
3. THE System SHALL create CloudWatch alarms for: WhatsApp DLQ depth > 5, Media DLQ depth > 10, message processing error rate > 5% (5-min window), Twilio send failure rate > 3%, and AI failure rate > 5% per service
4. THE System SHALL include requestId, userId, sessionId, and channel in all structured log entries to enable end-to-end request tracing across webhook → EventBridge → SQS → worker → Twilio
5. THE System SHALL log all state transitions (session state changes, order status changes, approval status changes) as structured events with oldState, newState, trigger, and actorId
6. THE System SHALL create a CloudWatch dashboard "OmnichannelHealth" displaying: message volume by channel (time series), error rates, DLQ depths, AI processing latency (p50/p95/p99), and active session count
7. THE System SHALL configure X-Ray tracing on all Lambda functions in the messaging pipeline to enable distributed trace visualization from webhook receipt to message delivery
8. THE System SHALL implement a daily health check Lambda that verifies: Twilio API connectivity, Gemini API connectivity, Bedrock API connectivity, DynamoDB table accessibility, and SQS queue health — publishing results as a CloudWatch metric "SystemHealthScore"
