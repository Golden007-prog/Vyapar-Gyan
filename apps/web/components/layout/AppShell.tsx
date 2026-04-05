'use client';

import { useState, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftRight, LogOut, Sparkles, Store } from 'lucide-react';
import type { NavConfig } from './nav-config';
import { BottomNav } from './BottomNav';
import { MoreMenu } from './MoreMenu';
import { MobileHeader } from './MobileHeader';
import { Sidebar } from './Sidebar';

export interface AppShellProps {
  children: React.ReactNode;
  role: 'seller' | 'customer' | 'admin';
  navConfig: NavConfig;
  headerActions?: React.ReactNode;
}

/** Map pathname segments to human-readable page titles. */
function deriveTitle(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  // Use the last meaningful segment
  const last = segments[segments.length - 1];
  if (!last) return 'Home';

  const titleMap: Record<string, string> = {
    seller: 'Overview',
    admin: 'Overview',
    inventory: 'Inventory Hub',
    orders: 'Orders',
    inbox: 'Customer Inbox',
    insights: 'AI Insights',
    approvals: 'Approvals',
    campaigns: 'Campaigns',
    sellers: 'Sellers',
    customers: 'Customers',
    disputes: 'Disputes',
    financials: 'Financials',
    audit: 'Audit Log',
    system: 'System Health',
    catalog: 'Catalog',
    settings: 'Settings',
    chat: 'Chat',
    cart: 'Cart',
    account: 'Account',
    checkout: 'Checkout',
  };

  return titleMap[last] || last.charAt(0).toUpperCase() + last.slice(1);
}

/** Brand logo for the sidebar header slot. */
function BrandLogo({ role }: { role: 'seller' | 'customer' | 'admin' }) {
  const href = role === 'admin' ? '/admin' : role === 'seller' ? '/seller' : '/catalog';
  const Icon = role === 'admin' ? Sparkles : Store;

  return (
    <Link href={href} className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
        <Icon className="h-4 w-4 text-white" />
      </div>
      <span className="text-lg font-bold text-gray-900">VyaparGyan</span>
    </Link>
  );
}

export function AppShell({ children, role, navConfig, headerActions }: AppShellProps) {
  const pathname = usePathname();
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Tablet sidebar: collapsed by default, expand on hover
  const [sidebarHovered, setSidebarHovered] = useState(false);

  const pageTitle = useMemo(() => deriveTitle(pathname), [pathname]);

  // Combine all nav items for the sidebar (use explicit sidebar order if provided, else primary non-"More" + overflow)
  const sidebarItems = useMemo(() => {
    if (navConfig.sidebar && navConfig.sidebar.length > 0) {
      return navConfig.sidebar;
    }
    const primary = navConfig.primary.filter((item) => item.href !== '#more');
    return [...primary, ...navConfig.overflow];
  }, [navConfig]);

  // Sidebar footer with logout/switch account actions
  const sidebarFooter = useMemo(
    () => <SidebarFooterActions />,
    [],
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ===== MOBILE (<768px): MobileHeader + content + BottomNav ===== */}
      <div className="md:hidden">
        <MobileHeader title={pageTitle} />
        <main className="pb-16">{children}</main>
        <BottomNav
          items={navConfig.primary}
          overflowItems={navConfig.overflow}
          onMorePress={() => setMoreMenuOpen(true)}
        />
        <MoreMenu
          items={navConfig.overflow}
          open={moreMenuOpen}
          onClose={() => setMoreMenuOpen(false)}
        />
      </div>

      {/* ===== TABLET & DESKTOP (≥768px): Sidebar + header + content ===== */}
      <div className="hidden md:block">
        {/* Sidebar — tablet: collapsed (w-16), desktop: expanded (w-64) */}
        <div
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
        >
          {/* Tablet (md–lg): collapsed sidebar, expand on hover */}
          <div className="lg:hidden">
            <Sidebar
              items={sidebarItems}
              collapsed={!sidebarHovered}
              onToggle={() => setSidebarHovered((prev) => !prev)}
              headerSlot={
                sidebarHovered ? (
                  <BrandLogo role={role} />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
                    {role === 'admin' ? (
                      <Sparkles className="h-4 w-4 text-white" />
                    ) : (
                      <Store className="h-4 w-4 text-white" />
                    )}
                  </div>
                )
              }
              footerSlot={sidebarHovered ? sidebarFooter : undefined}
            />
          </div>

          {/* Desktop (≥lg): always expanded sidebar */}
          <div className="hidden lg:block">
            <Sidebar
              items={sidebarItems}
              collapsed={false}
              headerSlot={<BrandLogo role={role} />}
              footerSlot={sidebarFooter}
            />
          </div>
        </div>

        {/* Content area — shifts based on sidebar width */}
        <div
          className={`transition-all duration-200 lg:pl-64 ${
            sidebarHovered ? 'md:pl-64' : 'md:pl-16'
          }`}
        >
          {/* Desktop/tablet header bar */}
          <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-white px-4 shadow-sm lg:px-6">
            <div className="flex-1" />
            {headerActions && (
              <div className="flex items-center gap-2">{headerActions}</div>
            )}
          </header>

          <main className="p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

/** Sidebar footer with logout and switch account buttons. */
function SidebarFooterActions() {
  const handleLogout = async () => {
    // Clear auth state
    document.cookie = 'idToken=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    try { sessionStorage.clear(); } catch { /* ignore */ }
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('CognitoIdentityServiceProvider') || k.startsWith('vyapargyan'))
          localStorage.removeItem(k);
      });
    } catch { /* ignore */ }
    const { signOut } = await import('aws-amplify/auth');
    try { await signOut({ global: true }); } catch { /* ignore */ }
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    window.location.href = `${base}/login`;
  };

  const handleSwitchAccount = async () => {
    document.cookie = 'idToken=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    try { sessionStorage.clear(); } catch { /* ignore */ }
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('CognitoIdentityServiceProvider') || k.startsWith('vyapargyan'))
          localStorage.removeItem(k);
      });
    } catch { /* ignore */ }
    const { signOut } = await import('aws-amplify/auth');
    try { await signOut({ global: true }); } catch { /* ignore */ }
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    window.location.href = `${base}/login`;
  };

  return (
    <div className="space-y-1">
      <button
        onClick={handleSwitchAccount}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-indigo-50 hover:text-indigo-600"
      >
        <ArrowLeftRight className="h-5 w-5 text-gray-400" />
        Switch Account
      </button>
      <button
        onClick={handleLogout}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-red-50 hover:text-red-600"
      >
        <LogOut className="h-5 w-5 text-gray-400" />
        Sign Out
      </button>
    </div>
  );
}
