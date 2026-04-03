import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MessageStatus from '../MessageStatus';
import type { DeliveryStatus } from '@/lib/api-chat';

describe('MessageStatus', () => {
  it('renders clock icon for queued status', () => {
    render(<MessageStatus status="queued" />);
    expect(screen.getByLabelText('Queued')).toBeInTheDocument();
  });

  it('renders single check for sent status', () => {
    render(<MessageStatus status="sent" />);
    expect(screen.getByLabelText('Sent')).toBeInTheDocument();
  });

  it('renders double gray checks for delivered status', () => {
    render(<MessageStatus status="delivered" />);
    expect(screen.getByLabelText('Delivered')).toBeInTheDocument();
  });

  it('renders double blue checks for read status', () => {
    render(<MessageStatus status="read" />);
    expect(screen.getByLabelText('Read')).toBeInTheDocument();
  });

  it('renders red alert icon for failed status', () => {
    render(<MessageStatus status="failed" />);
    expect(screen.getByLabelText('Failed')).toBeInTheDocument();
  });

  it('shows Retry button only for failed status with onRetry', () => {
    const onRetry = jest.fn();
    render(<MessageStatus status="failed" onRetry={onRetry} />);
    expect(screen.getByLabelText('Retry sending message')).toBeInTheDocument();
  });

  it('does not show Retry button for non-failed statuses', () => {
    const statuses: DeliveryStatus[] = ['queued', 'sent', 'delivered', 'read'];
    statuses.forEach((status) => {
      const { unmount } = render(<MessageStatus status={status} onRetry={jest.fn()} />);
      expect(screen.queryByLabelText('Retry sending message')).not.toBeInTheDocument();
      unmount();
    });
  });

  it('calls onRetry when Retry button is clicked', () => {
    const onRetry = jest.fn();
    render(<MessageStatus status="failed" onRetry={onRetry} />);
    fireEvent.click(screen.getByLabelText('Retry sending message'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show Retry button for failed status without onRetry', () => {
    render(<MessageStatus status="failed" />);
    expect(screen.queryByLabelText('Retry sending message')).not.toBeInTheDocument();
  });
});
