'use client';

interface AISuggestionCardProps {
  title: string;
  body: string;
  onApprove?: () => void;
  onDismiss?: () => void;
}

export default function AISuggestionCard({
  title,
  body,
  onApprove,
  onDismiss,
}: AISuggestionCardProps) {
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 shadow-sm" aria-label={`AI Suggestion: ${title}`}>
      <div className="mb-1 flex items-center gap-1.5">
        <svg className="h-4 w-4 text-indigo-500" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 1a1 1 0 011 1v1.07A5.001 5.001 0 0113.93 8H15a1 1 0 110 2h-1.07A5.001 5.001 0 019 14.93V16a1 1 0 11-2 0v-1.07A5.001 5.001 0 012.07 10H1a1 1 0 110-2h1.07A5.001 5.001 0 017 3.07V2a1 1 0 011-1zm0 4a3 3 0 100 6 3 3 0 000-6z" />
        </svg>
        <h4 className="text-sm font-semibold text-indigo-900">{title}</h4>
      </div>
      <p className="text-xs text-indigo-700">{body}</p>
      <div className="mt-2 flex gap-2">
        {onApprove && (
          <button
            onClick={onApprove}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            aria-label="Approve suggestion"
          >
            Approve
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            aria-label="Dismiss suggestion"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
