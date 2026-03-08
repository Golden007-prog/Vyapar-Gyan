import type { ReactNode } from 'react';

// --- Status color configs by domain ---

const ORDER_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  PENDING_PAYMENT: { label: 'Pending', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  PAID: { label: 'Paid', bg: 'bg-blue-100', text: 'text-blue-800' },
  PROCESSING: { label: 'Confirmed', bg: 'bg-blue-100', text: 'text-blue-800' },
  SHIPPED: { label: 'Shipped', bg: 'bg-purple-100', text: 'text-purple-800' },
  DELIVERED: { label: 'Delivered', bg: 'bg-green-100', text: 'text-green-800' },
  CANCELLED: { label: 'Cancelled', bg: 'bg-red-100', text: 'text-red-800' },
};

const APPROVAL_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: 'Draft', bg: 'bg-gray-100', text: 'text-gray-800' },
  pending_review: { label: 'Pending', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  approved: { label: 'Approved', bg: 'bg-green-100', text: 'text-green-800' },
  rejected: { label: 'Rejected', bg: 'bg-red-100', text: 'text-red-800' },
  edited_approved: { label: 'Edited & Approved', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  executed: { label: 'Executed', bg: 'bg-indigo-100', text: 'text-indigo-800' },
  scheduled: { label: 'Scheduled', bg: 'bg-blue-100', text: 'text-blue-800' },
};

const DELIVERY_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  queued: { label: 'Queued', bg: 'bg-gray-100', text: 'text-gray-800' },
  sent: { label: 'Sent', bg: 'bg-blue-100', text: 'text-blue-800' },
  delivered: { label: 'Delivered', bg: 'bg-green-100', text: 'text-green-800' },
  read: { label: 'Read', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  failed: { label: 'Failed', bg: 'bg-red-100', text: 'text-red-800' },
};

const CAMPAIGN_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  pending: { label: 'Pending', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  in_progress: { label: 'In Progress', bg: 'bg-blue-100', text: 'text-blue-800' },
  completed: { label: 'Completed', bg: 'bg-green-100', text: 'text-green-800' },
  failed: { label: 'Failed', bg: 'bg-red-100', text: 'text-red-800' },
  draft: { label: 'Draft', bg: 'bg-gray-100', text: 'text-gray-800' },
  scheduled: { label: 'Scheduled', bg: 'bg-purple-100', text: 'text-purple-800' },
  sending: { label: 'Sending', bg: 'bg-blue-100', text: 'text-blue-800' },
  sent: { label: 'Sent', bg: 'bg-green-100', text: 'text-green-800' },
};

const DOMAIN_MAP: Record<string, Record<string, { label: string; bg: string; text: string }>> = {
  order: ORDER_STATUS,
  approval: APPROVAL_STATUS,
  delivery: DELIVERY_STATUS,
  campaign: CAMPAIGN_STATUS,
};

const FALLBACK = { label: '', bg: 'bg-gray-100', text: 'text-gray-800' };

// --- Component ---

export type StatusDomain = 'order' | 'approval' | 'delivery' | 'campaign';

export interface StatusPillProps {
  /** The raw status value, e.g. "SHIPPED", "pending_review", "delivered" */
  status: string;
  /** Which domain's color mapping to use */
  domain: StatusDomain;
  /** Override the display label (defaults to the mapped label or the raw status) */
  label?: string;
  /** Optional icon to render before the label */
  icon?: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

export default function StatusPill({ status, domain, label, icon, className = '' }: StatusPillProps) {
  const config = DOMAIN_MAP[domain]?.[status] ?? FALLBACK;
  const displayLabel = label ?? (config.label || status);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text} ${className}`}
    >
      {icon}
      {displayLabel}
    </span>
  );
}
