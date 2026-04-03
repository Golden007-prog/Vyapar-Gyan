/**
 * Property-based test: Card tap navigates to correct detail URL
 *
 * **Validates: Requirements 4.7**
 *
 * For any Product with id `pid`, tapping its MobileProductCard shall trigger
 * navigation to `/seller/inventory/${pid}`. For any Order with id `oid`,
 * tapping its MobileOrderCard shall trigger navigation to `/seller/orders/${oid}`.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fc from 'fast-check';
import MobileProductCard from '../MobileProductCard';
import type { Product } from '../MobileProductCard';
import MobileOrderCard from '../MobileOrderCard';
import type { Order } from '../MobileOrderCard';

// --- Mocks ---

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// --- Arbitraries ---

const productArb: fc.Arbitrary<Product> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
  name: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  categoryId: fc.uuid(),
  categoryName: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  price: fc.double({ min: 1, max: 999999, noNaN: true }),
  stockQuantity: fc.integer({ min: 0, max: 99999 }),
  stockAddedDate: fc.integer({ min: new Date('2020-01-01').getTime(), max: Date.now() }).map((ts) => new Date(ts).toISOString()),
  imageUrls: fc.constant([]),
  isActive: fc.boolean(),
  sku: fc.constant(undefined),
  brand: fc.constant(undefined),
  variant: fc.constant(undefined),
});

const statusArb = fc.constantFrom('pending', 'confirmed', 'processing', 'delivered', 'cancelled');

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

// --- Tests ---

describe('CardNavigation - Property 4: Card tap navigates to correct detail URL', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('MobileProductCard tap navigates to /seller/inventory/${productId} for any product ID', () => {
    fc.assert(
      fc.property(productArb, (product) => {
        pushMock.mockClear();
        const { container } = render(<MobileProductCard product={product} />);

        const button = container.querySelector('button');
        expect(button).toBeTruthy();
        fireEvent.click(button!);

        expect(pushMock).toHaveBeenCalledTimes(1);
        expect(pushMock).toHaveBeenCalledWith(`/seller/inventory/${product.id}`);
      }),
      { numRuns: 100 },
    );
  });

  it('MobileOrderCard tap navigates to /seller/orders/${orderId} for any order ID', () => {
    fc.assert(
      fc.property(orderArb, (order) => {
        pushMock.mockClear();
        const { container } = render(<MobileOrderCard order={order} />);

        const button = container.querySelector('button');
        expect(button).toBeTruthy();
        fireEvent.click(button!);

        expect(pushMock).toHaveBeenCalledTimes(1);
        expect(pushMock).toHaveBeenCalledWith(`/seller/orders/${order.id}`);
      }),
      { numRuns: 100 },
    );
  });
});
