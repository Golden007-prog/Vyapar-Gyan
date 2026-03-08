'use client';

import { useState } from 'react';
import {
  X,
  CheckCircle,
  XCircle,
  Edit,
  Calendar,
  Loader2,
  Sparkles,
  IndianRupee,
} from 'lucide-react';
import type { ApprovalDetail } from '@/lib/api-approvals';

// --- Props ---

interface ApprovalDetailModalProps {
  approval: ApprovalDetail;
  onClose: () => void;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onEditApprove: (id: string, payload: Record<string, unknown>) => Promise<void>;
  onSchedule: (id: string, scheduledFor: string) => Promise<void>;
}

// --- Helpers ---

const typeLabels: Record<string, string> = {
  discount: 'Discount',
  campaign: 'Campaign',
  price_change: 'Price Change',
  stock_alert: 'Stock Alert',
  dead_stock_liquidation: 'Dead Stock Liquidation',
  reorder_suggestion: 'Reorder Suggestion',
};

function formatCurrency(val: number): string {
  return `₹${val.toLocaleString('en-IN')}`;
}

// --- Component ---

export default function ApprovalDetailModal({
  approval,
  onClose,
  onApprove,
  onReject,
  onEditApprove,
  onSchedule,
}: ApprovalDetailModalProps) {
  const [activeAction, setActiveAction] = useState<'none' | 'reject' | 'schedule' | 'edit'>('none');
  const [rejectionReason, setRejectionReason] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [processing, setProcessing] = useState(false);

  const isPending = approval.status === 'pending_review';
  const payload = approval.payload as Record<string, unknown>;
  const products = (payload?.products as Array<Record<string, unknown>>) ?? [];

  async function handleAction(fn: () => Promise<void>) {
    setProcessing(true);
    try {
      await fn();
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative mx-4 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
              {typeLabels[approval.type] ?? approval.type}
            </span>
            <span className="text-sm text-gray-500">
              {new Date(approval.createdAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* AI Rationale */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-gray-900">AI Rationale</h3>
            </div>
            <p className="text-sm leading-relaxed text-gray-700">{approval.aiRationale}</p>
          </section>

          {/* Impact Breakdown */}
          <section className="rounded-lg bg-gray-50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Impact Breakdown</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="flex items-center justify-center gap-1 text-lg font-bold text-gray-900">
                  <IndianRupee className="h-4 w-4" />
                  {approval.estimatedImpact.toLocaleString('en-IN')}
                </div>
                <p className="text-xs text-gray-500">Est. Revenue Impact</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">{approval.affectedProductIds.length}</p>
                <p className="text-xs text-gray-500">Products Affected</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">{approval.priorityScore.toFixed(1)}</p>
                <p className="text-xs text-gray-500">Priority Score</p>
              </div>
            </div>
          </section>

          {/* Affected Products Table */}
          {products.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Affected Products</h3>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Product</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Current</th>
                      <th className="px-3 py-2 text-right font-medium text-gray-600">Proposed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {products.map((p, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900">{String(p.name ?? p.productId ?? `Product ${i + 1}`)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {p.currentPrice != null ? formatCurrency(Number(p.currentPrice)) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-indigo-600">
                          {p.proposedPrice != null ? formatCurrency(Number(p.proposedPrice)) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Action Panels (only for pending approvals) */}
          {isPending && (
            <section className="space-y-3 border-t pt-4">
              {/* Reject reason input */}
              {activeAction === 'reject' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Rejection Reason</label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Explain why you're rejecting this recommendation…"
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={!rejectionReason.trim() || processing}
                      onClick={() => handleAction(() => onReject(approval.approvalId, rejectionReason.trim()))}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Reject'}
                    </button>
                    <button onClick={() => setActiveAction('none')} className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Schedule date picker */}
              {activeAction === 'schedule' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Schedule For</label>
                  <input
                    type="datetime-local"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    className="w-full rounded-lg border px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={!scheduledDate || processing}
                      onClick={() => handleAction(() => onSchedule(approval.approvalId, new Date(scheduledDate).toISOString()))}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Schedule'}
                    </button>
                    <button onClick={() => setActiveAction('none')} className="rounded-lg border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Main action buttons */}
              {activeAction === 'none' && (
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={processing}
                    onClick={() => handleAction(() => onApprove(approval.approvalId))}
                    className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                    Approve
                  </button>
                  <button
                    disabled={processing}
                    onClick={() => handleAction(() => onEditApprove(approval.approvalId, approval.payload))}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Edit className="h-4 w-4" />
                    Edit &amp; Approve
                  </button>
                  <button
                    disabled={processing}
                    onClick={() => setActiveAction('reject')}
                    className="flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </button>
                  <button
                    disabled={processing}
                    onClick={() => setActiveAction('schedule')}
                    className="flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Calendar className="h-4 w-4" />
                    Schedule
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Status info for non-pending */}
          {!isPending && (
            <section className="border-t pt-4">
              <p className="text-sm text-gray-500">
                Status: <span className="font-medium text-gray-900 capitalize">{approval.status.replace(/_/g, ' ')}</span>
                {approval.approvedAt && ` · Actioned ${new Date(approval.approvedAt).toLocaleDateString('en-IN')}`}
                {approval.rejectionReason && ` · Reason: ${approval.rejectionReason}`}
                {approval.scheduledFor && ` · Scheduled for ${new Date(approval.scheduledFor).toLocaleDateString('en-IN')}`}
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
