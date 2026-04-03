'use client';

import { useState } from 'react';
import { configureAmplify } from '@/lib/amplify-config';
import { AppShell } from '@/components/layout/AppShell';
import { ADMIN_NAV } from '@/components/layout/nav-config';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  useState(() => { configureAmplify(); });

  return (
    <AppShell
      role="admin"
      navConfig={ADMIN_NAV}
      headerActions={
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
          Admin
        </span>
      }
    >
      {children}
    </AppShell>
  );
}
