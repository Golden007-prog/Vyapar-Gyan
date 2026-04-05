# Requirements Document

## Introduction

This document defines the requirements for VyaparGyan's next feature set — seven capabilities that extend the AI-powered multi-seller marketplace from its current state into a fully omnichannel, AI-driven commerce platform for Indian local retailers. The features span role-based WhatsApp routing, real-time chat synchronization, AI inventory operations, admin dashboard expansion, UPI payments, abandoned cart recovery, and voice-activated financial reports.

## Glossary

- **WhatsApp_Bot**: The Twilio-powered WhatsApp webhook handler that processes incoming messages and routes them through the conversation state machine
- **Session_Service**: The service managing WhatsApp conversation state (state machine transitions, TTL, context storage) in DynamoDB
- **Role_Resolver**: The utility that looks up a phone number in DynamoDB via GSI and returns the user's role (seller/customer/unregistered)
- **Seller_Copilot**: The WhatsApp-based assistant interface for sellers, providing stock checks, trend alerts, campaign approvals, and inventory actions
- **Customer_Discovery**: The WhatsApp-based store discovery interface for customers, providing favorites, pincode search, and global search
- **Message_Router**: The fan-out service that pushes messages to the correct channels (WhatsApp via Twilio, Web via WebSocket) based on recipient's active connections
- **Intent_Extractor**: The Gemini-powered service that extracts product intent, store intent, and language from customer messages
- **Handoff_Controller**: The session-level flag and logic that switches a conversation from AI-managed to human-managed mode
- **Campaign_Executor**: The Lambda worker that dispatches approved campaign notifications to selected channels (Web Chat, WhatsApp, or Both)
- **Inventory_Processor**: The handler that processes file attachments (CSV/Excel/images) sent via WhatsApp and maps them to inventory records
- **Admin_Dashboard**: The Next.js web application pages under `/admin/` for platform operators
- **Payment_Link_Service**: The service that generates Razorpay Payment Links for WhatsApp checkout flows
- **Cart_Abandonment_Scheduler**: The EventBridge Scheduler-based system that detects inactive carts and triggers reminder notifications
- **Voice_Query_Pipeline**: The end-to-end pipeline that transcribes seller voice notes, extracts financial query intent, executes DynamoDB queries, and returns text + audio responses
- **Trend_Scheduler**: The EventBridge Scheduler service that creates per-seller recurring rules for automated Grok/Gemini market trend analysis
- **Catalog_Manager**: The admin tool for managing global product categories, aliases, and merge operations
- **Dispute_Resolver**: The admin interface for reviewing flagged orders and taking resolution actions (refund, replace, dismiss)

## Requirements

### Requirement 1: Phone Number Lookup and Role-Based Routing

**User Story:** As a WhatsApp user, I want the bot to recognize my role (seller, customer, or unregistered) automatically, so that I receive a personalized experience without manual selection.

#### Acceptance Criteria

1. WHEN an incoming WhatsApp message is received, THE Role_Resolver SHALL normalize the sender's phone number by stripping the +91 country code, removing spaces, and extracting the 10-digit Indian mobile number
2. WHEN a normalized phone number is provided, THE Role_Resolver SHALL query DynamoDB GSI1 (GSI1PK = `PHONE#{normalized_phone}`, GSI1SK = `PROFILE`) and return the user's userId, role, and profile
3. IF the phone number is not found in DynamoDB, THEN THE Role_Resolver SHALL return null to indicate an unregistered user
4. WHEN a user's role is resolved, THE Session_Service SHALL cache the role resolution result in the WhatsApp session DynamoDB record to avoid repeated GSI lookups
5. WHEN the resolved role is SELLER, THE WhatsApp_Bot SHALL route the conversation to the Seller_Copilot flow
6. WHEN the resolved role is CUSTOMER, THE WhatsApp_Bot SHALL route the conversation to the Customer_Discovery flow
7. WHEN the resolved role is null (unregistered), THE WhatsApp_Bot SHALL route the conversation to the Onboarding flow

