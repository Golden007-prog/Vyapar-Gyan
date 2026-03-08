# Requirements Document: Omnichannel Commerce MVP

## Introduction

This specification defines the next major product phase for VyaparGyan: a unified omnichannel commerce experience that seamlessly integrates WhatsApp and web chat for both customers and sellers. The system will provide a consistent conversation, cart, and session model across channels, with seller approval workflows for all AI-triggered actions, voice and image-based ordering capabilities, and policy-compliant messaging.

The MVP focuses on delivering a polished, production-ready experience using one shared WhatsApp business number (via Twilio), with phone verification, unified state management, and modern chat UX for all user types.

## Glossary

- **System**: The VyaparGyan omnichannel commerce platform
- **Customer**: End user browsing and purchasing products via WhatsApp or web chat
- **Seller**: Retailer managing products, inventory, and orders via web dashboard and WhatsApp
- **Admin**: Platform operator moderating sellers and resolving disputes
- **Session**: A conversation context that persists across WhatsApp and web channels
- **Cart**: Shopping cart state synchronized across all channels
- **Channel**: Communication medium (WhatsApp or web chat)
- **Approval_Engine**: Workflow system for seller review of AI-generated actions
- **AI_Insight**: System-generated recommendation for pricing, discounts, or campaigns
- **Campaign**: Promotional message sent to customers after seller approval
- **Service_Window**: 24-hour period after customer message during which promotional messages are allowed (WhatsApp policy)
- **Template_Message**: Pre-approved WhatsApp message format required for outbound promotional content
- **OTP**: One-time password for phone number verification
- **Voice_Note**: Audio message from customer transcribed to text for intent detection
- **Image_Search**: Product discovery via customer-uploaded images
- **Twilio**: Third-party service providing WhatsApp messaging API
- **Bedrock**: AWS AI service for conversation orchestration
- **Gemini**: Google AI service for voice transcription and image recognition
- **Message_Thread**: Chronological history of messages in a session
- **Idempotency**: Property ensuring duplicate message processing is prevented
- **Dead_Stock**: Inventory items aged beyond threshold requiring liquidation
- **Discount_Campaign**: Time-limited price reduction to drive sales
- **Quiet_Hours**: Time period when promotional messages are suppressed (10 PM - 9 AM IST)
- **Frequency_Cap**: Maximum number of promotional messages per customer per time period
- **Opt_Out**: Customer preference to stop receiving promotional messages
- **Deleted_User**: Customer or seller who has permanently removed their account
- **Phone_Verification**: Process confirming user owns the phone number via OTP
- **Preferred_Channel**: User's default communication channel (WhatsApp or web)

## Requirements

### Requirement 1: Unified Identity and Phone Verification

**User Story:** As a customer or seller, I want to verify my phone number and manage my account, so that I can securely access the platform across WhatsApp and web channels.

#### Acceptance Criteria

1. WHEN a new user registers, THE System SHALL send an OTP to the provided phone number within 30 seconds
2. WHEN a user enters a valid OTP within 10 minutes, THE System SHALL mark the phone number as verified
3. WHEN a user enters an invalid OTP, THE System SHALL increment the failure counter and allow up to 3 attempts
4. WHEN OTP attempts exceed 3 failures, THE System SHALL block OTP requests for that phone number for 1 hour
5. WHEN a verified user changes their phone number, THE System SHALL require OTP verification for the new number
6. THE System SHALL store exactly one verified phone number per user account
7. WHEN a user disconnects their phone number, THE System SHALL revoke WhatsApp access while preserving web access
8. WHEN a user deletes their account, THE System SHALL mark all associated data as deleted and revoke all access

### Requirement 2: Role-Based Permissions and Channel Access

**User Story:** As a platform operator, I want to enforce role-based permissions across channels, so that users can only access features appropriate to their role.

#### Acceptance Criteria

1. THE System SHALL support exactly three roles: customer, seller, and admin
2. WHEN a customer accesses the platform, THE System SHALL grant access to product browsing, cart management, and order tracking
3. WHEN a seller accesses the platform, THE System SHALL grant access to inventory management, order fulfillment, AI insights approval, and customer chat
4. WHEN an admin accesses the platform, THE System SHALL grant access to all seller features plus seller moderation and dispute resolution
5. WHEN a user attempts to access a feature not permitted for their role, THE System SHALL return a 403 Forbidden error
6. THE System SHALL verify user role on every API request using JWT claims
7. WHEN a seller is suspended by admin, THE System SHALL revoke all seller access while preserving customer access for that user
8. THE System SHALL allow a user to hold both customer and seller roles simultaneously with independent permissions

