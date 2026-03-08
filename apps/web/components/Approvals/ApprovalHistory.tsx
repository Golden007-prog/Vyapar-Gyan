'use client';

import { CheckCircle, XCircle, Clock, Edit, Loader2 } from 'lucide-react';
import type { ApprovalSummary } from '@/lib/api-approvals';

interface ApprovalHistoryProps {
  approvals: ApprovalSummary[];
  loading?: boolean;
  onSelect?: (approvalId: string) => void;
}

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  approved: { icon: CheckCircle, color: 'text-green-500', label: 'Approved' },
  rejected: { icon: XCircle, color: 'text-red-500', label: 'Rejected' },
  edited_approved: { icon: Edit, color: 'text-blue-500', label: 'Edited & Approved' },
  executed: { icon: CheckCircle, color: 'text-emerald-600', label: 'Executed' },
  pending_review: { icon: Clock, color: 'text-amber-500', label: 'Pending' },
};

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

export default function ApprovalHistory({ approvals, loading, onSelect }: ApprovalHistoryProps) {
  const historyItems = approvals.filter(
    (a) => a.status !== 'pending_review' && a.status !== 'draft',
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading history…</span>
      </div>
    );
  }

  if (historyItems.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-500">
        No approval history yet.
      </p>
    );
  }

  return (
    <div className="flow-root">
      <ul className="-mb-4">
        {historyItems.map((item, idx) => {
          const cfg = statusConfig[item.status] ?? statusConfig.pending_review;
          const Icon = cfg.icon;
          const isLast = idx === historyItems.length - 1;

          return (
            <li key={item.approvalId} className="relative pb-4">
              {/* Connector line */}
              {!isLast && (
                <span
                  className="absolute left-3.5 top-7 -ml-px h-full w-0.5 bg-gray-200"
                  aria-hidden="true"
                />
              )}

              <div className="relative flex items-start gap-3">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full bg-white ring-2 ring-gray-100 ${cfg.color}`}>
                  <Icon className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onSelect?.(item.approvalId)}
                    className="text-left hover:underline"
                  >
                    <p className="text-sm font-medium text-gray-900">
                      {cfg.label}{' '}
                      <span className="font-normal text-gray-500">
                        — {item.type.replace(/_/g, ' ')}
                      </span>
                    </p>
                  </button>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {item.affectedProductCount} product{item.affectedProductCount !== 1 ? 's' : ''} · ₹{item.estimatedImpact.toLocaleString('en-IN')} impact
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {formatRelativeTime(item.createdAt)}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