### Requirement 2: Onboarding Flow for Unregistered Users

**User Story:** As an unregistered WhatsApp user, I want to receive a friendly welcome message with a registration link, so that I can create my account and start using the platform.

#### Acceptance Criteria

1. WHEN an unregistered phone number sends a first message, THE WhatsApp_Bot SHALL send a welcome message containing a platform description and a registration link to the `/register` page
2. THE WhatsApp_Bot SHALL include query parameters `?ref=whatsapp&phone={phone}` in the registration link for phone number pre-fill
3. WHEN an unregistered user sends a subsequent message without having registered, THE WhatsApp_Bot SHALL send a shorter reminder message instead of the full onboarding message
4. WHEN an onboarding session is created, THE Session_Service SHALL set a 24-hour TTL on the session record so that the next message after expiry re-triggers the full onboarding flow
5. THE WhatsApp_Bot SHALL limit onboarding messages to one full welcome and subsequent reminders within a 24-hour window to avoid spamming the user

### Requirement 3: Seller Copilot Home Menu and Stock Check

**User Story:** As a seller, I want to check my product stock levels via WhatsApp using natural language, so that I can manage inventory without opening the web dashboard.

#### Acceptance Criteria

1. WHEN a seller sends the first message in a session, THE Seller_Copilot SHALL display a home menu with options: (1) Check stock, (2) Configure trend alerts, (3) Review pending campaigns, (4) Quick inventory summary
2. WHEN a seller sends a natural language stock query (e.g., "how much Amul Butter left?"), THE Seller_Copilot SHALL use Gemini to extract the product intent and query DynamoDB for matching products belonging to that seller
3. WHEN matching products are found, THE Seller_Copilot SHALL return the product name, current stock quantity, and last restock date for each match
4. IF no matching products are found for a stock query, THEN THE Seller_Copilot SHALL respond with "No matching products found" and suggest the seller check the product name
5. WHEN a seller types "menu" or "home", THE Seller_Copilot SHALL return to the copilot home menu from any sub-state

### Requirement 4: Seller Copilot Trend Alert Configuration

**User Story:** As a seller, I want to configure automated market trend alerts at my preferred interval via WhatsApp, so that I receive timely insights about my product categories without manual checking.

#### Acceptance Criteria

1. WHEN a seller types "trends" or "alerts", THE Seller_Copilot SHALL present interval options: 30 minutes, 1 hour, 8 hours, 24 hours
2. WHEN a seller selects an interval, THE Trend_Scheduler SHALL create or update an EventBridge Scheduler rule for that seller with the corresponding rate expression
3. WHEN the EventBridge Scheduler rule fires, THE Trend_Scheduler SHALL trigger the trend analyzer worker Lambda which uses Grok and Gemini to analyze market trends for the seller's product categories
4. WHEN trend analysis results are available, THE Trend_Scheduler SHALL deliver a formatted summary to the seller's WhatsApp number via Twilio
5. WHEN a seller types "stop alerts", THE Trend_Scheduler SHALL disable the EventBridge Scheduler rule for that seller
6. THE Trend_Scheduler SHALL store the seller's current alert configuration in DynamoDB (PK = `SELLER#{id}`, SK = `TREND_CONFIG`) including the selected interval and enabled/disabled status

### Requirement 5: Seller Copilot Campaign Approval via WhatsApp

**User Story:** As a seller, I want to review and approve or dismiss pending AI-generated campaigns directly from WhatsApp, so that I can act on business insights without switching to the web dashboard.

#### Acceptance Criteria

1. WHEN a seller requests campaign review, THE Seller_Copilot SHALL list all pending campaigns with a numbered list showing: campaign name, affected products, suggested discount, and expected revenue impact
2. WHEN a seller replies with a campaign number or "approve {number}", THE Seller_Copilot SHALL trigger a `campaign.approved` event on EventBridge to initiate the campaign execution flow
3. WHEN a seller replies with "dismiss {number}", THE Seller_Copilot SHALL update the campaign status to rejected in DynamoDB
4. WHEN a campaign is approved, THE Seller_Copilot SHALL send a confirmation message with the campaign summary
5. IF no pending campaigns exist, THEN THE Seller_Copilot SHALL respond with "All caught up! No pending campaigns."

