'use client';

import type { DeliveryStatus } from '@/lib/api-chat';

interface MessageStatusProps {
  status: DeliveryStatus;
  onRetry?: () => void;
}

function ClockIcon() {
  return (
    <svg
      className="h-3 w-3 text-gray-400"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SingleCheckIcon() {
  return (
    <svg
      className="h-3 w-3 text-gray-400"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8.5l3.5 3.5L13 4" />
    </svg>
  );
}

function DoubleCheckIcon({ className }: { className: string }) {
  return (
    <svg
      className={`h-3 w-3 ${className}`}
      viewBox="0 0 20 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 8.5l3.5 3.5L11 4" />
      <path d="M6 8.5l3.5 3.5L16 4" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      className="h-3 w-3 text-red-500"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 5v4" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function MessageStatus({ status, onRetry }: MessageStatusProps) {
  return (
    <span className="inline-flex items-center gap-1">
      {status === 'queued' && (
        <span aria-label="Queued">
          <ClockIcon />
        </span>
      )}
      {status === 'sent' && (
        <span aria-label="Sent">
          <SingleCheckIcon />
        </span>
      )}
      {status === 'delivered' && (
        <span aria-label="Delivered">
          <DoubleCheckIcon className="text-gray-400" />
        </span>
      )}
      {status === 'read' && (
        <span aria-label="Read">
          <DoubleCheckIcon className="text-blue-500" />
        </span>
      )}
      {status === 'failed' && (
        <span className="inline-flex items-center gap-1" aria-label="Failed">
          <AlertIcon />
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-[10px] font-medium text-red-500 underline hover:text-red-700"
              aria-label="Retry sending message"
            >
              Retry
            </button>
          )}
        </span>
      )}
    </span>
  );
}
