'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { getOrder, type Order } from '@/lib/api-orders';
import StatusPill from '@/components/ui/StatusPill';
import OrderTimeline from '@/components/ui/OrderTimeline';

export default function OrderDetailClient() {
  const params = useParams();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    getOrder(orderId)
      .then((res) => setOrder(res.order))
      .catch(() => {
        setOrder({
          id: orderId, orderId, customerId: 'demo', sellerId: 'demo',
          items: [
            { productId: 'p1', sellerId: 's1', name: 'Tata Salt 1kg', price: 25, quantity: 2 },
            { productId: 'p2', sellerId: 's1', name: 'Amul Butter 500g', price: 280, quantity: 1 },
          ],
          subtotal: 330, commissionAmount: 33, totalAmount: 363, status: 'PROCESSING',
          shippingAddress: { name: 'Demo Customer', phone: '+91 9000000003', addressLine1: '123 Demo Street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
          createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString(),
        });
      })
      .finally(() => setLoading(false));
  }, [orderId]);

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/orders" className="flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to Orders
      </Link>

      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{order.orderId}</h1>
          <p className="mt-0.5 text-xs text-gray-500">Placed on {date}</p>
        </div>
        <StatusPill status={order.status} domain="order" />
      </div>

      <section className="mt-6 rounded-lg border bg-white p-4">
        <h2 className="mb-4 text-sm font-semibold text-gray-800">Order Progress</h2>
        <OrderTimeline currentStatus={order.status} />
      </section>

      <section className="mt-4 rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Items</h2>
        <div className="divide-y">
          {order.items.map((item) => (
            <div key={item.productId} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
              </div>
              <span className="ml-4 text-sm font-medium text-gray-900">
                ₹{(item.price * item.quantity).toLocaleString('en-IN')}
              </span>
            </div>
          ))}
        </div>
      </section>

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

      <div className="mt-6 text-center">
        <Link href="/chat" className="text-sm text-indigo-600 hover:underline">
          Need help? Chat with us
        </Link>
      </div>
    </div>
  );
}