### Requirement 3: Unified Session Model Across Channels

**User Story:** As a customer, I want my conversation and cart to persist when I switch between WhatsApp and web chat, so that I can continue shopping seamlessly.

#### Acceptance Criteria

1. WHEN a customer sends a message on WhatsApp, THE System SHALL create or retrieve a session linked to their phone number
2. WHEN the same customer opens web chat, THE System SHALL retrieve the existing session using their authenticated user ID
3. THE System SHALL synchronize cart contents across WhatsApp and web within 2 seconds of any cart modification
4. THE System SHALL display the same message history on both WhatsApp and web for a given session
5. WHEN a customer adds a product to cart on WhatsApp, THE System SHALL reflect that addition in web chat immediately
6. WHEN a customer removes a product from cart on web, THE System SHALL reflect that removal in WhatsApp immediately
7. THE System SHALL maintain session state (browsing, cart, ordering) consistently across both channels
8. WHEN a session is inactive for 24 hours, THE System SHALL mark it as expired but preserve message history for 30 days

### Requirement 4: Seller Approval Engine for AI Actions

**User Story:** As a seller, I want to review and approve all AI-generated recommendations before they execute, so that I maintain control over my business decisions.

#### Acceptance Criteria

1. WHEN the AI detects dead stock, THE System SHALL create an approval request with status "pending_review"
2. WHEN a seller views an approval request, THE System SHALL display the AI rationale, affected products, proposed action, and estimated impact
3. WHEN a seller approves a discount recommendation, THE System SHALL update product prices and transition approval status to "approved"
4. WHEN a seller rejects a recommendation, THE System SHALL transition approval status to "rejected" and log the rejection reason
5. WHEN a seller edits an AI recommendation, THE System SHALL save the modified version and transition status to "edited_approved"
6. THE System SHALL prevent execution of any AI-generated action until seller approval is recorded
7. WHEN a seller approves a campaign, THE System SHALL schedule message sends only to customers within the 24-hour service window
8. THE System SHALL create an audit log entry for every approval decision including seller ID, timestamp, and action taken

### Requirement 5: Omnichannel Messaging with Policy Compliance

**User Story:** As a platform operator, I want to send promotional messages only when policy-compliant, so that we avoid WhatsApp account suspension.

#### Acceptance Criteria

1. WHEN a customer sends a message, THE System SHALL record the timestamp and open a 24-hour service window
2. WHEN the System sends a promotional message, THE System SHALL verify the customer has an active service window
3. IF no service window exists, THEN THE System SHALL use a pre-approved template message format
4. WHEN the current time is between 10 PM and 9 AM IST, THE System SHALL suppress promotional messages until 9 AM
5. WHEN a customer has received 3 promotional messages in 24 hours, THE System SHALL suppress additional promotional messages until the window resets
6. WHEN a customer sends "STOP" or "Unsubscribe", THE System SHALL mark their opt-out preference and suppress all promotional messages
7. WHEN a customer has opted out, THE System SHALL still allow transactional messages (order confirmations, shipping updates)
8. WHEN a user deletes their account, THE System SHALL immediately revoke all pending campaign sends for that user

### Requirement 6: Voice Note Ordering

**User Story:** As a customer, I want to order products by sending voice notes, so that I can shop hands-free in my native language.

#### Acceptance Criteria

1. WHEN a customer sends a voice note on WhatsApp, THE System SHALL download the audio file within 5 seconds
2. WHEN the audio file is downloaded, THE System SHALL transcribe it using Gemini within 10 seconds
3. WHEN transcription completes, THE System SHALL extract product names and quantities using intent detection
4. WHEN products are identified, THE System SHALL search the catalog and return matching products with confidence scores
5. IF confidence score is above 80%, THEN THE System SHALL add products to cart and confirm the addition
6. IF confidence score is below 80%, THEN THE System SHALL ask clarifying questions before adding to cart
7. WHEN transcription fails, THE System SHALL send a fallback message asking the customer to type their request
8. THE System SHALL support voice notes in English, Hindi, and regional Indian languages

### Requirement 7: Image-Based Product Search

