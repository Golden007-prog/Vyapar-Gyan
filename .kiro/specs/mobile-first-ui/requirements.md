# Requirements Document

## Introduction

VyaparGyan is an AI-powered multi-seller marketplace for Indian local retailers. The current web application is desktop-first with sidebar navigation that collapses poorly on mobile devices. Indian sellers primarily use budget Android smartphones with spotty 3G/4G connectivity. This feature converts the seller dashboard, customer chat, and admin panel to a mobile-first responsive design using bottom tab navigation, responsive stat cards, mobile-optimized data tables, full-screen chat, and PWA capabilities — without changing visual branding or adding new features.

## Glossary

- **AppShell**: The shared layout component that detects the current viewport breakpoint and renders the appropriate navigation pattern (BottomNav on mobile, collapsible sidebar on tablet, full sidebar on desktop)
- **BottomNav**: A fixed bottom tab bar component rendered on mobile viewports below 768px, containing 5 primary navigation tabs with role-specific items
- **MoreMenu**: A bottom sheet overlay triggered by the "More" tab in BottomNav, displaying secondary navigation items that do not fit in the 5-tab bar
- **MobileHeader**: A minimal top bar component for mobile viewports containing a back arrow, page title, and optional action buttons
- **Stat_Card**: A dashboard metric display component showing a title, primary numeric value, trend indicator, and icon
- **Mobile_Card**: A card-based representation of a data table row used on mobile viewports, replacing traditional HTML tables
- **Chat_View**: The customer or seller chat interface including message list, composer input bar, and optional cart side panel
- **PWA**: Progressive Web App — a web application that uses service workers, a manifest file, and caching strategies to provide app-like behavior including offline access and home screen installation
- **Service_Worker**: A background script registered by the browser that intercepts network requests and enables offline caching and background sync
- **Safe_Area_Inset**: Device-specific padding values (via CSS `env(safe-area-inset-*)`) that account for hardware elements like notches and home indicators
- **Viewport_Breakpoint**: A CSS media query width threshold that triggers layout changes — sm: 640px, md: 768px, lg: 1024px
- **Khata_Book_OCR_Flow**: The mobile camera capture and AI extraction workflow where sellers photograph handwritten ledger pages to digitize inventory
- **CSV_Upload_Flow**: The multi-step wizard for uploading, AI-analyzing, mapping, previewing, and confirming bulk product imports from CSV files

## Requirements

### Requirement 1: AppShell Layout Component

**User Story:** As a seller, customer, or admin, I want the application layout to automatically adapt its navigation pattern based on my device screen size, so that I can navigate efficiently on any device.

#### Acceptance Criteria

1. WHEN the viewport width is below 768px, THE AppShell SHALL render the BottomNav component and the MobileHeader component instead of the sidebar
2. WHEN the viewport width is between 768px and 1024px, THE AppShell SHALL render a collapsible icon-only sidebar that expands on hover or tap
3. WHEN the viewport width is above 1024px, THE AppShell SHALL render the full sidebar with icon and label for each navigation item
4. THE AppShell SHALL detect the current user role (seller, customer, admin) and pass the corresponding navigation configuration to the active navigation component
5. WHEN the viewport width crosses the 768px breakpoint during a resize event, THE AppShell SHALL transition between BottomNav and sidebar without a full page reload or visible layout shift
6. THE AppShell SHALL wrap all authenticated pages via the existing Next.js layout groups for seller, customer, and admin routes

### Requirement 2: Mobile Bottom Navigation

**User Story:** As a mobile user, I want a bottom tab bar with my most-used actions, so that I can navigate the app with one hand like I do in WhatsApp and Paytm.

#### Acceptance Criteria

1. THE BottomNav SHALL display exactly 5 tabs with an icon and a label (12px font size) for each tab
2. WHEN the user role is seller, THE BottomNav SHALL display tabs for Overview, Inventory, Orders, Inbox, and More
3. WHEN the user role is customer, THE BottomNav SHALL display tabs for Catalog, Chat, Cart, Orders, and Account
4. WHEN the user role is admin, THE BottomNav SHALL display tabs for Overview, Sellers, Audit, Health, and More
5. WHEN the user taps a tab, THE BottomNav SHALL navigate to the corresponding route and highlight the active tab with the brand color (indigo-600)
6. THE BottomNav SHALL have a minimum height of 48px for each tab tap target to meet touch accessibility guidelines
7. THE BottomNav SHALL apply bottom padding equal to `env(safe-area-inset-bottom)` to account for device home indicators
8. WHEN the user taps the More tab, THE BottomNav SHALL open the MoreMenu bottom sheet overlay displaying the remaining navigation items (seller: AI Insights, Approvals, Campaigns, Settings; admin: Settings)
9. THE BottomNav SHALL render only on viewports below 768px width
10. THE BottomNav SHALL use a z-index of 50 to remain above page content

### Requirement 3: Responsive Stat Cards

**User Story:** As a seller or admin, I want my dashboard metric cards to display clearly on any screen size, so that I can check business performance on my phone.

#### Acceptance Criteria

1. WHEN the viewport width is below 768px, THE Stat_Card layout SHALL stack cards vertically at full width
2. WHEN the viewport width is between 768px and 1024px, THE Stat_Card layout SHALL arrange cards in a 2-column grid
3. WHEN the viewport width is above 1024px, THE Stat_Card layout SHALL arrange cards in a 4-column row
4. THE Stat_Card SHALL render the primary numeric value at a minimum font size of 24px on all viewport sizes
5. THE Stat_Card SHALL render the secondary trend text at a minimum font size of 13px on all viewport sizes
6. THE Stat_Card SHALL have a minimum height of 80px on mobile viewports

