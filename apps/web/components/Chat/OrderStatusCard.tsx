'use client';

interface OrderItem {
  name: string;
  quantity: number;
}

interface OrderStatusCardProps {
  orderNumber: string;
  status: string;
  items: OrderItem[];
  totalAmount: number;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  confirmed: { bg: 'bg-blue-100', text: 'text-blue-800' },
  processing: { bg: 'bg-blue-100', text: 'text-blue-800' },
  shipped: { bg: 'bg-purple-100', text: 'text-purple-800' },
  delivered: { bg: 'bg-green-100', text: 'text-green-800' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-800' },
  refunded: { bg: 'bg-gray-100', text: 'text-gray-800' },
};

function formatRelativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return '';
  }
}

export default function OrderStatusCard({
  orderNumber,
  status,
  items,
  totalAmount,
  updatedAt,
}: OrderStatusCardProps) {
  const statusKey = status.toLowerCase();
  const colors = STATUS_COLORS[statusKey] ?? { bg: 'bg-gray-100', text: 'text-gray-800' };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm" aria-label={`Order ${orderNumber}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">Order #{orderNumber}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors.bg} ${colors.text}`} aria-label={`Status: ${status}`}>
          {status}
        </span>
      </div>
      <div className="mt-2 space-y-0.5">
        {items.map((item, i) => (
          <p key={i} className="text-xs text-gray-700">
            {item.name} × {item.quantity}
          </p>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
        <span className="text-sm font-bold text-gray-900">₹{totalAmount.toLocaleString('en-IN')}</span>
        <span className="text-[10px] text-gray-400">Updated {formatRelativeTime(updatedAt)}</span>
      </div>
    </div>
  );
}
