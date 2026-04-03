'use client';

import { useRouter } from 'next/navigation';
import { Clock, CheckCircle, Package, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface Order {
  id: string;
  customerId: string;
  status: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  subtotal: number;
  commissionAmount: number;
  sellerAmount: number;
  shippingAddress: {
    name: string;
    phone: string;
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MobileOrderCardProps {
  order: Order;
  onTap?: (order: Order) => void;
}

const statusConfig: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  confirmed: { label: 'Confirmed', color: 'bg-blue-100 text-blue-800', icon: CheckCircle },
  processing: { label: 'Processing', color: 'bg-purple-100 text-purple-800', icon: Package },
  delivered: { label: 'Delivered', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800', icon: XCircle },
};

function formatAmount(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(dateStr));
  } catch {
    return '—';
  }
}

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export default function MobileOrderCard({ order, onTap }: MobileOrderCardProps) {
  const router = useRouter();
  const status = statusConfig[order.status] ?? {
    label: order.status || '—',
    color: 'bg-gray-100 text-gray-800',
    icon: Clock,
  };
  const StatusIcon = status.icon;

  const handleTap = () => {
    if (onTap) {
      onTap(order);
    } else {
      router.push(`/seller/orders/${order.id}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      className="w-full rounded-lg border bg-white p-4 text-left shadow-sm active:bg-gray-50 transition-colors"
      aria-label={`View order ${truncateId(order.id)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            #{truncateId(order.id)}
          </p>
          <p className="mt-0.5 text-sm text-gray-600 truncate">
            {order.shippingAddress?.name || '—'}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${status.color}`}
        >
          <StatusIcon className="h-3 w-3" />
          {status.label}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="font-semibold text-gray-900">
          {formatAmount(order.subtotal)}
        </span>
        <span className="text-xs text-gray-500">
          {formatDate(order.createdAt)}
        </span>
      </div>
    </button>
  );
}