**User Story:** As a customer, I want to find products by uploading images, so that I can discover items visually without knowing exact names.

#### Acceptance Criteria

1. WHEN a customer sends an image on WhatsApp or web chat, THE System SHALL download the image within 5 seconds
2. WHEN the image is downloaded, THE System SHALL analyze it using Gemini Vision within 10 seconds
3. WHEN image analysis completes, THE System SHALL extract product attributes (category, color, style, brand)
4. WHEN attributes are extracted, THE System SHALL search the catalog using attribute matching
5. THE System SHALL return up to 5 matching products ranked by visual similarity score
6. WHEN no matches are found, THE System SHALL suggest the closest category and ask the customer to browse
7. WHEN multiple strong matches exist, THE System SHALL display them as a carousel for customer selection
8. THE System SHALL handle image formats: JPEG, PNG, WebP with maximum size 5MB

### Requirement 8: Modern Chat UX for Customers and Sellers

**User Story:** As a customer or seller, I want a WhatsApp-style chat interface on web, so that I have a familiar and intuitive messaging experience.

#### Acceptance Criteria

1. THE System SHALL display messages in chronological order with sender identification (customer, seller, system)
2. THE System SHALL show message timestamps in relative format (e.g., "2 minutes ago", "Yesterday")
3. THE System SHALL display message delivery status (sent, delivered, read) for outbound messages
4. WHEN a new message arrives, THE System SHALL play a notification sound and show a badge count
5. THE System SHALL provide a sticky bottom composer with text input, emoji picker, and file upload
6. WHEN a user types a message, THE System SHALL show a typing indicator to the other party
7. THE System SHALL support message editing within 5 minutes of sending
8. THE System SHALL display the cart as a side panel that updates in real-time during conversation
9. THE System SHALL show quick reply buttons for common actions (Add to Cart, Checkout, View Orders)
10. THE System SHALL render product cards with image, name, price, and stock status inline in the chat

### Requirement 9: Cart and Checkout Synchronization

**User Story:** As a customer, I want my cart to update instantly across channels, so that I can start shopping on WhatsApp and complete checkout on web.

#### Acceptance Criteria

1. WHEN a customer adds a product to cart, THE System SHALL update the cart state in DynamoDB within 1 second
2. WHEN cart state changes, THE System SHALL broadcast the update to all active sessions for that customer
3. THE System SHALL display cart item count, subtotal, and checkout button on both WhatsApp and web
4. WHEN a product in cart goes out of stock, THE System SHALL remove it from cart and notify the customer
5. WHEN a customer proceeds to checkout, THE System SHALL validate stock availability for all cart items
6. IF stock is insufficient, THEN THE System SHALL remove unavailable items and notify the customer
7. WHEN checkout completes, THE System SHALL clear the cart and create an order record
8. THE System SHALL preserve cart contents for 7 days if the customer does not complete checkout

### Requirement 10: Seller Chat Inbox with Customer Context

**User Story:** As a seller, I want to see all customer conversations with order history and cart contents, so that I can provide personalized support.

#### Acceptance Criteria

1. WHEN a seller opens their inbox, THE System SHALL display all active customer conversations sorted by most recent message
2. WHEN a seller selects a conversation, THE System SHALL display the full message history, current cart contents, and past orders
3. THE System SHALL show customer profile information (name, phone, total orders, total spend) in the conversation sidebar
4. WHEN a customer sends a message, THE System SHALL notify the seller in real-time with a badge count
5. WHEN a seller replies, THE System SHALL send the message to the customer's preferred channel (WhatsApp or web)
6. THE System SHALL allow sellers to view and modify customer cart contents during conversation
7. WHEN a seller marks a conversation as resolved, THE System SHALL move it to the resolved tab
8. THE System SHALL provide search functionality to find conversations by customer name, phone, or order number

### Requirement 11: Approval Inbox and Campaign Composer

**User Story:** As a seller, I want to review AI recommendations and compose campaigns in one place, so that I can efficiently manage promotional activities.

#### Acceptance Criteria

