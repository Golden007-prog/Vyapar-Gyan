'use client';

import { createContext, useContext } from 'react';

export interface SellerStore {
  sellerId: string;
  businessName: string;
  description?: string;
}

export interface StoreContextValue {
  selectedStore: SellerStore | null;
  setSelectedStore: (store: SellerStore) => void;
  stores: SellerStore[];
}

export const StoreContext = createContext<StoreContextValue>({
  selectedStore: null,
  setSelectedStore: () => {},
  stores: [],
});

export function useStore() {
  return useContext(StoreContext);
}

export const DEMO_STORES: SellerStore[] = [
  { sellerId: 'seller-dragon-001', businessName: 'Dragon Store', description: 'Your neighbourhood everything store' },
  { sellerId: 'SELLER#demo-seller-001', businessName: 'Gupta General Store', description: 'Daily essentials & groceries' },
  { sellerId: 'SELLER#demo-seller-002', businessName: 'Sharma Electronics', description: 'Gadgets & accessories' },
];

export const STORE_KEY = 'vyapargyan_selected_store';
