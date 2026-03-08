'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  Sparkles,
  Megaphone,
  ShoppingBag,
  MessageSquare,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  Store,
  ArrowLeftRight,
} from 'lucide-react';
import { signOut } from 'aws-amplify/auth';
import { configureAmplify } from '@/lib/amplify-config';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navigation: NavItem[] = [
  { name: 'Overview', href: '/seller', icon: LayoutDashboard },
  { name: 'Inventory Hub', href: '/seller/inventory', icon: Package },
  { name: 'Orders', href: '/seller/orders', icon: ShoppingBag },
  { name: 'Customer Inbox', href: '/seller/inbox', icon: MessageSquare },
  { name: 'AI Insights', href: '/seller/insights', icon: Sparkles },
  { name: 'Approvals', href: '/seller/approvals', icon: ShieldCheck },
  { name: 'Campaigns', href: '/seller/campaigns', icon: Megaphone },
];

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  useState(() => { configureAmplify(); });

  const clearAllState = () => {
    document.cookie = 'idToken=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    try { sessionStorage.clear(); } catch {}
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('CognitoIdentityServiceProvider') || k.startsWith('vyapargyan')) localStorage.removeItem(k);
      });
    } catch {}
  };

  const handleLogout = async () => {
    clearAllState();
    try { await signOut({ global: true }); } catch {}
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    window.location.href = `${base}/login`;
  };

  const handleSwitchAccount = async () => {
    clearAllState();
    try { await signOut({ global: true }); } catch {}
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    window.location.href = `${base}/login`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-gray-600/75 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-white shadow-lg transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center justify-between border-b px-4">
          <Link href="/seller" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
              <Store className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">VyaparGyan</span>
          </Link>
          <button onClick={() => setSidebarOpen(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== '/seller' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? 'text-indigo-600' : 'text-gray-400'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-3 space-y-1">
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
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-white px-4 shadow-sm lg:px-6">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">Dragon Store</span>
          </div>
        </header>

        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
