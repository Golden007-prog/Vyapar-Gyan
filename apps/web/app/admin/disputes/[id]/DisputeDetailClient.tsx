'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, ShieldAlert, Clock, CheckCircle, XCircle,
  MessageSquare, FileText, Save, RefreshCw, Ban, ArrowUpRight,
  IndianRupee, Package, Image as ImageIcon,
} from 'lucide-react';
import {
  getDisputeDetail,
  resolveDispute,
  updateDisputeNotes,
  type DisputeDetail,
  type OrderDetail,
  type ChatMessage,
  type TimelineEntry,
  type DisputeStatus,
  type DisputeIssueType,
  type ResolutionAction,
} from '@/lib/api-disputes';

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

// Mock data for demo
const MOCK_DISPUTE: DisputeDetail = {
  disputeId: 'disp-001', orderId: 'ord-101', customerId: 'cust-001', sellerId: 'seller-001',
  customerName: 'Priya Sharma', sellerName: 'Dragon Store',
  issueType: 'wrong_item', status: 'open',
  adminNotes: 'Customer reported receiving blue instead of red.',
  resolution: null, evidenceUrls: [],
  createdAt: '2026-03-09T10:00:00Z', updatedAt: '2026-03-09T10:00:00Z',
};

const MOCK_ORDER: OrderDetail = {
  orderId: 'ord-101', totalAmount: 1250, status: 'delivered',
  items: [{ name: 'Cotton Kurta (Red)', qty: 1, price: 1250 }],
  createdAt: '2026-03-07T08:00:00Z',
};

const MOCK_CHAT: ChatMessage[] = [
  { messageId: 'm1', content: 'I ordered a red kurta but received blue', channel: 'whatsapp', senderRole: 'customer', direction: 'inbound', createdAt: '2026-03-09T09:50:00Z' },
  { messageId: 'm2', content: 'Sorry for the inconvenience. Let me check.', channel: 'web', senderRole: 'seller', direction: 'outbound', createdAt: '2026-03-09T09:55:00Z' },
  { messageId: 'm3', content: 'Can you send a photo of what you received?', channel: 'web', senderRole: 'seller', direction: 'outbound', createdAt: '2026-03-09T09:56:00Z' },
];

const MOCK_TIMELINE: TimelineEntry[] = [
  { auditId: 'a1', actorId: 'system', actionType: 'dispute.created', newValues: { status: 'open' }, createdAt: '2026-03-09T10:00:00Z' },
];

