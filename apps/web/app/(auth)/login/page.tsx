'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeftRight } from 'lucide-react';
import { signIn, signOut, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';
import Link from 'next/link';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border bg-white p-8 shadow-lg animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-48 mb-4" />
          <div className="h-10 bg-gray-200 rounded mb-3" />
          <div className="h-10 bg-gray-200 rounded mb-3" />
          <div className="h-10 bg-gray-200 rounded" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [existingSession, setExistingSession] = useState(false);
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  // Check for existing session on mount
  useEffect(() => {
    getCurrentUser().then(() => setExistingSession(true)).catch(() => {});
  }, []);

  const demoAccounts = [
    { role: 'Admin (Platform)', phone: '9000000001', password: 'DemoAdmin@123' },
    { role: 'Seller (Dragon Store Owner)', phone: '8927049085', password: 'DemoSeller@123' },
    { role: 'Customer (Enigma)', phone: '7001124396', password: 'DemoCustomer@123' },
  ];

  const fillDemoAccount = (demoPhone: string, demoPassword: string) => {
    setPhone(demoPhone);
    setPassword(demoPassword);
  };

  const handleClearSession = async () => {
    try {
      document.cookie = 'idToken=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
      try { sessionStorage.clear(); } catch {}
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('CognitoIdentityServiceProvider') || k.startsWith('vyapargyan')) localStorage.removeItem(k);
        });
      } catch {}
      await signOut({ global: true });
    } catch {}
    setExistingSession(false);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Always sign out first to prevent session conflicts
      try { await signOut(); } catch {}

      const username = phone.startsWith('+91') ? phone : `+91${phone.replace(/^0+/, '')}`;

      const signInResult = await signIn({
        username,
        password,
      });

      if (signInResult.isSignedIn) {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken;

        if (!idToken) {
          throw new Error('Failed to retrieve user session');
        }

        const groups = (idToken.payload['cognito:groups'] as string[]) || [];

        document.cookie = `idToken=${idToken.toString()}; path=/; max-age=3600; secure; samesite=strict`;

        if (redirect) {
          router.push(redirect);
        } else if (groups.includes('admin')) {
          router.push('/admin');
        } else if (groups.includes('seller')) {
          router.push('/seller');
        } else {
          router.push('/chat');
        }
      } else {
        setError('Additional authentication steps required. Please contact support.');
      }
    } catch (err: any) {
      console.error('Login error:', err);

      if (err.name === 'NotAuthorizedException' || err.name === 'UserNotFoundException') {
        setError('Invalid phone number or password.');
      } else if (err.name === 'UserNotConfirmedException') {
        setError('Your account is not confirmed. Please verify your phone number.');
      } else if (err.name === 'PasswordResetRequiredException') {
        setError('Password reset required. Please contact support.');
      } else if (err.name === 'TooManyRequestsException') {
        setError('Too many login attempts. Please try again later.');
      } else {
        setError(err.message || 'An error occurred during login.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border bg-white p-8 shadow-lg">
      <h2 className="text-xl font-semibold text-gray-900">Sign in to your account</h2>
      <p className="mt-1 text-sm text-gray-600">
        Enter your phone number and password
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {existingSession && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
            <ArrowLeftRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">Another account is signed in</p>
              <p className="mt-0.5 text-xs text-amber-700">Sign in below to switch, or clear the session first.</p>
              <button type="button" onClick={handleClearSession}
                className="mt-1.5 rounded bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-200 transition">
                Clear Session & Switch
              </button>
            </div>
          </div>
        )}
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
            Phone number
          </label>
          <div className="mt-1 flex">
            <span className="inline-flex items-center rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500">
              +91
            </span>
            <input
              id="phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="block w-full rounded-r-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="9876543210"
              pattern="[6-9][0-9]{9}"
              maxLength={10}
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      {isDemoMode && (
        <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
          <p className="mb-3 text-sm font-semibold text-indigo-900">Demo Accounts</p>
          <div className="space-y-2">
            {demoAccounts.map((account) => (
              <button
                key={account.role}
                type="button"
                onClick={() => fillDemoAccount(account.phone, account.password)}
                className="flex w-full items-center justify-between rounded-md bg-white px-3 py-2 text-left text-sm shadow-sm hover:bg-indigo-100 transition-colors"
              >
                <span className="font-medium text-gray-900">{account.role}</span>
                <span className="text-xs text-gray-500">+91 {account.phone}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-indigo-600">Click to auto-fill credentials</p>
        </div>
      )}

      <div className="mt-6 text-center text-sm text-gray-600">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
          Register
        </Link>
      </div>
    </div>
  );
}