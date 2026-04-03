'use client';

import type { AutocompleteSuggestion } from '@/lib/api-search';

export interface AutocompleteDropdownProps {
  suggestions: AutocompleteSuggestion[];
  isLoading: boolean;
  onSelect: (suggestion: AutocompleteSuggestion) => void;
  visible: boolean;
}

export default function AutocompleteDropdown({
  suggestions,
  isLoading,
  onSelect,
  visible,
}: AutocompleteDropdownProps) {
  if (!visible || (!isLoading && suggestions.length === 0)) {
    return null;
  }

  return (
    <ul
      role="listbox"
      className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
    >
      {isLoading && suggestions.length === 0 ? (
        <li className="px-4 py-2 text-sm text-gray-400">Loading…</li>
      ) : (
        suggestions.map((s) => (
          <li key={s.productId} role="option" aria-selected={false}>
            <button
              type="button"
              onClick={() => onSelect(s)}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-50"
            >
              <span className="truncate font-medium text-gray-900">
                {s.name}
              </span>
              <span className="ml-2 shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                {s.category}
              </span>
            </button>
          </li>
        ))
      )}
    </ul>
  );
}
