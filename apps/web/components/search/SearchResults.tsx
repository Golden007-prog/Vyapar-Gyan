'use client';

import type { SearchProductItem } from '@/lib/api-search';
import { Skeleton, ProductCardSkeleton } from '@/components/ui/Skeleton';

export interface SearchResultsProps {
  items: SearchProductItem[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  onPageChange: (page: number) => void;
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function ProductCard({ product }: { product: SearchProductItem }) {
  const imgSrc = product.imageUrls?.[0];

  return (
    <div className="overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="aspect-square w-full bg-gray-100 flex items-center justify-center">
        {imgSrc ? (
          <img
            src={imgSrc}
            alt={product.productName}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-3xl text-gray-300">📦</span>
        )}
      </div>
      <div className="p-3 space-y-1">
        <p className="text-sm font-medium text-gray-900 truncate">{product.productName}</p>
        <span className="inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
          {product.category}
        </span>
        <p className="text-sm font-semibold text-gray-900">{formatPrice(product.price)}</p>
      </div>
    </div>
  );
}

function LoadingSkeleton({ count }: { count: number }) {
  return (
    <>
      <div className="mb-4">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </>
  );
}

export default function SearchResults({
  items,
  total,
  page,
  pageSize,
  isLoading,
  onPageChange,
}: SearchResultsProps) {
  const hasMore = page * pageSize < total;

  if (isLoading && items.length === 0) {
    return <LoadingSkeleton count={8} />;
  }

  if (!isLoading && items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
        <span className="mx-auto mb-4 block text-4xl">🔍</span>
        <h3 className="text-lg font-medium text-gray-900">No products found</h3>
        <p className="mt-2 text-sm text-gray-600">
          Try different search terms or adjust your filters.
        </p>
      </div>
    );
  }

  const showingEnd = Math.min(page * pageSize, total);

  return (
    <div>
      <p className="mb-4 text-sm text-gray-600">
        Showing {showingEnd} of {total} result{total !== 1 ? 's' : ''}
        {page > 1 && ` · Page ${page}`}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((item) => (
          <ProductCard key={item.productId} product={item} />
        ))}
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}