### Requirement 4: Mobile Data Tables to Card Lists

**User Story:** As a seller, I want to view my product inventory and order lists as scrollable cards on my phone, so that I can manage my business without horizontal scrolling.

#### Acceptance Criteria

1. WHEN the viewport width is below 768px, THE Inventory_Page SHALL render product data as a vertical list of Mobile_Card components instead of an HTML table
2. WHEN the viewport width is below 768px, THE Orders_Page SHALL render order data as a vertical list of Mobile_Card components instead of an HTML table
3. WHEN the viewport width is 768px or above, THE Inventory_Page and Orders_Page SHALL render data in the existing HTML table format
4. THE product Mobile_Card SHALL display the product name, category badge, price, stock count, and status badge
5. THE order Mobile_Card SHALL display the order ID, customer name, amount, status badge, and date
6. THE Mobile_Card list SHALL support pull-to-refresh to trigger a data refetch
7. WHEN the user taps a Mobile_Card, THE application SHALL navigate to the corresponding detail view
8. THE Mobile_Card SHALL use 16px padding and 8px vertical gap between cards

### Requirement 5: Full-Screen Mobile Chat

**User Story:** As a customer chatting with a seller on my phone, I want the chat to use my full screen with the keyboard handled properly, so that I have a WhatsApp-like messaging experience.

#### Acceptance Criteria

1. WHEN the viewport width is below 768px, THE Chat_View SHALL render in full-screen mode using `100dvh` height, hiding the top navigation bar and showing only a minimal header with a back arrow, store name, and online status
2. THE Chat_View message input bar SHALL remain pinned to the bottom of the viewport above the virtual keyboard when the keyboard is open
3. THE Chat_View input bar SHALL include bottom padding equal to `env(safe-area-inset-bottom)` on devices with home indicators
4. WHEN a new message is received or sent, THE Chat_View message list SHALL auto-scroll to the latest message
5. THE Chat_View send button SHALL have a minimum tap target size of 44x44px
6. WHEN the user taps the back arrow in the mobile chat header, THE Chat_View SHALL navigate back to the chat list (customer) or inbox (seller)
7. WHEN the viewport width is 768px or above, THE Chat_View SHALL render in the current layout with the top navigation bar visible

### Requirement 6: Khata Book OCR Mobile Camera Flow

**User Story:** As a seller using my phone, I want to photograph my handwritten Khata book and have AI extract the inventory data, so that I can digitize stock without typing.

#### Acceptance Criteria

1. WHEN the user taps the Khata Book OCR button on a mobile device, THE Khata_Book_OCR_Flow SHALL open the device rear camera directly using the HTML `capture="environment"` attribute
2. WHEN the user captures a photo, THE Khata_Book_OCR_Flow SHALL display a preview of the captured image before submission
3. THE Khata_Book_OCR_Flow SHALL provide crop and rotate controls on the image preview screen
4. WHEN the user confirms the image and taps "Extract with AI", THE Khata_Book_OCR_Flow SHALL display a progress indicator (skeleton loader or spinner) during the Gemini Vision extraction
5. WHEN the extraction completes, THE Khata_Book_OCR_Flow SHALL display the photo and extracted data in a stacked layout on mobile (photo on top, data below) instead of side-by-side
6. IF the camera access is denied by the device, THEN THE Khata_Book_OCR_Flow SHALL fall back to a standard file picker for image selection

### Requirement 7: CSV Upload Mobile Optimization

**User Story:** As a seller uploading product data from a CSV file on my phone, I want the upload wizard to fit my screen and let me review data clearly, so that I can bulk-import inventory on the go.

#### Acceptance Criteria

1. WHEN the viewport width is below 768px, THE CSV_Upload_Flow modal SHALL render as a full-screen overlay instead of a centered modal
2. THE CSV_Upload_Flow step indicator SHALL display as compact dots on mobile viewports instead of full step labels
3. THE CSV_Upload_Flow preview table SHALL scroll horizontally with the first column (product name) sticky-positioned on mobile
4. WHEN the CSV contains validation errors, THE CSV_Upload_Flow SHALL highlight error rows with a visible "Fix" action button on mobile
5. WHEN the viewport width is below 768px, THE CSV_Upload_Flow "Analyze with AI" button SHALL render at full width

### Requirement 8: PWA Foundation

**User Story:** As a seller with unreliable internet, I want to install VyaparGyan on my phone home screen and browse my catalog offline, so that I can check inventory even without connectivity.

#### Acceptance Criteria

1. THE PWA SHALL include a `manifest.json` file with the application name "VyaparGyan", short name "VyaparGyan", theme color matching the brand indigo-600, and icons at 192x192 and 512x512 pixel sizes
2. THE Service_Worker SHALL cache static assets (JavaScript bundles, CSS files, images) using a cache-first strategy on initial load
3. THE Service_Worker SHALL serve cached static assets when the device is offline
4. WHEN the device is offline and the user navigates to an uncached page, THE Service_Worker SHALL display a branded offline fallback page with the message "You're offline. Your inventory changes will sync when you reconnect."
5. WHEN the application detects a third visit from the same browser, THE PWA SHALL display an install prompt suggesting the user add VyaparGyan to the home screen
6. THE PWA SHALL achieve a Lighthouse PWA audit score of 80 or above
7. THE PWA SHALL be installable on Android Chrome as a standalone application