export default function DisputeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const disputeId = params.id as string;

  const [dispute, setDispute] = useState<DisputeDetail | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');

  useEffect(() => {
    loadDetail();
  }, [disputeId]);

  async function loadDetail() {
    setLoading(true);
    try {
      const data = await getDisputeDetail(disputeId);
      setDispute(data.dispute);
      setOrder(data.order);
      setChat(data.chatTranscript);
      setTimeline(data.timeline);
      setNotes(data.dispute.adminNotes || '');
    } catch {
      // Fallback to mock
      setDispute(MOCK_DISPUTE);
      setOrder(MOCK_ORDER);
      setChat(MOCK_CHAT);
      setTimeline(MOCK_TIMELINE);
      setNotes(MOCK_DISPUTE.adminNotes);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveNotes() {
    if (!dispute) return;
    setSavingNotes(true);
    try {
      await updateDisputeNotes(dispute.disputeId, notes);
    } catch { /* mock mode */ }
    finally { setSavingNotes(false); }
  }

  async function handleResolve(action: ResolutionAction) {
    if (!dispute) return;
    setResolving(true);
    try {
      await resolveDispute(dispute.disputeId, {
        action,
        amount: action === 'refund_partial' ? parseFloat(refundAmount) : undefined,
        notes: resolutionNotes || undefined,
      });
      await loadDetail();
    } catch {
      // In mock mode, update locally
      setDispute((prev) => prev ? {
        ...prev,
        status: action === 'dismiss' ? 'dismissed' : action === 'escalate' ? 'in_progress' : 'resolved',
        resolution: { action, resolvedAt: new Date().toISOString() },
      } : null);
    } finally {
      setResolving(false);
    }
  }

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-4 text-sm text-gray-600">Loading dispute...</p>
        </div>
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="mx-auto h-12 w-12 text-gray-300" />
        <p className="mt-2 text-gray-600">Dispute not found</p>
        <button onClick={() => router.push('/admin/disputes')} className="mt-4 text-indigo-600 text-sm hover:underline">
          Back to disputes
        </button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[dispute.status];
  const isActionable = dispute.status === 'open' || dispute.status === 'in_progress';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.push('/admin/disputes')} className="rounded-lg border p-2 hover:bg-gray-50">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Dispute #{dispute.disputeId.slice(-6)}</h1>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${statusCfg.color}`}>
              <statusCfg.icon className="h-3 w-3" />
              {statusCfg.label}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {ISSUE_TYPE_LABELS[dispute.issueType]} · Order {dispute.orderId} · Created {formatDate(dispute.createdAt)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column — Order + Chat */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Details */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-4">
              <Package className="h-5 w-5 text-indigo-500" /> Order Details
            </h2>
            {order ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-gray-500">Order ID:</span> <span className="font-mono">{order.orderId}</span></div>
                  <div><span className="text-gray-500">Status:</span> <span className="font-medium">{order.status}</span></div>
                  <div><span className="text-gray-500">Amount:</span> <span className="font-medium">₹{order.totalAmount}</span></div>
                  <div><span className="text-gray-500">Date:</span> {formatDate(order.createdAt)}</div>
                </div>
                {order.items && order.items.length > 0 && (
                  <div className="mt-3 border-t pt-3">
                    <p className="text-xs font-medium text-gray-500 mb-2">Items</p>
                    {order.items.map((item: any, i: number) => (
                      <div key={i} className="flex justify-between text-sm py-1">
                        <span>{item.name} × {item.qty || 1}</span>
                        <span className="font-medium">₹{item.price}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Order details not available</p>
            )}
          </div>

          {/* Chat Transcript */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-4">
              <MessageSquare className="h-5 w-5 text-indigo-500" /> Chat Transcript
            </h2>
            {chat.length > 0 ? (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {chat.map((msg) => (
                  <div key={msg.messageId} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      msg.direction === 'outbound' ? 'bg-indigo-50 text-indigo-900' : 'bg-gray-100 text-gray-900'
                    }`}>
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-xs font-medium capitalize">{msg.senderRole}</span>
                        <span className={`text-xs px-1 rounded ${msg.channel === 'whatsapp' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                          {msg.channel}
                        </span>
                      </div>
                      <p>{typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}</p>
                      <p className="text-xs text-gray-400 mt-1">{formatDate(msg.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No chat history available</p>
            )}
          </div>

          {/* Evidence */}
          {dispute.evidenceUrls.length > 0 && (
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-4">
                <ImageIcon className="h-5 w-5 text-indigo-500" /> Evidence
              </h2>
              <div className="grid grid-cols-3 gap-3">
                {dispute.evidenceUrls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                    className="block rounded-lg border bg-gray-50 p-4 text-center text-sm text-indigo-600 hover:bg-indigo-50">
                    <ImageIcon className="mx-auto h-8 w-8 text-gray-400 mb-1" />
                    Evidence {i + 1}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column — Actions + Notes + Timeline */}
        <div className="space-y-6">
          {/* Parties */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Parties</h3>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-gray-500">Customer:</span>
                <p className="font-medium">{dispute.customerName}</p>
              </div>
              <div>
                <span className="text-gray-500">Seller:</span>
                <p className="font-medium">{dispute.sellerName}</p>
              </div>
            </div>
          </div>

          {/* Resolution Actions */}
          {isActionable && (
            <div className="rounded-lg border bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Resolution Actions</h3>
              <div className="space-y-2">
                <button onClick={() => handleResolve('refund_full')} disabled={resolving}
                  className="w-full flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
                  <IndianRupee className="h-4 w-4" /> Full Refund
                </button>
                <div className="flex gap-2">
                  <input type="number" placeholder="Amount" value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <button onClick={() => handleResolve('refund_partial')} disabled={resolving || !refundAmount}
                    className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50">
                    Partial
                  </button>
                </div>
                <button onClick={() => handleResolve('replace')} disabled={resolving}
                  className="w-full flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                  <RefreshCw className="h-4 w-4" /> Replace
                </button>
                <button onClick={() => handleResolve('dismiss')} disabled={resolving}
                  className="w-full flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                  <Ban className="h-4 w-4" /> Dismiss
                </button>
                <button onClick={() => handleResolve('escalate')} disabled={resolving}
                  className="w-full flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                  <ArrowUpRight className="h-4 w-4" /> Escalate
                </button>
                <textarea placeholder="Resolution notes (optional)" value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)} rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          {/* Resolution Info (if resolved) */}
          {dispute.resolution && (
            <div className="rounded-lg border bg-green-50 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-green-900 mb-2">Resolution</h3>
              <div className="text-sm text-green-800 space-y-1">
                <p>Action: <span className="font-medium capitalize">{dispute.resolution.action.replace('_', ' ')}</span></p>
                {dispute.resolution.amount && <p>Amount: ₹{dispute.resolution.amount}</p>}
                {dispute.resolution.resolvedAt && <p>Resolved: {formatDate(dispute.resolution.resolvedAt)}</p>}
                {dispute.resolution.notes && <p>Notes: {dispute.resolution.notes}</p>}
              </div>
            </div>
          )}

          {/* Admin Notes */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
              <FileText className="h-4 w-4" /> Admin Notes
            </h3>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Add notes about this dispute..." />
            <button onClick={handleSaveNotes} disabled={savingNotes}
              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> {savingNotes ? 'Saving...' : 'Save Notes'}
            </button>
          </div>

          {/* Timeline */}
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Timeline</h3>
            {timeline.length > 0 ? (
              <div className="space-y-3">
                {timeline.map((entry) => (
                  <div key={entry.auditId} className="flex gap-3 text-sm">
                    <div className="mt-1 h-2 w-2 rounded-full bg-indigo-400 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">{entry.actionType.replace('dispute.', '').replace('_', ' ')}</p>
                      <p className="text-xs text-gray-500">{formatDate(entry.createdAt)} · by {entry.actorId}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No timeline entries</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
