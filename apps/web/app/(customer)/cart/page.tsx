'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ShoppingCart,
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  ArrowRight,
  Store,
} from 'lucide-react';
import { useStore } from '@/lib/store-context';
import { getDemoCart, updateDemoItem, removeDemoItem } from '@/lib/demo-cart';
import type { Cart, CartItem } from '@/lib/api-cart';

const GST_RATE = 0.18;

export default function CartPage() {
  const { selectedStore } = useStore();
  const sellerId = selectedStore?.sellerId || 'seller-dragon-001';
  const storeName = selectedStore?.businessName || 'Dragon Store';

  const [cart, setCart] = useState<Cart | null>(null);

  useEffect(() => {
    setCart(getDemoCart(sellerId));
  }, [sellerId]);

  const handleUpdate = useCallback((productId: string, quantity: number) => {
    setCart(updateDemoItem(sellerId, productId, quantity));
  }, [sellerId]);

  const handleRemove = useCallback((productId: string) => {
    setCart(removeDemoItem(sellerId, productId));
  }, [sellerId]);

  const items = cart?.items ?? [];
  const subtotal = cart?.subtotal ?? 0;
  const gst = Math.round(subtotal * GST_RATE);
  const total = subtotal + gst;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <ShoppingCart className="h-5 w-5 text-indigo-600" />
        <h1 className="text-lg font-semibold text-gray-900">Your Cart</h1>
      </div>

      <div className="mb-4 flex items-center gap-2 rounded-lg bg-indigo-50 px-4 py-2 text-sm text-indigo-700">
        <Store className="h-4 w-4" />
        <span>Shopping at <span className="font-medium">{storeName}</span></span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ShoppingBag className="h-16 w-16 text-gray-300" />
          <p className="mt-4 text-lg font-medium text-gray-600">Your cart is empty</p>
          <p className="mt-1 text-sm text-gray-400">Browse the catalog to add products</p>
          <Link
            href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/catalog`}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Browse Catalog
          </Link>
        </div>
      ) : (
        <>
          {/* Items */}
          <div className="divide-y rounded-lg border bg-white shadow-sm">
            {items.map((item) => (
              <CartItemRow
                key={item.productId}
                item={item}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
              />
            ))}
          </div>

          {/* Summary */}
          <div className="mt-6 rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-800">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal ({cart?.itemCount} items)</span>
                <span>₹{subtotal.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>GST (18%)</span>
                <span>₹{gst.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold text-gray-900">
                <span>Total</span>
                <span>₹{total.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <Link
              href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/checkout`}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Proceed to Checkout
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function CartItemRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: CartItem;
  onUpdate: (pid: string, qty: number) => void;
  onRemove: (pid: string) => void;
}) {
  return (
    <div className="flex gap-4 p-4">
      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-2xl">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.name} className="h-full w-full rounded-lg object-cover" />
        ) : (
          '📦'
        )}
      </div>
      <div className="flex flex-1 flex-col justify-between">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">{item.name}</p>
            <p className="mt-0.5 text-xs text-gray-500">₹{item.price} each</p>
          </div>
          <button
            onClick={() => onRemove(item.productId)}
            className="text-gray-400 hover:text-red-500"
            aria-label={`Remove ${item.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onUpdate(item.productId, Math.max(1, item.quantity - 1))}
              disabled={item.quantity <= 1}
              className="rounded-md border p-1 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
              aria-label="Decrease quantity"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[28px] text-center text-sm font-medium">{item.quantity}</span>
            <button
              onClick={() => onUpdate(item.productId, item.quantity + 1)}
              disabled={item.quantity >= 99}
              className="rounded-md border p-1 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
              aria-label="Increase quantity"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <span className="text-sm font-semibold text-gray-900">
            ₹{(item.price * item.quantity).toLocaleString('en-IN')}
          </span>
        </div>
      </div>
    </div>
  );
}
