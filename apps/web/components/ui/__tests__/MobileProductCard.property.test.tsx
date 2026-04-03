/**
 * Property-based test: Product card displays all required fields
 *
 * **Validates: Requirements 4.4**
 *
 * For any valid Product object (with non-empty name, a category, a numeric
 * price, a stock quantity, and a status), the MobileProductCard component
 * shall render output containing the product name, category name, formatted
 * price, stock count, and status text.
 */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fc from 'fast-check';
import MobileProductCard from '../MobileProductCard';
import type { Product } from '../MobileProductCard';

// --- Mocks ---

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// --- Arbitraries ---

const productArb: fc.Arbitrary<Product> = fc.record({
  id: fc.uuid(),
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

// --- Test ---

describe('MobileProductCard - Property 2: Product card displays all required fields', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('should display name, category, price (₹), stock count, and status for any valid product', () => {
    fc.assert(
      fc.property(productArb, (product) => {
        const { container } = render(<MobileProductCard product={product} />);
        const text = container.textContent || '';

        // Product name must appear
        expect(text).toContain(product.name);

        // Category name must appear
        expect(text).toContain(product.categoryName);

        // Price must include ₹ symbol
        expect(text).toContain('₹');

        // Stock count text must appear
        expect(text).toContain('in stock');

        // Status text must appear
        if (product.isActive) {
          expect(text).toContain('Active');
        } else {
          expect(text).toContain('Inactive');
        }
      }),
      { numRuns: 100 },
    );
  });
});
