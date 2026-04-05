'use client';

import { Bot, UserCheck } from 'lucide-react';

interface HandoffIndicatorProps {
  /** Whether the conversation is in human handoff mode */
  isHumanHandoff: boolean;
  /** When the handoff expires (ISO string or epoch seconds) */
  handoffExpiresAt?: string | number | null;
}

/**
 * Displays "AI mode" or "Human mode" indicator in the seller Inbox header.
 * Req 10.5: Visual indicator reflecting the current handoff state.
 */
export default function HandoffIndicator({ isHumanHandoff, handoffExpiresAt }: HandoffIndicatorProps) {
  // Check if handoff has expired
  let isExpired = false;
  if (isHumanHandoff && handoffExpiresAt != null) {
    const expiresEpoch =
      typeof handoffExpiresAt === 'number'
        ? handoffExpiresAt > 1e12
          ? Math.floor(handoffExpiresAt / 1000) // ms → s
          : handoffExpiresAt
        : Math.floor(new Date(handoffExpiresAt).getTime() / 1000);
    isExpired = expiresEpoch <= Math.floor(Date.now() / 1000);
  }

  const isHuman = isHumanHandoff && !isExpired;

  if (isHuman) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
        <UserCheck className="h-3 w-3" />
        Human mode
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
      <Bot className="h-3 w-3" />
      AI mode
    </span>
  );
}