1. WHEN a seller opens the approval inbox, THE System SHALL display all pending AI recommendations sorted by priority
2. WHEN a seller views a recommendation, THE System SHALL show affected products, proposed discount percentage, estimated revenue impact, and AI rationale
3. WHEN a seller approves a discount, THE System SHALL update product prices immediately and create a campaign draft
4. WHEN a seller opens the campaign composer, THE System SHALL pre-fill message content based on the approved discount
5. THE System SHALL allow sellers to edit campaign message text, target audience, and send schedule
6. WHEN a seller schedules a campaign, THE System SHALL validate that target customers have active service windows
7. THE System SHALL display estimated reach (number of eligible customers) before campaign send
8. WHEN a campaign sends, THE System SHALL track delivery status, open rate, and conversion rate

### Requirement 12: Phone Number Management and Account Deletion

**User Story:** As a user, I want to change my phone number or delete my account, so that I can maintain control over my personal data.

#### Acceptance Criteria

1. WHEN a user initiates phone number change, THE System SHALL send OTP to both old and new numbers
2. WHEN both OTPs are verified, THE System SHALL update the phone number and preserve all account data
3. WHEN a user disconnects their phone number, THE System SHALL revoke WhatsApp access and preserve web access
4. WHEN a user requests account deletion, THE System SHALL display a confirmation dialog with consequences
5. WHEN account deletion is confirmed, THE System SHALL mark the user as deleted and anonymize personal data
6. WHEN a deleted user's phone number is used for registration, THE System SHALL allow creation of a new account
7. THE System SHALL cancel all pending campaigns for a deleted user within 1 minute of deletion
8. THE System SHALL preserve order history for deleted users for 7 years for compliance purposes

### Requirement 13: Message Idempotency and Retry Handling

**User Story:** As a platform operator, I want to prevent duplicate message processing, so that customers don't receive repeated messages or experience cart corruption.

#### Acceptance Criteria

1. WHEN a WhatsApp webhook is received, THE System SHALL check for an existing idempotency record using the message ID
2. IF an idempotency record exists, THEN THE System SHALL return 200 OK without processing the message
3. IF no idempotency record exists, THEN THE System SHALL create one with a 24-hour TTL before processing
4. WHEN message processing fails, THE System SHALL retry up to 3 times with exponential backoff
5. WHEN all retries fail, THE System SHALL send the message to a dead letter queue for manual review
6. THE System SHALL use conditional writes in DynamoDB to prevent race conditions during cart updates
7. WHEN an outbound message send fails, THE System SHALL retry up to 3 times before marking as failed
8. THE System SHALL log all retry attempts with request ID for debugging

### Requirement 14: Session Timeout and Recovery

**User Story:** As a customer, I want to resume my shopping session after a break, so that I don't lose my cart or conversation context.

#### Acceptance Criteria

1. WHEN a session is inactive for 24 hours, THE System SHALL mark it as expired
2. WHEN a customer sends a message after session expiry, THE System SHALL create a new session and restore the previous cart
3. THE System SHALL preserve message history for 30 days after session expiry
4. WHEN a customer returns within 7 days, THE System SHALL display a welcome back message with cart summary
5. WHEN a customer returns after 7 days, THE System SHALL clear the cart and start a fresh session
6. THE System SHALL use DynamoDB TTL to automatically delete expired session data after 30 days
7. WHEN a session times out during checkout, THE System SHALL preserve cart contents and allow resumption
8. THE System SHALL send a cart reminder message 24 hours after cart abandonment if the customer has an active service window

### Requirement 15: Delivery Status Synchronization

**User Story:** As a customer, I want to see real-time message delivery status, so that I know when my messages are received and read.

#### Acceptance Criteria

1. WHEN a message is sent, THE System SHALL display "sent" status immediately
2. WHEN Twilio confirms delivery, THE System SHALL update status to "delivered" within 5 seconds
3. WHEN the recipient reads the message, THE System SHALL update status to "read" within 5 seconds
4. WHEN a message fails to deliver, THE System SHALL update status to "failed" and display an error message
5. THE System SHALL synchronize delivery status across WhatsApp and web chat
6. WHEN a status update webhook is received, THE System SHALL update the message record in DynamoDB
7. THE System SHALL display status icons (single check, double check, blue double check) matching WhatsApp conventions
8. WHEN a message is deleted by the sender, THE System SHALL mark it as deleted but preserve it in the database for audit

### Requirement 16: Failed AI Processing Fallback

**User Story:** As a customer, I want to receive helpful responses even when AI processing fails, so that I can continue shopping without frustration.

#### Acceptance Criteria

