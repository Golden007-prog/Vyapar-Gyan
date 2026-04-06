/**
 * Cart API Client
 *
 * Functions for cart endpoints (JWT-protected).
 * Supports optimistic updates — callers can apply changes locally
 * before the server responds, then reconcile on success/failure.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.vyapargyan.com';

// --- Types ---

export interface CartItem {
  productId: string;
  sellerId: string;
  name: string;
  price: number;
  quantity: number;
  thumbnailUrl?: string;
}

export interface Cart {
  items: CartItem[];
  subtotal: number;
  itemCount: number;
  cartVersion: number;
  updatedAt: string;
}

export interface AddItemPayload {
  productId: string;
  quantity: number;
}

export interface AddItemResponse {
  cart: Cart;
  addedItem: CartItem;
}

export interface UpdateItemResponse {
  cart: Cart;
}

export interface RemoveItemResponse {
  cart: Cart;
}

export interface CheckoutResponse {
  orderId: string;
  paymentLink?: string;
  total: number;
}

export interface CartConflictError {
  error: string;
  currentVersion: number;
}

// --- Helpers ---

async function getAuthToken(): Promise<string | null> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await Promise.race([
      fetchAuthSession(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Auth timeout')), 2000)),
    ]);
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

async function cartFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, { ...options, headers: { ...headers, ...options?.headers }, signal: controller.signal });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(err.error || `Cart request failed: ${res.status}`) as Error & {
        status: number;
        currentVersion?: number;
      };
      error.status = res.status;
      if (res.status === 409 && err.currentVersion) {
        error.currentVersion = err.currentVersion;
      }
      throw error;
    }

    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- Optimistic Update Helpers ---

/** Apply an optimistic add-item to a local cart copy */
export function optimisticAddItem(cart: Cart, item: CartItem): Cart {
  const existing = cart.items.find((i) => i.productId === item.productId);
  const items = existing
    ? cart.items.map((i) =>
        i.productId === item.productId ? { ...i, quantity: i.quantity + item.quantity } : i,
      )
    : [...cart.items, item];
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return { ...cart, items, subtotal, itemCount: items.reduce((c, i) => c + i.quantity, 0) };
}

/** Apply an optimistic quantity update to a local cart copy */
export function optimisticUpdateItem(cart: Cart, productId: string, quantity: number): Cart {
  const items = cart.items.map((i) => (i.productId === productId ? { ...i, quantity } : i));
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return { ...cart, items, subtotal, itemCount: items.reduce((c, i) => c + i.quantity, 0) };
}

/** Apply an optimistic remove to a local cart copy */
export function optimisticRemoveItem(cart: Cart, productId: string): Cart {
  const items = cart.items.filter((i) => i.productId !== productId);
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  return { ...cart, items, subtotal, itemCount: items.reduce((c, i) => c + i.quantity, 0) };
}

// --- API Functions ---

/** Get current cart state */
export async function getCart(): Promise<{ cart: Cart }> {
  return cartFetch<{ cart: Cart }>('/api/v1/cart');
}

/** Add item to cart */
export async function addItem(payload: AddItemPayload): Promise<AddItemResponse> {
  return cartFetch<AddItemResponse>('/api/v1/cart/items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Update item quantity */
export async function updateItem(productId: string, quantity: number): Promise<UpdateItemResponse> {
  return cartFetch<UpdateItemResponse>(`/api/v1/cart/items/${productId}`, {
    method: 'PUT',
    body: JSON.stringify({ quantity }),
  });
}

/** Remove item from cart */
export async function removeItem(productId: string): Promise<RemoveItemResponse> {
  return cartFetch<RemoveItemResponse>(`/api/v1/cart/items/${productId}`, {
    method: 'DELETE',
  });
}

/** Validate stock and proceed to checkout */
export async function checkout(): Promise<CheckoutResponse> {
  return cartFetch<CheckoutResponse>('/api/v1/cart/checkout', { method: 'POST' });
}
