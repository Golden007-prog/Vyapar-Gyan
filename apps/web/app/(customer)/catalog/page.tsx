'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { SlidersHorizontal, ChevronDown, Loader2, ShoppingBag, ShoppingCart, CheckCircle2 } from 'lucide-react';
import { listProducts, listCategories, type CatalogProduct, type Category, type ListProductsParams } from '@/lib/api-catalog';
import { searchProducts as opensearchProducts, type SearchProductItem, type SearchResponse } from '@/lib/api-search';
import SearchBar from '@/components/search/SearchBar';
import SearchResults from '@/components/search/SearchResults';
import CategoryFilters from '@/components/search/CategoryFilters';
import { ProductCardSkeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { useStore } from '@/lib/store-context';
import { addItem as apiAddItem } from '@/lib/api-cart';
import { addDemoItem } from '@/lib/demo-cart';

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

  // --- DynamoDB-based browsing state (default view) ---
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [sort, setSort] = useState<SortOption>('popularity');
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [usingDemo, setUsingDemo] = useState(false);

  // --- OpenSearch-based search state ---
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchItems, setSearchItems] = useState<SearchProductItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchPage, setSearchPage] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchCategory, setSearchCategory] = useState<string | null>(null);
  const [searchUnavailable, setSearchUnavailable] = useState(false);

  // Extract unique categories from search results
  const searchCategories = Array.from(
    new Set(searchItems.map((item) => item.category).filter(Boolean))
  );

  // Filter search items by selected category (client-side for category chips)
  const filteredSearchItems = searchCategory
    ? searchItems.filter((item) => item.category === searchCategory)
    : searchItems;

  // Load categories for DynamoDB browsing
  useEffect(() => {
    listCategories()
      .then((res) => setCategories(res.categories || []))
      .catch(() => setCategories(DEMO_CATEGORIES));
  }, []);

  // Fetch products from DynamoDB (default browsing)
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setUsingDemo(false);

    try {
      const params: ListProductsParams = { sort, limit: PAGE_SIZE };
      if (selectedCategory) params.category = selectedCategory;

      const res = await listProducts(params);
      if (res.products && res.products.length > 0) {
        setProducts(res.products);
      } else {
        setProducts(DEMO_PRODUCTS);
        setUsingDemo(true);
      }
    } catch {
      setProducts(DEMO_PRODUCTS);
      setUsingDemo(true);
    } finally {
      setLoading(false);
    }
  }, [sort, selectedCategory]);

  useEffect(() => {
    if (!searchMode) {
      fetchProducts();
    }
  }, [fetchProducts, searchMode]);

  // --- OpenSearch search handler (with client-side demo fallback) ---
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    setSearchMode(true);
    setSearchPage(1);
    setSearchCategory(null);
    setSearchLoading(true);
    setSearchUnavailable(false);
    setSearchItems([]);

    try {
      const res: SearchResponse = await opensearchProducts({ q: query, page: 1, size: PAGE_SIZE });
      setSearchItems(res.items);
      setSearchTotal(res.total);
    } catch {
      // OpenSearch not deployed — fall back to client-side filtering of demo products
      const lowerQuery = query.toLowerCase();
      const filtered = DEMO_PRODUCTS.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerQuery) ||
          (p.description && p.description.toLowerCase().includes(lowerQuery))
      );
      const asSearchItems: SearchProductItem[] = filtered.map((p) => ({
        productId: p.productId,
        productName: p.name,
        description: p.description || '',
        sellerId: p.sellerId,
        price: p.price,
        category: '',
        stockQuantity: 100,
        imageUrls: p.imageUrls || [],
        createdAt: p.createdAt || new Date().toISOString(),
      }));
      setSearchItems(asSearchItems);
      setSearchTotal(asSearchItems.length);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // --- Search pagination (Load More) ---
  const handleSearchPageChange = useCallback(async (nextPage: number) => {
    setSearchLoading(true);
    try {
      const res: SearchResponse = await opensearchProducts({
        q: searchQuery,
        category: searchCategory || undefined,
        page: nextPage,
        size: PAGE_SIZE,
      });
      setSearchItems((prev) => [...prev, ...res.items]);
      setSearchTotal(res.total);
      setSearchPage(nextPage);
    } catch {
      // Silently fail on pagination — keep existing results
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, searchCategory]);

  // --- Search category filter handler ---
  const handleSearchCategorySelect = useCallback(async (category: string | null) => {
    setSearchCategory(category);
    setSearchPage(1);
    setSearchLoading(true);
    setSearchItems([]);

    try {
      const res: SearchResponse = await opensearchProducts({
        q: searchQuery,
        category: category || undefined,
        page: 1,
        size: PAGE_SIZE,
      });
      setSearchItems(res.items);
      setSearchTotal(res.total);
    } catch {
      setSearchItems([]);
      setSearchTotal(0);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery]);

  // --- Exit search mode ---
  const handleClearSearch = () => {
    setSearchMode(false);
    setSearchQuery('');
    setSearchItems([]);
    setSearchTotal(0);
    setSearchPage(1);
    setSearchCategory(null);
    setSearchUnavailable(false);
  };

  // Client-side filter for demo data in browse mode
  const displayProducts = usingDemo ? products : products;

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

      {/* Search Bar (OpenSearch-powered) */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchBar
            placeholder="Search products..."
            onSearch={handleSearch}
          />
        </div>

        {!searchMode && (
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
        )}

        {searchMode && (
          <button
            onClick={handleClearSearch}
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Back to Browse
          </button>
        )}
      </div>

      {/* Search unavailable banner */}
      {searchUnavailable && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Search is temporarily unavailable. Showing browsable catalog instead.
          <button
            onClick={() => setSearchUnavailable(false)}
            className="ml-2 font-medium underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* === SEARCH MODE: OpenSearch results === */}
      {searchMode && (
        <div>
          {/* Category filters from search results */}
          {searchCategories.length > 0 && (
            <div className="mb-4">
              <CategoryFilters
                categories={searchCategories}
                selected={searchCategory}
                onSelect={handleSearchCategorySelect}
              />
            </div>
          )}

          <SearchResults
            items={searchCategory ? filteredSearchItems : searchItems}
            total={searchCategory ? filteredSearchItems.length : searchTotal}
            page={searchPage}
            pageSize={PAGE_SIZE}
            isLoading={searchLoading}
            onPageChange={handleSearchPageChange}
          />
        </div>
      )}

      {/* === BROWSE MODE: DynamoDB-based catalog === */}
      {!searchMode && (
        <>
          {/* Category chips (DynamoDB browsing) */}
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
              description="This store has no products yet."
              actionLabel="Clear Filters"
              onAction={() => setSelectedCategory('')}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {displayProducts.map((product) => (
                <ProductCard key={product.productId} product={product} sellerId={selectedStore?.sellerId || 'seller-dragon-001'} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}


function ProductCard({ product, sellerId }: { product: CatalogProduct; sellerId: string }) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  const hasDiscount = product.originalPrice && product.originalPrice > product.price;
  const discountPct = hasDiscount
    ? Math.round(((product.originalPrice! - product.price) / product.originalPrice!) * 100)
    : 0;

  // Generate a consistent color for the product placeholder
  const colors = ['bg-indigo-100', 'bg-emerald-100', 'bg-amber-100', 'bg-rose-100', 'bg-sky-100', 'bg-violet-100'];
  const colorIdx = product.productId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent Link navigation
    e.stopPropagation();
    if (product.stockStatus === 'out_of_stock') return;
    setAdding(true);
    try {
      await apiAddItem({ productId: product.productId, quantity: 1 });
    } catch {
      addDemoItem(sellerId, {
        productId: product.productId,
        sellerId,
        name: product.name,
        price: product.price,
        quantity: 1,
      });
    }
    setAdding(false);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

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
        {product.stockStatus !== 'out_of_stock' && (
          <button
            onClick={handleAddToCart}
            disabled={adding}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {adding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : added ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <ShoppingCart className="h-3.5 w-3.5" />
            )}
            {added ? 'Added!' : 'Add to Cart'}
          </button>
        )}
      </div>
    </Link>
  );
}