1. WHEN voice transcription fails, THE System SHALL send a message asking the customer to type their request
2. WHEN image recognition fails, THE System SHALL ask the customer to describe the product they're looking for
3. WHEN intent detection confidence is below 50%, THE System SHALL ask clarifying questions instead of guessing
4. WHEN Bedrock API is unavailable, THE System SHALL fall back to rule-based conversation handling
5. WHEN Gemini API is unavailable, THE System SHALL disable voice and image features and notify the customer
6. THE System SHALL log all AI failures with request ID and error details for debugging
7. WHEN AI processing takes longer than 15 seconds, THE System SHALL send a "processing" message to the customer
8. THE System SHALL retry failed AI requests up to 2 times before falling back to manual handling

### Requirement 17: Media Processing Retry Queue

**User Story:** As a platform operator, I want to retry failed media processing jobs, so that temporary failures don't result in lost customer requests.

#### Acceptance Criteria

1. WHEN voice transcription fails, THE System SHALL send the job to a retry queue with exponential backoff
2. WHEN image recognition fails, THE System SHALL send the job to a retry queue with exponential backoff
3. THE System SHALL retry media processing jobs up to 3 times with delays of 1s, 5s, and 30s
4. WHEN all retries fail, THE System SHALL send the job to a dead letter queue for manual review
5. THE System SHALL preserve the original message context (session ID, customer ID) in the retry queue
6. WHEN a retry succeeds, THE System SHALL send the processed result to the customer
7. THE System SHALL monitor dead letter queue depth and alert when it exceeds 10 items
8. THE System SHALL provide an admin interface to manually reprocess failed media jobs

### Requirement 18: Template Compliance Checks

**User Story:** As a platform operator, I want to validate outbound messages against WhatsApp policies, so that we avoid account suspension.

#### Acceptance Criteria

1. WHEN a promotional message is scheduled, THE System SHALL verify the customer has an active service window
2. IF no service window exists, THEN THE System SHALL require use of a pre-approved template message
3. THE System SHALL maintain a registry of approved template IDs and their parameters
4. WHEN a template message is sent, THE System SHALL validate that all required parameters are provided
5. THE System SHALL reject promotional messages sent during quiet hours (10 PM - 9 AM IST)
6. THE System SHALL enforce frequency caps (maximum 3 promotional messages per customer per 24 hours)
7. WHEN a customer opts out, THE System SHALL suppress all promotional messages while allowing transactional messages
8. THE System SHALL log all compliance checks with pass/fail status for audit purposes

### Requirement 19: Audit Logging for Seller Actions

**User Story:** As a platform operator, I want to track all seller-approved actions, so that I can investigate disputes and ensure accountability.

#### Acceptance Criteria

1. WHEN a seller approves an AI recommendation, THE System SHALL create an audit log entry with seller ID, timestamp, and action details
2. WHEN a seller modifies a campaign, THE System SHALL log the original and modified versions
3. WHEN a seller sends a manual message to a customer, THE System SHALL log the message content and recipient
4. WHEN a seller updates product prices, THE System SHALL log the old and new prices with justification
5. THE System SHALL store audit logs in DynamoDB with a 7-year retention period
6. THE System SHALL provide an admin interface to search audit logs by seller, date range, and action type
7. WHEN a dispute is raised, THE System SHALL retrieve all relevant audit logs for investigation
8. THE System SHALL export audit logs to S3 in JSON format for compliance reporting

### Requirement 20: Out-of-Stock Reroute Flow

**User Story:** As a customer, I want to be notified when a product goes out of stock and offered alternatives, so that I can complete my purchase.

#### Acceptance Criteria

1. WHEN a customer adds a product to cart, THE System SHALL validate current stock availability
2. WHEN a product in cart goes out of stock, THE System SHALL remove it from cart and notify the customer
3. WHEN a product goes out of stock, THE System SHALL search for similar products in the same category
4. THE System SHALL display up to 3 alternative products with similar attributes and price range
5. WHEN a customer selects an alternative, THE System SHALL add it to cart and continue the checkout flow
6. WHEN no alternatives are available, THE System SHALL offer to notify the customer when the product is restocked
7. WHEN a customer opts in for restock notification, THE System SHALL send a message when stock is replenished
8. THE System SHALL track out-of-stock events and alert sellers when products frequently go out of stock

### Requirement 21: Payment Reminder Flow

**User Story:** As a seller, I want to send payment reminders to customers with pending orders, so that I can reduce order cancellations.

#### Acceptance Criteria

