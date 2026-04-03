import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ProductCard from '../ProductCard';
import OrderStatusCard from '../OrderStatusCard';
import AISuggestionCard from '../AISuggestionCard';
import QuickReplyButtons from '../QuickReplyButtons';

describe('ProductCard', () => {
  const defaultProps = {
    productId: 'prod-1',
    name: 'Cotton Kurta',
    price: 599,
    imageUrl: 'https://example.com/kurta.jpg',
    description: 'Comfortable cotton kurta for daily wear',
  };

  it('renders product name, price, and description', () => {
    render(<ProductCard {...defaultProps} />);
    expect(screen.getByText('Cotton Kurta')).toBeInTheDocument();
    expect(screen.getByText('₹599')).toBeInTheDocument();
    expect(screen.getByText('Comfortable cotton kurta for daily wear')).toBeInTheDocument();
  });

  it('renders product image with alt text', () => {
    render(<ProductCard {...defaultProps} />);
    const img = screen.getByAltText('Cotton Kurta');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/kurta.jpg');
  });

  it('renders Add to cart button', () => {
    render(<ProductCard {...defaultProps} />);
    expect(screen.getByLabelText('Add Cotton Kurta to cart')).toBeInTheDocument();
  });

  it('calls onAddToCart with productId when button is clicked', () => {
    const onAddToCart = jest.fn();
    render(<ProductCard {...defaultProps} onAddToCart={onAddToCart} />);
    fireEvent.click(screen.getByText('Add to cart'));
    expect(onAddToCart).toHaveBeenCalledWith('prod-1');
  });

  it('formats price with Indian locale', () => {
    render(<ProductCard {...defaultProps} price={12500} />);
    expect(screen.getByText('₹12,500')).toBeInTheDocument();
  });
});

describe('OrderStatusCard', () => {
  const defaultProps = {
    orderNumber: 'VG-1234',
    status: 'Shipped',
    items: [
      { name: 'Cotton Kurta', quantity: 2 },
      { name: 'Silk Saree', quantity: 1 },
    ],
    totalAmount: 2499,
    updatedAt: new Date().toISOString(),
  };

  it('renders order number and status badge', () => {
    render(<OrderStatusCard {...defaultProps} />);
    expect(screen.getByText('Order #VG-1234')).toBeInTheDocument();
    expect(screen.getByLabelText('Status: Shipped')).toBeInTheDocument();
  });

  it('renders item summary', () => {
    render(<OrderStatusCard {...defaultProps} />);
    expect(screen.getByText('Cotton Kurta × 2')).toBeInTheDocument();
    expect(screen.getByText('Silk Saree × 1')).toBeInTheDocument();
  });

  it('renders total amount with ₹ prefix', () => {
    render(<OrderStatusCard {...defaultProps} />);
    expect(screen.getByText('₹2,499')).toBeInTheDocument();
  });

  it('renders updated time', () => {
    render(<OrderStatusCard {...defaultProps} />);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it('applies color-coded badge for different statuses', () => {
    const { rerender } = render(<OrderStatusCard {...defaultProps} status="Delivered" />);
    const badge = screen.getByLabelText('Status: Delivered');
    expect(badge.className).toContain('bg-green-100');

    rerender(<OrderStatusCard {...defaultProps} status="Cancelled" />);
    const cancelBadge = screen.getByLabelText('Status: Cancelled');
    expect(cancelBadge.className).toContain('bg-red-100');
  });
});

describe('AISuggestionCard', () => {
  const defaultProps = {
    title: 'Dead Stock Alert',
    body: 'You have 15 items that haven\'t sold in 90 days. Consider a 20% discount.',
  };

  it('renders title and body', () => {
    render(<AISuggestionCard {...defaultProps} />);
    expect(screen.getByText('Dead Stock Alert')).toBeInTheDocument();
    expect(screen.getByText(/15 items/)).toBeInTheDocument();
  });

  it('renders Approve button when onApprove is provided', () => {
    const onApprove = jest.fn();
    render(<AISuggestionCard {...defaultProps} onApprove={onApprove} />);
    const btn = screen.getByLabelText('Approve suggestion');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('renders Dismiss button when onDismiss is provided', () => {
    const onDismiss = jest.fn();
    render(<AISuggestionCard {...defaultProps} onDismiss={onDismiss} />);
    const btn = screen.getByLabelText('Dismiss suggestion');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render buttons when callbacks are not provided', () => {
    render(<AISuggestionCard {...defaultProps} />);
    expect(screen.queryByLabelText('Approve suggestion')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Dismiss suggestion')).not.toBeInTheDocument();
  });
});

describe('QuickReplyButtons', () => {
  const defaultProps = {
    prompt: 'How would you like to proceed?',
    options: [
      { label: 'Track Order', value: 'track_order' },
      { label: 'Cancel Order', value: 'cancel_order' },
      { label: 'Contact Support', value: 'contact_support' },
    ],
  };

  it('renders prompt text', () => {
    render(<QuickReplyButtons {...defaultProps} />);
    expect(screen.getByText('How would you like to proceed?')).toBeInTheDocument();
  });

  it('renders all option buttons as pills', () => {
    render(<QuickReplyButtons {...defaultProps} />);
    expect(screen.getByText('Track Order')).toBeInTheDocument();
    expect(screen.getByText('Cancel Order')).toBeInTheDocument();
    expect(screen.getByText('Contact Support')).toBeInTheDocument();
  });

  it('calls onSelect with option value when button is clicked', () => {
    const onSelect = jest.fn();
    render(<QuickReplyButtons {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Cancel Order'));
    expect(onSelect).toHaveBeenCalledWith('cancel_order');
  });

  it('renders buttons with pill styling (rounded-full)', () => {
    render(<QuickReplyButtons {...defaultProps} />);
    const btn = screen.getByText('Track Order');
    expect(btn.className).toContain('rounded-full');
  });

  it('has horizontally scrollable container', () => {
    render(<QuickReplyButtons {...defaultProps} />);
    const group = screen.getByRole('group', { name: 'Quick reply buttons' });
    expect(group.className).toContain('overflow-x-auto');
  });
});
