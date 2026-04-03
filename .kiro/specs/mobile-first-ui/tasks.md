# Implementation Plan: Mobile-First UI

## Overview

Convert VyaparGyan's desktop-first web app to a mobile-first responsive layout. This involves creating a unified AppShell component with BottomNav/Sidebar switching at breakpoints, mobile card views for data tables, full-screen mobile chat, and a PWA foundation. All work is in `apps/web/` using Next.js 14, Tailwind CSS, TypeScript, and Lucide React icons.

## Tasks

- [x] 1. Create navigation config and layout foundation
  - [x] 1.1 Create nav types and role configs in `apps/web/components/layout/nav-config.ts`
    - Define `NavItem` and `NavConfig` types
    - Export `SELLER_NAV`, `CUSTOMER_NAV`, `ADMIN_NAV` configs with primary (max 5) and overflow items
    - Use Lucide icons matching existing navigation items
    - _Requirements: 1.4, 2.2, 2.3, 2.4_

  - [x] 1.2 Create `BottomNav` component in `apps/web/components/layout/BottomNav.tsx`
    - Fixed bottom bar with `z-50`, `pb-[env(safe-area-inset-bottom)]`
    - Render 5 tabs with stacked icon (20px) + label (12px), min height 48px per tab
    - Active tab highlighted with `text-indigo-600` and `bg-indigo-50` using `usePathname()`
    - "More" tab (when overflow items exist) triggers `onMorePress` callback
    - Only visible below `md` breakpoint (`md:hidden`)
    - _Requirements: 2.1, 2.5, 2.6, 2.7, 2.9, 2.10_

  - [x] 1.3 Create `MoreMenu` bottom sheet in `apps/web/components/layout/MoreMenu.tsx`
    - Slide-up overlay with `backdrop-blur-sm`, 48px min tap targets
    - Render overflow NavItems plus logout/switch account actions
    - Close on item tap or backdrop tap
    - _Requirements: 2.8_

  - [x] 1.4 Create `MobileHeader` component in `apps/web/components/layout/MobileHeader.tsx`
    - 48px height, optional back arrow, centered title, right-side action slot
    - Only visible below `md` breakpoint
    - _Requirements: 1.1, 5.1_

  - [x] 1.5 Create `Sidebar` component in `apps/web/components/layout/Sidebar.tsx`
    - Extract sidebar logic from existing seller/admin layouts
    - Support collapsed (w-16, icon-only with tooltips) and expanded (w-64, icon + label) modes
    - Tablet: collapsed by default, expand on hover; Desktop: always expanded
    - Accept `headerSlot` and `footerSlot` for brand logo and logout actions
    - _Requirements: 1.2, 1.3_

- [x] 2. Create AppShell and integrate into role layouts
  - [x] 2.1 Create `AppShell` component in `apps/web/components/layout/AppShell.tsx`
    - Accept `role`, `navConfig`, `headerActions`, and `children` props
    - Mobile (<768px): render MobileHeader + children (with `pb-16`) + BottomNav
    - Tablet (768–1024px): render collapsed Sidebar (expand on hover) + header + children
    - Desktop (>1024px): render full Sidebar + header + children
    - Use Tailwind responsive classes (`md:hidden`, `hidden md:flex`, `lg:w-64`) for breakpoint switching
    - Transition between layouts without full page reload
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

  - [x] 2.2 Refactor `apps/web/app/seller/layout.tsx` to use AppShell
    - Replace inline sidebar/header with `<AppShell role="seller" navConfig={SELLER_NAV}>`
    - Preserve existing auth logic (configureAmplify, logout, switch account)
    - Pass role badge as `headerActions`
    - _Requirements: 1.4, 1.6_

  - [x] 2.3 Refactor `apps/web/app/admin/layout.tsx` to use AppShell
    - Replace inline sidebar/header with `<AppShell role="admin" navConfig={ADMIN_NAV}>`
    - Preserve existing auth logic
    - Pass admin badge as `headerActions`
    - _Requirements: 1.4, 1.6_

  - [x] 2.4 Refactor `apps/web/app/(customer)/layout.tsx` to use AppShell
    - Replace inline top nav with `<AppShell role="customer" navConfig={CUSTOMER_NAV}>`
    - Preserve store picker, cart badge, and auth logic
    - Pass store picker as `headerActions`
    - _Requirements: 1.4, 1.6_

  - [x] 2.5 Write property test for active tab highlighting
    - **Property 1: Active tab matches current route**
    - Generate random NavItem selections from all role configs, mock `usePathname` to match, verify only that tab renders with active style
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 2.5**

