'use client';

interface TypingIndicatorProps {
  label?: string;
}

export default function TypingIndicator({ label = 'Seller is typing' }: TypingIndicatorProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
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
      <span className="text-xs text-gray-400">{label}...</span>
    </div>
  );
}
