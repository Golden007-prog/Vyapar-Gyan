import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CategoryFilters from '../CategoryFilters';

const categories = ['Electronics', 'Clothing', 'Footwear', 'Home'];

describe('CategoryFilters', () => {
  it('renders nothing when categories array is empty', () => {
    const { container } = render(
      <CategoryFilters categories={[]} selected={null} onSelect={jest.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a chip button for each category', () => {
    render(
      <CategoryFilters categories={categories} selected={null} onSelect={jest.fn()} />,
    );

    for (const cat of categories) {
      expect(screen.getByText(cat)).toBeInTheDocument();
    }
  });

  it('calls onSelect with category when an unselected chip is clicked', () => {
    const onSelect = jest.fn();
    render(
      <CategoryFilters categories={categories} selected={null} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByText('Clothing'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('Clothing');
  });

  it('calls onSelect with null when the selected chip is clicked (deselect)', () => {
    const onSelect = jest.fn();
    render(
      <CategoryFilters categories={categories} selected="Clothing" onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByText('Clothing'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('applies selected styling to the active chip', () => {
    render(
      <CategoryFilters categories={categories} selected="Electronics" onSelect={jest.fn()} />,
    );

    const selectedBtn = screen.getByText('Electronics');
    expect(selectedBtn).toHaveAttribute('aria-pressed', 'true');
    expect(selectedBtn.className).toContain('bg-indigo-600');

    const unselectedBtn = screen.getByText('Footwear');
    expect(unselectedBtn).toHaveAttribute('aria-pressed', 'false');
    expect(unselectedBtn.className).toContain('bg-gray-100');
  });

  it('has an accessible group role', () => {
    render(
      <CategoryFilters categories={categories} selected={null} onSelect={jest.fn()} />,
    );

    expect(screen.getByRole('group', { name: /category filters/i })).toBeInTheDocument();
  });
});
