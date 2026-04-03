'use client';

interface TypingIndicatorProps {
  /** Legacy simple label prop */
  label?: string;
  /** Map of userId → boolean for multi-user typing support */
  typingUsers?: Map<string, boolean>;
  /** Map of userId → display name for resolving names */
  userNames?: Map<string, string>;
}

function getTypingLabel(
  typingUsers?: Map<string, boolean>,
  userNames?: Map<string, string>,
  fallbackLabel?: string,
): string | null {
  if (!typingUsers || typingUsers.size === 0) {
    return fallbackLabel ?? null;
  }

  const activeUsers: string[] = [];
  typingUsers.forEach((isTyping, userId) => {
    if (isTyping) {
      activeUsers.push(userNames?.get(userId) ?? userId);
    }
  });

  if (activeUsers.length === 0) return null;
  if (activeUsers.length === 1) return `${activeUsers[0]} is typing`;
  if (activeUsers.length === 2) return `${activeUsers[0]} and ${activeUsers[1]} are typing`;
  return `${activeUsers[0]} and ${activeUsers.length - 1} others are typing`;
}

export default function TypingIndicator({ label, typingUsers, userNames }: TypingIndicatorProps) {
  const displayLabel = getTypingLabel(typingUsers, userNames, label);

  if (!displayLabel) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2" aria-label={`${displayLabel}`}>
      <div className="flex items-center gap-1 rounded-2xl bg-gray-200 px-4 py-2.5">
        <span
          className="h-2 w-2 animate-bounce rounded-full bg-gray-500"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="h-2 w-2 animate-bounce rounded-full bg-gray-500"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="h-2 w-2 animate-bounce rounded-full bg-gray-500"
          style={{ animationDelay: '300ms' }}
        />
      </div>
      <span className="text-xs text-gray-400">{displayLabel}...</span>
    </div>
  );
}
