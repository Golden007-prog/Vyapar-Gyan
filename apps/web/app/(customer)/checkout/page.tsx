'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  Store,
  ShoppingBag,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Shield,
} from 'lucide-react';
import { useStore } from '@/lib/store-context';
import { getDemoCart, clearDemoCart } from '@/lib/demo-cart';
import type { Cart } from '@/lib/api-cart';

const GST_RATE = 0.18;
const RAZORPAY_KEY = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_test_demo';

declare global {
  interface Window {
    Razorpay: any;
  }
}

export default function CheckoutPage() {
  const router = useRouter();
  const { selectedStore } = useStore();
  const sellerId = selectedStore?.sellerId || 'seller-dragon-001';
  const storeName = selectedStore?.businessName || 'Dragon Store';

  const [cart, setCart] = useState<Cart | null>(null);
  const [paying, setPaying] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState('');

  // Customer details for demo
  const [name, setName] = useState('Demo Customer');
  const [phone, setPhone] = useState('+91 7001124396');
  const [address, setAddress] = useState('123 Demo Street, Mumbai, Maharashtra 400001');

  useEffect(() => {
    setCart(getDemoCart(sellerId));
  }, [sellerId]);

  // Load Razorpay script
  useEffect(() => {
    if (document.getElementById('razorpay-script')) return;
    const script = document.createElement('script');
    script.id = 'razorpay-script';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const items = cart?.items ?? [];
  const subtotal = cart?.subtotal ?? 0;
  const gst = Math.round(subtotal * GST_RATE);
  const total = subtotal + gst;

  const handlePayment = useCallback(async () => {
    if (items.length === 0) return;
    setPaying(true);
    setError('');

    const generatedOrderId = `VG-${Date.now().toString(36).toUpperCase()}`;

    // Try to create order via backend first
    let razorpayOrderId: string | undefined;
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL;
      if (apiBase) {
        const res = await fetch(`${apiBase}/api/v1/payments/create-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: total, orderId: generatedOrderId }),
        });
        if (res.ok) {
          const data = await res.json();
          razorpayOrderId = data.razorpayOrderId;
        }
      }
    } catch { /* proceed with demo flow */ }

    // If Razorpay SDK is loaded and we have a key, open checkout
    if (typeof window.Razorpay === 'function' && RAZORPAY_KEY !== 'rzp_test_demo') {
      const options = {
        key: RAZORPAY_KEY,
        amount: total * 100, // paise
        currency: 'INR',
        name: 'VyaparGyan',
        description: `Order from ${storeName}`,
        order_id: razorpayOrderId,
        handler: function () {
          // Payment success
          clearDemoCart(sellerId);
          setOrderId(generatedOrderId);
          setOrderPlaced(true);
          setPaying(false);
        },
        prefill: {
          name: name,
          contact: phone.replace(/\s/g, ''),
        },
        notes: {
          order_id: generatedOrderId,
          store: storeName,
        },
        theme: { color: '#4F46E5' },
        modal: {
          ondismiss: function () {
            setPaying(false);
          },
        },
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } else {
      // Demo fallback: simulate successful payment after short delay
      await new Promise(r => setTimeout(r, 1500));
      clearDemoCart(sellerId);
      setOrderId(generatedOrderId);
      setOrderPlaced(true);
      setPaying(false);
    }
  }, [items, total, sellerId, storeName, name, phone]);

  // Order confirmation view
  if (orderPlaced) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-gray-900">Order Placed!</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your order <span className="font-mono font-medium text-indigo-600">{orderId}</span> has been confirmed.
        </p>
        <div className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
          <p>Payment of <span className="font-semibold">₹{total.toLocaleString('en-IN')}</span> received</p>
          <p className="mt-1">Store: {storeName}</p>
        </div>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href={`${basePath}/orders`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            View Orders
          </Link>
          <Link
            href={`${basePath}/catalog`}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-6 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            Continue Shopping
          </Link>
        </div>
      </div>
    );
  }

  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

  // Empty cart redirect
  if (cart && items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <ShoppingBag className="mx-auto h-16 w-16 text-gray-300" />
        <p className="mt-4 text-lg font-medium text-gray-600">Your cart is empty</p>
        <Link
          href={`${basePath}/catalog`}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          Browse Catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link href={`${basePath}/cart`} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600">
        <ArrowLeft className="h-4 w-4" /> Back to Cart
      </Link>

      <h1 className="mb-6 text-lg font-semibold text-gray-900">Checkout</h1>

      <div className="grid gap-6 md:grid-cols-5">
        {/* Left: Details */}
        <div className="space-y-5 md:col-span-3">
          {/* Store */}
          <div className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Store className="h-4 w-4 text-indigo-600" />
              <span>Ordering from <span className="font-medium">{storeName}</span></span>
            </div>
          </div>

          {/* Customer Details */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">Delivery Details</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Phone</label>
                <input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Address</label>
                <textarea
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Order Summary */}
        <div className="md:col-span-2">
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-gray-800">Order Summary</h2>
            <div className="max-h-48 space-y-3 overflow-y-auto">
              {items.map(item => (
                <div key={item.productId} className="flex justify-between text-sm">
                  <span className="text-gray-600">{item.name} × {item.quantity}</span>
                  <span className="font-medium text-gray-900">₹{(item.price * item.quantity).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 border-t pt-3 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span>
                <span>₹{subtotal.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>GST (18%)</span>
                <span>₹{gst.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-bold text-gray-900">
                <span>Total</span>
                <span>₹{total.toLocaleString('en-IN')}</span>
              </div>
            </div>

            {error && (
              <p className="mt-3 text-xs text-red-600">{error}</p>
            )}

            <button
              onClick={handlePayment}
              disabled={paying || items.length === 0}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {paying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="h-4 w-4" />
                  Pay ₹{total.toLocaleString('en-IN')}
                </>
              )}
            </button>

            <div className="mt-3 flex items-center justify-center gap-1 text-[10px] text-gray-400">
              <Shield className="h-3 w-3" />
              <span>Secured by Razorpay · Test Mode</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
