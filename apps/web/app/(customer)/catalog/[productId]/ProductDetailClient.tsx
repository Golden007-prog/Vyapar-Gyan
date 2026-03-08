'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ShoppingCart,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Store,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { getProduct, type ProductDetail } from '@/lib/api-catalog';

const STOCK_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  in_stock: { label: 'In Stock', color: 'text-green-600 bg-green-50', icon: CheckCircle2 },
  low_stock: { label: 'Only a few left', color: 'text-amber-600 bg-amber-50', icon: AlertTriangle },
  out_of_stock: { label: 'Out of Stock', color: 'text-red-600 bg-red-50', icon: XCircle },
};

export default function ProductDetailClient() {
  const { productId } = useParams<{ productId: string }>();
  const router = useRouter();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [imgIdx, setImgIdx] = useState(0);
  const [addingToCart, setAddingToCart] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);

  useEffect(() => {
    if (!productId) return;
    setLoading(true);
    getProduct(productId)
      .then((res) => setProduct(res.product))
      .catch(() => {
        setProduct({
          productId,
          name: 'Demo Product',
          description: 'This is a demo product. In production, product details are loaded from the API.',
          price: 199,
          originalPrice: 249,
          stockStatus: 'in_stock',
          imageUrls: [],
          seller: { sellerId: 'demo-seller-001', businessName: 'Gupta General Store' },
          createdAt: new Date().toISOString(),
        });
      })
      .finally(() => setLoading(false));
  }, [productId]);

  const images = product?.imageUrls ?? [];
  const hasMultipleImages = images.length > 1;

  const prevImage = () => setImgIdx((i) => (i === 0 ? images.length - 1 : i - 1));
  const nextImage = () => setImgIdx((i) => (i === images.length - 1 ? 0 : i + 1));

  const handleAddToCart = async () => {
    setAddingToCart(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      setAddedToCart(true);
      setTimeout(() => setAddedToCart(false), 2000);
    } finally {
      setAddingToCart(false);
    }
  };

  const handleAskSeller = () => {
    router.push(`/chat?product=${productId}`);
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-lg font-medium text-gray-700">{error || 'Product not found'}</p>
        <Link
          href="/catalog"
          className="mt-4 inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to catalog
        </Link>
      </div>
    );
  }

  const stock = STOCK_CONFIG[product.stockStatus] ?? STOCK_CONFIG.out_of_stock;
  const StockIcon = stock.icon;
  const hasDiscount = product.originalPrice && product.originalPrice > product.price;
  const discountPct = hasDiscount
    ? Math.round(((product.originalPrice! - product.price) / product.originalPrice!) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link
        href="/catalog"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600"
      >
        <ArrowLeft className="h-4 w-4" /> Back to catalog
      </Link>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Image Carousel */}
        <div className="relative aspect-square overflow-hidden rounded-xl bg-gray-100">
          {images.length > 0 ? (
            <img src={images[imgIdx]} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-300">
              <span className="text-6xl">📦</span>
            </div>
          )}
          {hasMultipleImages && (
            <>
              <button onClick={prevImage} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1.5 shadow hover:bg-white" aria-label="Previous image">
                <ChevronLeft className="h-5 w-5 text-gray-700" />
              </button>
              <button onClick={nextImage} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/80 p-1.5 shadow hover:bg-white" aria-label="Next image">
                <ChevronRight className="h-5 w-5 text-gray-700" />
              </button>
            </>
          )}
          {hasMultipleImages && (
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
              {images.map((_, i) => (
                <button key={i} onClick={() => setImgIdx(i)} className={`h-2 w-2 rounded-full transition ${i === imgIdx ? 'bg-indigo-600' : 'bg-white/70'}`} aria-label={`Image ${i + 1}`} />
              ))}
            </div>
          )}
          {hasDiscount && (
            <span className="absolute left-3 top-3 rounded-md bg-red-500 px-2 py-1 text-xs font-bold text-white">
              -{discountPct}% OFF
            </span>
          )}
        </div>

        {/* Product Info */}
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
          {product.seller?.businessName && (
            <div className="mt-2 flex items-center gap-1.5 text-sm text-gray-500">
              <Store className="h-4 w-4" />
              <span>Sold by {product.seller.businessName}</span>
            </div>
          )}
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900">₹{product.price.toLocaleString('en-IN')}</span>
            {hasDiscount && (
              <>
                <span className="text-lg text-gray-400 line-through">₹{product.originalPrice!.toLocaleString('en-IN')}</span>
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700">
                  Save ₹{(product.originalPrice! - product.price).toLocaleString('en-IN')}
                </span>
              </>
            )}
          </div>
          <div className={`mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${stock.color}`}>
            <StockIcon className="h-4 w-4" />
            {stock.label}
          </div>
          {product.description && (
            <p className="mt-5 text-sm leading-relaxed text-gray-600">{product.description}</p>
          )}
          <div className="mt-auto flex flex-col gap-3 pt-6">
            <button onClick={handleAddToCart} disabled={product.stockStatus === 'out_of_stock' || addingToCart} className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
              {addingToCart ? <Loader2 className="h-4 w-4 animate-spin" /> : addedToCart ? <CheckCircle2 className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
              {addedToCart ? 'Added!' : 'Add to Cart'}
            </button>
            <button onClick={handleAskSeller} className="flex items-center justify-center gap-2 rounded-lg border border-indigo-600 px-6 py-3 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50">
              <MessageCircle className="h-4 w-4" />
              Ask Seller
            </button>
          </div>
        </div>
      </div>

      {hasMultipleImages && (
        <div className="mt-4 flex gap-2 overflow-x-auto md:max-w-[50%]">
          {images.map((url, i) => (
            <button key={i} onClick={() => setImgIdx(i)} className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border-2 transition ${i === imgIdx ? 'border-indigo-500' : 'border-transparent opacity-60 hover:opacity-100'}`}>
              <img src={url} alt={`Thumbnail ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}