1. WHEN an order is created but not paid within 1 hour, THE System SHALL send a payment reminder to the customer
2. WHEN a customer has an active service window, THE System SHALL send the reminder as a regular message
3. IF no service window exists, THEN THE System SHALL use a pre-approved payment reminder template
4. THE System SHALL include the payment link, order summary, and expiry time in the reminder
5. WHEN a customer pays after receiving a reminder, THE System SHALL track the conversion for analytics
6. THE System SHALL send a maximum of 2 payment reminders per order (at 1 hour and 12 hours)
7. WHEN an order is not paid within 24 hours, THE System SHALL cancel the order and unreserve stock
8. THE System SHALL notify the seller when an order is auto-cancelled due to non-payment

### Requirement 22: Seller WhatsApp Chat Access

**User Story:** As a seller, I want to manage customer conversations via WhatsApp, so that I can respond to inquiries on the go.

#### Acceptance Criteria

1. WHEN a customer sends a message, THE System SHALL route it to the seller's WhatsApp if the seller has verified their phone number
2. WHEN a seller replies via WhatsApp, THE System SHALL send the message to the customer's preferred channel
3. THE System SHALL prefix seller messages with the seller's business name for customer identification
4. WHEN a seller sends a command (e.g., "update price"), THE System SHALL process it using the seller copilot
5. THE System SHALL distinguish between seller-to-customer messages and seller-to-system commands
6. WHEN a seller is offline, THE System SHALL queue messages and deliver them when the seller comes online
7. THE System SHALL provide a "switch to web" command for sellers to transition complex conversations to the dashboard
8. THE System SHALL sync all WhatsApp conversations to the web inbox for unified history

### Requirement 23: Customer Web Chat Access

**User Story:** As a customer, I want to browse products and chat with sellers on the web, so that I can shop from my desktop.

#### Acceptance Criteria

1. WHEN a customer opens the web chat, THE System SHALL authenticate them using JWT tokens
2. WHEN a customer is not authenticated, THE System SHALL allow guest browsing with limited features
3. THE System SHALL display the product catalog with search, filters, and category navigation
4. WHEN a customer selects a product, THE System SHALL display details in a modal with "Add to Cart" and "Ask Seller" buttons
5. WHEN a customer clicks "Ask Seller", THE System SHALL open the chat interface with the product pre-filled
6. THE System SHALL route customer messages to the seller's preferred channel (WhatsApp or web)
7. WHEN a seller replies, THE System SHALL display the message in the customer's web chat in real-time
8. THE System SHALL persist web chat sessions across page refreshes using session storage

### Requirement 24: Onboarding Flow with Phone Verification

**User Story:** As a new user, I want to complete onboarding with phone verification, so that I can start using the platform securely.

#### Acceptance Criteria

1. WHEN a new user registers, THE System SHALL collect email, phone number, and role (customer or seller)
2. WHEN registration is submitted, THE System SHALL send an OTP to the provided phone number
3. THE System SHALL display an OTP input screen with a 10-minute countdown timer
4. WHEN a valid OTP is entered, THE System SHALL create the user account and mark the phone as verified
5. WHEN a seller registers, THE System SHALL require additional business information (business name, address, GST number)
6. WHEN onboarding completes, THE System SHALL redirect customers to the product catalog and sellers to the dashboard
7. THE System SHALL send a welcome message to the user's WhatsApp number after verification
8. THE System SHALL provide a "Resend OTP" button with a 60-second cooldown period

### Requirement 25: Account Settings and Preferences

**User Story:** As a user, I want to manage my account settings and communication preferences, so that I can control how the platform interacts with me.

#### Acceptance Criteria

1. WHEN a user opens account settings, THE System SHALL display current phone number, email, and preferred channel
2. THE System SHALL allow users to change their preferred channel between WhatsApp and web
3. WHEN a user changes their preferred channel, THE System SHALL route future messages to the new channel
4. THE System SHALL allow users to opt out of promotional messages while preserving transactional messages
5. WHEN a user opts out, THE System SHALL display a confirmation message and update the preference immediately
6. THE System SHALL allow users to change their phone number with OTP verification
7. THE System SHALL provide a "Delete Account" button with a confirmation dialog
8. WHEN account deletion is confirmed, THE System SHALL execute the deletion within 1 minute and send a confirmation email

### Requirement 26: Unified Inbox for Sellers

