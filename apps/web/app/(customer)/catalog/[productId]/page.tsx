import ProductDetailClient from './ProductDetailClient';

// Required for static export — pre-render a placeholder path.
// Actual product data is fetched client-side at runtime.
export function generateStaticParams() {
  return [{ productId: 'demo' }];
}

export default function ProductDetailPage({ params }: { params: { productId: string } }) {
  return <ProductDetailClient />;
}