'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavItem } from './nav-config';

export interface SidebarProps {
  items: NavItem[];
  collapsed?: boolean;
  onToggle?: () => void;
  headerSlot?: React.ReactNode;
  footerSlot?: React.ReactNode;
}

export function Sidebar({
  items,
  collapsed = false,
  onToggle,
  headerSlot,
  footerSlot,
}: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    // Exact match for root role paths (e.g. /seller, /admin)
    if (href === '/seller' || href === '/admin') {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-white shadow-lg transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
      onMouseEnter={() => collapsed && onToggle?.()}
      onMouseLeave={() => !collapsed && onToggle?.()}
    >
      {/* Header slot — brand logo area */}
      {headerSlot && (
        <div className="flex h-16 shrink-0 items-center border-b px-4">
          {headerSlot}
        </div>
      )}

      {/* Navigation items */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 ${
                  active ? 'text-indigo-600' : 'text-gray-400'
                }`}
              />
              {!collapsed && <span>{item.label}</span>}

              {/* Tooltip on hover when collapsed */}
              {collapsed && (
                <span className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer slot — logout / switch account area */}
      {footerSlot && (
        <div className="shrink-0 border-t p-3">{footerSlot}</div>
      )}
    </aside>
  );
}
