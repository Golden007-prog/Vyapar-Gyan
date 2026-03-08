import type { ReactNode } from 'react';
import Link from 'next/link';

export interface EmptyStateProps {
  /** Icon or illustration rendered above the title */
  icon?: ReactNode;
  /** Main heading */
  title: string;
  /** Supporting description text */
  description?: string;
  /** CTA button label */
  actionLabel?: string;
  /** CTA link href (renders a Next.js Link) */
  actionHref?: string;
  /** CTA click handler (renders a button instead of Link) */
  onAction?: () => void;
  /** Additional CSS classes on the wrapper */
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`rounded-lg border border-dashed border-gray-300 p-12 text-center ${className}`}>
      {icon && <div className="mx-auto mb-4 flex justify-center">{icon}</div>}

      <h3 className="text-lg font-medium text-gray-900">{title}</h3>

      {description && <p className="mt-2 text-sm text-gray-600">{description}</p>}

      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {actionLabel}
        </Link>
      )}

      {actionLabel && onAction && !actionHref && (
        <button
          onClick={onAction}
          className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
