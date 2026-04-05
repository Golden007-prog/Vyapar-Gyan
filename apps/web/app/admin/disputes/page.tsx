'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, Search, Filter, ChevronLeft, ChevronRight,
  ShieldAlert, Clock, CheckCircle, XCircle,
} from 'lucide-react';
import {
  listDisputes,
  type DisputeListItem,
  type DisputeStatus,
  type DisputeIssueType,
} from '@/lib/api-disputes';

// Mock data for demo / fallback
const MOCK_DISPUTES: DisputeListItem[] = [
  { disputeId: 'disp-001', orderId: 'ord-101', customerId: 'cust-001', sellerId: 'seller-001', customerName: 'Priya Sharma', sellerName: 'Dragon Store', issueType: 'wrong_item', status: 'open', createdAt: '2026-03-09T10:00:00Z', updatedAt: '2026-03-09T10:00:00Z' },
  { disputeId: 'disp-002', orderId: 'ord-102', customerId: 'cust-002', sellerId: 'seller-002', customerName: 'Rahul Verma', sellerName: 'Fresh Mart', issueType: 'not_delivered', status: 'in_progress', createdAt: '2026-03-08T14:00:00Z', updatedAt: '2026-03-09T08:00:00Z' },
  { disputeId: 'disp-003', orderId: 'ord-103', customerId: 'cust-003', sellerId: 'seller-001', customerName: 'Anita Patel', sellerName: 'Dragon Store', issueType: 'quality_issue', status: 'open', createdAt: '2026-03-07T16:00:00Z', updatedAt: '2026-03-07T16:00:00Z' },
  { disputeId: 'disp-004', orderId: 'ord-104', customerId: 'cust-004', sellerId: 'seller-003', customerName: 'Vikram Singh', sellerName: 'Kirana King', issueType: 'refund_request', status: 'resolved', createdAt: '2026-03-05T09:00:00Z', updatedAt: '2026-03-06T11:00:00Z' },
  { disputeId: 'disp-005', orderId: 'ord-105', customerId: 'cust-005', sellerId: 'seller-002', customerName: 'Meera Joshi', sellerName: 'Fresh Mart', issueType: 'payment_failed', status: 'dismissed', createdAt: '2026-03-04T12:00:00Z', updatedAt: '2026-03-04T15:00:00Z' },
  { disputeId: 'disp-006', orderId: 'ord-106', customerId: 'cust-006', sellerId: 'seller-001', customerName: 'Arjun Reddy', sellerName: 'Dragon Store', issueType: 'not_delivered', status: 'open', createdAt: '2026-03-10T07:00:00Z', updatedAt: '2026-03-10T07:00:00Z' },
];

const ISSUE_TYPE_LABELS: Record<DisputeIssueType, string> = {
  wrong_item: 'Wrong Item',
  not_delivered: 'Not Delivered',
  quality_issue: 'Quality Issue',
  refund_request: 'Refund Request',
  payment_failed: 'Payment Failed',
};

const STATUS_CONFIG: Record<DisputeStatus, { label: string; color: string; icon: React.ElementType }> = {
  open: { label: 'Open', color: 'bg-red-100 text-red-700', icon: ShieldAlert },
  in_progress: { label: 'In Progress', color: 'bg-amber-100 text-amber-700', icon: Clock },
  resolved: { label: 'Resolved', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  dismissed: { label: 'Dismissed', color: 'bg-gray-100 text-gray-600', icon: XCircle },
};

export default function DisputesPage() {
  const router = useRouter();
  const [disputes, setDisputes] = useState<DisputeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<DisputeStatus | ''>('');
  const [issueTypeFilter, setIssueTypeFilter] = useState<DisputeIssueType | ''>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const loadDisputes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listDisputes({
        status: statusFilter || undefined,
        issue_type: issueTypeFilter || undefined,
        page,
        size: 20,
      });
      setDisputes(data.disputes);
      setTotalPages(data.totalPages);
      setTotal(data.total);
    } catch {
      // Fallback to mock data
      let filtered = [...MOCK_DISPUTES];
      if (statusFilter) filtered = filtered.filter((d) => d.status === statusFilter);
      if (issueTypeFilter) filtered = filtered.filter((d) => d.issueType === issueTypeFilter);
      filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setDisputes(filtered);
      setTotalPages(1);
      setTotal(filtered.length);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, issueTypeFilter, page]);

  useEffect(() => { loadDisputes(); }, [loadDisputes]);

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const statusBadge = (status: DisputeStatus) => {
    const cfg = STATUS_CONFIG[status];
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
        <cfg.icon className="h-3 w-3" />
        {cfg.label}
      </span>
    );
  };

  const issueTypeBadge = (type: DisputeIssueType) => {
    const colors: Record<DisputeIssueType, string> = {
      wrong_item: 'bg-orange-100 text-orange-700',
      not_delivered: 'bg-red-100 text-red-700',
      quality_issue: 'bg-yellow-100 text-yellow-700',
      refund_request: 'bg-blue-100 text-blue-700',
      payment_failed: 'bg-purple-100 text-purple-700',
    };
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[type]}`}>
        {ISSUE_TYPE_LABELS[type]}
      </span>
    );
  };

  // Count by status for summary
  const openCount = MOCK_DISPUTES.filter((d) => d.status === 'open').length;
  const inProgressCount = MOCK_DISPUTES.filter((d) => d.status === 'in_progress').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-sm text-gray-600">Loading disputes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dispute Resolution</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review flagged orders, manage disputes, and take resolution actions.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={AlertTriangle} label="Total Disputes" value={String(total)} color="indigo" />
        <SummaryCard icon={ShieldAlert} label="Open" value={String(openCount)} color="red" />
        <SummaryCard icon={Clock} label="In Progress" value={String(inProgressCount)} color="amber" />
        <SummaryCard icon={CheckCircle} label="Resolved" value={String(MOCK_DISPUTES.filter((d) => d.status === 'resolved').length)} color="green" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as DisputeStatus | ''); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <select
            value={issueTypeFilter}
            onChange={(e) => { setIssueTypeFilter(e.target.value as DisputeIssueType | ''); setPage(1); }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">All Issue Types</option>
            <option value="wrong_item">Wrong Item</option>
            <option value="not_delivered">Not Delivered</option>
            <option value="quality_issue">Quality Issue</option>
            <option value="refund_request">Refund Request</option>
            <option value="payment_failed">Payment Failed</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Order ID', 'Customer', 'Seller', 'Issue Type', 'Status', 'Created'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {disputes.map((d) => (
                <tr
                  key={d.disputeId}
                  onClick={() => router.push(`/admin/disputes/${d.disputeId}`)}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-indigo-600">{d.orderId}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 text-xs font-medium">
                        {d.customerName.charAt(0)}
                      </div>
                      <span className="text-sm text-gray-900">{d.customerName}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{d.sellerName}</td>
                  <td className="whitespace-nowrap px-4 py-3">{issueTypeBadge(d.issueType)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{statusBadge(d.status)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">{formatDate(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {disputes.length === 0 && (
          <div className="py-12 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-2 text-sm text-gray-600">No disputes found</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">Page {page} of {totalPages}</p>
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

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string;
  color: 'indigo' | 'red' | 'amber' | 'green';
}) {
  const colors = {
    indigo: 'bg-indigo-100 text-indigo-600',
    red: 'bg-red-100 text-red-600',
    amber: 'bg-amber-100 text-amber-600',
    green: 'bg-green-100 text-green-600',
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