### Requirement 6: Customer Store Discovery

**User Story:** As a customer, I want to discover and browse stores via WhatsApp using favorites, pincode search, or global search, so that I can shop from local retailers through my preferred messaging channel.

#### Acceptance Criteria

1. WHEN a customer sends the first message in a session, THE Customer_Discovery SHALL display a home menu with options: (1) My favorite stores, (2) Search stores by pincode/city, (3) Search all stores, (4) Browse last visited store
2. WHEN a customer selects "My favorite stores", THE Customer_Discovery SHALL query DynamoDB for `CUSTOMER#{id} / FAVORITE#*` records and list the saved store names
3. WHEN a customer provides a 6-digit pincode or city name, THE Customer_Discovery SHALL query the sellers GSI by location and return matching stores
4. WHEN a customer provides a city name, THE Customer_Discovery SHALL perform a case-insensitive search against seller location data
5. WHEN a customer selects "Search all stores" and provides a query, THE Customer_Discovery SHALL forward the query to OpenSearch for fuzzy full-text matching on seller store names
6. WHEN a customer selects a store from any search result, THE Customer_Discovery SHALL transition the session to the existing BROWSING state with the selected seller's `sellerId` as context
7. WHEN a customer is browsing a store, THE Customer_Discovery SHALL offer an "Add to favorites" option for that store
8. IF no stores are found for a pincode or city search, THEN THE Customer_Discovery SHALL respond with "No stores found in your area" and suggest trying a different search


### Requirement 7: Unified Message Storage with Channel Tracking

**User Story:** As a platform operator, I want all messages stored in a single unified thread regardless of channel origin, so that sellers and customers see a complete conversation history across WhatsApp and Web Chat.

#### Acceptance Criteria

1. THE WhatsApp_Bot SHALL write all incoming WhatsApp messages to DynamoDB with `channel = "whatsapp"` in the message record
2. THE WebSocket handler SHALL write all incoming web chat messages to DynamoDB with `channel = "web"` in the message record
3. THE WhatsApp_Bot SHALL write all AI-generated and system auto-reply messages with `channel = "system"` in the message record
4. WHEN a message thread is queried, THE Message_Router SHALL return messages from all channels (whatsapp, web, system) in chronological order
5. WHEN rendering messages in the web chat UI, THE Admin_Dashboard SHALL display a channel indicator icon (WhatsApp icon or Web icon) next to each message
6. THE Message_Router SHALL prevent duplicate messages when the same user is active on both WhatsApp and Web Chat simultaneously

### Requirement 8: Bi-Directional Message Push (WhatsApp ↔ Web)

**User Story:** As a seller, I want customer WhatsApp messages to appear in my web Inbox in real-time, and my web replies to be delivered to the customer's WhatsApp, so that I can manage all conversations from one place.

#### Acceptance Criteria

1. WHEN a customer sends a WhatsApp message, THE Message_Router SHALL store the message in DynamoDB and push it to the seller's active WebSocket connections within 1 second
2. WHEN a seller replies from the web Inbox, THE Message_Router SHALL store the message in DynamoDB, send it to the customer's WhatsApp via Twilio within 2 seconds, and push it to the customer's active WebSocket connections
3. WHEN a message is created, THE Message_Router SHALL publish a `message.created` event to EventBridge to trigger the fan-out Lambda
4. WHEN the fan-out Lambda receives a `message.created` event, THE Message_Router SHALL check the recipient's active channels and push the message to each active channel
5. THE Message_Router SHALL synchronize message delivery status (sent, delivered, read) across all channels for the same message

### Requirement 9: Gemini Intent Extraction for Contextual Routing

