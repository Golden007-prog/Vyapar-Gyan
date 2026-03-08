'use client';

import Link from 'next/link';
import {
  BookOpen,
  TrendingUp,
  MessageCircle,
  Wallet,
  ArrowRight,
  Sparkles,
  Shield,
  Zap,
  Users,
  BarChart3,
  Store,
  ShoppingBag,
  Bot,
  Globe,
} from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-white/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">VyaparGyan</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Login
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Register
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-100 px-4 py-2 text-sm font-medium text-indigo-700">
              <Sparkles className="h-4 w-4" />
              AI-Powered · WhatsApp Commerce · Built for Bharat
            </div>

            <h1 className="mt-8 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
              Your AI Business Manager
              <br />
              <span className="text-indigo-600">for Local Retail</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600 sm:text-xl">
              Automate inventory with Khata Book OCR, get AI pricing insights from market trends,
              and sell directly on WhatsApp — all from one platform.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/login"
                className="group flex items-center gap-2 rounded-lg bg-indigo-600 px-8 py-4 text-lg font-semibold text-white shadow-lg transition-all hover:bg-indigo-700 hover:shadow-xl"
              >
                Try the Demo
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/register"
                className="flex items-center gap-2 rounded-lg border-2 border-indigo-200 bg-white px-8 py-4 text-lg font-semibold text-indigo-600 shadow transition-all hover:border-indigo-300 hover:bg-indigo-50"
              >
                Create Account
              </Link>
            </div>

            <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500 sm:gap-8">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-green-600" />
                Razorpay Payments
              </div>
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-green-600" />
                Twilio WhatsApp
              </div>
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-indigo-600" />
                Bedrock + Gemini + Grok AI
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-orange-500" />
                AWS Serverless
              </div>
            </div>
          </div>
        </div>

        {/* Decorative blobs */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-10 top-20 h-72 w-72 animate-blob rounded-full bg-indigo-200 opacity-20 mix-blend-multiply blur-xl" />
          <div className="animation-delay-2000 absolute right-10 top-40 h-72 w-72 animate-blob rounded-full bg-purple-200 opacity-20 mix-blend-multiply blur-xl" />
          <div className="animation-delay-4000 absolute bottom-20 left-1/2 h-72 w-72 animate-blob rounded-full bg-pink-200 opacity-20 mix-blend-multiply blur-xl" />
        </div>
      </section>

      {/* How It Works — 3 personas */}
      <section className="border-t bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">Three Roles, One Platform</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              Every user gets a tailored experience — from browsing to managing to monitoring.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {/* Customer */}
            <div className="group rounded-2xl border border-gray-200 bg-white p-8 transition hover:border-indigo-200 hover:shadow-lg">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100">
                <ShoppingBag className="h-6 w-6 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Customer</h3>
              <p className="mt-3 text-gray-600">
                Browse products, chat with sellers, add to cart, and order — all through a WhatsApp-like web chat or directly on WhatsApp via Twilio.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-gray-500">
                <li className="flex items-center gap-2"><Globe className="h-3.5 w-3.5 text-indigo-500" /> Omnichannel ordering</li>
                <li className="flex items-center gap-2"><MessageCircle className="h-3.5 w-3.5 text-indigo-500" /> Real-time chat</li>
                <li className="flex items-center gap-2"><Wallet className="h-3.5 w-3.5 text-indigo-500" /> Secure checkout</li>
              </ul>
            </div>

            {/* Seller */}
            <div className="group rounded-2xl border border-gray-200 bg-white p-8 transition hover:border-emerald-200 hover:shadow-lg">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
                <Store className="h-6 w-6 text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Seller</h3>
              <p className="mt-3 text-gray-600">
                Manage inventory, fulfill orders, and get AI-powered insights on dead stock, pricing, and automated discount campaigns.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-gray-500">
                <li className="flex items-center gap-2"><BookOpen className="h-3.5 w-3.5 text-emerald-500" /> Khata Book OCR</li>
                <li className="flex items-center gap-2"><TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> AI pricing insights</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-emerald-500" /> Auto campaigns</li>
              </ul>
            </div>

            {/* Admin */}
            <div className="group rounded-2xl border border-gray-200 bg-white p-8 transition hover:border-amber-200 hover:shadow-lg">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100">
                <Shield className="h-6 w-6 text-amber-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Admin</h3>
              <p className="mt-3 text-gray-600">
                Approve sellers, monitor platform health, resolve disputes, and track marketplace analytics in real time.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-gray-500">
                <li className="flex items-center gap-2"><Users className="h-3.5 w-3.5 text-amber-500" /> Seller moderation</li>
                <li className="flex items-center gap-2"><BarChart3 className="h-3.5 w-3.5 text-amber-500" /> Platform analytics</li>
                <li className="flex items-center gap-2"><Zap className="h-3.5 w-3.5 text-amber-500" /> System monitoring</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">Powered by AI, End to End</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
              Four core capabilities that work together to transform local retail
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl bg-gradient-to-br from-indigo-50 to-indigo-100 p-8 transition hover:shadow-lg">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-indigo-600">
                <BookOpen className="h-7 w-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Khata Book OCR</h3>
              <p className="mt-3 text-gray-700">
                Snap a photo of your handwritten ledger and Gemini Vision digitizes your stock automatically. No manual data entry.
              </p>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 p-8 transition hover:shadow-lg">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-600">
                <TrendingUp className="h-7 w-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Smart Pricing</h3>
              <p className="mt-3 text-gray-700">
                Grok and Gemini analyze market trends to detect dead stock and recommend dynamic discounts or price increases.
              </p>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-purple-50 to-purple-100 p-8 transition hover:shadow-lg">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-purple-600">
                <MessageCircle className="h-7 w-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">WhatsApp Commerce</h3>
              <p className="mt-3 text-gray-700">
                Customers browse, chat, and buy through an automated WhatsApp assistant powered by Twilio. No app downloads needed.
              </p>
            </div>

            <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-orange-100 p-8 transition hover:shadow-lg">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-orange-600">
                <Wallet className="h-7 w-7 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Instant Split Payouts</h3>
              <p className="mt-3 text-gray-700">
                Razorpay Route handles commission splitting automatically. Sellers get paid directly with real-time tracking.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack Banner */}
      <section className="border-t bg-gray-50 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <p className="mb-8 text-center text-sm font-semibold uppercase tracking-wider text-gray-400">
            Built With
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm font-medium text-gray-500">
            <span>AWS Lambda</span>
            <span className="text-gray-300">·</span>
            <span>DynamoDB</span>
            <span className="text-gray-300">·</span>
            <span>API Gateway</span>
            <span className="text-gray-300">·</span>
            <span>Cognito</span>
            <span className="text-gray-300">·</span>
            <span>EventBridge</span>
            <span className="text-gray-300">·</span>
            <span>Bedrock</span>
            <span className="text-gray-300">·</span>
            <span>Twilio</span>
            <span className="text-gray-300">·</span>
            <span>Razorpay</span>
            <span className="text-gray-300">·</span>
            <span>Gemini</span>
            <span className="text-gray-300">·</span>
            <span>Grok</span>
            <span className="text-gray-300">·</span>
            <span>Next.js</span>
            <span className="text-gray-300">·</span>
            <span>CDK</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-indigo-600 to-indigo-700 py-20">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">See It in Action</h2>
          <p className="mt-4 text-lg text-indigo-100">
            Log in with a demo account to explore the full platform — customer, seller, and admin.
          </p>
          <Link
            href="/login"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-white px-8 py-4 text-lg font-semibold text-indigo-600 shadow-lg transition hover:bg-gray-50"
          >
            Try Demo Login
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 py-12 text-gray-300">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="text-center md:text-left">
              <h3 className="text-xl font-bold text-white">VyaparGyan</h3>
              <p className="mt-1 text-sm text-gray-400">AI-powered marketplace for Indian retailers</p>
            </div>
            <div className="flex gap-6 text-sm">
              <Link href="/login" className="transition hover:text-white">Login</Link>
              <Link href="/register" className="transition hover:text-white">Register</Link>
            </div>
          </div>
          <div className="mt-8 border-t border-gray-800 pt-8 text-center text-xs text-gray-500">
            <p>&copy; {new Date().getFullYear()} VyaparGyan. Built with ❤️ for Bharat&apos;s retailers.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
