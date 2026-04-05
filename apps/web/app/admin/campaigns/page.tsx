'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Megaphone, Filter, ChevronLeft, ChevronRight, TrendingUp,
  BarChart3, Eye, Flag, Ban, ArrowLeft, Users, Percent, DollarSign,
} from 'lucide-react';
import {
  listAdminCampaigns,
  getAdminCampaignDetail,
  flagCampaign,
  blockCampaign,
  type AdminCampaignRecord,
  type AggregateMetrics,
  type DeliveryLogEntry,
  type CampaignStatus,
} from '@/lib/api-admin-campaigns';

// Mock data for demo / fallback
const MOCK_METRICS: AggregateMetrics = {
  totalCampaigns30d: 24,
  avgOpenRate: 42.5,
  avgConversionRate: 8.3,
  totalRevenue: 125000,
};

const MOCK_CAMPAIGNS: AdminCampaignRecord[] = [
  { campaignId: 'camp-001', sellerId: 'seller-001', sellerName: 'Dragon Store', status: 'sent', messageText: '20% off on Dairy products!', estimatedReach: 150, sentCount: 142, deliveredCount: 138, readCount: 65, conversionCount: 12, revenueImpact: 18000, channel: 'whatsapp', executedAt: '2026-03-10T10:00:00Z', createdAt: '2026-03-09T08:00:00Z', updatedAt: '2026-03-10T10:00:00Z' },
  { campaignId: 'camp-002', sellerId: 'seller-002', sellerName: 'Fresh Mart', status: 'sent', messageText: 'Buy 1 Get 1 on Snacks', estimatedReach: 200, sentCount: 185, deliveredCount: 180, readCount: 90, conversionCount: 18, revenueImpact: 27000, channel: 'both', executedAt: '2026-03-09T14:00:00Z', createdAt: '2026-03-08T12:00:00Z', updatedAt: '2026-03-09T14:00:00Z' },
  { campaignId: 'camp-003', sellerId: 'seller-003', sellerName: 'Kirana King', status: 'scheduled', messageText: 'Flash sale on Beverages', estimatedReach: 80, sentCount: 0, deliveredCount: 0, readCount: 0, conversionCount: 0, revenueImpact: 0, channel: 'web', scheduledAt: '2026-03-12T09:00:00Z', createdAt: '2026-03-10T16:00:00Z', updatedAt: '2026-03-10T16:00:00Z' },
  { campaignId: 'camp-004', sellerId: 'seller-001', sellerName: 'Dragon Store', status: 'failed', messageText: 'Weekend special on Rice', estimatedReach: 120, sentCount: 45, deliveredCount: 30, readCount: 5, conversionCount: 1, revenueImpact: 500, channel: 'whatsapp', executedAt: '2026-03-07T11:00:00Z', createdAt: '2026-03-06T09:00:00Z', updatedAt: '2026-03-07T11:00:00Z' },
  { campaignId: 'camp-005', sellerId: 'seller-002', sellerName: 'Fresh Mart', status: 'flagged', messageText: 'Clearance sale on Spices', estimatedReach: 90, sentCount: 88, deliveredCount: 85, readCount: 10, conversionCount: 0, revenueImpact: 0, channel: 'whatsapp', executedAt: '2026-03-05T15:00:00Z', createdAt: '2026-03-04T10:00:00Z', updatedAt: '2026-03-05T15:00:00Z' },
];