**User Story:** As a seller, I want to see all customer conversations in one inbox, so that I can manage support efficiently.

#### Acceptance Criteria

1. WHEN a seller opens the unified inbox, THE System SHALL display conversations from both WhatsApp and web chat
2. THE System SHALL show conversation metadata (customer name, last message, unread count, channel icon)
3. WHEN a seller selects a conversation, THE System SHALL display the full message history with channel indicators
4. THE System SHALL provide tabs for "Active", "Resolved", and "All" conversations
5. WHEN a new message arrives, THE System SHALL move the conversation to the top of the active list
6. THE System SHALL allow sellers to search conversations by customer name, phone, or message content
7. THE System SHALL display customer context (total orders, total spend, last order date) in the sidebar
8. THE System SHALL allow sellers to assign conversations to team members (future: multi-user seller accounts)

### Requirement 27: Cart Side Panel with Real-Time Updates

**User Story:** As a customer, I want to see my cart update in real-time during conversation, so that I can track what I'm purchasing.

#### Acceptance Criteria

1. THE System SHALL display the cart as a collapsible side panel on the web chat interface
2. WHEN a product is added to cart, THE System SHALL animate the addition and update the item count
3. THE System SHALL display cart items with thumbnail image, name, quantity, unit price, and subtotal
4. WHEN a customer changes quantity, THE System SHALL update the subtotal and total in real-time
5. THE System SHALL display the cart total, tax, and shipping cost with a "Checkout" button
6. WHEN a product in cart goes out of stock, THE System SHALL highlight it in red and disable checkout
7. THE System SHALL allow customers to remove items from cart with a single click
8. WHEN cart is empty, THE System SHALL display a message encouraging the customer to browse products

### Requirement 28: Empty States with Suggested Actions

**User Story:** As a user, I want to see helpful suggestions when screens are empty, so that I know what to do next.

#### Acceptance Criteria

1. WHEN a seller's inbox is empty, THE System SHALL display a message with suggested actions (e.g., "No conversations yet. Share your store link to get started.")
2. WHEN a customer's cart is empty, THE System SHALL display a message with a "Browse Products" button
3. WHEN a seller has no pending approvals, THE System SHALL display a message with a link to AI insights documentation
4. WHEN a customer has no orders, THE System SHALL display a message encouraging them to start shopping
5. WHEN search returns no results, THE System SHALL suggest alternative search terms or categories
6. WHEN a seller has no products, THE System SHALL display a message with a "Add Product" button
7. THE System SHALL use friendly, encouraging language in all empty states
8. THE System SHALL include relevant icons or illustrations to make empty states visually appealing

### Requirement 29: Status Pills for Message and Order State

**User Story:** As a user, I want to see clear status indicators, so that I can quickly understand the state of messages, orders, and campaigns.

#### Acceptance Criteria

1. THE System SHALL display message status as pills with icons (sent, delivered, read, failed)
2. THE System SHALL display order status as colored pills (pending, confirmed, processing, shipped, delivered, cancelled)
3. THE System SHALL display campaign status as pills (draft, scheduled, sending, sent, completed, failed)
4. THE System SHALL display approval status as pills (pending_review, approved, rejected, edited_approved)
5. THE System SHALL use consistent colors across the platform (green for success, yellow for pending, red for error, blue for info)
6. WHEN a status changes, THE System SHALL animate the pill transition
7. THE System SHALL display status pills in both list views and detail views
8. THE System SHALL provide tooltips on hover explaining what each status means

### Requirement 30: Timeline for Order and Conversation Events

**User Story:** As a customer or seller, I want to see a timeline of events, so that I can track the history of orders and conversations.

#### Acceptance Criteria

1. WHEN a user views an order, THE System SHALL display a timeline of events (created, confirmed, processing, shipped, delivered)
2. THE System SHALL show timestamps for each event in relative format (e.g., "2 hours ago")
3. WHEN a user views a conversation, THE System SHALL display a timeline of key events (session started, product added to cart, order created, payment completed)
4. THE System SHALL highlight the current state in the timeline
5. THE System SHALL display event details on hover (e.g., "Shipped by FedEx, tracking #123456")
6. THE System SHALL allow users to expand event details for more information
7. THE System SHALL use icons to represent different event types (package for shipping, credit card for payment, chat bubble for messages)
8. THE System SHALL display the timeline in chronological order with the most recent event at the top