- [x] 3. Checkpoint - Verify AppShell and navigation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Responsive stat cards and mobile data tables
  - [x] 4.1 Make stat cards responsive in `apps/web/app/seller/page.tsx`
    - Mobile: single column (`grid-cols-1`), min card height 80px, value font ≥24px, trend font ≥13px
    - Tablet: 2-column grid (`md:grid-cols-2`)
    - Desktop: 4-column row (`lg:grid-cols-4`) — preserve current layout
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 4.2 Make stat cards responsive in `apps/web/app/admin/page.tsx`
    - Apply same responsive grid pattern as seller dashboard
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 4.3 Create `MobileProductCard` in `apps/web/components/ui/MobileProductCard.tsx`
    - Display product name, category badge, formatted price (₹), stock count with color coding, stock age, active/inactive status badge
    - 16px padding, 8px gap between cards
    - Tap triggers navigation to product detail
    - _Requirements: 4.4, 4.7, 4.8_

  - [x] 4.4 Write property test for MobileProductCard
    - **Property 2: Product card displays all required fields**
    - Generate random Product objects with arbitrary names, prices, categories; verify all fields present in rendered output
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 4.4**

  - [x] 4.5 Create `MobileOrderCard` in `apps/web/components/ui/MobileOrderCard.tsx`
    - Display order ID (truncated), customer name, amount (₹), status badge with icon, date
    - 16px padding, 8px gap between cards
    - Tap triggers navigation to order detail
    - _Requirements: 4.5, 4.7, 4.8_

  - [x] 4.6 Write property test for MobileOrderCard
    - **Property 3: Order card displays all required fields**
    - Generate random Order objects with arbitrary IDs, names, amounts, statuses; verify all fields present in rendered output
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 4.5**

  - [x] 4.7 Add mobile card view to `apps/web/app/seller/inventory/page.tsx`
    - Below `md`: render `MobileProductCard` list instead of HTML table
    - At `md` and above: keep existing table
    - Use Tailwind `md:hidden` / `hidden md:block` to toggle
    - _Requirements: 4.1, 4.3_

  - [x] 4.8 Add mobile card view to `apps/web/app/seller/orders/page.tsx`
    - Below `md`: render `MobileOrderCard` list instead of HTML table
    - At `md` and above: keep existing table
    - _Requirements: 4.2, 4.3_

  - [x] 4.9 Write property test for card tap navigation
    - **Property 4: Card tap navigates to correct detail URL**
    - Generate random product/order IDs, simulate tap, verify navigation URL matches `/seller/inventory/${pid}` or `/seller/orders/${oid}`
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 4.7**

- [x] 5. Checkpoint - Verify responsive cards and tables
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Full-screen mobile chat
  - [x] 6.1 Update `apps/web/app/(customer)/chat/page.tsx` for full-screen mobile mode
    - Mobile (<768px): use `100dvh` height, hide top nav, show minimal header with back arrow + store name + online status
    - Desktop (≥768px): keep current layout with top nav visible
    - Back arrow navigates to chat list / previous page
    - _Requirements: 5.1, 5.6, 5.7_

  - [x] 6.2 Update `apps/web/components/Chat/ChatComposer.tsx` for mobile keyboard handling
    - Pin input bar above virtual keyboard using `visualViewport` API
    - Add `pb-[env(safe-area-inset-bottom)]` for devices with home indicators
    - Ensure send button has minimum 44x44px tap target
    - Fall back to `window.innerHeight` if `visualViewport` unavailable
    - _Requirements: 5.2, 5.3, 5.5_

  - [x] 6.3 Update `apps/web/components/Chat/MessageList.tsx` for auto-scroll
    - Ensure auto-scroll to latest message on send and receive works in full-screen mobile mode
    - _Requirements: 5.4_

- [x] 7. Mobile camera and CSV upload optimizations
  - [x] 7.1 Update Khata Book OCR flow in `apps/web/app/seller/inventory/page.tsx`
    - Add `capture="environment"` attribute to camera input on mobile
    - Show image preview with crop/rotate controls before submission
    - Display stacked layout on mobile (photo on top, extracted data below)
    - Fall back to standard file picker if camera access denied
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.2 Update CSV upload modal in `apps/web/app/seller/inventory/page.tsx` for mobile
    - Mobile (<768px): render as full-screen overlay instead of centered modal
    - Step indicator as compact dots on mobile
    - Preview table with horizontal scroll and sticky first column
    - "Analyze with AI" button full-width on mobile
    - Error rows with visible "Fix" action button
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 8. PWA foundation
  - [x] 8.1 Create `apps/web/public/manifest.json`
    - Name: "VyaparGyan", short_name: "VyaparGyan", theme_color: "#4f46e5"
    - Icons at 192x192 and 512x512 sizes
    - `display: "standalone"`, `start_url: "/"`
    - _Requirements: 8.1_

  - [x] 8.2 Add manifest link and theme-color meta tag to `apps/web/app/layout.tsx`
    - `<link rel="manifest" href="/manifest.json">`
    - `<meta name="theme-color" content="#4f46e5">`
    - _Requirements: 8.1_

  - [x] 8.3 Create service worker at `apps/web/public/sw.js`
    - Cache-first strategy for static assets (JS/CSS bundles, images)
    - Network-first strategy for API responses
    - Pre-cache offline fallback page
    - Graceful registration failure handling (log warning, continue)
    - _Requirements: 8.2, 8.3_

  - [x] 8.4 Create offline fallback page at `apps/web/app/offline/page.tsx`
    - Branded page with message: "You're offline. Your inventory changes will sync when you reconnect."
    - _Requirements: 8.4_

  - [x] 8.5 Implement install prompt logic
    - Track visit count in localStorage
    - Show install prompt on third visit (`n >= 3`)
    - Listen for `beforeinstallprompt` event, silently skip if unsupported
    - _Requirements: 8.5, 8.7_

  - [x] 8.6 Write property test for install prompt logic
    - **Property 5: Install prompt triggers on third visit**
    - Generate random visit counts (0–100), verify prompt shows iff count >= 3
    - Use `fast-check` with minimum 100 iterations
    - **Validates: Requirements 8.5**

  - [x] 8.7 Register service worker in `apps/web/app/layout.tsx`
    - Register `sw.js` on client-side mount
    - Handle registration failure gracefully
    - _Requirements: 8.2_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests use `fast-check` via Jest (`pnpm --filter @vyapargyan/web test`)
- No backend changes required — this is purely a frontend layout refactor
- Tailwind default breakpoints used: `md: 768px`, `lg: 1024px`