**User Story:** As a customer, I want the bot to understand my shopping intent from natural language messages (including product names, quantities, and store names), so that I am routed to the correct seller's catalog automatically.

#### Acceptance Criteria

1. WHEN a customer sends a message, THE Intent_Extractor SHALL use Gemini to extract product intent (name, quantity, action) and store intent (seller/store name) from the message text
2. WHEN a store intent is detected (e.g., "from Dragon Store"), THE Intent_Extractor SHALL route the session to the matched seller's catalog context and the conversation SHALL appear in that seller's Inbox
3. WHEN a product intent is detected without a store context, THE Intent_Extractor SHALL search across all sellers via OpenSearch to find matching products
4. THE Intent_Extractor SHALL store extraction results in the session record for conversation continuity across subsequent messages
5. THE Intent_Extractor SHALL support intent extraction in both Hindi and English languages
6. WHEN extracting intent, THE Intent_Extractor SHALL return a structured JSON response containing product name, quantity, action (search/buy/check_price), store name, and detected language

### Requirement 10: Human Handoff Protocol

**User Story:** As a seller, I want to take over a conversation from the AI bot when I reply from the web Inbox, so that I can provide personalized assistance to my customers.

#### Acceptance Criteria

1. WHEN a seller sends the first reply from the web Inbox for a conversation, THE Handoff_Controller SHALL set `isHumanHandoff: true` on the session record
2. WHILE the `isHumanHandoff` flag is true, THE WhatsApp_Bot SHALL skip AI processing for incoming customer messages and pipe them directly to the seller's Inbox
3. WHEN a seller types `/ai` in the web Inbox, THE Handoff_Controller SHALL set `isHumanHandoff: false` to re-enable AI responses for that session
4. IF a seller has been inactive for 30 minutes during a human handoff session, THEN THE Handoff_Controller SHALL automatically reset `isHumanHandoff` to false
5. THE Admin_Dashboard SHALL display an "AI mode" or "Human mode" indicator in the seller Inbox header reflecting the current handoff state of the conversation

### Requirement 11: WhatsApp Inventory Upload (CSV/Excel/Khata Photo)

**User Story:** As a seller, I want to upload inventory files (CSV, Excel) or Khata book photos directly via WhatsApp, so that I can update my product catalog without using the web dashboard.

#### Acceptance Criteria

1. WHEN a seller sends a file attachment via WhatsApp, THE Inventory_Processor SHALL detect the file type from the Twilio media webhook metadata
2. WHEN a CSV or Excel file is detected, THE Inventory_Processor SHALL download the file via the Twilio media URL and process it through the existing Smart CSV mapping Lambda
3. WHEN an image file (JPG, PNG, WebP) is detected, THE Inventory_Processor SHALL process it through the existing Khata Book OCR Lambda using Gemini Vision
4. WHEN extraction is complete, THE Inventory_Processor SHALL send the extracted items as a numbered list in a WhatsApp message to the seller
5. WHEN a seller confirms the extraction (e.g., "looks good"), THE Inventory_Processor SHALL commit the extracted items to DynamoDB as inventory records
6. WHEN a seller requests an edit before committing (e.g., "change item 3 price to 250"), THE Inventory_Processor SHALL update the specified item in the pending extraction and re-display the updated list
7. WHILE processing a file, THE Inventory_Processor SHALL send progress messages to the seller (e.g., "Processing your file...")
8. IF an error occurs during extraction (e.g., missing price in a row), THEN THE Inventory_Processor SHALL report the error clearly with the specific row and issue (e.g., "Row 5: missing price")

### Requirement 12: Omnichannel Campaign Deployment

**User Story:** As a seller, I want to deploy AI-generated campaigns to customers via Web Chat, WhatsApp, or both channels simultaneously, so that I can maximize campaign reach across all customer touchpoints.

#### Acceptance Criteria

