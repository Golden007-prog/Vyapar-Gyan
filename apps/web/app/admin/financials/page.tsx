'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  DollarSign, TrendingUp, Clock, AlertTriangle, Download,
  RefreshCw, Filter, ChevronLeft, ChevronRight, BarChart3,
} from 'lucide-react';
import {
  getFinancialSummary,
  listTransactions,
  retryTransfer,
  exportTransactionsCSV,
  type FinancialSummary,
  type TransactionRecord,
  type TransferStatus,
} from '@/lib/api-financials';

// Mock data for demo / fallback
const MOCK_SUMMARY: FinancialSummary = {
  totalPlatformRevenue: 485000,
  totalCommissionEarned: 48500,
  pendingSettlements: 3,
  failedPayouts: 1,
};

const MOCK_TRANSACTIONS: TransactionRecord[] = [
  { transferId: 'txn-001', orderId: 'ord-201', sellerId: 'seller-001', sellerName: 'Dragon Store', orderAmount: 2500, commissionRate: 0.10, commissionAmount: 250, sellerAmount: 2250, transferStatus: 'completed', razorpayTransferId: 'trf_abc123', createdAt: '2026-03-10T14:00:00Z', updatedAt: '2026-03-10T14:00:00Z' },
  { transferId: 'txn-002', orderId: 'ord-202', sellerId: 'seller-002', sellerName: 'Fresh Mart', orderAmount: 1800, commissionRate: 0.10, commissionAmount: 180, sellerAmount: 1620, transferStatus: 'completed', razorpayTransferId: 'trf_def456', createdAt: '2026-03-09T11:00:00Z', updatedAt: '2026-03-09T11:00:00Z' },
  { transferId: 'txn-003', orderId: 'ord-203', sellerId: 'seller-001', sellerName: 'Dragon Store', orderAmount: 3200, commissionRate: 0.10, commissionAmount: 320, sellerAmount: 2880, transferStatus: 'pending', razorpayTransferId: 'trf_ghi789', createdAt: '2026-03-09T09:00:00Z', updatedAt: '2026-03-09T09:00:00Z' },
  { transferId: 'txn-004', orderId: 'ord-204', sellerId: 'seller-003', sellerName: 'Kirana King', orderAmount: 950, commissionRate: 0.10, commissionAmount: 95, sellerAmount: 855, transferStatus: 'failed', razorpayTransferId: 'trf_jkl012', createdAt: '2026-03-08T16:00:00Z', updatedAt: '2026-03-08T16:00:00Z' },
  { transferId: 'txn-005', orderId: 'ord-205', sellerId: 'seller-002', sellerName: 'Fresh Mart', orderAmount: 4100, commissionRate: 0.10, commissionAmount: 410, sellerAmount: 3690, transferStatus: 'completed', razorpayTransferId: 'trf_mno345', createdAt: '2026-03-07T10:00:00Z', updatedAt: '2026-03-07T10:00:00Z' },
  { transferId: 'txn-006', orderId: 'ord-206', sellerId: 'seller-001', sellerName: 'Dragon Store', orderAmount: 1500, commissionRate: 0.10, commissionAmount: 150, sellerAmount: 1350, transferStatus: 'reversed', razorpayTransferId: 'trf_pqr678', createdAt: '2026-03-06T13:00:00Z', updatedAt: '2026-03-06T13:00:00Z' },
];

const STATUS_CONFIG: Record<TransferStatus, { label: string; color: string }> = {
  completed: { label: 'Completed', color: 'bg-green-100 text-green-700' },
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-700' },
  failed: { label: 'Failed', color: 'bg-red-100 text-red-700' },
  reversed: { label: 'Reversed', color: 'bg-gray-100 text-gray-600' },
};

