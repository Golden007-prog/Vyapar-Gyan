/**
 * Unit tests for Cart Service
 *
 * Validates: addItem with version check, validateCheckout, clearCart.
 */

import type { Cart, UnifiedCartItem } from '../../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetCart = jest.fn();
const mockPutCart = jest.fn();
const mockDeleteCart = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  getCart: (...args: unknown[]) => mockGetCart(...args),
  putCart: (...args: unknown[]) => mockPutCart(...args),
  deleteCart: (...args: unknown[]) => mockDeleteCart(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({ eventBusName: 'test-bus' }),
}));

// Mock EventBridge — prevent real AWS calls
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutEventsCommand: jest.fn(),
}));

// Import after mocks are set up
import { getCart, addItem, validateCheckout, clearCart } from '../cart-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cart Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getCart', () => {
    it('returns null when no cart exists', async () => {
      mockGetCart.mockResolvedValue(null);
      const result = await getCart('user-1');
      expect(result).toBeNull();
      expect(mockGetCart).toHaveBeenCalledWith('user-1');
    });
  });

  describe('addItem', () => {
    const item: UnifiedCartItem = {
      productId: 'prod-1',
      sellerId: 'seller-1',
      name: 'Test Product',
      price: 100,
      quantity: 2,
    };

    it('creates a new cart when none exists', async () => {
      mockGetCart.mockResolvedValue(null);
      mockPutCart.mockResolvedValue(undefined);

      const result = await addItem('user-1', item);

      expect(result.userId).toBe('user-1');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].productId).toBe('prod-1');
      expect(result.subtotal).toBe(200); // 100 × 2
      expect(result.itemCount).toBe(2);
      expect(result.cartVersion).toBe(1);
      // putCart called with expectedVersion undefined (new cart)
      expect(mockPutCart).toHaveBeenCalledWith(expect.objectContaining({ cartVersion: 1 }), undefined);
    });

    it('increments quantity when product already in cart', async () => {
      const existingCart: Cart = {
        userId: 'user-1',
        items: [{ productId: 'prod-1', sellerId: 'seller-1', name: 'Test Product', price: 100, quantity: 1 }],
        subtotal: 100,
        itemCount: 1,
        cartVersion: 3,
        updatedAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 604800,
      };
      mockGetCart.mockResolvedValue(existingCart);
      mockPutCart.mockResolvedValue(undefined);

      const result = await addItem('user-1', item);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(3); // 1 + 2
      expect(result.subtotal).toBe(300); // 100 × 3
      expect(result.cartVersion).toBe(4);
      // putCart called with expectedVersion = 3 (optimistic concurrency)
      expect(mockPutCart).toHaveBeenCalledWith(expect.objectContaining({ cartVersion: 4 }), 3);
    });

    it('adds a new product to existing cart', async () => {
      const existingCart: Cart = {
        userId: 'user-1',
        items: [{ productId: 'prod-1', sellerId: 'seller-1', name: 'Product A', price: 50, quantity: 1 }],
        subtotal: 50,
        itemCount: 1,
        cartVersion: 1,
        updatedAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 604800,
      };
      mockGetCart.mockResolvedValue(existingCart);
      mockPutCart.mockResolvedValue(undefined);

      const newItem: UnifiedCartItem = {
        productId: 'prod-2',
        sellerId: 'seller-2',
        name: 'Product B',
        price: 75,
        quantity: 1,
      };

      const result = await addItem('user-1', newItem);

      expect(result.items).toHaveLength(2);
      expect(result.subtotal).toBe(125); // 50 + 75
      expect(result.itemCount).toBe(2);
    });
  });

  describe('validateCheckout', () => {
    it('returns invalid when cart is empty', async () => {
      mockGetCart.mockResolvedValue(null);
      const result = await validateCheckout('user-1');
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Cart is empty');
    });

    it('returns valid for a cart with valid items', async () => {
      mockGetCart.mockResolvedValue({
        userId: 'user-1',
        items: [{ productId: 'p1', sellerId: 's1', name: 'Item', price: 50, quantity: 2 }],
        subtotal: 100,
        itemCount: 2,
        cartVersion: 1,
        updatedAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 604800,
      });

      const result = await validateCheckout('user-1');
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('clearCart', () => {
    it('deletes the cart from DynamoDB', async () => {
      mockDeleteCart.mockResolvedValue(undefined);
      await clearCart('user-1');
      expect(mockDeleteCart).toHaveBeenCalledWith('user-1');
    });
  });
});