1. WHEN a seller approves a campaign, THE Campaign_Executor SHALL present channel selection options: Web Chat, WhatsApp, or Both
2. WHEN "Web Chat" is selected, THE Campaign_Executor SHALL create a system message in each targeted customer's thread and push it via WebSocket
3. WHEN "WhatsApp" is selected, THE Campaign_Executor SHALL send the campaign message to each targeted customer via Twilio with discount details
4. WHEN "Both" is selected, THE Campaign_Executor SHALL execute both Web Chat and WhatsApp delivery paths
5. THE Campaign_Executor SHALL track delivery status per customer per channel (sent, delivered, read, converted)
6. THE Admin_Dashboard SHALL display campaign reports on the Campaigns page with per-channel breakdown of sent, delivered, read, and conversion metrics

### Requirement 13: Enhanced AI Insight Cards

**User Story:** As a seller, I want AI insight cards to show severity, confidence, financial impact, and the AI model source, so that I can make informed decisions about which insights to act on.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL render each AI Insight card with: severity badge (HIGH in red, MEDIUM in amber, LOW in blue), AI source label (GROK, GEMINI, or BEDROCK), confidence percentage, expected financial impact in ₹ format, affected product count, and a 1-2 line market research summary
2. WHEN a seller clicks "Approve & Send" on an insight card, THE Admin_Dashboard SHALL open the campaign notification modal to initiate the campaign creation flow
3. WHEN a seller clicks "Dismiss" on an insight card, THE Admin_Dashboard SHALL move the insight to a dismissed list in DynamoDB
4. WHEN a seller clicks "Refresh", THE Admin_Dashboard SHALL re-trigger the trend analyzer worker and dead-stock agent for all active products
5. THE Admin_Dashboard SHALL allow recovery of dismissed insights within 24 hours via an undo action


### Requirement 14: Customer Directory and Analytics

**User Story:** As an admin, I want a customer directory with lifetime value, order history, and cross-pollination metrics, so that I can understand customer behavior and platform health.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL provide a `/admin/customers` page displaying a paginated customer list with columns: Name, Phone, Registered Date, Total Orders, LTV (lifetime value), Stores Visited, Last Active
2. WHEN an admin searches by name or phone, THE Admin_Dashboard SHALL filter the customer list to matching records
3. WHEN an admin applies date range or LTV range filters, THE Admin_Dashboard SHALL filter the customer list accordingly
4. WHEN an admin clicks on a customer row, THE Admin_Dashboard SHALL display a detail view with order history, chat history, favorite stores, and channel preference (web/WhatsApp/both)
5. THE Admin_Dashboard SHALL calculate and display a cross-pollination metric for each customer showing how many different sellers the customer has ordered from
6. THE Admin_Dashboard SHALL display summary cards at the top of the page: Total Customers, New This Month, Average LTV, Average Orders per Customer

### Requirement 15: Dispute Resolution and Support Hub

**User Story:** As an admin, I want a dispute resolution interface with full order context, chat transcripts, and resolution actions, so that I can efficiently resolve customer and seller issues.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL provide a `/admin/disputes` page displaying a list of flagged orders and disputes with columns: Order ID, Customer, Seller, Issue Type, Status, Created Date
2. THE Admin_Dashboard SHALL support filtering disputes by status (Open, In Progress, Resolved, Dismissed) and issue type (Wrong Item, Not Delivered, Quality Issue, Refund Request, Payment Failed)
3. WHEN an admin clicks on a dispute, THE Admin_Dashboard SHALL display a detail view with: order details (items, amount, payment status), read-only chat transcript between customer and seller, uploaded images/evidence, and a resolution history timeline
4. THE Admin_Dashboard SHALL provide resolution actions: Refund (full or partial), Replace, Dismiss, and Escalate
5. WHEN an admin selects "Refund", THE Dispute_Resolver SHALL trigger a Razorpay refund API call and send notifications to both the customer and seller
6. THE Admin_Dashboard SHALL provide an admin notes field on each dispute, and notes SHALL be saved and visible in the audit log
7. THE Dispute_Resolver SHALL auto-flag orders that have negative customer feedback, payment failures, or delivery delays exceeding 48 hours

### Requirement 16: Financials and Commission Tracking

