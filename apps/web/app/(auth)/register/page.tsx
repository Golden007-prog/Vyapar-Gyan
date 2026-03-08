'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ShoppingBag, Store, Info } from 'lucide-react';
import { signUp } from 'aws-amplify/auth';
import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.vyapargyan.com';
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

type Role = 'customer' | 'seller';

export default function RegisterPage() {
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Seller-only fields
  const [businessName, setBusinessName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [gstNumber, setGstNumber] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    if (role === 'seller') {
      if (!businessName.trim()) {
        setError('Business name is required for sellers.');
        return;
      }
      if (gstNumber && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstNumber)) {
        setError('Please enter a valid GST number.');
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      const phoneE164 = `+91${phone}`;

      // 1. Sign up with Cognito
      await signUp({
        username: phoneE164,
        password,
        options: {
          userAttributes: {
            phone_number: phoneE164,
            name: displayName,
          },
        },
      });

      // 2. Call backend register endpoint to create DDB profile
      const registerBody: Record<string, string> = {
        role,
        phoneNumber: phone,
        displayName,
        password,
      };
      if (role === 'seller') {
        registerBody.businessName = businessName;
        if (businessAddress) registerBody.businessAddress = businessAddress;
        if (gstNumber) registerBody.gstNumber = gstNumber;
      }

      const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerBody),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          throw new Error('This phone number is already registered.');
        }
        throw new Error(data.error || data.message || 'Registration failed.');
      }

      // Redirect to OTP verification
      router.push(`/verify?phone=${encodeURIComponent(phone)}&role=${role}`);
    } catch (err: any) {
      console.error('Registration error:', err);

      if (err.name === 'UsernameExistsException') {
        setError('An account with this phone number already exists.');
      } else {
        setError(err.message || 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Role selection step
  if (!role) {
    return (
      <div className="rounded-lg border bg-white p-8 shadow-lg">
        {DEMO_MODE && (
          <div className="mb-6 flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4">
            <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800">Registration is disabled in demo mode</p>
              <p className="mt-1 text-sm text-amber-700">
                Please use the pre-configured demo accounts on the{' '}
                <Link href="/login" className="font-semibold text-indigo-600 underline hover:text-indigo-500">
                  login page
                </Link>.
              </p>
            </div>
          </div>
        )}
        <h2 className="text-xl font-semibold text-gray-900">Create your account</h2>
        <p className="mt-1 text-sm text-gray-600">How would you like to use VyaparGyan?</p>

        <div className="mt-6 space-y-3">
          <button
            onClick={() => setRole('customer')}
            disabled={DEMO_MODE}
            className="flex w-full items-center gap-4 rounded-lg border-2 border-gray-200 p-4 text-left transition hover:border-indigo-500 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:bg-white"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
              <ShoppingBag className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">I&apos;m a Customer</p>
              <p className="text-sm text-gray-500">Browse products and shop via chat</p>
            </div>
          </button>

          <button
            onClick={() => setRole('seller')}
            disabled={DEMO_MODE}
            className="flex w-full items-center gap-4 rounded-lg border-2 border-gray-200 p-4 text-left transition hover:border-indigo-500 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:bg-white"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <Store className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">I&apos;m a Seller</p>
              <p className="text-sm text-gray-500">List products and manage your store</p>
            </div>
          </button>
        </div>

        <div className="mt-6 text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-8 shadow-lg">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            {role === 'seller' ? 'Seller Registration' : 'Customer Registration'}
          </h2>
          <p className="mt-1 text-sm text-gray-600">Fill in your details to get started</p>
        </div>
        <button
          type="button"
          onClick={() => setRole(null)}
          className="text-sm text-indigo-600 hover:text-indigo-500"
        >
          Change role
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700">
            Full name
          </label>
          <input
            id="displayName"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Your name"
            minLength={2}
            maxLength={100}
          />
        </div>

        <div>
          <label htmlFor="reg-phone" className="block text-sm font-medium text-gray-700">
            Phone number
          </label>
          <div className="mt-1 flex">
            <span className="inline-flex items-center rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500">
              +91
            </span>
            <input
              id="reg-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="block w-full rounded-r-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="9876543210"
              maxLength={10}
            />
          </div>
        </div>

        {role === 'seller' && (
          <>
            <div>
              <label htmlFor="businessName" className="block text-sm font-medium text-gray-700">
                Business name <span className="text-red-500">*</span>
              </label>
              <input
                id="businessName"
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Your store name"
                minLength={2}
                maxLength={100}
              />
            </div>

            <div>
              <label htmlFor="businessAddress" className="block text-sm font-medium text-gray-700">
                Business address
              </label>
              <input
                id="businessAddress"
                type="text"
                value={businessAddress}
                onChange={(e) => setBusinessAddress(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Shop address"
                maxLength={500}
              />
            </div>

            <div>
              <label htmlFor="gstNumber" className="block text-sm font-medium text-gray-700">
                GST number <span className="text-xs text-gray-400">(optional)</span>
              </label>
              <input
                id="gstNumber"
                type="text"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="22AAAAA0000A1Z5"
                maxLength={15}
              />
            </div>
          </>
        )}

        <div>
          <label htmlFor="reg-password" className="block text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="reg-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Min 8 characters"
            minLength={8}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Re-enter password"
            minLength={8}
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
          {loading ? 'Creating account...' : 'Create account'}
        </button>
      </form>

      <div className="mt-6 text-center text-sm text-gray-600">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
          Sign in
        </Link>
      </div>
    </div>
  );
}