export default function FinancialsPage() {
  const [summary, setSummary] = useState<FinancialSummary>(MOCK_SUMMARY);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<TransferStatus | ''>('');
  const [sellerFilter, setSellerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Chart view toggle
  const [chartView, setChartView] = useState<'trend' | 'seller'>('trend');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, txnRes] = await Promise.all([
        getFinancialSummary(),
        listTransactions({
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          seller: sellerFilter || undefined,
          status: statusFilter || undefined,
          page,
          size: 20,
        }),
      ]);
      setSummary(summaryRes.summary);
      setTransactions(txnRes.transactions);
      setTotalPages(txnRes.totalPages);
      setTotal(txnRes.total);
    } catch {
      // Fallback to mock data
      setSummary(MOCK_SUMMARY);
      let filtered = [...MOCK_TRANSACTIONS];
      if (statusFilter) filtered = filtered.filter((t) => t.transferStatus === statusFilter);
      if (sellerFilter) filtered = filtered.filter((t) => t.sellerName.toLowerCase().includes(sellerFilter.toLowerCase()));
      if (dateFrom) filtered = filtered.filter((t) => t.createdAt >= dateFrom);
      if (dateTo) filtered = filtered.filter((t) => t.createdAt <= dateTo);
      filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setTransactions(filtered);
      setTotalPages(1);
      setTotal(filtered.length);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sellerFilter, dateFrom, dateTo, page]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRetry = async (transferId: string) => {
    setRetrying(transferId);
    try {
      await retryTransfer(transferId);
      await loadData();
    } catch {
      // Update locally for demo
      setTransactions((prev) =>
        prev.map((t) => t.transferId === transferId ? { ...t, transferStatus: 'pending' as TransferStatus } : t),
      );
    } finally {
      setRetrying(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await exportTransactionsCSV({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        seller: sellerFilter || undefined,
        status: statusFilter || undefined,
      });
      // Trigger download
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financials-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: generate CSV from current data
      const header = 'Date,Order ID,Seller,Order Amount,Commission %,Commission Amount,Seller Amount,Status';
      const rows = transactions.map((t) =>
        `${t.createdAt},${t.orderId},"${t.sellerName}",${t.orderAmount.toFixed(2)},${(t.commissionRate * 100).toFixed(1)},${t.commissionAmount.toFixed(2)},${t.sellerAmount.toFixed(2)},${t.transferStatus}`,
      );
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financials-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const formatCurrency = (amount: number) =>
    `₹${amount.toLocaleString('en-IN')}`;

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const statusBadge = (status: TransferStatus) => {
    const cfg = STATUS_CONFIG[status];
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
        {cfg.label}
      </span>
    );
  };

  // Compute chart data from transactions (or mock)
  const chartData = transactions.length > 0 ? transactions : MOCK_TRANSACTIONS;

  // Daily commission trend
  const dailyTrend = computeDailyTrend(chartData);
  const maxDailyCommission = Math.max(...dailyTrend.map((d) => d.commission), 1);

  // Commission by seller
  const sellerBreakdown = computeSellerBreakdown(chartData);
  const maxSellerCommission = Math.max(...sellerBreakdown.map((s) => s.commission), 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-sm text-gray-600">Loading financials...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Financials</h1>
          <p className="mt-1 text-sm text-gray-500">
            Platform revenue, commission tracking, and Razorpay Route transactions.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={DollarSign} label="Total Platform Revenue" value={formatCurrency(summary.totalPlatformRevenue)} color="indigo" />
        <SummaryCard icon={TrendingUp} label="Total Commission Earned" value={formatCurrency(summary.totalCommissionEarned)} color="green" />
        <SummaryCard icon={Clock} label="Pending Settlements" value={String(summary.pendingSettlements)} color="amber" />
        <SummaryCard icon={AlertTriangle} label="Failed Payouts" value={String(summary.failedPayouts)} color="red" />
      </div>

      {/* Charts */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Commission Analytics</h2>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              onClick={() => setChartView('trend')}
              className={`px-3 py-1.5 text-xs font-medium ${chartView === 'trend' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              Daily Trend
            </button>
            <button
              onClick={() => setChartView('seller')}
              className={`px-3 py-1.5 text-xs font-medium ${chartView === 'seller' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              By Seller
            </button>
          </div>
        </div>

        {chartView === 'trend' ? (
          <div className="h-48">
            <div className="flex items-end gap-1 h-full">
              {dailyTrend.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div
                    className="w-full bg-indigo-500 rounded-t transition-all"
                    style={{ height: `${(d.commission / maxDailyCommission) * 100}%`, minHeight: d.commission > 0 ? '4px' : '0' }}
                    title={`${d.date}: ${formatCurrency(d.commission)}`}
                  />
                  <span className="text-[10px] text-gray-500 mt-1 truncate w-full text-center">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {sellerBreakdown.map((s) => (
              <div key={s.seller} className="flex items-center gap-3">
                <span className="w-28 text-sm text-gray-700 truncate">{s.seller}</span>
                <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${(s.commission / maxSellerCommission) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-gray-900 w-20 text-right">{formatCurrency(s.commission)}</span>
              </div>
            ))}
            {sellerBreakdown.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No data available</p>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as TransferStatus | ''); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="reversed">Reversed</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            placeholder="From"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            placeholder="To"
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
      </div>

      {/* Transactions Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Date', 'Order ID', 'Seller', 'Order Amount', 'Commission %', 'Commission', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {transactions.map((t) => (
                <tr key={t.transferId} className="hover:bg-gray-50 transition-colors">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDate(t.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-indigo-600">{t.orderId}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 text-xs font-medium">
                        {t.sellerName.charAt(0)}
                      </div>
                      <span className="text-sm text-gray-900">{t.sellerName}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{formatCurrency(t.orderAmount)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{(t.commissionRate * 100).toFixed(1)}%</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-emerald-600">{formatCurrency(t.commissionAmount)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{statusBadge(t.transferStatus)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {t.transferStatus === 'failed' && (
                      <button
                        onClick={() => handleRetry(t.transferId)}
                        disabled={retrying === t.transferId}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3 w-3 ${retrying === t.transferId ? 'animate-spin' : ''}`} />
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {transactions.length === 0 && (
          <div className="py-12 text-center">
            <BarChart3 className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-2 text-sm text-gray-600">No transactions found</p>
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
// Helper Components & Functions
// ========================================================================

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string;
  color: 'indigo' | 'green' | 'amber' | 'red';
}) {
  const colors = {
    indigo: 'bg-indigo-100 text-indigo-600',
    green: 'bg-green-100 text-green-600',
    amber: 'bg-amber-100 text-amber-600',
    red: 'bg-red-100 text-red-600',
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

function computeDailyTrend(transactions: TransactionRecord[]): { date: string; commission: number }[] {
  const map = new Map<string, number>();
  for (const t of transactions) {
    const date = t.createdAt.slice(0, 10);
    map.set(date, (map.get(date) || 0) + t.commissionAmount);
  }
  const entries = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14); // Last 14 days
  return entries.map(([date, commission]) => ({ date, commission: Math.round(commission) }));
}

function computeSellerBreakdown(transactions: TransactionRecord[]): { seller: string; commission: number }[] {
  const map = new Map<string, number>();
  for (const t of transactions) {
    const name = t.sellerName || t.sellerId;
    map.set(name, (map.get(name) || 0) + t.commissionAmount);
  }
  return Array.from(map.entries())
    .map(([seller, commission]) => ({ seller, commission: Math.round(commission) }))
    .sort((a, b) => b.commission - a.commission);
}
