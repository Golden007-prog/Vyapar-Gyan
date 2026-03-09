/**
 * Demo-safe local cart store
 *
 * Persists cart in sessionStorage scoped by sellerId.
 * Used when the backend API is unavailable (demo / GitHub Pages).
 */

import type { Cart, CartItem } from './api-cart';

const CART_KEY = 'vyapargyan_demo_cart';

function storeKey(sellerId: string): string {
  return `${CART_KEY}_${sellerId}`;
}

function emptyCart(): Cart {
  return { items: [], subtotal: 0, itemCount: 0, cartVersion: 1, updatedAt: new Date().toISOString() };
}

export function getDemoCart(sellerId: string): Cart {
  try {
    const raw = sessionStorage.getItem(storeKey(sellerId));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return emptyCart();
}

export function saveDemoCart(sellerId: string, cart: Cart): void {
  try {
    sessionStorage.setItem(storeKey(sellerId), JSON.stringify({ ...cart, updatedAt: new Date().toISOString() }));
  } catch { /* ignore */ }
}

export function addDemoItem(sellerId: string, item: CartItem): Cart {
  const cart = getDemoCart(sellerId);
  const existing = cart.items.find(i => i.productId === item.productId);
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    cart.items.push({ ...item });
  }
  cart.subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  cart.itemCount = cart.items.reduce((c, i) => c + i.quantity, 0);
  cart.cartVersion += 1;
  saveDemoCart(sellerId, cart);
  return cart;
}

export function updateDemoItem(sellerId: string, productId: string, quantity: number): Cart {
  const cart = getDemoCart(sellerId);
  cart.items = cart.items.map(i => i.productId === productId ? { ...i, quantity } : i);
  cart.subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  cart.itemCount = cart.items.reduce((c, i) => c + i.quantity, 0);
  cart.cartVersion += 1;
  saveDemoCart(sellerId, cart);
  return cart;
}

export function removeDemoItem(sellerId: string, productId: string): Cart {
  const cart = getDemoCart(sellerId);
  cart.items = cart.items.filter(i => i.productId !== productId);
  cart.subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  cart.itemCount = cart.items.reduce((c, i) => c + i.quantity, 0);
  cart.cartVersion += 1;
  saveDemoCart(sellerId, cart);
  return cart;
}

export function clearDemoCart(sellerId: string): Cart {
  const cart = emptyCart();
  saveDemoCart(sellerId, cart);
  return cart;
}
