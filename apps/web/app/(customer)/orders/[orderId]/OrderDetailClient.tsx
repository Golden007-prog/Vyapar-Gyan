'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  CreditCard,
  XCircle,
  Shield,
  AlertTriangle,
} from 'lucide-react';
import { getOrder, cancelOrder, type Order, type OrderStatus } from '@/lib/api-orders';
import StatusPill from '@/components/ui/StatusPill';
import OrderTimeline, { type TimelineEvent } from '@/components/ui/OrderTimeline';
import { WebSocketClient, type WebSocketEvent } from '@/lib/websocket-client';

// --- Razorpay type declaration ---
declare global {
  interface Window {
    Razorpay: any;
  }
}

const RAZORPAY_KEY = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_demo';

// --- Status helpers ---

/** Map new order statuses to timeline steps */
function buildTimelineEvents(order: Order): { events: TimelineEvent[]; currentIndex: number } {
  // If we have a server-provided timeline, use it
  if (order.timeline && order.timeline.length > 0) {
    const events: TimelineEvent[] = order.timeline.map((entry) => ({
      key: entry.status,
      label: getStatusLabel(entry.status),
      description: entry.note || getStatusDescription(entry.status, entry.actor),
      timestamp: entry.timestamp,
    }));
    return { events, currentIndex: events.length - 1 };
  }

  // Build default timeline from status
  const isTerminal = ['rejected', 'cancelled', 'expired', 'payment_failed'].includes(order.status);

  if (isTerminal) {
    // Show abbreviated timeline ending at the terminal status
    const steps: TimelineEvent[] = [
      { key: 'pending_seller_confirmation', label: 'Order Placed', description: 'Waiting for seller confirmation', timestamp: order.createdAt },
    ];
    if (['cancelled', 'rejected'].includes(order.status) && order.confirmedAt) {
      steps.push({ key: 'confirmed', label: 'Confirmed', description: 'Seller confirmed', timestamp: order.confirmedAt });
    }
    steps.push({
      key: order.status,
      label: getStatusLabel(order.status),
      description: order.rejectionReason || getStatusDescription(order.status),
      timestamp: order.updatedAt,
    });
    return { events: steps, currentIndex: steps.length - 1 };
  }

  // Normal flow timeline
  const allSteps: { key: string; label: string; description: string; timestampField?: keyof Order }[] = [
    { key: 'pending_seller_confirmation', label: 'Order Placed', description: 'Waiting for seller confirmation', timestampField: 'createdAt' },
    { key: 'confirmed', label: 'Confirmed', description: 'Seller confirmed your order', timestampField: 'confirmedAt' },
    { key: 'payment_pending', label: 'Payment Pending', description: 'Complete payment to proceed' },
    { key: 'paid', label: 'Paid', description: 'Payment received', timestampField: 'paidAt' },
    { key: 'preparing', label: 'Preparing', description: 'Seller is preparing your order' },
    { key: 'shipped', label: 'Shipped', description: 'On the way to you' },
    { key: 'delivered', label: 'Delivered', description: 'Order delivered', timestampField: 'deliveredAt' },
  ];

  const statusOrder = allSteps.map((s) => s.key);
  const currentIdx = statusOrder.indexOf(order.status);

  const events: TimelineEvent[] = allSteps.map((step) => ({
    key: step.key,
    label: step.label,
    description: step.description,
    timestamp: step.timestampField ? (order[step.timestampField] as string | undefined) : undefined,
  }));

  return { events, currentIndex: currentIdx >= 0 ? currentIdx : 0 };
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending_seller_confirmation: 'Order Placed',
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
    // Legacy
    PENDING_PAYMENT: 'Pending',
    PAID: 'Paid',
    PROCESSING: 'Confirmed',
    SHIPPED: 'Shipped',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
  };
  return labels[status] || status;
}

