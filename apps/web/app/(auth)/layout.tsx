'use client';

import { useEffect } from 'react';
import { configureAmplify } from '@/lib/amplify-config';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    configureAmplify();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-block">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-600 shadow-lg">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">VyaparGyan</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-Powered Marketplace for Local Retailers
          </p>
        </div>
        {children}
        <p className="mt-6 text-center text-[11px] text-gray-400">
          Secured by AWS Cognito · Serverless on AWS
        </p>
      </div>
    </div>
  );
}
