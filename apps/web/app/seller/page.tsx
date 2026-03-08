'use client';

import { TrendingUp, Package, Sparkles, IndianRupee } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  change?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'up' | 'down';
}

function MetricCard({ title, value, change, icon: Icon, trend }: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          {change && (
            <p
              className={`mt-2 text-sm ${
                trend === 'up' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {change}
            </p>
          )}
        </div>
        <div className="rounded-full bg-indigo-50 p-3">
          <Icon className="h-6 w-6 text-indigo-600" />
        </div>
      </div>
    </div>
  );
}

export default function SellerDashboard() {
  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 p-6 text-white">
        <h1 className="text-2xl font-bold">Welcome back, Dragon Store!</h1>
        <p className="mt-2 text-indigo-100">
          Your AI business manager is working to optimize your inventory and boost sales.
        </p>
      </div>

      {/* Metrics grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Sales"
          value="₹45,231"
          change="+12.5% from last month"
          icon={IndianRupee}
          trend="up"
        />
        <MetricCard
          title="Active Products"
          value="127"
          change="3 low stock items"
          icon={Package}
        />
        <MetricCard
          title="Active AI Campaigns"
          value="2"
          change="1 pending approval"
          icon={Sparkles}
        />
        <MetricCard
          title="Monthly Revenue"
          value="₹1.2L"
          change="+8.3% from last month"
          icon={TrendingUp}
          trend="up"
        />
      </div>

      {/* Quick actions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* AI Insights preview */}
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Latest AI Insights
            </h2>
            <Sparkles className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="space-y-3">
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">
                Dead Stock Alert
              </p>
              <p className="mt-1 text-sm text-amber-700">
                15 products haven&apos;t sold in 60+ days. AI suggests 20% discount campaign.
              </p>
              <a href="/seller/insights" className="mt-3 inline-block text-sm font-medium text-amber-900 hover:underline">
                Review Suggestion →
              </a>
            </div>
            <div className="rounded-lg bg-green-50 p-4">
              <p className="text-sm font-medium text-green-900">
                Price Optimization
              </p>
              <p className="mt-1 text-sm text-green-700">
                Market analysis suggests increasing price for 8 high-demand items.
              </p>
              <a href="/seller/insights" className="mt-3 inline-block text-sm font-medium text-green-900 hover:underline">
                View Details →
              </a>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Recent Activity
          </h2>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-green-100 p-2">
                <Package className="h-4 w-4 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  New order received
                </p>
                <p className="text-xs text-gray-500">Order #1234 - ₹850</p>
                <p className="text-xs text-gray-400">2 hours ago</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-blue-100 p-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  AI campaign sent
                </p>
                <p className="text-xs text-gray-500">
                  Discount notification to 45 customers
                </p>
                <p className="text-xs text-gray-400">5 hours ago</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-purple-100 p-2">
                <TrendingUp className="h-4 w-4 text-purple-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  Stock updated
                </p>
                <p className="text-xs text-gray-500">
                  Khata book processed - 23 items added
                </p>
                <p className="text-xs text-gray-400">1 day ago</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
