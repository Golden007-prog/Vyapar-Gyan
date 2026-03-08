'use client';

import { useState } from 'react';
import {
  ShoppingCart,
  X,
  Plus,
  Minus,
  Trash2,
  Loader2,
  ShoppingBag,
} from 'lucide-react';
import type { Cart, CartItem } from '@/lib/api-cart';

const GST_RATE = 0.18; // 18% GST

// --- Sub-components ---

function EmptyCartState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
      <ShoppingBag className="h-12 w-12 text-gray-300" />
      <p className="mt-3 text-sm font-medium text-gray-600">Your cart is empty</p>
      <p className="mt-1 text-xs text-gray-400">
        Browse the catalog or ask a seller to add items
      </p>
    </div>
  );
}

interface CartItemRowProps {
  item: CartItem;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  disabled?: boolean;
}

function CartItemRow({ item, onUpdateQuantity, onRemove, disabled }: CartItemRowProps) {
  return (
    <div className="flex gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
      {/* Thumbnail */}
      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg text-gray-300">
            📦
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex flex-1 flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium text-gray-800">{item.name}</p>
          <button
            onClick={() => onRemove(item.productId)}
            disabled={disabled}
            className="flex-shrink-0 text-gray-400 hover:text-red-500 disabled:opacity-40"
            aria-label={`Remove ${item.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between">
          {/* Quantity selector */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onUpdateQuantity(item.productId, Math.max(1, item.quantity - 1))}
              disabled={disabled || item.quantity <= 1}
              className="rounded-md border border-gray-300 p-1 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
              aria-label="Decrease quantity"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="min-w-[24px] text-center text-sm font-medium">{item.quantity}</span>
            <button
              onClick={() => onUpdateQuantity(item.productId, item.quantity + 1)}
              disabled={disabled || item.quantity >= 99}
              className="rounded-md border border-gray-300 p-1 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
              aria-label="Increase quantity"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {/* Line total */}
          <span className="text-sm font-semibold text-gray-900">
            ₹{(item.price * item.quantity).toLocaleString('en-IN')}
          </span>
        </div>
      </div>
    </div>
  );
}


interface CartSummaryProps {
  subtotal: number;
}

function CartSummary({ subtotal }: CartSummaryProps) {
  const gst = Math.round(subtotal * GST_RATE);
  const total = subtotal + gst;

  return (
    <div className="space-y-1.5 border-t px-4 py-3 text-sm">
      <div className="flex justify-between text-gray-500">
        <span>Subtotal</span>
        <span>₹{subtotal.toLocaleString('en-IN')}</span>
      </div>
      <div className="flex justify-between text-gray-500">
        <span>GST (18%)</span>
        <span>₹{gst.toLocaleString('en-IN')}</span>
      </div>
      <div className="flex justify-between border-t pt-1.5 font-semibold text-gray-900">
        <span>Total</span>
        <span>₹{total.toLocaleString('en-IN')}</span>
      </div>
    </div>
  );
}

interface CheckoutButtonProps {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

function CheckoutButton({ onClick, loading, disabled }: CheckoutButtonProps) {
  return (
    <div className="px-4 pb-4">
      <button
        onClick={onClick}
        disabled={disabled || loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          'Proceed to Checkout'
        )}
      </button>
    </div>
  );
}

// --- Main Component ---

interface CartSidePanelProps {
  cart: Cart | null;
  open: boolean;
  onToggle: () => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
  checkingOut?: boolean;
}

export default function CartSidePanel({
  cart,
  open,
  onToggle,
  onUpdateQuantity,
  onRemove,
  onCheckout,
  checkingOut,
}: CartSidePanelProps) {
  const itemCount = cart?.itemCount ?? 0;

  return (
    <>
      {/* Toggle button (visible when panel is closed) */}
      {!open && (
        <button
          onClick={onToggle}
          className="fixed bottom-20 right-4 z-20 flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-indigo-700 md:hidden"
          aria-label="Open cart"
        >
          <ShoppingCart className="h-4 w-4" />
          {itemCount > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-indigo-600">
              {itemCount}
            </span>
          )}
        </button>
      )}

      {/* Side panel */}
      <div
        className={`flex flex-col border-l bg-white transition-all duration-300 ${
          open ? 'w-80' : 'w-0 overflow-hidden'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-gray-800">
              Cart{itemCount > 0 && ` (${itemCount})`}
            </h2>
          </div>
          <button
            onClick={onToggle}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close cart"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        {!cart || cart.items.length === 0 ? (
          <EmptyCartState />
        ) : (
          <>
            {/* Items list */}
            <div className="flex-1 overflow-y-auto">
              {cart.items.map((item) => (
                <CartItemRow
                  key={item.productId}
                  item={item}
                  onUpdateQuantity={onUpdateQuantity}
                  onRemove={onRemove}
                  disabled={checkingOut}
                />
              ))}
            </div>

            {/* Summary + Checkout */}
            <CartSummary subtotal={cart.subtotal} />
            <CheckoutButton
              onClick={onCheckout}
              loading={checkingOut}
              disabled={cart.items.length === 0}
            />
          </>
        )}
      </div>
    </>
  );
}
