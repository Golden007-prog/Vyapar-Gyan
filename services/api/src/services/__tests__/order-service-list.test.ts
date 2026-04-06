/**
 * Unit tests for OrderService.listSellerOrders() and listCustomerOrders()
 *
 * Validates: Requirements 14.2, 14.3
 */

import { marshall } from '@aws-sdk/util-dynamodb';

// ---------------------------------------------------------------------------
// Mock DynamoDB client — must be declared before jest.mock (hoisted)
// ---------------------------------------------------------------------------

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  TransactWriteItemsCommand: jest.fn(),
  GetItemCommand: jest.fn(),
  QueryCommand: jest.fn((input: any) => input),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: jest.fn() })),
  PutEventsCommand: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({ tableName: 'test-table' }),
}));

// Import after mocks are set up
import { OrderService } from '../order-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSellerIndexItem(overrides: Record<string, any> = {}) {
  return marshall({
    PK: 'SELLER#seller-1',
    SK: `ORDER#2025-01-15T10:00:00.000Z#uuid-1`,
    orderId: 'VG-20250115-0001',
    orderUUID: 'uuid-1',
    customerId: 'cust-1',
    totalAmount: 500,
    status: 'pending_seller_confirmation',
    createdAt: '2025-01-15T10:00:00.000Z',
    ...overrides,
  });
}

function makeCustomerIndexItem(overrides: Record<string, any> = {}) {
  return marshall({
    PK: 'CUSTOMER#cust-1',
    SK: `ORDER#2025-01-15T10:00:00.000Z#uuid-1`,
    orderId: 'VG-20250115-0001',
    orderUUID: 'uuid-1',
    sellerId: 'seller-1',
    totalAmount: 500,
    status: 'paid',
    createdAt: '2025-01-15T10:00:00.000Z',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrderService.listSellerOrders', () => {
  let service: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderService('test-table');
  });

  it('returns seller orders sorted descending by default', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeSellerIndexItem({ createdAt: '2025-01-16T10:00:00.000Z', SK: 'ORDER#2025-01-16T10:00:00.000Z#uuid-2', orderUUID: 'uuid-2', orderId: 'VG-20250116-0001' }),
        makeSellerIndexItem(),
      ],
    });

    const results = await service.listSellerOrders('seller-1');

    expect(results).toHaveLength(2);
    expect(results[0]!.orderUUID).toBe('uuid-2');
    expect(results[1]!.orderUUID).toBe('uuid-1');

    // Verify QueryCommand was called with ScanIndexForward: false
    const queryInput = mockSend.mock.calls[0][0];
    expect(queryInput.ScanIndexForward).toBe(false);
    expect(queryInput.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :skPrefix)');
  });

  it('returns empty array when no orders exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const results = await service.listSellerOrders('seller-no-orders');
    expect(results).toEqual([]);
  });

  it('returns empty array when Items is undefined', async () => {
    mockSend.mockResolvedValueOnce({});

    const results = await service.listSellerOrders('seller-no-orders');
    expect(results).toEqual([]);
  });

  it('applies status filter when provided', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeSellerIndexItem({ status: 'confirmed' })],
    });

    const results = await service.listSellerOrders('seller-1', 'confirmed');

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('confirmed');

    const queryInput = mockSend.mock.calls[0][0];
    expect(queryInput.FilterExpression).toBe('#status = :statusFilter');
    expect(queryInput.ExpressionAttributeNames).toEqual({ '#status': 'status' });
  });

  it('does not include FilterExpression when no status filter', async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeSellerIndexItem()] });

    await service.listSellerOrders('seller-1');

    const queryInput = mockSend.mock.calls[0][0];
    expect(queryInput.FilterExpression).toBeUndefined();
  });

  it('respects custom limit parameter', async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeSellerIndexItem()] });

    await service.listSellerOrders('seller-1', undefined, 10);

    const queryInput = mockSend.mock.calls[0][0];
    expect(queryInput.Limit).toBe(10);
  });

  it('uses default limit of 50', async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeSellerIndexItem()] });

    await service.listSellerOrders('seller-1');

    const queryInput = mockSend.mock.calls[0][0];
    expect(queryInput.Limit).toBe(50);
  });

  it('maps seller index items to OrderSummary with customerId', async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeSellerIndexItem()] });

    const results = await service.listSellerOrders('seller-1');

    expect(results[0]).toEqual({
      orderId: 'VG-20250115-0001',
      orderUUID: 'uuid-1',
      customerId: 'cust-1',
      totalAmount: 500,
      status: 'pending_seller_confirmation',
      createdAt: '2025-01-15T10:00:00.000Z',
    });
  });
});

describe('OrderService.listCustomerOrders', () => {
  let service: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderService('test-table');
  });

  it('returns customer orders sorted descending by default', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        makeCustomerIndexItem({ createdAt: '2025-01-16T10:00:00.000Z', SK: 'ORDER#2025-01-16T10:00:00.000Z#uuid-2', orderUUID: 'uuid-2', orderId: 'VG-20250116-0001' }),
        makeCustomerIndexItem(),
      ],
    });

    const results = await service.listCustomerOrders('cust-1');

    expect(results).toHaveLength(2);
    expect(results[0]!.orderUUID).toBe('uuid-2');
    expect(results[1]!.orderUUID).toBe('uuid-1');

    const queryInput = mockSend.mock.calls[0][0];
    expect(queryInput.ScanIndexForward).toBe(false);
    expect(queryInput.KeyConditionExpression).toBe('PK = :pk AND begins_with(SK, :skPrefix)');
  });

  it('returns empty array when no orders exist', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const results = await service.listCustomerOrders('cust-no-orders');
    expect(results).toEqual([]);
  });

  it('applies status filter when provided', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [makeCustomerIndexItem({ status: 'paid' })],
    });

    const results = await service.listCustomerOrders('cust-1', 'paid');

    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('paid');

    const queryInput = mockSend.mock.calls[0][0];
    expect(queryInput.FilterExpression).toBe('#status = :statusFilter');
  });

  it('maps customer index items to OrderSummary with sellerId', async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeCustomerIndexItem()] });

    const results = await service.listCustomerOrders('cust-1');

    expect(results[0]).toEqual({
      orderId: 'VG-20250115-0001',
      orderUUID: 'uuid-1',
      sellerId: 'seller-1',
      totalAmount: 500,
      status: 'paid',
      createdAt: '2025-01-15T10:00:00.000Z',
    });
  });

  it('uses default limit of 50', async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeCustomerIndexItem()] });

    await service.listCustomerOrders('cust-1');

    const queryInput = mockSend.mock.calls[0][0];
    expect(queryInput.Limit).toBe(50);
  });

  it('respects custom limit parameter', async () => {
    mockSend.mockResolvedValueOnce({ Items: [makeCustomerIndexItem()] });

    await service.listCustomerOrders('cust-1', undefined, 25);

    const queryInput = mockSend.mock.calls[0][0];
    expect(queryInput.Limit).toBe(25);
  });
});
