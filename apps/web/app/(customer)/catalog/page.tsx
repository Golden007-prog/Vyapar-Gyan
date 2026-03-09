'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Search, SlidersHorizontal, X, ChevronDown, Loader2, ShoppingBag } from 'lucide-react';
import { listProducts, listCategories, type CatalogProduct, type Category, type ListProductsParams } from '@/lib/api-catalog';
import { ProductCardSkeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useStore } from '@/lib/store-context';

type SortOption = 'popularity' | 'price_asc' | 'price_desc' | 'newest';

const SORT_LABELS: Record<SortOption, string> = {
  popularity: 'Popular',
  price_asc: 'Price: Low → High',
  price_desc: 'Price: High → Low',
  newest: 'Newest',
};

const PAGE_SIZE = 20;

// Demo products for when API is unavailable
const DEMO_PRODUCTS: CatalogProduct[] = [
  { productId: 'demo-p1', name: 'Tata Salt 1kg', description: 'Iodized salt for daily cooking', price: 25, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-15T10:00:00Z' },
  { productId: 'demo-p2', name: 'Amul Butter 500g', description: 'Fresh pasteurized butter', price: 280, originalPrice: 300, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-14T10:00:00Z' },
  { productId: 'demo-p3', name: 'Parle-G Biscuits 800g', description: 'India\'s favorite glucose biscuit', price: 55, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-13T10:00:00Z' },
  { productId: 'demo-p4', name: 'Fortune Sunflower Oil 1L', description: 'Refined sunflower cooking oil', price: 180, originalPrice: 195, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-12T10:00:00Z' },
  { productId: 'demo-p5', name: 'Maggi 2-Minute Noodles (Pack of 12)', description: 'Masala instant noodles', price: 144, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-11T10:00:00Z' },
  { productId: 'demo-p6', name: 'Colgate MaxFresh Toothpaste 150g', description: 'Cooling crystals toothpaste', price: 95, sellerId: 'seller-dragon-001', stockStatus: 'low_stock', imageUrls: [], createdAt: '2025-01-10T10:00:00Z' },
  { productId: 'demo-p7', name: 'Surf Excel Matic 2kg', description: 'Front load washing powder', price: 420, originalPrice: 460, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-09T10:00:00Z' },
  { productId: 'demo-p8', name: 'Dettol Handwash 200ml', description: 'Original antibacterial handwash', price: 65, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-08T10:00:00Z' },
  { productId: 'demo-p9', name: 'Aashirvaad Atta 5kg', description: 'Whole wheat flour', price: 295, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-07T10:00:00Z' },
  { productId: 'demo-p10', name: 'Red Label Tea 500g', description: 'Premium Assam tea', price: 230, originalPrice: 250, sellerId: 'seller-dragon-001', stockStatus: 'low_stock', imageUrls: [], createdAt: '2025-01-06T10:00:00Z' },
  { productId: 'demo-p11', name: 'Vim Dishwash Bar 500g', description: 'Lemon fresh dishwash bar', price: 35, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-05T10:00:00Z' },
  { productId: 'demo-p12', name: 'Cadbury Dairy Milk Silk', description: 'Smooth chocolate bar', price: 85, sellerId: 'seller-dragon-001', stockStatus: 'in_stock', imageUrls: [], createdAt: '2025-01-04T10:00:00Z' },
];

const DEMO_CATEGORIES: Category[] = [
  { categoryId: 'cat-grocery', name: 'Groceries' },
  { categoryId: 'cat-personal', name: 'Personal Care' },
  { categoryId: 'cat-household', name: 'Household' },
  { categoryId: 'cat-snacks', name: 'Snacks & Beverages' },
];

export default function CatalogPage() {
  const { selectedStore } = useStore();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sort, setSort] = useState<SortOption>('popularity');
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [usingDemo, setUsingDemo] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Load categories
  useEffect(() => {
    listCategories()
      .then((res) => setCategories(res.categories || []))
      .catch(() => setCategories(DEMO_CATEGORIES));
  }, []);

  // Fetch products
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError('');
    setUsingDemo(false);

    try {
      const params: ListProductsParams = { sort, limit: PAGE_SIZE };
      if (selectedCategory) params.category = selectedCategory;
      if (debouncedSearch) params.search = debouncedSearch;

      const res = await listProducts(params);
      if (res.products && res.products.length > 0) {
        setProducts(res.products);
      } else {
        // API returned empty — use demo data
        setProducts(DEMO_PRODUCTS);
        setUsingDemo(true);
      }
    } catch {
      // API failed — use demo data
      setProducts(DEMO_PRODUCTS);
      setUsingDemo(true);
    } finally {
      setLoading(false);
    }
  }, [sort, selectedCategory, debouncedSearch]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Client-side filter for demo data
  const displayProducts = usingDemo
    ? products.filter((p) => {
        if (debouncedSearch && !p.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
        return true;
      })
    : products;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">
          {selectedStore ? selectedStore.businessName : 'Catalog'}
        </h1>
        {selectedStore?.description && (
          <p className="mt-1 text-sm text-gray-500">{selectedStore.description}</p>
        )}
      </div>

      {/* Search + Filter Bar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-4 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm transition ${showFilters ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </button>

          <div className="relative">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className="appearance-none rounded-lg border border-gray-300 bg-white py-2.5 pl-3 pr-8 text-sm text-gray-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {Object.entries(SORT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          </div>
        </div>
      </div>

      {/* Category chips */}
      {showFilters && categories.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('')}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${!selectedCategory ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.categoryId}
              onClick={() => setSelectedCategory(cat.categoryId)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${selectedCategory === cat.categoryId ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* Product Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : displayProducts.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="h-12 w-12 text-gray-300" />}
          title="No products found"
          description={search ? 'Try a different search term.' : 'This store has no products yet.'}
          actionLabel="Clear Search"
          onAction={() => { setSearch(''); setSelectedCategory(''); }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {displayProducts.map((product) => (
            <ProductCard key={product.productId} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: CatalogProduct }) {
  const hasDiscount = product.originalPrice && product.originalPrice > product.price;
  const discountPct = hasDiscount
    ? Math.round(((product.originalPrice! - product.price) / product.originalPrice!) * 100)
    : 0;

  // Generate a consistent color for the product placeholder
  const colors = ['bg-indigo-100', 'bg-emerald-100', 'bg-amber-100', 'bg-rose-100', 'bg-sky-100', 'bg-violet-100'];
  const colorIdx = product.productId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;

  // Next.js <Link> automatically prepends basePath from next.config.js
  // Do NOT manually add basePath — it causes double-prefixing on GitHub Pages

  return (
    <Link
      href={`/catalog/${product.productId}`}
      className="group overflow-hidden rounded-xl border bg-white shadow-sm transition hover:shadow-md"
    >
      {/* Image / Placeholder */}
      <div className={`relative aspect-square ${colors[colorIdx]} flex items-center justify-center`}>
        {product.imageUrls?.[0] ? (
          <img src={product.imageUrls[0]} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <span className="text-3xl">📦</span>
        )}
        {hasDiscount && (
          <span className="absolute left-2 top-2 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
            -{discountPct}%
          </span>
        )}
        {product.stockStatus === 'low_stock' && (
          <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            Low Stock
          </span>
        )}
        {product.stockStatus === 'out_of_stock' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-700">Out of Stock</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="line-clamp-2 text-sm font-medium text-gray-900 group-hover:text-indigo-600 transition">
          {product.name}
        </p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-base font-bold text-gray-900">₹{product.price}</span>
          {hasDiscount && (
            <span className="text-xs text-gray-400 line-through">₹{product.originalPrice}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
