/**
 * Transform utilities for OpenSearch document ↔ SearchProductItem conversion.
 *
 * - `toOpenSearchDoc` converts a product object to a flat document for indexing.
 * - `fromOpenSearchHit` converts a raw OpenSearch hit `_source` back to a SearchProductItem.
 *
 * Together they guarantee round-trip preservation of key fields:
 * productId, productName, price, category, sellerId.
 *
 * Validates: Requirements 11.1
 */

import type { SearchProductItem } from './schemas';

/**
 * A product-like input object accepted by `toOpenSearchDoc`.
 * Mirrors the fields stored in DynamoDB and indexed in OpenSearch.
 */
export interface ProductInput {
  productId: string;
  productName: string;
  description?: string;
  category: string;
  tags?: string[];
  sellerId: string;
  status?: string;
  price: number;
  stockQuantity?: number;
  imageUrls?: string[];
  createdAt?: string;
}

/**
 * The flat document shape written to the OpenSearch `products` index.
 */
export interface OpenSearchProductDoc {
  productId: string;
  productName: string;
  description: string;
  category: string;
  tags: string[];
  sellerId: string;
  status: string;
  price: number;
  stockQuantity: number;
  imageUrls: string[];
  createdAt: string;
}

/**
 * Convert a product object to a flat OpenSearch document suitable for indexing.
 *
 * Defaults are applied for optional fields so the index mapping stays consistent.
 */
export function toOpenSearchDoc(product: ProductInput): OpenSearchProductDoc {
  return {
    productId: product.productId,
    productName: product.productName,
    description: product.description ?? '',
    category: product.category,
    tags: product.tags ?? [],
    sellerId: product.sellerId,
    status: product.status ?? 'Active',
    price: product.price,
    stockQuantity: product.stockQuantity ?? 0,
    imageUrls: product.imageUrls ?? [],
    createdAt: product.createdAt ?? '',
  };
}

/**
 * Convert a raw OpenSearch hit `_source` object to a `SearchProductItem`.
 *
 * Coerces each field to the expected type so callers always get a well-typed result,
 * even if the raw source has unexpected shapes.
 */
export function fromOpenSearchHit(
  hit: Record<string, unknown>,
): SearchProductItem {
  return {
    productId: String(hit.productId ?? ''),
    productName: String(hit.productName ?? ''),
    description: String(hit.description ?? ''),
    category: String(hit.category ?? ''),
    sellerId: String(hit.sellerId ?? ''),
    price: Number(hit.price ?? 0),
    stockQuantity: Number(hit.stockQuantity ?? 0),
    imageUrls: Array.isArray(hit.imageUrls)
      ? hit.imageUrls.map(String)
      : [],
    createdAt: String(hit.createdAt ?? ''),
  };
}
