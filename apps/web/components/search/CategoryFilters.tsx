'use client';

export interface CategoryFiltersProps {
  categories: string[];
  selected: string | null;
  onSelect: (category: string | null) => void;
}

export default function CategoryFilters({
  categories,
  selected,
  onSelect,
}: CategoryFiltersProps) {
  if (categories.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide" role="group" aria-label="Category filters">
      {categories.map((category) => {
        const isSelected = category === selected;
        return (
          <button
            key={category}
            type="button"
            onClick={() => onSelect(isSelected ? null : category)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              isSelected
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            aria-pressed={isSelected}
          >
            {category}
          </button>
        );
      })}
    </div>
  );
}
