'use client';

import { CreditCard, Package, ShoppingCart, Clock } from 'lucide-react';

interface QuickActionsProps {
  customerUserId: string;
  onAction?: (action: string, customerUserId: string) => void;
}

const actions = [
  { id: 'payment-link', label: 'Payment Link', icon: CreditCard, color: 'text-green-600 bg-green-50 hover:bg-green-100' },
  { id: 'share-product', label: 'Share Product', icon: Package, color: 'text-blue-600 bg-blue-50 hover:bg-blue-100' },
  { id: 'create-order', label: 'Create Order', icon: ShoppingCart, color: 'text-purple-600 bg-purple-50 hover:bg-purple-100' },
  { id: 'view-history', label: 'View History', icon: Clock, color: 'text-orange-600 bg-orange-50 hover:bg-orange-100' },
] as const;

export default function QuickActions({ customerUserId, onAction }: QuickActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ id, label, icon: Icon, color }) => (
        <button
          key={id}
          onClick={() => onAction?.(id, customerUserId)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${color}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
