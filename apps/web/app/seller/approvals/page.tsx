'use client';

import { useState } from 'react';
import { ShieldCheck, IndianRupee, CheckCircle, XCircle, Clock } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';

type FilterTab = 'pending_review' | 'approved' | 'rejected' | 'all';

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'pending_review', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

const typeBadge: Record<string, { bg: string; text: string; label: string }> = {
  discount: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Discount' },
  campaign: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Campaign' },
  price_change: { bg: 'bg-green-100', text: 'text-green-800', label: 'Price Change' },
  stock_alert: { bg: 'bg-red-100', text: 'text-red-800', label: 'Stock Alert' },
  dead_stock_liquidation: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Dead Stock' },
  reorder_suggestion: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Reorder' },
};

interface DemoApproval {
  approvalId: string;
  type: string;
  status: 'pending_review' | 'approved' | 'rejected';
  aiRationale: string;
  affectedProductCount: number;
  estimatedImpact: number;
  priorityScore: number;
  createdAt: string;
}

const DEMO_APPROVALS: DemoApproval[] = [
  {
    approvalId: 'appr-001',
    type: 'dead_stock_liquidation',
    status: 'pending_review',
    aiRationale: 'Old Phone Cases have been in stock for 120+ days with zero sales. Recommend 40% discount to clear inventory before monsoon season.',
    affectedProductCount: 3,
    estimatedImpact: 4500,
    priorityScore: 9.2,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    approvalId: 'appr-002',
    type: 'price_change',
    status: 'pending_review',
    aiRationale: 'Amul Butter 500g is priced ₹280 but market average is ₹265. Consider reducing to ₹270 to stay competitive.',
    affectedProductCount: 1,
    estimatedImpact: 1200,
    priorityScore: 7.5,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    approvalId: 'appr-003',
    type: 'reorder_suggestion',
    status: 'pending_review',
    aiRationale: 'Tata Salt 1kg stock is at 4 units. Based on 15 units/week sales velocity, reorder 50 units to avoid stockout.',
    affectedProductCount: 1,
    estimatedImpact: 750,
    priorityScore: 8.1,
    createdAt: new Date(Date.now() - 14400000).toISOString(),
  },
  {
    approvalId: 'appr-004',
    type: 'campaign',
    status: 'approved',
    aiRationale: 'Summer clearance campaign for winter jackets. 25% discount sent to 156 past customers via WhatsApp.',
    affectedProductCount: 5,
    estimatedImpact: 12000,
    priorityScore: 8.8,
    createdAt: new Date(Date.now() - 604800000).toISOString(),
  },
  {
    approvalId: 'appr-005',
    type: 'discount',
    status: 'rejected',
    aiRationale: 'Suggested 15% discount on Maggi Noodles pack. Rejected — product sells well at current price.',
    affectedProductCount: 1,
    estimatedImpact: 500,
    priorityScore: 4.2,
    createdAt: new Date(Date.now() - 1209600000).toISOString(),
  },
];

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function ApprovalsPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>('pending_review');
  const [approvals, setApprovals] = useState<DemoApproval[]>(DEMO_APPROVALS);

  const filtered = approvals.filter((a) => {
    if (activeTab === 'all') return true;
    return a.status === activeTab;
  });

  const pendingCount = approvals.filter((a) => a.status === 'pending_review').length;

  const handleApprove = (id: string) => {
    setApprovals((prev) =>
      prev.map((a) => (a.approvalId === id ? { ...a, status: 'approved' as const } : a))
    );
  };

  const handleReject = (id: string) => {
    setApprovals((prev) =>
      prev.map((a) => (a.approvalId === id ? { ...a, status: 'rejected' as const } : a))
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Approval Inbox</h1>
          <p className="mt-1 text-sm text-gray-600">
            Review AI recommendations before they execute
          </p>
        </div>
        {activeTab === 'pending_review' && pendingCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-4 py-2">
            <ShieldCheck className="h-5 w-5 text-indigo-600" />
            <span className="text-sm font-medium text-indigo-900">{pendingCount} pending</span>
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Approval Cards */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((a) => {
            const badge = typeBadge[a.type] ?? { bg: 'bg-gray-100', text: 'text-gray-800', label: a.type };
            return (
              <div
                key={a.approvalId}
                className="rounded-lg border bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                      {a.status === 'approved' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          <CheckCircle className="h-3 w-3" /> Approved
                        </span>
                      )}
                      {a.status === 'rejected' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                          <XCircle className="h-3 w-3" /> Rejected
                        </span>
                      )}
                      {a.status === 'pending_review' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                          <Clock className="h-3 w-3" /> Pending
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{formatRelativeTime(a.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-700">{a.aiRationale}</p>
                    <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                      <span>{a.affectedProductCount} product{a.affectedProductCount !== 1 ? 's' : ''}</span>
                      <span className="flex items-center gap-0.5">
                        <IndianRupee className="h-3 w-3" />
                        {a.estimatedImpact.toLocaleString('en-IN')} impact
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-lg font-bold text-indigo-600">{a.priorityScore.toFixed(1)}</p>
                    <p className="text-[10px] text-gray-400">priority</p>
                  </div>
                </div>

                {/* Actions for pending items */}
                {a.status === 'pending_review' && (
                  <div className="mt-3 flex gap-2 border-t pt-3">
                    <button
                      onClick={() => handleApprove(a.approvalId)}
                      className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                    >
                      <CheckCircle className="h-4 w-4" /> Approve
                    </button>
                    <button
                      onClick={() => handleReject(a.approvalId)}
                      className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<ShieldCheck className="h-12 w-12 text-gray-400" />}
          title="No approvals"
          description={
            activeTab === 'pending_review'
              ? 'All caught up! No pending recommendations right now.'
              : `No ${activeTab === 'all' ? '' : activeTab + ' '}approvals found.`
          }
        />
      )}
    </div>
  );
}