**User Story:** As an admin, I want a financials dashboard showing platform revenue, commission earned, and Razorpay Route transaction details, so that I can monitor the platform's financial health.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL provide a `/admin/financials` page displaying summary cards: Total Platform Revenue, Total Commission Earned, Pending Settlements, Failed Payouts
2. THE Admin_Dashboard SHALL display a Razorpay Route transactions table with columns: Date, Order ID, Seller, Order Amount, Commission Percentage, Commission Amount, Transfer Status (Completed, Pending, Failed, Reversed)
3. WHEN an admin applies date range, seller, or status filters, THE Admin_Dashboard SHALL filter the transactions table accordingly
4. WHEN an admin clicks "Retry" on a failed payout, THE Admin_Dashboard SHALL trigger the Razorpay transfer API to retry the failed transfer
5. WHEN an admin clicks "Export CSV", THE Admin_Dashboard SHALL download the currently filtered transaction data as a CSV file
6. THE Admin_Dashboard SHALL display a daily commission trend line chart and a commission-by-seller bar chart with date range selection

### Requirement 17: AI Campaign Oversight

**User Story:** As an admin, I want a platform-wide view of all AI-generated campaigns across all sellers with performance metrics, so that I can monitor campaign quality and intervene on underperforming campaigns.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL provide a `/admin/campaigns` page displaying all campaigns across all sellers with columns: Campaign Name, Seller, Channel, Status, Sent Count, Open Rate, Conversion Rate, Revenue Impact
2. WHEN an admin clicks on a campaign, THE Admin_Dashboard SHALL display a per-customer delivery log with: sent time, delivered status, read status, and ordered status
3. THE Admin_Dashboard SHALL display aggregate metrics at the top of the page: Total Campaigns (30 days), Average Open Rate, Average Conversion Rate, Total Revenue from Campaigns
4. WHEN an admin applies filters by seller, channel, date range, or status, THE Admin_Dashboard SHALL filter the campaign list accordingly
5. THE Admin_Dashboard SHALL allow admins to flag or block campaigns that have low performance or high complaint rates

### Requirement 18: Global Catalog Manager

**User Story:** As an admin, I want to manage global product categories with aliases, merge operations, and impact previews, so that I can maintain a clean and consistent catalog taxonomy across all sellers.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL provide a `/admin/catalog` page displaying a master list of product categories with columns: Category Name, Product Count, Active Sellers Using
2. THE Catalog_Manager SHALL support CRUD operations: add new category, rename existing category, merge two categories, and deactivate a category
3. WHEN an admin renames a category, THE Catalog_Manager SHALL update all product records that reference the old category name
4. WHEN an admin initiates a merge operation, THE Catalog_Manager SHALL display an impact preview showing the number of affected products and sellers (e.g., "Merging 'Dairy' into 'Groceries' will affect 45 products from 3 sellers") before executing
5. THE Catalog_Manager SHALL support category alias management where multiple names map to one canonical category (e.g., "Grocery" = "Groceries" = "किराना" = "kirana") for OCR and intent extraction alignment
6. WHEN an admin deactivates a category, THE Catalog_Manager SHALL hide the category from the customer-facing catalog while preserving existing product associations

### Requirement 19: Admin Sidebar Navigation Update

**User Story:** As an admin, I want the sidebar navigation updated with all new admin pages, so that I can access all platform management tools from a consistent navigation structure.

#### Acceptance Criteria

1. THE Admin_Dashboard SHALL display the following items in the sidebar navigation in order: Overview, Sellers, Customers, Disputes, Financials, Campaigns, Catalog, Audit, Health, Settings
2. WHEN an admin navigates to a page, THE Admin_Dashboard SHALL highlight the active sidebar item correctly
3. THE Admin_Dashboard SHALL display a mobile bottom navigation bar for admin with primary actions: Overview, Sellers, Disputes, Financials, and a "More" menu containing: Customers, Campaigns, Catalog, Audit, Health, Settings
4. THE Admin_Dashboard SHALL ensure all new navigation links resolve to valid pages with no broken links

