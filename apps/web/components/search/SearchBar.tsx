'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import {
  getAutocompleteSuggestions,
  type AutocompleteSuggestion,
} from '@/lib/api-search';

export interface SearchBarProps {
  placeholder?: string;
  onSearch: (query: string) => void;
  sellerScope?: string;
}

export default function SearchBar({
  placeholder = 'Search products...',
  onSearch,
  sellerScope,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSuggestions = useCallback(async (value: string) => {
    if (value.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await getAutocompleteSuggestions(value, 5);
      setSuggestions(res.suggestions);
      setShowDropdown(res.suggestions.length > 0);
    } catch {
      setSuggestions([]);
      setShowDropdown(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  const handleSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setShowDropdown(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearch(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
    if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setSuggestions([]);
    setShowDropdown(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    inputRef.current?.focus();
  };

  const handleSuggestionSelect = (suggestion: AutocompleteSuggestion) => {
    setQuery(suggestion.name);
    setShowDropdown(false);
    onSearch(suggestion.name);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center rounded-lg border border-gray-300 bg-white shadow-sm focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
        <button
          type="button"
          onClick={handleSearch}
          className="flex shrink-0 items-center justify-center pl-3 text-gray-400 hover:text-gray-600"
          aria-label="Search"
        >
          <Search className="h-5 w-5" />
        </button>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          placeholder={placeholder}
          className="w-full px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-transparent outline-none"
          aria-label="Search products"
          aria-autocomplete="list"
          role="combobox"
          aria-expanded={showDropdown}
        />

        {isLoading && (
          <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin text-gray-400" />
        )}

        {query && !isLoading && (
          <button
            type="button"
            onClick={handleClear}
            className="mr-2 flex shrink-0 items-center justify-center text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Autocomplete Dropdown (inline until AutocompleteDropdown component is created in 10.2) */}
      {showDropdown && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((s) => (
            <li key={s.productId} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => handleSuggestionSelect(s)}
                className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-50"
              >
                <span className="truncate font-medium text-gray-900">{s.name}</span>
                <span className="ml-2 shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                  {s.category}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
