'use client';

import { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft, User, Phone, MessageSquare, ShoppingBag, IndianRupee } from 'lucide-react';
import { getCustomerContext, type CustomerContext } from '@/lib/api-inbox';

function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

function ChannelBadge({ channel }: { channel: string }) {
  if (channel === 'whatsapp') {
    return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">WhatsApp</span>;
  }
  if (channel === 'web') {
    return <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">Web</span>;
  }
  return <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">Both</span>;
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-blue-100 text-blue-800',
    shipped: 'bg-purple-100 text-purple-800',
    delivered: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${colors[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

interface CustomerContextSidebarProps {
  customerUserId: string | null;
  isOpen: boolean;
  onToggle: () => void;
}

export default function CustomerContextSidebar({ customerUserId, isOpen, onToggle }: CustomerContextSidebarProps) {
  const [context, setContext] = useState<CustomerContext | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerUserId || !isOpen) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await getCustomerContext(customerUserId!);
        if (!cancelled) setContext(data);
      } catch {
        if (!cancelled) setContext(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [customerUserId, isOpen]);

  // Toggle button always visible
  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="flex h-full w-8 items-center justify-center border-l bg-gray-50 hover:bg-gray-100 transition-colors"
        title="Show customer context"
      >
        <ChevronLeft className="h-4 w-4 text-gray-500" />
      </button>
    );
  }

  return (
    <div className="flex h-full w-72 flex-shrink-0 flex-col border-l bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Customer Context</h3>
        <button onClick={onToggle} className="rounded p-1 hover:bg-gray-100" title="Hide sidebar">
          <ChevronRight className="h-4 w-4 text-gray-500" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!customerUserId && (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-xs text-gray-400">Select a conversation to see customer details</p>
          </div>
        )}

        {customerUserId && loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-r-transparent" />
          </div>
        )}

        {customerUserId && !loading && context && (
          <div className="space-y-4 p-4">
            {/* Profile */}
            {context.profile && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100">
                    <User className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{context.profile.displayName}</p>
                    <ChannelBadge channel={context.preferredChannel} />
                  </div>
                </div>

                <div className="space-y-1.5 rounded-lg bg-gray-50 p-3">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <Phone className="h-3 w-3" />
                    <span>{context.profile.phoneNumber}</span>
                  </div>
                  {context.profile.whatsappConnected && (
                    <div className="flex items-center gap-2 text-xs text-green-600">
                      <MessageSquare className="h-3 w-3" />
                      <span>WhatsApp connected</span>
                    </div>
                  )}
                  <div className="text-xs text-gray-400">
                    Customer since {formatDate(context.profile.createdAt)}
                  </div>
                </div>
              </div>
            )}

            {/* Spend summary */}
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase">
                <IndianRupee className="h-3 w-3" />
                Lifetime Value
              </div>
              <p className="mt-1 text-lg font-semibold text-gray-900">{formatCurrency(context.totalSpend)}</p>
              <p className="text-xs text-gray-500">{context.orderCount} order{context.orderCount !== 1 ? 's' : ''}</p>
            </div>

            {/* Order history */}
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase mb-2">
                <ShoppingBag className="h-3 w-3" />
                Recent Orders
              </div>
              {context.orderHistory.length === 0 ? (
                <p className="text-xs text-gray-400">No orders yet</p>
              ) : (
                <div className="space-y-2">
                  {context.orderHistory.slice(0, 5).map((order) => (
                    <div key={order.orderId} className="rounded-lg border p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-700">
                          #{order.orderId.slice(0, 8)}
                        </span>
                        <StatusPill status={order.status} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                        <span>{formatCurrency(order.subtotal)} · {order.itemCount} item{order.itemCount !== 1 ? 's' : ''}</span>
                        <span>{formatDate(order.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {customerUserId && !loading && !context && (
          <div className="flex h-full items-center justify-center p-4">
            <p className="text-xs text-gray-400">Could not load customer context</p>
          </div>
        )}
      </div>
    </div>
  );
}
