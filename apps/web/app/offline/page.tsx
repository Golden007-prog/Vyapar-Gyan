'use client';

import { WifiOff } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6 text-center">
      <div className="rounded-full bg-indigo-100 p-4">
        <WifiOff className="h-12 w-12 text-indigo-600" />
      </div>
      <h1 className="mt-6 text-2xl font-bold text-gray-900">VyaparGyan</h1>
      <p className="mt-3 text-base text-gray-600">
        You&apos;re offline. Your inventory changes will sync when you reconnect.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-8 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        Try Again
      </button>
    </div>
  );
}
