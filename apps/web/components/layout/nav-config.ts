import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  MessageSquare,
  Sparkles,
  ShieldCheck,
  Megaphone,
  MoreHorizontal,
  Search,
  ShoppingCart,
  User,
  Users,
  FileText,
  Activity,
  Settings,
} from 'lucide-react';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavConfig = {
  role: 'seller' | 'customer' | 'admin';
  primary: NavItem[];   // max 5, shown in BottomNav
  overflow: NavItem[];  // shown in MoreMenu sheet
};

export const SELLER_NAV: NavConfig = {
  role: 'seller',
  primary: [
    { label: 'Overview', href: '/seller', icon: LayoutDashboard },
    { label: 'Inventory', href: '/seller/inventory', icon: Package },
    { label: 'Orders', href: '/seller/orders', icon: ShoppingBag },
    { label: 'Inbox', href: '/seller/inbox', icon: MessageSquare },
    { label: 'More', href: '#more', icon: MoreHorizontal },
  ],
  overflow: [
    { label: 'AI Insights', href: '/seller/insights', icon: Sparkles },
    { label: 'Approvals', href: '/seller/approvals', icon: ShieldCheck },
    { label: 'Campaigns', href: '/seller/campaigns', icon: Megaphone },
  ],
};

export const CUSTOMER_NAV: NavConfig = {
  role: 'customer',
  primary: [
    { label: 'Catalog', href: '/catalog', icon: Search },
    { label: 'Chat', href: '/chat', icon: MessageSquare },
    { label: 'Cart', href: '/cart', icon: ShoppingCart },
    { label: 'Orders', href: '/orders', icon: ShoppingBag },
    { label: 'Account', href: '/account', icon: User },
  ],
  overflow: [],
};

export const ADMIN_NAV: NavConfig = {
  role: 'admin',
  primary: [
    { label: 'Overview', href: '/admin', icon: LayoutDashboard },
    { label: 'Sellers', href: '/admin/sellers', icon: Users },
    { label: 'Audit', href: '/admin/audit', icon: FileText },
    { label: 'Health', href: '/admin/system', icon: Activity },
    { label: 'More', href: '#more', icon: MoreHorizontal },
  ],
  overflow: [
    { label: 'Settings', href: '/admin/settings', icon: Settings },
  ],
};
