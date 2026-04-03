'use client';

import { useRouter } from 'next/navigation';
import { Package } from 'lucide-react';

export interface Product {
  id: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  price: number;
  stockQuantity: number;
  stockAddedDate: string;
  imageUrls: string[];
  isActive: boolean;
  sku?: string;
  brand?: string;
  variant?: string;
}

export interface MobileProductCardProps {
  product: Product;
  onTap?: (product: Product) => void;
}

function formatPrice(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function getStockDays(stockAddedDate: string): number {
  return Math.max(0, Math.ceil(Math.abs(Date.now() - new Date(stockAddedDate).getTime()) / 86400000));
}

function getStockColor(qty: number): string {
  if (qty < 10) return 'text-red-600';
  if (qty < 30) return 'text-amber-600';
  return 'text-green-600';
}

function getStockBg(qty: number): string {
  if (qty < 10) return 'bg-red-50';
  if (qty < 30) return 'bg-amber-50';
  return 'bg-green-50';
}

export default function MobileProductCard({ product, onTap }: MobileProductCardProps) {
  const router = useRouter();
  const stockAge = getStockDays(product.stockAddedDate);

  const handleTap = () => {
    if (onTap) {
      onTap(product);
    } else {
      router.push(`/seller/inventory/${product.id}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleTap}
      className="w-full rounded-lg border bg-white p-4 text-left shadow-sm active:bg-gray-50 transition-colors"
      aria-label={`View ${product.name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-100">
            <Package className="h-5 w-5 text-gray-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
            <span className="mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {product.categoryName || product.categoryId}
            </span>
          </div>
        </div>
        <span
          className={`shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
            product.isActive
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {product.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="font-semibold text-gray-900">{formatPrice(product.price)}</span>
        <div className="flex items-center gap-3">
          <span className={`font-medium ${getStockColor(product.stockQuantity)} ${getStockBg(product.stockQuantity)} rounded px-1.5 py-0.5 text-xs`}>
            {product.stockQuantity} in stock
          </span>
          <span className="text-xs text-gray-500">{stockAge}d old</span>
        </div>
      </div>
    </button>
  );
}
