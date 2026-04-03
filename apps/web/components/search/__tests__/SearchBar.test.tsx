import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SearchBar from '../SearchBar';

// Mock api-search module
const mockGetAutocompleteSuggestions = jest.fn();
jest.mock('@/lib/api-search', () => ({
  getAutocompleteSuggestions: (...args: unknown[]) => mockGetAutocompleteSuggestions(...args),
}));

describe('SearchBar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetAutocompleteSuggestions.mockReset();
    mockGetAutocompleteSuggestions.mockResolvedValue({ suggestions: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders input, search icon button, and placeholder', () => {
    render(<SearchBar onSearch={jest.fn()} placeholder="Find items..." />);
    expect(screen.getByLabelText('Search products')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Find items...')).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  it('shows clear button when input has text', () => {
    render(<SearchBar onSearch={jest.fn()} />);
    const input = screen.getByLabelText('Search products');

    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'shoes' } });
    expect(screen.getByLabelText('Clear search')).toBeInTheDocument();
  });

  it('clears input when clear button is clicked', () => {
    render(<SearchBar onSearch={jest.fn()} />);
    const input = screen.getByLabelText('Search products') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'shoes' } });
    fireEvent.click(screen.getByLabelText('Clear search'));

    expect(input.value).toBe('');
  });

  it('calls onSearch when Enter is pressed', () => {
    const onSearch = jest.fn();
    render(<SearchBar onSearch={onSearch} />);
    const input = screen.getByLabelText('Search products');

    fireEvent.change(input, { target: { value: 'laptop' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSearch).toHaveBeenCalledWith('laptop');
  });

  it('calls onSearch when search icon is clicked', () => {
    const onSearch = jest.fn();
    render(<SearchBar onSearch={onSearch} />);
    const input = screen.getByLabelText('Search products');

    fireEvent.change(input, { target: { value: 'phone' } });
    fireEvent.click(screen.getByLabelText('Search'));

    expect(onSearch).toHaveBeenCalledWith('phone');
  });

  it('does not call onSearch for empty/whitespace input', () => {
    const onSearch = jest.fn();
    render(<SearchBar onSearch={onSearch} />);
    const input = screen.getByLabelText('Search products');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSearch).not.toHaveBeenCalled();
  });

  it('debounces autocomplete by 300ms', async () => {
    mockGetAutocompleteSuggestions.mockResolvedValue({
      suggestions: [{ name: 'Shoes', category: 'Footwear', productId: 'p1' }],
    });

    render(<SearchBar onSearch={jest.fn()} />);
    const input = screen.getByLabelText('Search products');

    fireEvent.change(input, { target: { value: 'sh' } });

    // Not called yet (before debounce)
    expect(mockGetAutocompleteSuggestions).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(mockGetAutocompleteSuggestions).toHaveBeenCalledWith('sh', 5);
    });
  });

  it('does not fetch autocomplete for single character input', async () => {
    render(<SearchBar onSearch={jest.fn()} />);
    const input = screen.getByLabelText('Search products');

    fireEvent.change(input, { target: { value: 's' } });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    expect(mockGetAutocompleteSuggestions).not.toHaveBeenCalled();
  });

  it('displays autocomplete suggestions', async () => {
    mockGetAutocompleteSuggestions.mockResolvedValue({
      suggestions: [
        { name: 'Running Shoes', category: 'Footwear', productId: 'p1' },
        { name: 'Casual Shoes', category: 'Footwear', productId: 'p2' },
      ],
    });

    render(<SearchBar onSearch={jest.fn()} />);
    const input = screen.getByLabelText('Search products');

    fireEvent.change(input, { target: { value: 'sho' } });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Running Shoes')).toBeInTheDocument();
      expect(screen.getByText('Casual Shoes')).toBeInTheDocument();
    });
  });

  it('calls onSearch when a suggestion is selected', async () => {
    const onSearch = jest.fn();
    mockGetAutocompleteSuggestions.mockResolvedValue({
      suggestions: [{ name: 'Blue Shirt', category: 'Clothing', productId: 'p1' }],
    });

    render(<SearchBar onSearch={onSearch} />);
    const input = screen.getByLabelText('Search products');

    fireEvent.change(input, { target: { value: 'bl' } });

    await act(async () => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Blue Shirt')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Blue Shirt'));
    expect(onSearch).toHaveBeenCalledWith('Blue Shirt');
  });

  it('accepts sellerScope prop', () => {
    // sellerScope is accepted without error — used by parent for scoped search
    const { container } = render(
      <SearchBar onSearch={jest.fn()} sellerScope="seller-123" />
    );
    expect(container.querySelector('input')).toBeInTheDocument();
  });
});
