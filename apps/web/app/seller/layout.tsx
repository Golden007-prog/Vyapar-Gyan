'use client';

import { useState } from 'react';
import { configureAmplify } from '@/lib/amplify-config';
import { AppShell } from '@/components/layout/AppShell';
import { SELLER_NAV } from '@/components/layout/nav-config';

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  useState(() => { configureAmplify(); });

  return (
    <AppShell
      role="seller"
      navConfig={SELLER_NAV}
      headerActions={
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
          Dragon Store
        </span>
      }
    >
      {children}
    </AppShell>
  );
}
