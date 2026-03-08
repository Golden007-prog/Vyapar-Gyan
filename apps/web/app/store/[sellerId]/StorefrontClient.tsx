'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Search, ShoppingCart } from 'lucide-react';
import ChatWidget from '@/components/ChatWidget';

interface Product {
  id: string;
  name: string;
  price: number;
  imageUrl: string;
  stock: number;
}

export default function StorefrontClient() {
  const params = useParams();
  const sellerId = params.sellerId as string;
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [businessName, setBusinessName] = useState('Gupta General Store');

  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      await new Promise(resolve => setTimeout(resolve, 800));
      const mockProducts: Product[] = [
        { id: '1', name: 'Tata Salt 1kg', price: 25, imageUrl: 'https://via.placeholder.com/300x300?text=Tata+Salt', stock: 50 },
        { id: '2', name: 'Amul Butter 500g', price: 280, imageUrl: 'https://via.placeholder.com/300x300?text=Amul+Butter', stock: 30 },
        { id: '3', name: 'Parle-G Biscuits', price: 10, imageUrl: 'https://via.placeholder.com/300x300?text=Parle-G', stock: 100 },
        { id: '4', name: 'Fortune Oil 1L', price: 180, imageUrl: 'https://via.placeholder.com/300x300?text=Fortune+Oil', stock: 25 },
        { id: '5', name: 'Maggi Noodles Pack', price: 12, imageUrl: 'https://via.placeholder.com/300x300?text=Maggi', stock: 80 },
        { id: '6', name: 'Colgate Toothpaste', price: 85, imageUrl: 'https://via.placeholder.com/300x300?text=Colgate', stock: 40 },
      ];
      setProducts(mockProducts);
      setLoading(false);
    };
    fetchProducts();
  }, [sellerId]);

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddToCart = (product: Product) => {
    alert(`Added ${product.name} to cart!`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">{businessName}</h1>
            <button className="p-2 hover:bg-gray-100 rounded-full relative">
              <ShoppingCart className="h-6 w-6 text-gray-700" />
              <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">0</span>
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input type="text" placeholder="Search products..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900">{filteredProducts.length} Products Available</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredProducts.map((product) => (
                <div key={product.id} className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                  <div className="aspect-square bg-gray-100">
                    <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-gray-900 mb-2">{product.name}</h3>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xl font-bold text-gray-900">₹{product.price}</span>
                      <span className="text-sm text-gray-500">{product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</span>
                    </div>
                    <button onClick={() => handleAddToCart(product)} disabled={product.stock === 0} className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">
                      {product.stock > 0 ? 'Add to Cart' : 'Out of Stock'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {filteredProducts.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-500 text-lg">No products found matching your search.</p>
              </div>
            )}
          </>
        )}
      </main>
      <ChatWidget sellerName={businessName} />
    </div>
  );
}