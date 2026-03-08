'use client';

import { useEffect, useState } from 'react';
import { Megaphone, TrendingUp, Users, CheckCircle, XCircle, Clock } from 'lucide-react';

interface Campaign {
  id: string;
  insightId: string;
  insightType: string;
  insightTitle: string;
  discountPercent?: number;
  priceIncrease?: number;
  targetCustomers: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesFailed: number;
  estimatedConversions: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const fetchCampaigns = async () => {
      setLoading(true);
      setError(null);
      setTimeout(() => {
        setCampaigns([
          {
            id: 'camp-001',
            insightId: 'insight-005',
            insightType: 'dead_stock_alert',
            insightTitle: 'Clearance: Old Phone Cases',
            discountPercent: 40,
            targetCustomers: 234,
            messagesSent: 234,
            messagesDelivered: 218,
            messagesFailed: 16,
            estimatedConversions: 18,
            status: 'completed',
            createdAt: new Date(Date.now() - 604800000).toISOString(),
            completedAt: new Date(Date.now() - 518400000).toISOString(),
          },
          {
            id: 'camp-002',
            insightId: 'insight-006',
            insightType: 'pricing_recommendation',
            insightTitle: 'Summer Clearance: Winter Jackets',
            discountPercent: 25,
            targetCustomers: 156,
            messagesSent: 156,
            messagesDelivered: 148,
            messagesFailed: 8,
            estimatedConversions: 12,
            status: 'completed',
            createdAt: new Date(Date.now() - 1209600000).toISOString(),
            completedAt: new Date(Date.now() - 1123200000).toISOString(),
          },
        ]);
        setLoading(false);
      }, 400);
    };

  const calculateTotalMetrics = () => {
    return {
      totalCampaigns: campaigns.length,
      totalMessagesSent: campaigns.reduce((sum, c) => sum + c.messagesSent, 0),
      totalConversions: campaigns.reduce((sum, c) => sum + c.estimatedConversions, 0),
    };
  };

  const getStatusBadge = (status: Campaign['status']) => {
    const config = {
      pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
      in_progress: { label: 'In Progress', color: 'bg-blue-100 text-blue-800', icon: Clock },
      completed: { label: 'Completed', color: 'bg-green-100 text-green-800', icon: CheckCircle },
      failed: { label: 'Failed', color: 'bg-red-100 text-red-800', icon: XCircle },
    };
    return config[status] || config.pending;
  };

  const getInsightTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      dead_stock_alert: 'Dead Stock Alert',
      pricing_recommendation: 'Pricing Recommendation',
      market_trend: 'Market Trend',
    };
    return labels[type] || type;
  };

  const calculateDeliveryRate = (campaign: Campaign): number => {
    if (campaign.messagesSent === 0) return 0;
    return Math.round((campaign.messagesDelivered / campaign.messagesSent) * 100);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const metrics = calculateTotalMetrics();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campaign Tracker</h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor your automated AI-powered marketing campaigns
          </p>
        </div>
        <button
          onClick={fetchCampaigns}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Refresh
        </button>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Campaigns Run</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {metrics.totalCampaigns}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {campaigns.filter(c => c.status === 'completed').length} completed
              </p>
            </div>
            <div className="rounded-full bg-indigo-100 p-3">
              <Megaphone className="h-6 w-6 text-indigo-600" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Messages Sent</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {metrics.totalMessagesSent.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Across all campaigns
              </p>
            </div>
            <div className="rounded-full bg-blue-100 p-3">
              <Users className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Est. Conversions</p>
              <p className="mt-2 text-3xl font-bold text-green-600">
                {metrics.totalConversions}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Estimated sales generated
              </p>
            </div>
            <div className="rounded-full bg-green-100 p-3">
              <TrendingUp className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-indigo-600 border-r-transparent"></div>
            <p className="mt-2 text-sm text-gray-500">Loading campaigns...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="rounded-lg bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && campaigns.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <Megaphone className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No campaigns yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Campaigns will appear here once you approve AI insights from the Insights page
          </p>
        </div>
      )}

      {/* Campaigns Table */}
      {!loading && !error && campaigns.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-white shadow">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Insight Trigger
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Offer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Target Customers
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Delivery Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Est. Conversions
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {campaigns.map((campaign) => {
                  const statusConfig = getStatusBadge(campaign.status);
                  const StatusIcon = statusConfig.icon;
                  const deliveryRate = calculateDeliveryRate(campaign);

                  return (
                    <tr key={campaign.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">
                            {campaign.insightTitle}
                          </div>
                          <div className="text-gray-500">
                            {getInsightTypeLabel(campaign.insightType)}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        {campaign.discountPercent ? (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                            {campaign.discountPercent}% OFF
                          </span>
                        ) : campaign.priceIncrease ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                            +₹{campaign.priceIncrease}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-500">N/A</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {campaign.targetCustomers.toLocaleString()}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
                              <div
                                className={`h-full ${
                                  deliveryRate >= 80
                                    ? 'bg-green-500'
                                    : deliveryRate >= 50
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                                }`}
                                style={{ width: `${deliveryRate}%` }}
                              />
                            </div>
                            <span className="text-sm font-medium text-gray-900">
                              {deliveryRate}%
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {campaign.messagesDelivered}/{campaign.messagesSent} delivered
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm font-medium text-green-600">
                          {campaign.estimatedConversions}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusConfig.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {statusConfig.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {formatDate(campaign.createdAt)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info Banner */}
      {!loading && campaigns.length > 0 && (
        <div className="rounded-lg bg-blue-50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <Megaphone className="h-5 w-5 text-blue-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">
                How Automated Campaigns Work
              </h3>
              <div className="mt-2 text-sm text-blue-700">
                <p>
                  When you approve an AI insight, our system automatically creates a WhatsApp
                  campaign targeting relevant customers. Messages are sent via our AI bot,
                  and conversions are tracked based on customer responses and purchases.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
