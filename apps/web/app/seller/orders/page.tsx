'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Package, CheckCircle, ShoppingBag,
  RefreshCw, X, AlertTriangle, ChevronRight, CircleDot,
} from 'lucide-react';
import StatusPill from '@/components/ui/StatusPill';
import {
  listSellerOrders,
  acceptOrder,
  rejectOrder,
  updateOrderStatus,
} from '@/lib/api-seller-orders';
import type { Order, OrderStatus } from '@/lib/api-orders';

// --- Types ---

type FilterTab =
  | 'all'
  | 'pending_seller_confirmation'
  | 'confirmed'
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'rejected_cancelled';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

// --- Constants ---

const FILTER_TABS: { key: FilterTab; label: string; statuses: string[] }[] = [
  { key: 'all', label: 'All', statuses: [] },
  { key: 'pending_seller_confirmation', label: 'Pending', statuses: ['pending_seller_confirmation'] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['confirmed', 'payment_pending'] },
  { key: 'paid', label: 'Paid', statuses: ['paid'] },
  { key: 'preparing', label: 'Preparing', statuses: ['preparing'] },
  { key: 'shipped', label: 'Shipped', statuses: ['shipped'] },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered', 'completed'] },
  { key: 'rejected_cancelled', label: 'Rejected/Cancelled', statuses: ['rejected', 'cancelled', 'expired', 'payment_failed'] },
];


// --- Demo data (fallback when API unavailable) ---

