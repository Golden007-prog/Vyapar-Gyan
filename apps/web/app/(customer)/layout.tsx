'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Search,
  User,
  Store,
  Package,
  MessageCircle,
  ShoppingCart,
  ChevronDown,
  X,
  LogOut,
  ArrowLeftRight,
} from 'lucide-react';
import { signOut } from 'aws-amplify/auth';
import { configureAmplify } from '@/lib/amplify-config';
import {
  StoreContext,
  DEMO_STORES,
  STORE_KEY,
  type SellerStore,
} from '@/lib/store-context';
import { getDemoCart } from '@/lib/demo-cart';

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [selectedStore, setSelectedStoreState] = useState<SellerStore | null>(null);
  const [showStorePicker, setShowStorePicker] = useState(false);
  const [pendingStore, setPendingStore] = useState<SellerStore | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    configureAmplify();
    try {
      const saved = sessionStorage.getItem(STORE_KEY);
      if (saved) {
        setSelectedStoreState(JSON.parse(saved));
      } else {
        setSelectedStoreState(DEMO_STORES[0]);
        sessionStorage.setItem(STORE_KEY, JSON.stringify(DEMO_STORES[0]));
      }
    } catch {
      setSelectedStoreState(DEMO_STORES[0]);
    }
  }, []);

  const setSelectedStore = useCallback((store: SellerStore) => {
    setSelectedStoreState(store);
    sessionStorage.setItem(STORE_KEY, JSON.stringify(store));
    setShowStorePicker(false);
    setShowConfirm(false);
    setPendingStore(null);
  }, []);

  const handleStoreSelect = (store: SellerStore) => {
    if (selectedStore && selectedStore.sellerId !== store.sellerId) {
      setPendingStore(store);
      setShowConfirm(true);
    } else {
      setSelectedStore(store);
    }
  };

  const clearAllState = () => {
    document.cookie = 'idToken=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    try { sessionStorage.clear(); } catch {}
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('CognitoIdentityServiceProvider') || k.startsWith('vyapargyan')) localStorage.removeItem(k);
      });
    } catch {}
  };

  const handleLogout = async () => {
    clearAllState();
    try { await signOut({ global: true }); } catch {}
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    window.location.href = `${base}/login`;
  };

  const handleSwitchAccount = async () => {
    clearAllState();
    try { await signOut({ global: true }); } catch {}
    const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
    window.location.href = `${base}/login`;
  };

  const navItems = [
    { href: '/catalog', label: 'Catalog', icon: Search },
    { href: '/cart', label: 'Cart', icon: ShoppingCart, badge: cartCount },
    { href: '/chat', label: 'Chat', icon: MessageCircle },
    { href: '/orders', label: 'Orders', icon: Package },
    { href: '/account', label: 'Account', icon: User },
  ];

  // Poll demo cart count
  useEffect(() => {
    const update = () => {
      if (selectedStore) {
        const c = getDemoCart(selectedStore.sellerId);
        setCartCount(c.itemCount);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [selectedStore]);

  return (
    <StoreContext.Provider value={{ selectedStore, setSelectedStore, stores: DEMO_STORES }}>
      <div className="min-h-screen bg-gray-50">
        {/* Top Nav */}
        <header className="sticky top-0 z-30 border-b bg-white shadow-sm">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <Link href="/catalog" className="flex items-center gap-2 text-lg font-bold text-indigo-600">
                <Store className="h-5 w-5" />
                <span className="hidden sm:inline">VyaparGyan</span>
              </Link>
              <button
                onClick={() => setShowStorePicker(true)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
              >
                <span className="max-w-[120px] truncate sm:max-w-[180px]">
                  {selectedStore?.businessName || 'Select Store'}
                </span>
                <ChevronDown className="h-3 w-3 text-gray-400" />
              </button>
            </div>

            <nav className="flex items-center gap-1 sm:gap-3">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition sm:px-3 ${
                      active
                        ? 'bg-indigo-50 text-indigo-600 font-medium'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                    {item.badge && item.badge > 0 ? (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
              <button
                onClick={handleSwitchAccount}
                className="ml-1 flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-400 transition hover:text-indigo-500 hover:bg-indigo-50"
                title="Switch Account"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-gray-400 transition hover:text-red-500 hover:bg-red-50"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </nav>
          </div>
        </header>

        <main>{children}</main>

        {/* Store Picker Modal */}
        {showStorePicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowStorePicker(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Select a Store</h3>
                <button onClick={() => setShowStorePicker(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-2">
                {DEMO_STORES.map((store) => (
                  <button
                    key={store.sellerId}
                    onClick={() => handleStoreSelect(store)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition ${
                      selectedStore?.sellerId === store.sellerId
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100">
                      <Store className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{store.businessName}</p>
                      {store.description && <p className="text-xs text-gray-500">{store.description}</p>}
                    </div>
                    {selectedStore?.sellerId === store.sellerId && (
                      <span className="ml-auto text-xs font-medium text-indigo-600">Active</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Store Change Confirmation */}
        {showConfirm && pendingStore && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
              <h3 className="text-lg font-semibold text-gray-900">Change Store?</h3>
              <p className="mt-2 text-sm text-gray-600">
                Switching to <span className="font-medium">{pendingStore.businessName}</span> will reset your current cart. Continue?
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => { setShowConfirm(false); setPendingStore(null); }}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setSelectedStore(pendingStore)}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
                >
                  Switch Store
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </StoreContext.Provider>
  );
}
