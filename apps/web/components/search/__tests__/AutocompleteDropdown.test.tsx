import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AutocompleteDropdown from '../AutocompleteDropdown';
import type { AutocompleteSuggestion } from '@/lib/api-search';

const suggestions: AutocompleteSuggestion[] = [
  { name: 'Running Shoes', category: 'Footwear', productId: 'p1' },
  { name: 'Casual Shoes', category: 'Footwear', productId: 'p2' },
  { name: 'Blue Shirt', category: 'Clothing', productId: 'p3' },
];

describe('AutocompleteDropdown', () => {
  it('renders nothing when visible is false', () => {
    const { container } = render(
      <AutocompleteDropdown
        suggestions={suggestions}
        isLoading={false}
        onSelect={jest.fn()}
        visible={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when visible but suggestions are empty and not loading', () => {
    const { container } = render(
      <AutocompleteDropdown
        suggestions={[]}
        isLoading={false}
        onSelect={jest.fn()}
        visible={true}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders suggestion items with name and category', () => {
    render(
      <AutocompleteDropdown
        suggestions={suggestions}
        isLoading={false}
        onSelect={jest.fn()}
        visible={true}
      />,
    );

    expect(screen.getByText('Running Shoes')).toBeInTheDocument();
    expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
    // Category badges
    expect(screen.getAllByText('Footwear')).toHaveLength(2);
    expect(screen.getByText('Clothing')).toBeInTheDocument();
  });

  it('calls onSelect with the clicked suggestion', () => {
    const onSelect = jest.fn();
    render(
      <AutocompleteDropdown
        suggestions={suggestions}
        isLoading={false}
        onSelect={onSelect}
        visible={true}
      />,
    );

    fireEvent.click(screen.getByText('Blue Shirt'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(suggestions[2]);
  });

  it('renders a loading indicator when loading with no suggestions', () => {
    render(
      <AutocompleteDropdown
        suggestions={[]}
        isLoading={true}
        onSelect={jest.fn()}
        visible={true}
      />,
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders suggestions even while loading if suggestions exist', () => {
    render(
      <AutocompleteDropdown
        suggestions={suggestions}
        isLoading={true}
        onSelect={jest.fn()}
        visible={true}
      />,
    );

    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(screen.getByText('Running Shoes')).toBeInTheDocument();
  });

  it('renders a listbox role for accessibility', () => {
    render(
      <AutocompleteDropdown
        suggestions={suggestions}
        isLoading={false}
        onSelect={jest.fn()}
        visible={true}
      />,
    );

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});