function getDemoSellerOrders(): Order[] {
  const now = Date.now();
  return [
    {
      id: 'ord-uuid-001', orderId: 'VG-20260307-0001', customerId: 'cust-demo-001', sellerId: 'seller-dragon',
      sellerName: 'Dragon Store',
      status: 'pending_seller_confirmation' as OrderStatus,
      items: [
        { productId: 'p-001', sellerId: 'seller-dragon', name: 'Amul Butter 500g', price: 280, quantity: 2 },
        { productId: 'p-006', sellerId: 'seller-dragon', name: 'Aashirvaad Atta 5kg', price: 320, quantity: 1 },
      ],
      subtotal: 880, commissionAmount: 132, totalAmount: 880,
      channel: 'whatsapp',
      shippingAddress: { name: 'Enigma', phone: '+917001124396', addressLine1: 'MG Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
      createdAt: new Date(now - 1800000).toISOString(),
      updatedAt: new Date(now - 1800000).toISOString(),
      timeline: [
        { status: 'pending_seller_confirmation', timestamp: new Date(now - 1800000).toISOString(), actor: 'customer' as const },
      ],
    },
    {
      id: 'ord-uuid-002', orderId: 'VG-20260307-0002', customerId: 'cust-002', sellerId: 'seller-dragon',
      sellerName: 'Dragon Store',
      status: 'paid' as OrderStatus,
      items: [
        { productId: 'p-003', sellerId: 'seller-dragon', name: 'USB-C Cable 1m', price: 149, quantity: 3 },
      ],
      subtotal: 447, commissionAmount: 67, totalAmount: 447,
      channel: 'web',
      shippingAddress: { name: 'Priya Sharma', phone: '+919876543210', addressLine1: 'Linking Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400050' },
      createdAt: new Date(now - 3600000).toISOString(),
      updatedAt: new Date(now - 1200000).toISOString(),
      confirmedAt: new Date(now - 2400000).toISOString(),
      paidAt: new Date(now - 1200000).toISOString(),
      timeline: [
        { status: 'pending_seller_confirmation', timestamp: new Date(now - 3600000).toISOString(), actor: 'customer' as const },
        { status: 'confirmed', timestamp: new Date(now - 2400000).toISOString(), actor: 'seller' as const },
        { status: 'payment_pending', timestamp: new Date(now - 2400000).toISOString(), actor: 'system' as const },
        { status: 'paid', timestamp: new Date(now - 1200000).toISOString(), actor: 'system' as const },
      ],
    },
    {
      id: 'ord-uuid-003', orderId: 'VG-20260306-0001', customerId: 'cust-003', sellerId: 'seller-dragon',
      sellerName: 'Dragon Store',
      status: 'preparing' as OrderStatus,
      items: [
        { productId: 'p-002', sellerId: 'seller-dragon', name: 'Surf Excel 1kg', price: 199, quantity: 2 },
        { productId: 'p-005', sellerId: 'seller-dragon', name: 'Vim Dishwash Bar', price: 35, quantity: 5 },
      ],
      subtotal: 573, commissionAmount: 86, totalAmount: 573,
      channel: 'whatsapp',
      shippingAddress: { name: 'Rahul Verma', phone: '+918765432100', addressLine1: 'Station Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      createdAt: new Date(now - 86400000).toISOString(),
      updatedAt: new Date(now - 43200000).toISOString(),
      timeline: [
        { status: 'pending_seller_confirmation', timestamp: new Date(now - 86400000).toISOString(), actor: 'customer' as const },
        { status: 'confirmed', timestamp: new Date(now - 82800000).toISOString(), actor: 'seller' as const },
        { status: 'paid', timestamp: new Date(now - 72000000).toISOString(), actor: 'system' as const },
        { status: 'preparing', timestamp: new Date(now - 43200000).toISOString(), actor: 'seller' as const },
      ],
    },
    {
      id: 'ord-uuid-004', orderId: 'VG-20260305-0001', customerId: 'cust-004', sellerId: 'seller-dragon',
      sellerName: 'Dragon Store',
      status: 'delivered' as OrderStatus,
      items: [
        { productId: 'p-001', sellerId: 'seller-dragon', name: 'Amul Butter 500g', price: 280, quantity: 1 },
      ],
      subtotal: 280, commissionAmount: 42, totalAmount: 280,
      channel: 'web',
      shippingAddress: { name: 'Anita Desai', phone: '+919988776655', addressLine1: 'FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411004' },
      createdAt: new Date(now - 172800000).toISOString(),
      updatedAt: new Date(now - 86400000).toISOString(),
      deliveredAt: new Date(now - 86400000).toISOString(),
      timeline: [
        { status: 'pending_seller_confirmation', timestamp: new Date(now - 172800000).toISOString(), actor: 'customer' as const },
        { status: 'confirmed', timestamp: new Date(now - 169200000).toISOString(), actor: 'seller' as const },
        { status: 'paid', timestamp: new Date(now - 158400000).toISOString(), actor: 'system' as const },
        { status: 'preparing', timestamp: new Date(now - 144000000).toISOString(), actor: 'seller' as const },
        { status: 'shipped', timestamp: new Date(now - 115200000).toISOString(), actor: 'seller' as const },
        { status: 'delivered', timestamp: new Date(now - 86400000).toISOString(), actor: 'seller' as const },
      ],
    },
    {
      id: 'ord-uuid-005', orderId: 'VG-20260304-0001', customerId: 'cust-005', sellerId: 'seller-dragon',
      sellerName: 'Dragon Store',
      status: 'rejected' as OrderStatus,
      items: [
        { productId: 'p-004', sellerId: 'seller-dragon', name: 'Winter Jacket (L)', price: 1200, quantity: 1 },
      ],
      subtotal: 1200, commissionAmount: 180, totalAmount: 1200,
      channel: 'whatsapp',
      rejectionReason: 'Item out of stock — seasonal product',
      shippingAddress: { name: 'Vikram Singh', phone: '+919876501234', addressLine1: 'Mall Road', city: 'Delhi', state: 'Delhi', pincode: '110001' },
      createdAt: new Date(now - 345600000).toISOString(),
      updatedAt: new Date(now - 342000000).toISOString(),
      timeline: [
        { status: 'pending_seller_confirmation', timestamp: new Date(now - 345600000).toISOString(), actor: 'customer' as const },
        { status: 'rejected', timestamp: new Date(now - 342000000).toISOString(), actor: 'seller' as const, note: 'Item out of stock — seasonal product' },
      ],
    },
  ];
}


// --- Helpers ---

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function itemsSummary(items: Order['items']) {
  const names = items.map(i => `${i.quantity}× ${i.name}`).join(', ');
  return names.length > 50 ? names.slice(0, 47) + '...' : names;
}

function getCustomerName(order: Order): string {
  return order.shippingAddress?.name || order.customerId || 'Customer';
}

/** Get contextual action buttons for a given order status */
function getActions(status: string): { label: string; action: string; variant: 'primary' | 'danger' | 'secondary' }[] {
  switch (status) {
    case 'pending_seller_confirmation':
      return [
        { label: 'Accept Order', action: 'accept', variant: 'primary' },
        { label: 'Reject Order', action: 'reject', variant: 'danger' },
      ];
    case 'paid':
      return [{ label: 'Mark as Preparing', action: 'preparing', variant: 'primary' }];
    case 'preparing':
      return [{ label: 'Mark as Shipped', action: 'shipped', variant: 'primary' }];
    case 'shipped':
      return [{ label: 'Mark as Delivered', action: 'delivered', variant: 'primary' }];
    default:
      return [];
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending_seller_confirmation: 'Awaiting Seller',
  confirmed: 'Confirmed',
  payment_pending: 'Payment Pending',
  paid: 'Paid',
  preparing: 'Preparing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  payment_failed: 'Payment Failed',
  expired: 'Expired',
};

// --- Toast Component ---

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
            t.type === 'success' ? 'bg-green-600 text-white' :
            t.type === 'error' ? 'bg-red-600 text-white' :
            'bg-indigo-600 text-white'
          }`}
        >
          {t.type === 'success' && <CheckCircle className="h-4 w-4" />}
          {t.type === 'error' && <AlertTriangle className="h-4 w-4" />}
          {t.type === 'info' && <ShoppingBag className="h-4 w-4" />}
          <span>{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="ml-2 opacity-70 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}


// --- Order Detail Modal (Task 16.2) ---

function OrderDetailModal({
  order,
  onClose,
  onAction,
  actionLoading,
}: {
  order: Order;
  onClose: () => void;
  onAction: (orderId: string, action: string, reason?: string) => void;
  actionLoading: string | null;
}) {
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const actions = getActions(order.status);
  const sellerAmount = order.subtotal - (order.commissionAmount || 0);

  const handleAction = (action: string) => {
    if (action === 'reject') {
      if (!showRejectInput) {
        setShowRejectInput(true);
        return;
      }
      if (!rejectReason.trim()) return;
      onAction(order.orderId || order.id, action, rejectReason.trim());
    } else {
      onAction(order.orderId || order.id, action);
    }
  };

  const timeline = order.timeline || [];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{order.orderId || order.id}</h2>
            <p className="text-xs text-gray-500">{formatDate(order.createdAt)}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill status={order.status} domain="order" />
            <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
              <X className="h-5 w-5 text-gray-400" />
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Customer Info */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Customer</h3>
            <div className="mt-2 rounded-lg bg-gray-50 p-3">
              <p className="text-sm font-medium text-gray-900">{getCustomerName(order)}</p>
              {order.shippingAddress?.phone && (
                <p className="text-xs text-gray-500">{order.shippingAddress.phone}</p>
              )}
              {order.shippingAddress?.addressLine1 && (
                <p className="mt-1 text-xs text-gray-500">
                  {order.shippingAddress.addressLine1}, {order.shippingAddress.city} {order.shippingAddress.pincode}
                </p>
              )}
              {order.channel && (
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  order.channel === 'whatsapp' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  via {order.channel}
                </span>
              )}
            </div>
          </section>

          {/* Items */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Items</h3>
            <div className="mt-2 divide-y rounded-lg border">
              {order.items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between px-3 py-2.5">
                  <div>
                    <p className="text-sm text-gray-900">{item.name}</p>
                    <p className="text-xs text-gray-500">{item.quantity} × {formatCurrency(item.price)}</p>
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(item.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Commission Breakdown */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Breakdown</h3>
            <div className="mt-2 space-y-1.5 rounded-lg bg-gray-50 p-3 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatCurrency(order.subtotal || order.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Platform Commission</span>
                <span className="text-red-600">−{formatCurrency(order.commissionAmount || 0)}</span>
              </div>
              <div className="flex justify-between border-t pt-1.5 font-semibold text-gray-900">
                <span>Your Earnings</span>
                <span className="text-green-700">{formatCurrency(sellerAmount)}</span>
              </div>
            </div>
          </section>

          {/* Rejection Reason */}
          {order.rejectionReason && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Rejection Reason</h3>
              <p className="mt-1 rounded-lg bg-red-50 p-3 text-sm text-red-700">{order.rejectionReason}</p>
            </section>
          )}

          {/* Timeline */}
          {timeline.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Timeline</h3>
              <div className="mt-2 space-y-0">
                {timeline.map((entry, idx) => {
                  const isLast = idx === timeline.length - 1;
                  return (
                    <div key={idx} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        {isLast ? (
                          <CircleDot className="h-4 w-4 shrink-0 text-indigo-600" />
                        ) : (
                          <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
                        )}
                        {!isLast && <div className="w-0.5 flex-1 min-h-[20px] bg-gray-200" />}
                      </div>
                      <div className="pb-3">
                        <p className="text-sm font-medium text-gray-900">
                          {STATUS_LABEL[entry.status] || entry.status}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {formatDate(entry.timestamp)} · {entry.actor}
                        </p>
                        {entry.note && (
                          <p className="mt-0.5 text-xs text-gray-500 italic">{entry.note}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Reject Reason Input */}
          {showRejectInput && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <label className="text-xs font-medium text-red-700">Rejection Reason (required)</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g., Item out of stock, cannot fulfill today..."
                className="mt-1 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm focus:border-red-400 focus:outline-none"
                rows={2}
              />
            </div>
          )}

          {/* Action Buttons */}
          {actions.length > 0 && (
            <div className="flex gap-2 pt-1">
              {actions.map((a) => (
                <button
                  key={a.action}
                  onClick={() => handleAction(a.action)}
                  disabled={actionLoading !== null || (a.action === 'reject' && showRejectInput && !rejectReason.trim())}
                  className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 ${
                    a.variant === 'primary'
                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                      : a.variant === 'danger'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {actionLoading === a.action ? (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                  ) : (
                    a.label
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// --- Main Page Component (Task 16.1 + 16.2) ---

export default function SellerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // --- Toast helpers ---
  const addToast = useCallback((message: string, type: Toast['type'] = 'success') => {
    const id = `toast-${Date.now()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // --- Load orders ---
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSellerOrders({ limit: 100 });
      const apiOrders = res.orders ?? [];
      if (apiOrders.length > 0) {
        apiOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setOrders(apiOrders);
      } else {
        setOrders(getDemoSellerOrders());
      }
    } catch {
      // Fallback to demo data
      setOrders(getDemoSellerOrders());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // --- WebSocket for real-time order arrival (Req 13.5) ---
  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { fetchAuthSession } = await import('aws-amplify/auth');
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString();
        if (!token || cancelled) return;

        const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL;
        if (!wsUrl) return;

        ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.action === 'order_update' || data.action === 'new_order') {
              const newOrder = data.order as Order;
              if (newOrder) {
                setOrders((prev) => {
                  const exists = prev.find((o) => (o.orderId || o.id) === (newOrder.orderId || newOrder.id));
                  if (exists) {
                    return prev.map((o) =>
                      (o.orderId || o.id) === (newOrder.orderId || newOrder.id) ? { ...o, ...newOrder } : o,
                    );
                  }
                  return [newOrder, ...prev];
                });
                addToast(`🛒 New order ${newOrder.orderId} — ${formatCurrency(newOrder.totalAmount)}`, 'info');
              }
            }
          } catch {
            // ignore malformed messages
          }
        };
      } catch {
        // No auth — WebSocket stays disconnected
      }
    })();

    return () => {
      cancelled = true;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [addToast]);

  // --- Filter orders ---
  const tabConfig = FILTER_TABS.find((t) => t.key === activeTab)!;
  const filteredOrders =
    activeTab === 'all'
      ? orders
      : orders.filter((o) => tabConfig.statuses.includes(o.status));

  const pendingCount = orders.filter((o) => o.status === 'pending_seller_confirmation').length;

  // --- Order actions (Task 16.2) ---
  const handleAction = useCallback(
    async (orderId: string, action: string, reason?: string) => {
      setActionLoading(action);

      // Optimistic update
      const prevOrders = [...orders];
      const statusMap: Record<string, OrderStatus> = {
        accept: 'confirmed',
        reject: 'rejected',
        preparing: 'preparing',
        shipped: 'shipped',
        delivered: 'delivered',
      };
      const newStatus = statusMap[action];
      if (newStatus) {
        setOrders((prev) =>
          prev.map((o) =>
            (o.orderId || o.id) === orderId ? { ...o, status: newStatus } : o,
          ),
        );
        if (selectedOrder && (selectedOrder.orderId || selectedOrder.id) === orderId) {
          setSelectedOrder((prev) => prev ? { ...prev, status: newStatus } : prev);
        }
      }

      try {
        switch (action) {
          case 'accept':
            await acceptOrder(orderId);
            addToast(`✅ Order ${orderId} accepted`);
            break;
          case 'reject':
            await rejectOrder(orderId, reason || 'Declined by seller');
            addToast(`❌ Order ${orderId} rejected`);
            break;
          case 'preparing':
            await updateOrderStatus(orderId, 'preparing');
            addToast(`📦 Order ${orderId} marked as preparing`);
            break;
          case 'shipped':
            await updateOrderStatus(orderId, 'shipped');
            addToast(`🚚 Order ${orderId} marked as shipped`);
            break;
          case 'delivered':
            await updateOrderStatus(orderId, 'delivered');
            addToast(`✅ Order ${orderId} marked as delivered`);
            break;
        }
        setSelectedOrder(null);
      } catch (err: any) {
        // Rollback on failure
        setOrders(prevOrders);
        if (selectedOrder) {
          const original = prevOrders.find((o) => (o.orderId || o.id) === orderId);
          if (original) setSelectedOrder(original);
        }
        addToast(err?.message || `Failed to ${action} order`, 'error');
      } finally {
        setActionLoading(null);
      }
    },
    [orders, selectedOrder, addToast],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Order Management</h1>
          <p className="mt-1 text-sm text-gray-500">Track and manage your customer orders</p>
        </div>
        <button
          onClick={loadOrders}
          disabled={loading}
          className="self-start flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filter Tabs (Req 13.2) */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTER_TABS.map((tab) => {
          const isPending = tab.key === 'pending_seller_confirmation';
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`relative whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
              }`}
            >
              {tab.label}
              {/* Pending count badge (Req 13.6) */}
              {isPending && pendingCount > 0 && (
                <span className={`ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                  activeTab === tab.key ? 'bg-white text-indigo-600' : 'bg-red-500 text-white'
                }`}>
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-r-transparent" />
            <p className="mt-2 text-sm text-gray-500">Loading orders...</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredOrders.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No orders found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {activeTab === 'all'
              ? "You haven't received any orders yet."
              : `No ${tabConfig.label.toLowerCase()} orders at the moment.`}
          </p>
        </div>
      )}

      {/* Mobile Cards */}
      {!loading && filteredOrders.length > 0 && (
        <div className="space-y-2 md:hidden">
          {filteredOrders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => setSelectedOrder(order)}
              className="w-full rounded-lg border bg-white p-4 text-left shadow-sm active:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{order.orderId || order.id}</p>
                  <p className="mt-0.5 text-xs text-gray-600">{getCustomerName(order)}</p>
                </div>
                <StatusPill status={order.status} domain="order" />
              </div>
              <p className="mt-1.5 text-xs text-gray-500 truncate">{itemsSummary(order.items)}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-900">{formatCurrency(order.totalAmount || order.subtotal)}</span>
                <span className="text-[11px] text-gray-400">{formatDate(order.createdAt)}</span>
              </div>
              {/* Inline quick actions on mobile cards */}
              {getActions(order.status).length > 0 && (
                <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {getActions(order.status).map((a) => (
                    <button
                      key={a.action}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (a.action === 'reject') {
                          setSelectedOrder(order);
                        } else {
                          handleAction(order.orderId || order.id, a.action);
                        }
                      }}
                      disabled={actionLoading !== null}
                      className={`flex-1 rounded-md py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                        a.variant === 'primary'
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : a.variant === 'danger'
                          ? 'bg-red-50 text-red-700 hover:bg-red-100'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {actionLoading === a.action ? '...' : a.label}
                    </button>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Desktop Table (Req 13.1) */}
      {!loading && filteredOrders.length > 0 && (
        <div className="hidden md:block overflow-hidden rounded-lg border bg-white shadow">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Order</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Customer</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Items</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Total</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Date</th>
                  <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredOrders.map((order) => {
                  const actions = getActions(order.status);
                  return (
                    <tr
                      key={order.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <span className="text-sm font-medium text-gray-900">{order.orderId || order.id}</span>
                        {order.channel && (
                          <span className={`ml-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-medium ${
                            order.channel === 'whatsapp' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
                          }`}>
                            {order.channel}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-sm text-gray-900">{getCustomerName(order)}</p>
                        {order.shippingAddress?.phone && (
                          <p className="text-xs text-gray-500">{order.shippingAddress.phone}</p>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-sm text-gray-900">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</p>
                        <p className="text-xs text-gray-500 truncate max-w-[200px]">{itemsSummary(order.items)}</p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <span className="text-sm font-medium text-gray-900">{formatCurrency(order.totalAmount || order.subtotal)}</span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <StatusPill status={order.status} domain="order" />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm text-gray-500">
                        {formatDate(order.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        {actions.length > 0 ? (
                          <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {actions.map((a) => (
                              <button
                                key={a.action}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (a.action === 'reject') {
                                    setSelectedOrder(order);
                                  } else {
                                    handleAction(order.orderId || order.id, a.action);
                                  }
                                }}
                                disabled={actionLoading !== null}
                                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                                  a.variant === 'primary'
                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                    : a.variant === 'danger'
                                    ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                              >
                                {actionLoading === a.action ? '...' : a.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedOrder(order); }}
                            className="text-xs text-indigo-600 hover:text-indigo-800"
                          >
                            View <ChevronRight className="inline h-3 w-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Order Detail Modal (Task 16.2) */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onAction={handleAction}
          actionLoading={actionLoading}
        />
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
