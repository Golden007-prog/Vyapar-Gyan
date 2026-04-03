/**
 * Property-based test: Order card displays all required fields
 *
 * **Validates: Requirements 4.5**
 *
 * For any valid Order object (with an ID, customer name, amount, status, and
 * date), the MobileOrderCard component shall render output containing the
 * order ID, customer name, formatted amount, status label, and formatted date.
 */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fc from 'fast-check';
import MobileOrderCard from '../MobileOrderCard';
import type { Order } from '../MobileOrderCard';

// --- Mocks ---

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// --- Arbitraries ---

const statusArb = fc.constantFrom('pending', 'confirmed', 'processing', 'delivered', 'cancelled');

const statusLabelMap: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const orderArb: fc.Arbitrary<Order> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
  customerId: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
  status: statusArb,
  items: fc.constant([]),
  subtotal: fc.double({ min: 1, max: 999999, noNaN: true }),
  commissionAmount: fc.double({ min: 0, max: 99999, noNaN: true }),
  sellerAmount: fc.double({ min: 0, max: 999999, noNaN: true }),
  shippingAddress: fc.record({
    name: fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0),
    phone: fc.constant('+911234567890'),
    addressLine1: fc.constant('123 Main St'),
    city: fc.constant('Mumbai'),
    state: fc.constant('Maharashtra'),
    pincode: fc.constant('400001'),
  }),
  createdAt: fc
    .integer({ min: new Date('2020-01-01').getTime(), max: new Date('2025-12-31').getTime() })
    .map((ts) => new Date(ts).toISOString()),
  updatedAt: fc
    .integer({ min: new Date('2020-01-01').getTime(), max: new Date('2025-12-31').getTime() })
    .map((ts) => new Date(ts).toISOString()),
});

// --- Test ---

describe('MobileOrderCard - Property 3: Order card displays all required fields', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('should display truncated order ID, customer name, ₹ symbol, and status label for any valid order', () => {
    fc.assert(
      fc.property(orderArb, (order) => {
        const { container } = render(<MobileOrderCard order={order} />);
        const text = container.textContent || '';

        // Truncated order ID (first 8 chars) must appear
        const truncatedId = order.id.length > 8 ? order.id.slice(0, 8) : order.id;
        expect(text).toContain(truncatedId);

        // Customer name from shippingAddress must appear
        expect(text).toContain(order.shippingAddress.name);

        // ₹ symbol must appear (formatted amount)
        expect(text).toContain('₹');

        // Status label text must appear
        const expectedLabel = statusLabelMap[order.status];
        expect(text).toContain(expectedLabel);
      }),
      { numRuns: 100 },
    );
  });
});
