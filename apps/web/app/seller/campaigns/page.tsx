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
  channel: 'web' | 'whatsapp' | 'both';
  webSent: number;
  webDelivered: number;
  whatsappSent: number;
  whatsappDelivered: number;
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
            channel: 'both',
            webSent: 120,
            webDelivered: 118,
            whatsappSent: 114,
            whatsappDelivered: 100,
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
            channel: 'whatsapp',
            webSent: 0,
            webDelivered: 0,
            whatsappSent: 156,
            whatsappDelivered: 148,
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

  const getChannelBadge = (ch: Campaign['channel']) => {
    const config = {
      web: { label: 'Web Chat', color: 'bg-purple-100 text-purple-800' },
      whatsapp: { label: 'WhatsApp', color: 'bg-green-100 text-green-800' },
      both: { label: 'Both', color: 'bg-indigo-100 text-indigo-800' },
    };
    return config[ch] || config.web;
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Campaign Tracker</h1>
          <p className="mt-1 text-sm text-gray-500">
            Monitor your automated AI-powered marketing campaigns
          </p>
        </div>
        <button
          onClick={fetchCampaigns}
          className="self-start rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
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

      {/* Mobile Campaign Cards */}
      {!loading && !error && campaigns.length > 0 && (
        <div className="space-y-3 md:hidden">
          {campaigns.map((campaign) => {
            const statusConfig = getStatusBadge(campaign.status);
            const StatusIcon = statusConfig.icon;
            const deliveryRate = calculateDeliveryRate(campaign);
            const channelBadge = getChannelBadge(campaign.channel);

            return (
              <div key={campaign.id} className="rounded-lg border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{campaign.insightTitle}</p>
                    <p className="text-xs text-gray-500">{getInsightTypeLabel(campaign.insightType)}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${statusConfig.color}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {campaign.discountPercent ? (
                    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                      {campaign.discountPercent}% OFF
                    </span>
                  ) : campaign.priceIncrease ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      +₹{campaign.priceIncrease}
                    </span>
                  ) : null}
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${channelBadge.color}`}>
                    {channelBadge.label}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-gray-500">Target</p>
                    <p className="font-medium text-gray-900">{campaign.targetCustomers.toLocaleString()} customers</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Est. Conversions</p>
                    <p className="font-medium text-green-600">{campaign.estimatedConversions}</p>
                  </div>
                </div>

                {/* Delivery progress */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Delivery Rate</span>
                    <span className="font-medium text-gray-900">{deliveryRate}%</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full ${deliveryRate >= 80 ? 'bg-green-500' : deliveryRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${deliveryRate}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-gray-400">{campaign.messagesDelivered}/{campaign.messagesSent} delivered</p>
                </div>

                {/* Channel breakdown */}
                {campaign.channel === 'both' && (
                  <div className="mt-3 flex gap-4 text-xs text-gray-600">
                    <span>Web: {campaign.webSent}/{campaign.webDelivered}</span>
                    <span>WhatsApp: {campaign.whatsappSent}/{campaign.whatsappDelivered}</span>
                  </div>
                )}

                <p className="mt-3 text-[11px] text-gray-400">{formatDate(campaign.createdAt)}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Desktop Campaigns Table */}
      {!loading && !error && campaigns.length > 0 && (
        <div className="hidden md:block overflow-hidden rounded-lg border bg-white shadow">
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
                    Channel
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Target Customers
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Delivery Rate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Web Sent / Delivered
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    WhatsApp Sent / Delivered
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
                  const channelBadge = getChannelBadge(campaign.channel);

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
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${channelBadge.color}`}>
                          {channelBadge.label}
                        </span>
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
                        <div className="text-sm text-gray-900">
                          {campaign.webSent} / {campaign.webDelivered}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm text-gray-900">
                          {campaign.whatsappSent} / {campaign.whatsappDelivered}
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
