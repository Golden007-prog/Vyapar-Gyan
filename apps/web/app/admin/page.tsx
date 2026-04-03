'use client';

import { useEffect, useState } from 'react';
import { Users, ShoppingBag, TrendingUp, Sparkles, IndianRupee, UserCheck } from 'lucide-react';

interface PlatformAnalytics {
  totalGMV: number;
  activeSellers: number;
  activeCustomers: number;
  aiInsightsGenerated: number;
  topSellers: Array<{
    id: string;
    businessName: string;
    revenue: number;
    orders: number;
  }>;
  recentActivity: Array<{
    id: string;
    type: string;
    description: string;
    timestamp: string;
  }>;
}

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'up' | 'down' | 'neutral';
}

function StatCard({ title, value, change, icon: Icon, trend = 'neutral' }: StatCardProps) {
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm hover:shadow-md transition-shadow min-h-[80px]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          {change && (
            <p
              className={`mt-2 text-sm ${
                trend === 'up'
                  ? 'text-green-600'
                  : trend === 'down'
                  ? 'text-red-600'
                  : 'text-gray-600'
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

export default function AdminDashboard() {
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      // Mock data for now - replace with actual API call
      // const data = await api.get<PlatformAnalytics>('/api/admin/analytics');
      const mockData: PlatformAnalytics = {
        totalGMV: 8450000,
        activeSellers: 342,
        activeCustomers: 12847,
        aiInsightsGenerated: 1523,
        topSellers: [
          { id: 'seller-dragon-001', businessName: 'Dragon Store', revenue: 520000, orders: 312 },
          { id: '2', businessName: 'Sharma Electronics', revenue: 450000, orders: 234 },
          { id: '3', businessName: 'Patel Groceries', revenue: 380000, orders: 567 },
          { id: '4', businessName: 'Kumar Fashion', revenue: 320000, orders: 189 },
          { id: '5', businessName: 'Singh Hardware', revenue: 285000, orders: 145 },
        ],
        recentActivity: [
          {
            id: '1',
            type: 'seller_approved',
            description: 'New seller approved: Verma Traders',
            timestamp: '2026-03-07T01:30:00Z',
          },
          {
            id: '2',
            type: 'campaign_sent',
            description: 'AI campaign sent to 1,245 customers',
            timestamp: '2026-03-07T00:15:00Z',
          },
          {
            id: '3',
            type: 'insight_generated',
            description: '45 new AI insights generated for sellers',
            timestamp: '2026-03-06T23:00:00Z',
          },
          {
            id: '4',
            type: 'high_value_order',
            description: 'High-value order placed: ₹45,000',
            timestamp: '2026-03-06T22:45:00Z',
          },
        ],
      };
      setAnalytics(mockData);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-sm text-gray-600">Loading platform analytics...</p>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Failed to load analytics data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Platform Overview</h1>
        <p className="mt-1 text-sm text-gray-600">
          Real-time marketplace health and AI-powered insights
        </p>
      </div>

      {/* Key metrics */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Platform GMV"
          value={`₹${(analytics.totalGMV / 100000).toFixed(1)}L`}
          change="+18.2% from last month"
          icon={IndianRupee}
          trend="up"
        />
        <StatCard
          title="Active Sellers"
          value={analytics.activeSellers.toString()}
          change="12 pending approval"
          icon={Users}
          trend="neutral"
        />
        <StatCard
          title="Active Customers"
          value={analytics.activeCustomers.toLocaleString()}
          change="+1,234 this month"
          icon={UserCheck}
          trend="up"
        />
        <StatCard
          title="AI Insights Generated"
          value={analytics.aiInsightsGenerated.toLocaleString()}
          change="Last 30 days"
          icon={Sparkles}
          trend="neutral"
        />
      </div>

      {/* Top performers and activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top performing sellers */}
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Top Performing Sellers
            </h2>
            <TrendingUp className="h-5 w-5 text-green-600" />
          </div>
          <div className="space-y-3">
            {analytics.topSellers.map((seller, index) => (
              <div
                key={seller.id}
                className="flex items-center justify-between rounded-lg border p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {seller.businessName}
                    </p>
                    <p className="text-xs text-gray-500">{seller.orders} orders</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900">
                    ₹{(seller.revenue / 1000).toFixed(0)}K
                  </p>
                  <p className="text-xs text-gray-500">revenue</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent platform activity */}
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Recent Platform Activity
          </h2>
          <div className="space-y-4">
            {analytics.recentActivity.map((activity) => {
              const getActivityStyles = (type: string) => {
                switch (type) {
                  case 'seller_approved':
                    return { icon: UserCheck, bgClass: 'bg-green-100', textClass: 'text-green-600' };
                  case 'campaign_sent':
                    return { icon: Sparkles, bgClass: 'bg-purple-100', textClass: 'text-purple-600' };
                  case 'insight_generated':
                    return { icon: TrendingUp, bgClass: 'bg-blue-100', textClass: 'text-blue-600' };
                  case 'high_value_order':
                    return { icon: ShoppingBag, bgClass: 'bg-indigo-100', textClass: 'text-indigo-600' };
                  default:
                    return { icon: ShoppingBag, bgClass: 'bg-gray-100', textClass: 'text-gray-600' };
                }
              };

              const { icon: ActivityIcon, bgClass, textClass } = getActivityStyles(activity.type);
              const timeAgo = new Date(activity.timestamp).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
              });

              return (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className={`rounded-full ${bgClass} p-2`}>
                    <ActivityIcon className={`h-4 w-4 ${textClass}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {activity.description}
                    </p>
                    <p className="text-xs text-gray-400">{timeAgo}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
