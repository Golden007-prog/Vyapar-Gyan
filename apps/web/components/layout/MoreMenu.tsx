'use client';

import { useEffect, useCallback } from 'react';
import Link from 'next/link';
import { LogOut, ArrowLeftRight } from 'lucide-react';
import type { NavItem } from './nav-config';

export interface MoreMenuProps {
  items: NavItem[];
  open: boolean;
  onClose: () => void;
}

export function MoreMenu({ items, open, onClose }: MoreMenuProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  const handleLogout = async () => {
    onClose();
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
    onClose();
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
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More options">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div className="absolute bottom-0 left-0 right-0 animate-slide-up rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-xl">
        {/* Drag handle */}
        <div className="flex justify-center py-3">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        {/* Nav items */}
        <nav className="px-4 pb-2" aria-label="Additional navigation">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className="flex min-h-[48px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 active:bg-gray-100"
              >
                <Icon size={20} className="text-gray-500" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Divider */}
        <div className="mx-4 border-t border-gray-200" />

        {/* Actions */}
        <div className="px-4 py-2">
          <button
            type="button"
            onClick={handleSwitchAccount}
            className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-indigo-50 hover:text-indigo-600 active:bg-indigo-100"
          >
            <ArrowLeftRight size={20} className="text-gray-500" aria-hidden="true" />
            Switch Account
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-red-50 hover:text-red-600 active:bg-red-100"
          >
            <LogOut size={20} className="text-gray-500" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
