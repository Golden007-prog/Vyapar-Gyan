/**
 * Search API Client
 *
 * Functions for OpenSearch-powered product search and autocomplete endpoints.
 * These endpoints use JWT auth when available (same pattern as api-catalog.ts).
 * Both functions enforce a 5-second timeout to avoid hanging in offline/demo mode.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.vyapargyan.com';

// --- Types ---

export interface SearchProductItem {
  productId: string;
  productName: string;
  description: string;
  category: string;
  sellerId: string;
  price: number;
  stockQuantity: number;
  imageUrls: string[];
  createdAt: string;
}

export interface SearchResponse {
  items: SearchProductItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AutocompleteSuggestion {
  name: string;
  category: string;
  productId: string;
}

export interface AutocompleteResponse {
  suggestions: AutocompleteSuggestion[];
}

export interface SearchProductsParams {
  q?: string;
  category?: string;
  seller?: string;
  page?: number;
  size?: number;
}

// --- Helpers ---

async function getOptionalToken(): Promise<string | null> {
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

async function searchFetch<T>(endpoint: string): Promise<T> {
  const token = await getOptionalToken();
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url, { headers, signal: controller.signal });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed: ${res.status}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- API Functions ---

export async function searchProducts(
  params: SearchProductsParams = {},
): Promise<SearchResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.seller) qs.set('seller', params.seller);
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.size !== undefined) qs.set('size', String(params.size));

  const query = qs.toString();
  return searchFetch<SearchResponse>(`/api/v1/search${query ? `?${query}` : ''}`);
}

export async function getAutocompleteSuggestions(
  q: string,
  limit?: number,
): Promise<AutocompleteResponse> {
  const qs = new URLSearchParams({ q });
  if (limit !== undefined) qs.set('limit', String(limit));
  return searchFetch<AutocompleteResponse>(`/api/v1/autocomplete?${qs.toString()}`);
}
