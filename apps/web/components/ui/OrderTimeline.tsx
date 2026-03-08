import { CheckCircle2, Circle } from 'lucide-react';

// --- Default order lifecycle steps ---

export interface TimelineEvent {
  key: string;
  label: string;
  description: string;
  timestamp?: string;
}

const DEFAULT_ORDER_STEPS: TimelineEvent[] = [
  { key: 'PENDING_PAYMENT', label: 'Ordered', description: 'Order placed, awaiting payment' },
  { key: 'PAID', label: 'Paid', description: 'Payment received' },
  { key: 'PROCESSING', label: 'Confirmed', description: 'Seller confirmed your order' },
  { key: 'SHIPPED', label: 'Shipped', description: 'On the way to you' },
  { key: 'DELIVERED', label: 'Delivered', description: 'Order delivered' },
];

const STATUS_ORDER: Record<string, number> = {
  PENDING_PAYMENT: 0,
  PAID: 1,
  PROCESSING: 2,
  SHIPPED: 3,
  DELIVERED: 4,
};

function formatTimestamp(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// --- Component ---

export interface OrderTimelineProps {
  /** Current order status string (e.g. "SHIPPED") — used with default steps */
  currentStatus?: string;
  /** Custom timeline events — overrides default order steps */
  events?: TimelineEvent[];
  /** Index of the current step when using custom events (0-based) */
  currentIndex?: number;
}

export default function OrderTimeline({ currentStatus, events, currentIndex }: OrderTimelineProps) {
  const steps = events ?? DEFAULT_ORDER_STEPS;

  // Determine active index
  const activeIdx =
    currentIndex !== undefined
      ? currentIndex
      : currentStatus
        ? (STATUS_ORDER[currentStatus] ?? -1)
        : -1;

  // Cancelled state
  if (currentStatus === 'CANCELLED') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
        <p className="text-sm font-medium text-red-800">This order has been cancelled.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {steps.map((step, idx) => {
        const isCompleted = idx <= activeIdx;
        const isCurrent = idx === activeIdx;
        const isLast = idx === steps.length - 1;

        return (
          <div key={step.key} className="flex gap-3">
            {/* Vertical line + icon */}
            <div className="flex flex-col items-center">
              {isCompleted ? (
                <CheckCircle2
                  className={`h-5 w-5 shrink-0 ${isCurrent ? 'text-indigo-600' : 'text-green-500'}`}
                />
              ) : (
                <Circle className="h-5 w-5 shrink-0 text-gray-300" />
              )}
              {!isLast && (
                <div
                  className={`w-0.5 flex-1 min-h-[28px] ${
                    idx < activeIdx ? 'bg-green-400' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>

            {/* Label + timestamp */}
            <div className={`pb-4 ${isLast ? 'pb-0' : ''}`}>
              <p className={`text-sm font-medium ${isCompleted ? 'text-gray-900' : 'text-gray-400'}`}>
                {step.label}
              </p>
              <p className={`text-xs ${isCompleted ? 'text-gray-500' : 'text-gray-300'}`}>
                {step.description}
              </p>
              {step.timestamp && isCompleted && (
                <p className="mt-0.5 text-[10px] text-gray-400">
                  {formatTimestamp(step.timestamp)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
