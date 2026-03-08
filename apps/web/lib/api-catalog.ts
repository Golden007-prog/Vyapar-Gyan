/**
 * Catalog API Client
 *
 * Functions for customer-facing catalog endpoints.
 * These endpoints support optional JWT — unauthenticated users can browse,
 * authenticated users get personalization context.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.vyapargyan.com';

// --- Types ---

export interface CatalogProduct {
  productId: string;
  name: string;
  description?: string;
  price: number;
  originalPrice?: number;
  categoryId?: string;
  sellerId: string;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  imageUrls: string[];
  createdAt: string;
}

export interface ProductDetail {
  productId: string;
  name: string;
  description?: string;
  price: number;
  originalPrice?: number;
  categoryId?: string;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  imageUrls: string[];
  seller: {
    sellerId: string;
    businessName?: string;
  };
  createdAt: string;
  updatedAt?: string;
}

export interface Category {
  categoryId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  displayOrder?: number;
}

export interface ListProductsParams {
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'popularity';
  limit?: number;
  cursor?: string;
}

// --- Helpers ---

async function getOptionalToken(): Promise<string | null> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() ?? null;
  } catch {
    return null;
  }
}

async function catalogFetch<T>(endpoint: string): Promise<T> {
  const token = await getOptionalToken();
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// --- API Functions ---

export async function listProducts(
  params: ListProductsParams = {},
): Promise<{ products: CatalogProduct[]; count: number }> {
  const qs = new URLSearchParams();
  if (params.category) qs.set('category', params.category);
  if (params.search) qs.set('search', params.search);
  if (params.minPrice !== undefined) qs.set('minPrice', String(params.minPrice));
  if (params.maxPrice !== undefined) qs.set('maxPrice', String(params.maxPrice));
  if (params.sort) qs.set('sort', params.sort);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);

  const query = qs.toString();
  return catalogFetch(`/api/v1/catalog/products${query ? `?${query}` : ''}`);
}

export async function getProduct(productId: string): Promise<{ product: ProductDetail }> {
  return catalogFetch(`/api/v1/catalog/products/${productId}`);
}

export async function listCategories(): Promise<{ categories: Category[] }> {
  return catalogFetch('/api/v1/catalog/categories');
}

export async function searchProducts(
  q: string,
  limit?: number,
): Promise<{ query: string; products: CatalogProduct[]; count: number }> {
  const qs = new URLSearchParams({ q });
  if (limit) qs.set('limit', String(limit));
  return catalogFetch(`/api/v1/catalog/search?${qs.toString()}`);
}