### Requirement 20: UPI Intent Integration via Razorpay Payment Links

**User Story:** As a customer checking out via WhatsApp, I want to receive a payment link that opens my preferred UPI app directly, so that I can complete payment without leaving WhatsApp.

#### Acceptance Criteria

1. WHEN a customer reaches the checkout state in the WhatsApp flow, THE Payment_Link_Service SHALL generate a Razorpay Payment Link with the order amount, description, customer phone number, and a 30-minute expiry
2. THE WhatsApp_Bot SHALL send the payment link to the customer in a WhatsApp message along with an order summary (items, quantities, total amount)
3. IF the payment link expires after 30 minutes without payment, THEN THE Payment_Link_Service SHALL send a reminder message to the customer with a new payment link
4. WHEN the Razorpay webhook receives a `payment_link.paid` event, THE Payment_Link_Service SHALL update the order status to confirmed and send confirmation notifications to both the customer and seller
5. IF a payment fails, THEN THE Payment_Link_Service SHALL notify the customer with the failure reason and offer to generate a new payment link

### Requirement 21: Automated Abandoned Cart Nudges

**User Story:** As a platform operator, I want the system to automatically detect abandoned carts and send reminder notifications to customers, so that cart recovery rates improve without manual intervention.

#### Acceptance Criteria

1. WHEN items are added to a customer's cart, THE Cart_Abandonment_Scheduler SHALL create or reset a 2-hour inactivity timer via EventBridge Scheduler
2. WHEN a customer completes checkout, THE Cart_Abandonment_Scheduler SHALL cancel the active inactivity timer for that cart
3. WHEN the 2-hour timer fires without checkout completion, THE Cart_Abandonment_Scheduler SHALL send a first nudge message: "You have {n} items in your cart worth ₹{amount}. Ready to checkout?"
4. THE Cart_Abandonment_Scheduler SHALL send the nudge via the customer's preferred channel (WhatsApp if the customer has an active session, Web Chat otherwise)
5. IF the cart remains abandoned 24 hours after the first nudge, THEN THE Cart_Abandonment_Scheduler SHALL send a second nudge message with a small incentive if applicable
6. THE Cart_Abandonment_Scheduler SHALL track nudge effectiveness by recording: nudge sent timestamp, cart recovered status (checkout completed within 1 hour of nudge), and channel used

### Requirement 22: Voice-Activated Financial Reports

**User Story:** As a seller, I want to send a voice note in my native language asking a business question and receive both a text and audio response, so that I can get financial insights hands-free in my preferred language.

#### Acceptance Criteria

1. WHEN a seller sends a voice note via WhatsApp, THE Voice_Query_Pipeline SHALL download the audio via Twilio and transcribe it using Gemini 2.0
2. WHEN transcription is complete, THE Voice_Query_Pipeline SHALL use Gemini to extract the financial query intent (daily sales, weekly revenue, monthly revenue, best sellers, pending orders, stock summary) and the detected language
3. WHEN a valid financial query intent is extracted, THE Voice_Query_Pipeline SHALL execute the corresponding DynamoDB query against the seller's data (e.g., sum order amounts for today, count pending orders)
4. THE Voice_Query_Pipeline SHALL format the query response in the same language the seller spoke in the voice note
5. THE Voice_Query_Pipeline SHALL generate a TTS audio response via Gemini TTS and send both the formatted text and audio voice note back to the seller via Twilio
6. THE Voice_Query_Pipeline SHALL support 8 Indian languages: Hindi, English, Tamil, Telugu, Marathi, Bengali, Gujarati, and Kannada
7. IF the voice query intent cannot be determined, THEN THE Voice_Query_Pipeline SHALL respond with a helpful message: "I couldn't understand that. Try asking about sales, orders, or stock."
8. THE Voice_Query_Pipeline SHALL complete the end-to-end response (transcription, intent extraction, query, formatting, TTS, delivery) within 8 seconds
