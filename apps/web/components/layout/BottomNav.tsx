'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import type { NavItem } from './nav-config';

export interface BottomNavProps {
  items: NavItem[];
  overflowItems?: NavItem[];
  onMorePress?: () => void;
}

export function BottomNav({ items, overflowItems, onMorePress }: BottomNavProps) {
  const pathname = usePathname();

  const hasOverflow = overflowItems && overflowItems.length > 0;

  // If there are overflow items, show first 4 primary tabs + "More" tab
  // Otherwise show all primary items (up to 5)
  const visibleItems = hasOverflow ? items.filter((item) => item.href !== '#more') : items;
  const tabs = hasOverflow ? visibleItems.slice(0, 4) : visibleItems.slice(0, 5);

  const isActive = (href: string) => {
    if (href === '/seller' || href === '/admin') {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      role="navigation"
      aria-label="Bottom navigation"
    >
      <div className="flex items-stretch">
        {tabs.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 transition-colors ${
                active
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="text-[12px] leading-tight">{item.label}</span>
            </Link>
          );
        })}

        {hasOverflow && (
          <button
            type="button"
            onClick={onMorePress}
            className="flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-gray-500 transition-colors hover:text-gray-700"
            aria-label="More navigation options"
          >
            <MoreHorizontal size={20} aria-hidden="true" />
            <span className="text-[12px] leading-tight">More</span>
          </button>
        )}
      </div>
    </nav>
  );
}
