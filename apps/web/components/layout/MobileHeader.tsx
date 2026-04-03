'use client';

import { ArrowLeft, Store } from 'lucide-react';

export interface MobileHeaderProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  actions?: React.ReactNode;
}

export function MobileHeader({ title, showBack, onBack, actions }: MobileHeaderProps) {
  return (
    <header className="flex h-12 items-center border-b border-gray-200 bg-white px-3 md:hidden">
      {/* Left slot: back arrow or brand logo */}
      <div className="flex w-10 shrink-0 items-center justify-start">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 active:bg-gray-200"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600">
            <Store size={14} className="text-white" />
          </div>
        )}
      </div>

      {/* Center: page title */}
      <h1 className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-gray-900">
        {title}
      </h1>

      {/* Right slot: optional action buttons */}
      <div className="flex w-10 shrink-0 items-center justify-end">
        {actions}
      </div>
    </header>
  );
}
