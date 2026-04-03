'use client';

interface QuickReplyOption {
  label: string;
  value: string;
}

interface QuickReplyButtonsProps {
  prompt: string;
  options: QuickReplyOption[];
  onSelect?: (value: string) => void;
}

export default function QuickReplyButtons({
  prompt,
  options,
  onSelect,
}: QuickReplyButtonsProps) {
  return (
    <div className="space-y-2" aria-label="Quick reply options">
      <p className="text-sm text-gray-700">{prompt}</p>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Quick reply buttons">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onSelect?.(option.value)}
            className="shrink-0 rounded-full border border-indigo-300 bg-white px-3.5 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 active:bg-indigo-100"
            aria-label={option.label}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
