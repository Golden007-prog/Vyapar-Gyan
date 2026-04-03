'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Store,
  ChevronDown,
  X,
} from 'lucide-react';
import { configureAmplify } from '@/lib/amplify-config';
import {
  StoreContext,
  DEMO_STORES,
  STORE_KEY,
  type SellerStore,
} from '@/lib/store-context';
import { getDemoCart } from '@/lib/demo-cart';
import { AppShell } from '@/components/layout/AppShell';
import { CUSTOMER_NAV } from '@/components/layout/nav-config';

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const [selectedStore, setSelectedStoreState] = useState<SellerStore | null>(null);
  const [showStorePicker, setShowStorePicker] = useState(false);
  const [pendingStore, setPendingStore] = useState<SellerStore | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    try { configureAmplify(); } catch {}
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

  // Store picker button passed as headerActions to AppShell
  const storePickerButton = (
    <button
      onClick={() => setShowStorePicker(true)}
      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
    >
      <span className="max-w-[120px] truncate sm:max-w-[180px]">
        {selectedStore?.businessName || 'Select Store'}
      </span>
      <ChevronDown className="h-3 w-3 text-gray-400" />
    </button>
  );

  return (
    <StoreContext.Provider value={{ selectedStore, setSelectedStore, stores: DEMO_STORES }}>
      <AppShell role="customer" navConfig={CUSTOMER_NAV} headerActions={storePickerButton}>
        {children}
      </AppShell>

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
    </StoreContext.Provider>
  );
}
