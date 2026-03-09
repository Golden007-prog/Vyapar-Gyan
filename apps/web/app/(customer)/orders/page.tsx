'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Package, Loader2, ChevronRight } from 'lucide-react';
import { listOrders, type Order, type OrderStatus } from '@/lib/api-orders';
import { getDemoOrders } from '@/lib/demo-orders';
import StatusPill from '@/components/ui/StatusPill';
import EmptyState from '@/components/ui/EmptyState';
import { CardSkeleton } from '@/components/ui/Skeleton';

// --- Filter Tabs ---

type FilterTab = 'all' | 'active' | 'delivered' | 'cancelled';

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

function filterOrders(orders: Order[], tab: FilterTab): Order[] {
  switch (tab) {
    case 'active':
      return orders.filter((o) =>
        ['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED'].includes(o.status),
      );
    case 'delivered':
      return orders.filter((o) => o.status === 'DELIVERED');
    case 'cancelled':
      return orders.filter((o) => o.status === 'CANCELLED');
    default:
      return orders;
  }
}

// --- Page ---

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');

  useEffect(() => {
    setLoading(true);
    listOrders({ limit: 50 })
      .then((res) => {
        // Merge API orders with any demo orders from sessionStorage
        const demoOrders = getDemoOrders().map(d => ({
          id: d.id,
          orderId: d.orderId,
          customerId: d.customerId,
          sellerId: d.sellerId,
          items: d.items,
          subtotal: d.subtotal,
          commissionAmount: d.commissionAmount,
          totalAmount: d.totalAmount,
          status: d.status as Order['status'],
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        }));
        const apiOrders = res.orders ?? [];
        // Deduplicate by orderId
        const seen = new Set(apiOrders.map(o => o.orderId));
        const merged = [...apiOrders, ...demoOrders.filter(d => !seen.has(d.orderId))];
        setOrders(merged);
      })
      .catch(() => {
        // API unavailable — show demo orders from sessionStorage + hardcoded fallbacks
        const demoOrders = getDemoOrders().map(d => ({
          id: d.id,
          orderId: d.orderId,
          customerId: d.customerId,
          sellerId: d.sellerId,
          items: d.items,
          subtotal: d.subtotal,
          commissionAmount: d.commissionAmount,
          totalAmount: d.totalAmount,
          status: d.status as Order['status'],
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        }));

        const fallbackOrders: Order[] = [
          {
            id: 'demo-o1', orderId: 'ORD-2025-001', customerId: 'cust-demo', sellerId: 'seller-demo',
            items: [{ productId: 'p1', sellerId: 's1', name: 'Tata Salt 1kg', price: 25, quantity: 2 }, { productId: 'p2', sellerId: 's1', name: 'Amul Butter 500g', price: 280, quantity: 1 }],
            subtotal: 330, commissionAmount: 33, totalAmount: 363, status: 'DELIVERED',
            createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), updatedAt: new Date(Date.now() - 86400000).toISOString(),
          },
          {
            id: 'demo-o2', orderId: 'ORD-2025-002', customerId: 'cust-demo', sellerId: 'seller-demo',
            items: [{ productId: 'p3', sellerId: 's1', name: 'Maggi Noodles Pack', price: 144, quantity: 1 }],
            subtotal: 144, commissionAmount: 14, totalAmount: 158, status: 'PROCESSING',
            createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString(),
          },
        ];

        // Demo orders from checkout go first, then fallbacks
        const seen = new Set(demoOrders.map(o => o.orderId));
        setOrders([...demoOrders, ...fallbackOrders.filter(f => !seen.has(f.orderId))]);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = filterOrders(orders, tab);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-lg font-semibold text-gray-900">My Orders</h1>

      {/* Filter tabs */}
      <div className="mt-4 flex gap-1 rounded-lg bg-gray-100 p-1">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              tab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="h-12 w-12 text-gray-300" />}
          title="No orders yet"
          description={
            tab === 'all'
              ? 'Your orders will appear here once you make a purchase.'
              : `No ${tab} orders found.`
          }
          actionLabel="Browse Catalog"
          actionHref="/catalog"
        />
      ) : (
        <div className="mt-4 space-y-3">
          {filtered.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const date = new Date(order.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const itemCount = order.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <Link
      href={`/orders/${order.orderId}`}
      className="flex items-center justify-between rounded-lg border bg-white p-4 transition hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{order.orderId}</span>
          <StatusPill status={order.status} domain="order" />
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {date} · {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </p>
        <p className="mt-0.5 text-xs text-gray-400 truncate">
          {order.items.map((i) => i.name).join(', ')}
        </p>
      </div>
      <div className="ml-4 flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">
          ₹{order.totalAmount.toLocaleString('en-IN')}
        </span>
        <ChevronRight className="h-4 w-4 text-gray-400" />
      </div>
    </Link>
  );
}
