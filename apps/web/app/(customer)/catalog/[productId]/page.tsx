import ProductDetailClient from './ProductDetailClient';

// Pre-render all demo product IDs + a catch-all placeholder for static export.
// Client-side fetching handles the actual data at runtime.
export function generateStaticParams() {
  return [
    { productId: 'demo' },
    { productId: 'demo-p1' },
    { productId: 'demo-p2' },
    { productId: 'demo-p3' },
    { productId: 'demo-p4' },
    { productId: 'demo-p5' },
    { productId: 'demo-p6' },
    { productId: 'demo-p7' },
    { productId: 'demo-p8' },
    { productId: 'demo-p9' },
    { productId: 'demo-p10' },
    { productId: 'demo-p11' },
    { productId: 'demo-p12' },
  ];
}

// Enable dynamic params for GitHub Pages
export const dynamicParams = true;

export default function ProductDetailPage({ params }: { params: { productId: string } }) {
  return <ProductDetailClient />;
}