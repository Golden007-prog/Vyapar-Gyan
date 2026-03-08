'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { confirmSignUp, resendSignUpCode } from 'aws-amplify/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.vyapargyan.com';
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const COOLDOWN_SECONDS = 60;
const OTP_LENGTH = 6;

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border bg-white p-8 shadow-lg animate-pulse"><div className="h-6 bg-gray-200 rounded w-48 mb-4" /><div className="flex justify-center gap-2">{Array(6).fill(0).map((_,i)=><div key={i} className="h-12 w-12 bg-gray-200 rounded-lg" />)}</div></div>}>
      <VerifyContent />
    </Suspense>
  );
}

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') || '';

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Auto-focus first input
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = useCallback((index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const digit = value.slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });

    // Auto-advance to next input
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }, [otp]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;

    const digits = pasted.split('');
    setOtp((prev) => {
      const next = [...prev];
      digits.forEach((d, i) => { next[i] = d; });
      return next;
    });

    const focusIndex = Math.min(digits.length, OTP_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length !== OTP_LENGTH) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const phoneE164 = `+91${phone}`;

      // 1. Confirm Cognito sign-up
      await confirmSignUp({
        username: phoneE164,
        confirmationCode: code,
      });

      // 2. Call backend OTP verify endpoint
      await fetch(`${API_BASE_URL}/api/v1/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phone, otp: code }),
      });

      setSuccess(true);

      // Redirect after brief success display
      setTimeout(() => {
        router.push('/login');
      }, 1500);
    } catch (err: any) {
      console.error('Verification error:', err);

      if (err.name === 'CodeMismatchException') {
        setError('Invalid verification code. Please try again.');
      } else if (err.name === 'ExpiredCodeException') {
        setError('Code has expired. Please request a new one.');
      } else if (err.name === 'LimitExceededException') {
        setError('Too many attempts. Please try again later.');
      } else {
        setError(err.message || 'Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;

    setResending(true);
    setError('');

    try {
      const phoneE164 = `+91${phone}`;
      await resendSignUpCode({ username: phoneE164 });
      setCooldown(COOLDOWN_SECONDS);
    } catch (err: any) {
      console.error('Resend error:', err);
      setError(err.message || 'Failed to resend code.');
    } finally {
      setResending(false);
    }
  };

  if (!phone) {
    return (
      <div className="rounded-lg border bg-white p-8 shadow-lg text-center">
        <p className="text-gray-600">No phone number provided.</p>
        <a href="/register" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500">
          Go to registration
        </a>
      </div>
    );
  }

  if (DEMO_MODE) {
    return (
      <div className="rounded-lg border bg-white p-8 shadow-lg text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100">
          <CheckCircle2 className="h-6 w-6 text-indigo-600" />
        </div>
        <h2 className="mt-4 text-xl font-semibold text-gray-900">Demo Mode</h2>
        <p className="mt-2 text-sm text-gray-600">
          Phone verification is skipped in demo mode. Please use the pre-configured demo accounts to sign in.
        </p>
        <a href="/login" className="mt-4 inline-flex justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition">
          Go to Login
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-8 shadow-lg">
      {success ? (
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          </div>
          <h2 className="mt-4 text-xl font-semibold text-gray-900">Phone verified!</h2>
          <p className="mt-2 text-sm text-gray-600">Redirecting to login...</p>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-semibold text-gray-900">Verify your phone</h2>
          <p className="mt-1 text-sm text-gray-600">
            Enter the 6-digit code sent to{' '}
            <span className="font-medium text-gray-900">+91 {phone}</span>
          </p>

          <form onSubmit={handleVerify} className="mt-6">
            <div className="flex justify-center gap-2" onPaste={handlePaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  aria-label={`Digit ${i + 1}`}
                  className="h-12 w-12 rounded-lg border border-gray-300 text-center text-lg font-semibold text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              ))}
            </div>

            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || otp.join('').length !== OTP_LENGTH}
              className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || resending}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              {resending
                ? 'Sending...'
                : cooldown > 0
                  ? `Resend code in ${cooldown}s`
                  : 'Resend code'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