const MOCK_DELIVERIES: DeliveryLogEntry[] = [
  { customerId: 'cust-001', channel: 'whatsapp', sentAt: '2026-03-10T10:00:00Z', deliveredAt: '2026-03-10T10:00:02Z', readAt: '2026-03-10T10:05:00Z', convertedAt: '2026-03-10T10:30:00Z', status: 'converted' },
  { customerId: 'cust-002', channel: 'whatsapp', sentAt: '2026-03-10T10:00:00Z', deliveredAt: '2026-03-10T10:00:03Z', readAt: '2026-03-10T10:12:00Z', status: 'read' },
  { customerId: 'cust-003', channel: 'web', sentAt: '2026-03-10T10:00:00Z', deliveredAt: '2026-03-10T10:00:01Z', status: 'delivered' },
  { customerId: 'cust-004', channel: 'whatsapp', sentAt: '2026-03-10T10:00:00Z', status: 'sent' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-600' },
  scheduled: { label: 'Scheduled', color: 'bg-blue-100 text-blue-700' },
  sending: { label: 'Sending', color: 'bg-amber-100 text-amber-700' },
  sent: { label: 'Sent', color: 'bg-green-100 text-green-700' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700' },
  flagged: { label: 'Flagged', color: 'bg-orange-100 text-orange-700' },
  blocked: { label: 'Blocked', color: 'bg-red-200 text-red-800' },
};

const CHANNEL_CONFIG: Record<string, { label: string; color: string }> = {
  whatsapp: { label: 'WhatsApp', color: 'bg-green-50 text-green-700' },
  web: { label: 'Web Chat', color: 'bg-indigo-50 text-indigo-700' },
  both: { label: 'Both', color: 'bg-purple-50 text-purple-700' },
};

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<AdminCampaignRecord[]>([]);
  const [metrics, setMetrics] = useState<AggregateMetrics>(MOCK_METRICS);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Detail view
  const [selectedCampaign, setSelectedCampaign] = useState<AdminCampaignRecord | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryLogEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | ''>('');
  const [channelFilter, setChannelFilter] = useState('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAdminCampaigns({
        seller: sellerFilter || undefined,
        channel: channelFilter || undefined,
        status: (statusFilter as CampaignStatus) || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        page,
        size: 20,
      });
      setCampaigns(res.campaigns);
      setMetrics(res.metrics);
      setTotalPages(res.totalPages);
      setTotal(res.total);
    } catch {
      // Fallback to mock data
      let filtered = [...MOCK_CAMPAIGNS];
      if (statusFilter) filtered = filtered.filter((c) => c.status === statusFilter);
      if (channelFilter) filtered = filtered.filter((c) => c.channel === channelFilter);
      if (sellerFilter) filtered = filtered.filter((c) => c.sellerName.toLowerCase().includes(sellerFilter.toLowerCase()));
      if (dateFrom) filtered = filtered.filter((c) => c.createdAt >= dateFrom);
      if (dateTo) filtered = filtered.filter((c) => c.createdAt <= dateTo);
      filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setCampaigns(filtered);
      setMetrics(MOCK_METRICS);
      setTotalPages(1);
      setTotal(filtered.length);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, channelFilter, sellerFilter, dateFrom, dateTo, page]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleViewDetail = async (campaign: AdminCampaignRecord) => {
    setSelectedCampaign(campaign);
    setDetailLoading(true);
    try {
      const res = await getAdminCampaignDetail(campaign.campaignId);
      setDeliveries(res.deliveries);
    } catch {
      setDeliveries(MOCK_DELIVERIES);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleFlag = async (campaignId: string) => {
    setActionLoading(campaignId);
    try {
      await flagCampaign(campaignId, 'Low performance');
      await loadData();
    } catch {
      setCampaigns((prev) =>
        prev.map((c) => c.campaignId === campaignId ? { ...c, status: 'flagged' as CampaignStatus } : c),
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleBlock = async (campaignId: string) => {
    setActionLoading(campaignId);
    try {
      await blockCampaign(campaignId, 'Blocked by admin');
      await loadData();
    } catch {
      setCampaigns((prev) =>
        prev.map((c) => c.campaignId === campaignId ? { ...c, status: 'blocked' as CampaignStatus } : c),
      );
    } finally {
      setActionLoading(null);
    }
  };

  const formatCurrency = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;
  const formatDate = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const formatTime = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const formatRate = (count: number, total: number) => {
    if (total === 0) return '0%';
    return `${((count / total) * 100).toFixed(1)}%`;
  };

  // Detail view
  if (selectedCampaign) {
    return (
      <CampaignDetailView
        campaign={selectedCampaign}
        deliveries={deliveries}
        loading={detailLoading}
        onBack={() => { setSelectedCampaign(null); setDeliveries([]); }}
        formatTime={formatTime}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-sm text-gray-600">Loading campaigns...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Campaign Oversight</h1>
        <p className="mt-1 text-sm text-gray-500">
          Monitor AI-generated campaigns across all sellers with performance metrics.
        </p>
      </div>

      {/* Aggregate Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={Megaphone} label="Total Campaigns (30d)" value={String(metrics.totalCampaigns30d)} color="indigo" />
        <MetricCard icon={Eye} label="Avg Open Rate" value={`${metrics.avgOpenRate}%`} color="green" />
        <MetricCard icon={Percent} label="Avg Conversion Rate" value={`${metrics.avgConversionRate}%`} color="amber" />
        <MetricCard icon={DollarSign} label="Total Revenue" value={formatCurrency(metrics.totalRevenue)} color="emerald" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:flex-wrap">
        <Filter className="h-4 w-4 text-gray-400 hidden sm:block" />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as CampaignStatus | ''); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="sending">Sending</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="flagged">Flagged</option>
          <option value="blocked">Blocked</option>
        </select>
        <select
          value={channelFilter}
          onChange={(e) => { setChannelFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All Channels</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="web">Web Chat</option>
          <option value="both">Both</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <input
          type="text"
          value={sellerFilter}
          onChange={(e) => { setSellerFilter(e.target.value); setPage(1); }}
          placeholder="Seller ID"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-32"
        />
      </div>

      {/* Campaigns Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Campaign', 'Seller', 'Channel', 'Status', 'Sent', 'Open Rate', 'Conv. Rate', 'Revenue', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {campaigns.map((c) => (
                <tr key={c.campaignId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="max-w-[200px]">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.messageText}</p>
                      <p className="text-xs text-gray-500">{formatDate(c.createdAt)}</p>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 text-xs font-medium">
                        {c.sellerName.charAt(0)}
                      </div>
                      <span className="text-sm text-gray-900">{c.sellerName}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <ChannelBadge channel={c.channel || 'whatsapp'} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">{c.sentCount.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">{formatRate(c.readCount, c.sentCount)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">{formatRate(c.conversionCount, c.sentCount)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-emerald-600">{formatCurrency(c.revenueImpact)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleViewDetail(c)}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-indigo-600"
                        title="View delivery log"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      {c.status !== 'flagged' && c.status !== 'blocked' && (
                        <button
                          onClick={() => handleFlag(c.campaignId)}
                          disabled={actionLoading === c.campaignId}
                          className="rounded p-1 text-gray-500 hover:bg-orange-50 hover:text-orange-600 disabled:opacity-50"
                          title="Flag campaign"
                        >
                          <Flag className="h-4 w-4" />
                        </button>
                      )}
                      {c.status !== 'blocked' && (
                        <button
                          onClick={() => handleBlock(c.campaignId)}
                          disabled={actionLoading === c.campaignId}
                          className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          title="Block campaign"
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {campaigns.length === 0 && (
          <div className="py-12 text-center">
            <Megaphone className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-2 text-sm text-gray-600">No campaigns found</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">Page {page} of {totalPages} ({total} total)</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50">
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ========================================================================
// Sub-components
// ========================================================================

function CampaignDetailView({
  campaign,
  deliveries,
  loading,
  onBack,
  formatTime,
}: {
  campaign: AdminCampaignRecord;
  deliveries: DeliveryLogEntry[];
  loading: boolean;
  onBack: () => void;
  formatTime: (iso: string) => string;
}) {
  return (
    <div className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-800">
        <ArrowLeft className="h-4 w-4" /> Back to campaigns
      </button>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Campaign Detail</h1>
        <p className="mt-1 text-sm text-gray-500">{campaign.messageText}</p>
      </div>

      {/* Campaign summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">Seller</p>
          <p className="text-lg font-semibold text-gray-900">{campaign.sellerName}</p>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">Status</p>
          <div className="mt-1"><StatusBadge status={campaign.status} /></div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">Sent / Delivered / Read</p>
          <p className="text-lg font-semibold text-gray-900">
            {campaign.sentCount} / {campaign.deliveredCount} / {campaign.readCount}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-600">Conversions / Revenue</p>
          <p className="text-lg font-semibold text-emerald-600">
            {campaign.conversionCount} / ₹{campaign.revenueImpact.toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {/* Delivery log */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <Users className="h-4 w-4" /> Per-Customer Delivery Log
          </h2>
        </div>

        {loading ? (
          <div className="py-12 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto" />
            <p className="mt-2 text-sm text-gray-600">Loading delivery log...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Customer', 'Channel', 'Sent', 'Delivered', 'Read', 'Ordered', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {deliveries.map((d, i) => (
                  <tr key={`${d.customerId}-${i}`} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-indigo-600">{d.customerId}</td>
                    <td className="whitespace-nowrap px-4 py-3"><ChannelBadge channel={d.channel} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatTime(d.sentAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{d.deliveredAt ? formatTime(d.deliveredAt) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{d.readAt ? formatTime(d.readAt) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{d.convertedAt ? formatTime(d.convertedAt) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <DeliveryStatusBadge status={d.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && deliveries.length === 0 && (
          <div className="py-12 text-center">
            <Users className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-2 text-sm text-gray-600">No delivery records found</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string;
  color: 'indigo' | 'green' | 'amber' | 'emerald';
}) {
  const colors = {
    indigo: 'bg-indigo-100 text-indigo-600',
    green: 'bg-green-100 text-green-600',
    amber: 'bg-amber-100 text-amber-600',
    emerald: 'bg-emerald-100 text-emerald-600',
  };
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`rounded-full p-2 ${colors[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-gray-600">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const cfg = CHANNEL_CONFIG[channel] || { label: channel, color: 'bg-gray-50 text-gray-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function DeliveryStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    sent: { label: 'Sent', color: 'bg-blue-100 text-blue-700' },
    delivered: { label: 'Delivered', color: 'bg-green-100 text-green-700' },
    read: { label: 'Read', color: 'bg-emerald-100 text-emerald-700' },
    converted: { label: 'Ordered', color: 'bg-purple-100 text-purple-700' },
    failed: { label: 'Failed', color: 'bg-red-100 text-red-700' },
  };
  const cfg = map[status] || { label: status, color: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}