function getStatusDescription(status: string, actor?: string): string {
  const desc: Record<string, string> = {
    pending_seller_confirmation: 'Waiting for seller confirmation',
    confirmed: 'Seller confirmed your order',
    payment_pending: 'Complete payment to proceed',
    paid: 'Payment received',
    preparing: 'Seller is preparing your order',
    shipped: 'On the way to you',
    delivered: 'Order delivered',
    completed: 'Order completed',
    rejected: 'Seller could not fulfill this order',
    cancelled: 'Order was cancelled',
    payment_failed: 'Payment attempt failed',
    expired: 'Payment link expired',
  };
  let text = desc[status] || '';
  if (actor) text += ` (by ${actor})`;
  return text;
}

const CANCELLABLE_STATUSES: OrderStatus[] = ['pending_seller_confirmation', 'confirmed'];
const PAYABLE_STATUS: OrderStatus = 'payment_pending';

// --- Component ---

export default function OrderDetailClient() {
  const params = useParams();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [actionError, setActionError] = useState('');
  const wsRef = useRef<WebSocketClient | null>(null);

  // --- Fetch order ---
  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    getOrder(orderId)
      .then((res) => setOrder(res.order))
      .catch(() => {
        // Demo fallback
        setOrder({
          id: orderId, orderId, customerId: 'demo', sellerId: 'demo',
          sellerName: 'Dragon Store',
          items: [
            { productId: 'p1', sellerId: 's1', name: 'Amul Butter 500g', price: 280, quantity: 1 },
            { productId: 'p2', sellerId: 's1', name: 'Surf Excel 1kg', price: 199, quantity: 2 },
          ],
          subtotal: 678, commissionAmount: 68, totalAmount: 678,
          status: 'pending_seller_confirmation',
          channel: 'web',
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          updatedAt: new Date().toISOString(),
        });
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  // --- WebSocket real-time updates ---
  useEffect(() => {
    let client: WebSocketClient | null = null;

    async function connectWs() {
      try {
        const { fetchAuthSession } = await import('aws-amplify/auth');
        const session = await fetchAuthSession();
        const token = session.tokens?.accessToken?.toString();
        if (!token) return;

        client = new WebSocketClient();
        wsRef.current = client;

        client.onMessage((event: WebSocketEvent) => {
          // Listen for order status updates
          if (
            (event.action === 'order_status_update' || event.action === 'order.status_changed') &&
            (event.orderId === orderId || event.order_id === orderId)
          ) {
            const newStatus = (event.newStatus || event.status) as OrderStatus | undefined;
            if (newStatus) {
              setOrder((prev) => prev ? { ...prev, status: newStatus, updatedAt: new Date().toISOString() } : prev);
            }
            // If full order data is pushed, use it
            if (event.order) {
              setOrder(event.order as Order);
            }
          }
        });

        client.connect(token);
      } catch {
        // WebSocket not available — page still works with manual refresh
      }
    }

    connectWs();

    return () => {
      if (client) client.disconnect();
      wsRef.current = null;
    };
  }, [orderId]);

  // --- Cancel order ---
  const handleCancel = useCallback(async () => {
    if (!order || cancelling) return;
    setCancelling(true);
    setActionError('');
    try {
      const res = await cancelOrder(order.orderId);
      setOrder(res.order);
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel order');
    } finally {
      setCancelling(false);
    }
  }, [order, cancelling]);

  // --- Pay Now with Razorpay ---
  const handlePayNow = useCallback(async () => {
    if (!order || paying) return;
    setPaying(true);
    setActionError('');

    // Load Razorpay script if not loaded
    if (!document.getElementById('razorpay-script')) {
      const script = document.createElement('script');
      script.id = 'razorpay-script';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      document.body.appendChild(script);
      await new Promise((resolve) => { script.onload = resolve; });
    }

    if (order.paymentLinkUrl) {
      // If we have a payment link URL, open it directly
      window.open(order.paymentLinkUrl, '_blank');
      setPaying(false);
      return;
    }

    // Embedded Razorpay checkout
    if (typeof window.Razorpay === 'function') {
      const options = {
        key: RAZORPAY_KEY,
        amount: order.totalAmount * 100,
        currency: 'INR',
        name: 'VyaparGyan',
        description: `Order ${order.orderId}`,
        handler: () => {
          // Payment success — refresh order
          setPaying(false);
          getOrder(order.orderId)
            .then((res) => setOrder(res.order))
            .catch(() => setOrder((prev) => prev ? { ...prev, status: 'paid' as OrderStatus } : prev));
        },
        prefill: { contact: '' },
        notes: { order_id: order.orderId },
        theme: { color: '#4F46E5' },
        modal: { ondismiss: () => setPaying(false) },
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } else {
      // Fallback: open payment link URL if available
      setActionError('Payment widget unavailable. Please try again.');
      setPaying(false);
    }
  }, [order, paying]);

  // --- Render ---

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Link href="/orders" className="flex items-center gap-1 text-sm text-indigo-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to Orders
        </Link>
        <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error || 'Order not found'}
        </div>
      </div>
    );
  }

  const date = new Date(order.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const { events: timelineEvents, currentIndex } = buildTimelineEvents(order);
  const canCancel = CANCELLABLE_STATUSES.includes(order.status);
  const canPay = order.status === PAYABLE_STATUS;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/orders" className="flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Orders
      </Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{order.orderId}</h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Placed on {date}
            {order.sellerName && <> · {order.sellerName}</>}
          </p>
        </div>
        <StatusPill status={order.status} domain="order" />
      </div>

      {/* Action error */}
      {actionError && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {actionError}
        </div>
      )}

      {/* Rejection reason */}
      {order.status === 'rejected' && order.rejectionReason && (
        <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          Reason: {order.rejectionReason}
        </div>
      )}

      {/* Pay Now button */}
      {canPay && (
        <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-3 text-sm text-amber-800">
            Your order has been confirmed by the seller. Complete payment to proceed.
          </p>
          <button
            onClick={handlePayNow}
            disabled={paying}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {paying ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
            ) : (
              <><CreditCard className="h-4 w-4" /> Pay ₹{order.totalAmount.toLocaleString('en-IN')}</>
            )}
          </button>
          <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-gray-400">
            <Shield className="h-3 w-3" />
            <span>Secured by Razorpay</span>
          </div>
        </section>
      )}

      {/* Order Timeline */}
      <section className="mt-4 rounded-lg border bg-white p-4">
        <h2 className="mb-4 text-sm font-semibold text-gray-800">Order Progress</h2>
        <OrderTimeline events={timelineEvents} currentIndex={currentIndex} />
      </section>

      {/* Items */}
      <section className="mt-4 rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Items</h2>
        <div className="divide-y">
          {order.items.map((item, idx) => (
            <div key={`${item.productId}-${idx}`} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                <p className="text-xs text-gray-500">
                  Qty: {item.quantity} × ₹{item.price.toLocaleString('en-IN')}
                </p>
              </div>
              <span className="ml-4 text-sm font-medium text-gray-900">
                ₹{(item.price * item.quantity).toLocaleString('en-IN')}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Payment Summary */}
      <section className="mt-4 rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Payment Summary</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Subtotal</span><span>₹{order.subtotal.toLocaleString('en-IN')}</span>
          </div>
          {order.commissionAmount > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Platform fee</span><span>₹{order.commissionAmount.toLocaleString('en-IN')}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-2 font-semibold text-gray-900">
            <span>Total</span><span>₹{order.totalAmount.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </section>

      {/* Shipping Address */}
      {order.shippingAddress && (
        <section className="mt-4 rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">Shipping Address</h2>
          <div className="text-sm text-gray-600">
            <p className="font-medium text-gray-900">{order.shippingAddress.name}</p>
            <p>{order.shippingAddress.addressLine1}</p>
            <p>{order.shippingAddress.city}, {order.shippingAddress.state} — {order.shippingAddress.pincode}</p>
            <p className="mt-1 text-xs text-gray-500">Phone: {order.shippingAddress.phone}</p>
          </div>
        </section>
      )}

      {/* Cancel Order button */}
      {canCancel && (
        <section className="mt-4">
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white py-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            {cancelling ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Cancelling...</>
            ) : (
              <><XCircle className="h-4 w-4" /> Cancel Order</>
            )}
          </button>
        </section>
      )}

      <div className="mt-6 text-center">
        <Link href="/chat" className="text-sm text-indigo-600 hover:underline">
          Need help? Chat with us
        </Link>
      </div>
    </div>
  );
}
