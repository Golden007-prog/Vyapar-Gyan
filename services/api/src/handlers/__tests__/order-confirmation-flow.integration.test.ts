/**
 * Integration Tests — Order Confirmation Flow
 *
 * Tests the full order lifecycle through OrderService and state machine.
 * Covers: WhatsApp order flow, Web order flow, seller rejection,
 * payment expiry, and concurrent acceptance.
 *
 * Validates: Requirements 1.3, 1.5, 1.7, 2.5, 3.4, 5.3, 5.4, 5.6, 6.1, 7.1, 7.4, 8.2, 8.7
 */

import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// ---------------------------------------------------------------------------
// Mock setup — must be before imports
// ---------------------------------------------------------------------------

const mockDynamoSend = jest.fn();
const mockEBSend = jest.fn().mockResolvedValue({});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockDynamoSend })),
  TransactWriteItemsCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'TransactWriteItems', ...(input as any) })),
  GetItemCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'GetItem', ...(input as any) })),
  QueryCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'Query', ...(input as any) })),
  PutItemCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'PutItem', ...(input as any) })),
  UpdateItemCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'UpdateItem', ...(input as any) })),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEBSend })),
  PutEventsCommand: jest.fn().mockImplementation((input: unknown) => ({ _type: 'PutEvents', ...(input as any) })),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    tableName: 'test-table',
    eventBusName: 'test-bus',
  }),
}));

jest.mock('../../core/metrics', () => ({
  publishCountMetric: jest.fn(),
  publishLatencyMetric: jest.fn(),
}));

jest.mock('../../services/order-scheduler-service', () => ({
  scheduleSellerReminders: jest.fn().mockResolvedValue(undefined),
  schedulePaymentNudges: jest.fn().mockResolvedValue(undefined),
  cancelOrderSchedules: jest.fn().mockResolvedValue(undefined),
}));

const mockCreatePaymentLink = jest.fn();
const mockVerifyWebhookSignature = jest.fn();
jest.mock('../../adapters/razorpay-adapter', () => ({
  RazorpayAdapter: jest.fn().mockImplementation(() => ({
    createPaymentLink: mockCreatePaymentLink,
    verifyWebhookSignature: mockVerifyWebhookSignature,
  })),
}));

jest.mock('../../adapters/twilio-adapter', () => ({
  twilioAdapter: {
    sendWhatsAppMessage: jest.fn().mockResolvedValue({ sid: 'WA_test' }),
    sendSMS: jest.fn().mockResolvedValue({ sid: 'SM_test' }),
  },
}));

jest.mock('../../services/whatsapp-sender', () => ({
  whatsappSender: { sendMessage: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../repositories/message-repository', () => ({
  MessageRepository: jest.fn().mockImplementation(() => ({
    create: jest.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { OrderService } from '../../services/order-service';
import {
  validateTransition,
  requiresStockUnreservation,
  requiresStockFinalization,
} from '../../services/order-state-machine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildOrderRecord(overrides: Record<string, any> = {}) {
  return {
    PK: 'ORDER#order-uuid-1',
    SK: 'METADATA',
    id: 'order-uuid-1',
    orderId: 'VG-20260115-0001',
    customerId: 'cust-enigma',
    customerPhone: '+917001124396',
    sellerId: 'seller-dragon',
    items: [
      { productId: 'demo-amul-butter', sellerId: 'seller-dragon', name: 'Amul Butter 500g', price: 280, quantity: 2 },
    ],
    subtotal: 560,
    commissionRate: 0.15,
    commissionAmount: 84,
    sellerAmount: 476,
    totalAmount: 560,
    status: 'pending_seller_confirmation',
    channel: 'whatsapp',
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function marshalledItem(record: Record<string, any>) {
  return { Item: marshall(record, { removeUndefinedValues: true }) };
}

function marshalledQueryItems(records: Record<string, any>[]) {
  return {
    Items: records.map(r => marshall(r, { removeUndefinedValues: true })),
    Count: records.length,
  };
}

function buildProductRecord(productId: string, stockQuantity: number, reservedStock: number) {
  return {
    PK: `PRODUCT#${productId}`,
    SK: 'METADATA',
    id: productId,
    stockQuantity,
    reserved_stock: reservedStock,
    isActive: true,
    name: 'Test Product',
    price: 280,
  };
}

/** Standard mock for transitionOrder calls — handles GetItem, Query, TransactWriteItems */
function setupTransitionMock(orderRecord: Record<string, any>) {
  mockDynamoSend.mockImplementation((cmd: any) => {
    if (cmd._type === 'GetItem') {
      const key = cmd.Key;
      if (!key) return Promise.resolve({});
      const pk = unmarshall(key)?.PK;
      if (typeof pk === 'string' && pk.startsWith('ORDER#')) {
        return Promise.resolve(marshalledItem(orderRecord));
      }
      return Promise.resolve({});
    }
    if (cmd._type === 'TransactWriteItems') return Promise.resolve({});
    if (cmd._type === 'Query') {
      return Promise.resolve(marshalledQueryItems([{
        PK: `SELLER#${orderRecord.sellerId}`,
        SK: `ORDER#${orderRecord.createdAt}#${orderRecord.id}`,
        orderUUID: orderRecord.id,
        status: orderRecord.status,
      }]));
    }
    return Promise.resolve({});
  });
}


// ---------------------------------------------------------------------------
// 19.1 WhatsApp Order Flow Integration Test
// Validates: Requirements 1.3, 2.5, 6.1, 7.1, 8.2
// ---------------------------------------------------------------------------

describe('19.1 Integration: WhatsApp Order Flow (CONFIRM → ACCEPT → payment → paid)', () => {
  let orderService: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    orderService = new OrderService('test-table');
  });

  it('full WhatsApp flow: create order → seller accepts → payment link → webhook paid', async () => {
    // ── Step 1: Create order (customer CONFIRM via WhatsApp) ──
    // Mock resolves all DynamoDB calls for order creation
    mockDynamoSend.mockResolvedValue({});
    // Override GetItem to return product for stock check
    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'GetItem') {
        const key = cmd.Key;
        if (!key) return Promise.resolve({});
        const pk = unmarshall(key)?.PK;
        if (typeof pk === 'string' && pk.startsWith('PRODUCT#')) {
          return Promise.resolve(marshalledItem(buildProductRecord('demo-amul-butter', 45, 0)));
        }
        if (typeof pk === 'string' && pk.startsWith('ORDER#')) {
          return Promise.resolve(marshalledItem(buildOrderRecord()));
        }
        return Promise.resolve({});
      }
      if (cmd._type === 'TransactWriteItems') return Promise.resolve({});
      if (cmd._type === 'Query') {
        return Promise.resolve(marshalledQueryItems([{
          PK: 'SELLER#seller-dragon',
          SK: 'ORDER#2026-01-15T10:00:00.000Z#order-uuid-1',
          orderUUID: 'order-uuid-1',
          status: 'pending_seller_confirmation',
        }]));
      }
      return Promise.resolve({});
    });

    const createResult = await orderService.createOrder({
      customerId: 'cust-enigma',
      customerPhone: '+917001124396',
      sellerId: 'seller-dragon',
      cartItems: [
        { productId: 'demo-amul-butter', sellerId: 'seller-dragon', name: 'Amul Butter 500g', price: 280, quantity: 2 } as any,
      ],
      channel: 'whatsapp',
      shippingAddress: {
        name: 'Enigma',
        phone: '+917001124396',
        addressLine1: '123 Main St',
        city: 'Kolkata',
        state: 'West Bengal',
        pincode: '700001',
      },
    });

    expect(createResult.success).toBe(true);
    expect(createResult.order).toBeDefined();
    expect(createResult.order!.status).toBe('pending_seller_confirmation');
    expect(createResult.order!.channel).toBe('whatsapp');
    expect(createResult.order!.totalAmount).toBe(560);

    // Verify TransactWriteItems was called (stock reservation + order creation)
    const transactCalls = mockDynamoSend.mock.calls.filter(
      (c: any[]) => c[0]?._type === 'TransactWriteItems',
    );
    expect(transactCalls.length).toBeGreaterThanOrEqual(1);

    // Verify EventBridge order.created event published
    expect(mockEBSend).toHaveBeenCalled();
    const ebCall = mockEBSend.mock.calls[0][0];
    expect(ebCall.Entries[0].Source).toBe('vyapargyan.orders');
    expect(ebCall.Entries[0].DetailType).toBe('order.created');

    // ── Step 2: Seller accepts (ACCEPT via WhatsApp — Req 6.1) ──
    const acceptValidation = validateTransition('pending_seller_confirmation', 'confirmed', 'seller');
    expect(acceptValidation.valid).toBe(true);

    setupTransitionMock(buildOrderRecord({ status: 'pending_seller_confirmation' }));
    mockEBSend.mockClear();

    const acceptResult = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'confirmed',
      actor: 'seller',
      actorId: 'seller-dragon',
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.order!.status).toBe('confirmed');
    expect(mockEBSend).toHaveBeenCalled();

    // ── Step 3: System generates payment link → payment_pending (Req 7.1) ──
    expect(validateTransition('confirmed', 'payment_pending', 'system').valid).toBe(true);

    setupTransitionMock(buildOrderRecord({ status: 'confirmed' }));
    mockEBSend.mockClear();

    const ppResult = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'payment_pending',
      actor: 'system',
      actorId: 'system',
    });

    expect(ppResult.success).toBe(true);
    expect(ppResult.order!.status).toBe('payment_pending');

    // ── Step 4: Razorpay webhook → paid (Req 8.2) ──
    expect(validateTransition('payment_pending', 'paid', 'webhook').valid).toBe(true);
    expect(requiresStockFinalization('paid')).toBe(true);

    setupTransitionMock(buildOrderRecord({ status: 'payment_pending' }));
    mockEBSend.mockClear();

    const paidResult = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'paid',
      actor: 'webhook',
      actorId: 'razorpay:plink_test123',
      reason: 'Payment captured via payment link plink_test123',
    });

    expect(paidResult.success).toBe(true);
    expect(paidResult.order!.status).toBe('paid');

    // Verify stock finalization in TransactWriteItems
    const paidTransactCalls = mockDynamoSend.mock.calls.filter(
      (c: any[]) => c[0]?._type === 'TransactWriteItems',
    );
    expect(paidTransactCalls.length).toBeGreaterThanOrEqual(1);

    // Verify the transaction includes product stock finalization
    const lastTransact = paidTransactCalls[paidTransactCalls.length - 1][0];
    const productUpdates = lastTransact.TransactItems.filter((item: any) => {
      if (!item.Update) return false;
      const key = unmarshall(item.Update.Key);
      return typeof key.PK === 'string' && key.PK.startsWith('PRODUCT#');
    });
    expect(productUpdates.length).toBe(1); // 1 product in order
    expect(productUpdates[0].Update.UpdateExpression).toContain('stockQuantity = stockQuantity - :qty');
    expect(productUpdates[0].Update.UpdateExpression).toContain('reserved_stock = reserved_stock - :qty');

    // Verify order.paid event published
    expect(mockEBSend).toHaveBeenCalled();
  });
});


// ---------------------------------------------------------------------------
// 19.2 Web Order Flow Integration Test
// Validates: Requirements 3.4, 5.3, 7.4, 8.2
// ---------------------------------------------------------------------------

describe('19.2 Integration: Web Order Flow (Place Order → Accept → Pay Now → paid)', () => {
  let orderService: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    orderService = new OrderService('test-table');
  });

  it('full web flow: create order → seller accepts → payment_pending → webhook paid', async () => {
    const webOrder = buildOrderRecord({
      id: 'web-order-uuid',
      orderId: 'VG-20260115-0002',
      channel: 'web',
      customerId: 'cust-web-user',
      customerPhone: '+919876543210',
      items: [{ productId: 'demo-surf-excel', sellerId: 'seller-dragon', name: 'Surf Excel 1kg', price: 199, quantity: 1 }],
      subtotal: 199,
      totalAmount: 199,
      commissionAmount: 30,
      sellerAmount: 169,
    });

    // ── Step 1: Customer clicks "Place Order" on web (Req 3.4) ──
    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'GetItem') {
        const key = cmd.Key;
        if (!key) return Promise.resolve({});
        const pk = unmarshall(key)?.PK;
        if (typeof pk === 'string' && pk.startsWith('PRODUCT#')) {
          return Promise.resolve(marshalledItem(buildProductRecord('demo-surf-excel', 30, 0)));
        }
        if (typeof pk === 'string' && pk.startsWith('ORDER#')) {
          return Promise.resolve(marshalledItem(webOrder));
        }
        return Promise.resolve({});
      }
      if (cmd._type === 'TransactWriteItems') return Promise.resolve({});
      if (cmd._type === 'Query') {
        return Promise.resolve(marshalledQueryItems([{
          PK: 'SELLER#seller-dragon',
          SK: 'ORDER#2026-01-15T10:00:00.000Z#web-order-uuid',
          orderUUID: 'web-order-uuid',
          status: 'pending_seller_confirmation',
        }]));
      }
      return Promise.resolve({});
    });

    const createResult = await orderService.createOrder({
      customerId: 'cust-web-user',
      customerPhone: '+919876543210',
      sellerId: 'seller-dragon',
      cartItems: [
        { productId: 'demo-surf-excel', sellerId: 'seller-dragon', name: 'Surf Excel 1kg', price: 199, quantity: 1 } as any,
      ],
      channel: 'web',
      shippingAddress: {
        name: 'Web User',
        phone: '+919876543210',
        addressLine1: '456 Park Ave',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
      },
    });

    expect(createResult.success).toBe(true);
    expect(createResult.order!.status).toBe('pending_seller_confirmation');
    expect(createResult.order!.channel).toBe('web');
    expect(createResult.order!.totalAmount).toBe(199);
    expect(mockEBSend).toHaveBeenCalled();

    // ── Step 2: Seller accepts via dashboard (Req 5.3) ──
    setupTransitionMock(buildOrderRecord({ ...webOrder, status: 'pending_seller_confirmation' }));
    mockEBSend.mockClear();

    const acceptResult = await orderService.transitionOrder({
      orderId: 'web-order-uuid',
      targetStatus: 'confirmed',
      actor: 'seller',
      actorId: 'seller-dragon',
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.order!.status).toBe('confirmed');

    // ── Step 3: System transitions to payment_pending (Req 7.4) ──
    setupTransitionMock({ ...webOrder, status: 'confirmed' });
    mockEBSend.mockClear();

    const ppResult = await orderService.transitionOrder({
      orderId: 'web-order-uuid',
      targetStatus: 'payment_pending',
      actor: 'system',
      actorId: 'system',
    });

    expect(ppResult.success).toBe(true);
    expect(ppResult.order!.status).toBe('payment_pending');

    // ── Step 4: Customer pays via embedded checkout → webhook (Req 8.2) ──
    setupTransitionMock({ ...webOrder, status: 'payment_pending' });
    mockEBSend.mockClear();

    const paidResult = await orderService.transitionOrder({
      orderId: 'web-order-uuid',
      targetStatus: 'paid',
      actor: 'webhook',
      actorId: 'razorpay:plink_web123',
      reason: 'Payment captured via embedded checkout',
    });

    expect(paidResult.success).toBe(true);
    expect(paidResult.order!.status).toBe('paid');
    expect(requiresStockFinalization('paid')).toBe(true);
    expect(mockEBSend).toHaveBeenCalled();
  });

  it('web order creation fails when stock insufficient', async () => {
    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'GetItem') {
        const key = cmd.Key;
        if (!key) return Promise.resolve({});
        const pk = unmarshall(key)?.PK;
        if (pk === 'PRODUCT#demo-surf-excel') {
          return Promise.resolve(marshalledItem(buildProductRecord('demo-surf-excel', 5, 5)));
        }
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });

    const result = await orderService.createOrder({
      customerId: 'cust-web-user',
      customerPhone: '+919876543210',
      sellerId: 'seller-dragon',
      cartItems: [
        { productId: 'demo-surf-excel', sellerId: 'seller-dragon', name: 'Surf Excel 1kg', price: 199, quantity: 1 } as any,
      ],
      channel: 'web',
      shippingAddress: {
        name: 'Web User',
        phone: '+919876543210',
        addressLine1: '456 Park Ave',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('out of stock');
    expect(result.outOfStockItems).toContain('Surf Excel 1kg');
  });
});


// ---------------------------------------------------------------------------
// 19.3 Seller Rejection Flow Integration Test
// Validates: Requirements 1.5, 5.4, 5.6
// ---------------------------------------------------------------------------

describe('19.3 Integration: Seller Rejection Flow (order.created → REJECT → stock unreserved)', () => {
  let orderService: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    orderService = new OrderService('test-table');
  });

  it('seller rejects order → status rejected, stock unreserved, customer notified', async () => {
    const orderRecord = buildOrderRecord({
      status: 'pending_seller_confirmation',
      items: [
        { productId: 'demo-amul-butter', sellerId: 'seller-dragon', name: 'Amul Butter 500g', price: 280, quantity: 3 },
        { productId: 'demo-usbc-cable', sellerId: 'seller-dragon', name: 'USB-C Cable 1m', price: 149, quantity: 1 },
      ],
      subtotal: 989,
      totalAmount: 989,
    });

    setupTransitionMock(orderRecord);

    // Validate state machine allows rejection
    expect(validateTransition('pending_seller_confirmation', 'rejected', 'seller').valid).toBe(true);
    expect(requiresStockUnreservation('rejected')).toBe(true);

    const result = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'rejected',
      actor: 'seller',
      actorId: 'seller-dragon',
      reason: 'Items not available in store',
    });

    expect(result.success).toBe(true);
    expect(result.order!.status).toBe('rejected');

    // Verify TransactWriteItems was called with stock unreservation updates
    const transactCalls = mockDynamoSend.mock.calls.filter(
      (c: any[]) => c[0]?._type === 'TransactWriteItems',
    );
    expect(transactCalls.length).toBe(1);

    const transactItems = transactCalls[0][0].TransactItems;
    expect(transactItems.length).toBeGreaterThanOrEqual(4);

    // Verify stock unreservation updates for both products
    const productUpdates = transactItems.filter((item: any) => {
      if (!item.Update) return false;
      const key = unmarshall(item.Update.Key);
      return typeof key.PK === 'string' && key.PK.startsWith('PRODUCT#');
    });
    expect(productUpdates.length).toBe(2);

    for (const update of productUpdates) {
      expect(update.Update.UpdateExpression).toContain('reserved_stock = reserved_stock - :qty');
    }

    // Verify order.rejected event published
    expect(mockEBSend).toHaveBeenCalled();
    const ebCall = mockEBSend.mock.calls[0][0];
    expect(ebCall.Entries[0].DetailType).toBe('order.rejected');
  });

  it('rejection of non-pending order fails with error', async () => {
    setupTransitionMock(buildOrderRecord({ status: 'confirmed' }));

    expect(validateTransition('confirmed', 'rejected', 'seller').valid).toBe(false);

    const result = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'rejected',
      actor: 'seller',
      actorId: 'seller-dragon',
      reason: 'Too late',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    const transactCalls = mockDynamoSend.mock.calls.filter(
      (c: any[]) => c[0]?._type === 'TransactWriteItems',
    );
    expect(transactCalls.length).toBe(0);
    expect(mockEBSend).not.toHaveBeenCalled();
  });
});


// ---------------------------------------------------------------------------
// 19.4 Payment Expiry Flow Integration Test
// Validates: Requirements 8.7
// ---------------------------------------------------------------------------

describe('19.4 Integration: Payment Expiry Flow (payment_pending → expired → stock unreserved)', () => {
  let orderService: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    orderService = new OrderService('test-table');
  });

  it('payment link expires → order expired, stock unreserved', async () => {
    const orderRecord = buildOrderRecord({
      status: 'payment_pending',
      paymentLinkId: 'plink_test_expire',
      paymentLinkUrl: 'https://rzp.io/test',
    });

    setupTransitionMock(orderRecord);

    expect(validateTransition('payment_pending', 'expired', 'webhook').valid).toBe(true);
    expect(requiresStockUnreservation('expired')).toBe(true);

    const result = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'expired',
      actor: 'webhook',
      actorId: 'razorpay:plink_test_expire',
      reason: 'Payment link expired',
    });

    expect(result.success).toBe(true);
    expect(result.order!.status).toBe('expired');

    // Verify TransactWriteItems includes stock unreservation
    const transactCalls = mockDynamoSend.mock.calls.filter(
      (c: any[]) => c[0]?._type === 'TransactWriteItems',
    );
    expect(transactCalls.length).toBe(1);

    const transactItems = transactCalls[0][0].TransactItems;
    const productUpdates = transactItems.filter((item: any) => {
      if (!item.Update) return false;
      const key = unmarshall(item.Update.Key);
      return typeof key.PK === 'string' && key.PK.startsWith('PRODUCT#');
    });
    expect(productUpdates.length).toBe(1);
    expect(productUpdates[0].Update.UpdateExpression).toContain('reserved_stock = reserved_stock - :qty');

    // Verify order.expired event published
    expect(mockEBSend).toHaveBeenCalled();
    const ebCall = mockEBSend.mock.calls[0][0];
    expect(ebCall.Entries[0].DetailType).toBe('order.expired');
  });

  it('expiry of non-payment_pending order is rejected', async () => {
    setupTransitionMock(buildOrderRecord({ status: 'paid' }));

    expect(validateTransition('paid', 'expired', 'webhook').valid).toBe(false);

    const result = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'expired',
      actor: 'webhook',
      actorId: 'razorpay:plink_test',
      reason: 'Payment link expired',
    });

    expect(result.success).toBe(false);
    expect(mockEBSend).not.toHaveBeenCalled();
  });

  it('payment_failed transition keeps stock reserved (no unreservation)', async () => {
    setupTransitionMock(buildOrderRecord({ status: 'payment_pending' }));

    expect(requiresStockUnreservation('payment_failed')).toBe(false);
    expect(requiresStockFinalization('payment_failed')).toBe(false);

    const result = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'payment_failed',
      actor: 'webhook',
      actorId: 'razorpay:pay_failed123',
      reason: 'Payment failed - insufficient funds',
    });

    expect(result.success).toBe(true);
    expect(result.order!.status).toBe('payment_failed');

    // Verify NO product stock updates in the transaction
    const transactCalls = mockDynamoSend.mock.calls.filter(
      (c: any[]) => c[0]?._type === 'TransactWriteItems',
    );
    expect(transactCalls.length).toBe(1);

    const transactItems = transactCalls[0][0].TransactItems;
    const productUpdates = transactItems.filter((item: any) => {
      if (!item.Update) return false;
      const key = unmarshall(item.Update.Key);
      return typeof key.PK === 'string' && key.PK.startsWith('PRODUCT#');
    });
    expect(productUpdates.length).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// 19.5 Concurrent Acceptance Integration Test
// Validates: Requirements 1.7
// ---------------------------------------------------------------------------

describe('19.5 Integration: Concurrent Acceptance (two sellers → one succeeds, one gets 409)', () => {
  let orderService: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    orderService = new OrderService('test-table');
  });

  it('first acceptance succeeds, second gets TransactionCanceledException (concurrent modification)', async () => {
    let transactCallCount = 0;

    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'GetItem') {
        const key = cmd.Key;
        if (!key) return Promise.resolve({});
        const pk = unmarshall(key)?.PK;
        if (typeof pk === 'string' && pk.startsWith('ORDER#')) {
          return Promise.resolve(marshalledItem(buildOrderRecord({ status: 'pending_seller_confirmation' })));
        }
        return Promise.resolve({});
      }
      if (cmd._type === 'TransactWriteItems') {
        transactCallCount++;
        if (transactCallCount === 1) return Promise.resolve({});
        // Second call fails — conditional check failed (status already changed)
        const error = new Error('Transaction cancelled, precondition not satisfied');
        error.name = 'TransactionCanceledException';
        return Promise.reject(error);
      }
      if (cmd._type === 'Query') {
        return Promise.resolve(marshalledQueryItems([{
          PK: 'SELLER#seller-dragon',
          SK: 'ORDER#2026-01-15T10:00:00.000Z#order-uuid-1',
          orderUUID: 'order-uuid-1',
          status: 'pending_seller_confirmation',
        }]));
      }
      return Promise.resolve({});
    });

    // First seller accepts — should succeed
    const result1 = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'confirmed',
      actor: 'seller',
      actorId: 'seller-dragon',
    });

    expect(result1.success).toBe(true);
    expect(result1.order!.status).toBe('confirmed');

    // Second seller tries to accept — should fail with concurrent modification
    const result2 = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'confirmed',
      actor: 'seller',
      actorId: 'seller-dragon-2',
    });

    expect(result2.success).toBe(false);
    expect(result2.error).toContain('concurrently');
  });

  it('conditional update prevents double-acceptance even with same seller', async () => {
    let transactCallCount = 0;

    mockDynamoSend.mockImplementation((cmd: any) => {
      if (cmd._type === 'GetItem') {
        const key = cmd.Key;
        if (!key) return Promise.resolve({});
        const pk = unmarshall(key)?.PK;
        if (typeof pk === 'string' && pk.startsWith('ORDER#')) {
          return Promise.resolve(marshalledItem(buildOrderRecord({ status: 'pending_seller_confirmation' })));
        }
        return Promise.resolve({});
      }
      if (cmd._type === 'TransactWriteItems') {
        transactCallCount++;
        if (transactCallCount === 1) return Promise.resolve({});
        const error = new Error('Transaction cancelled');
        error.name = 'TransactionCanceledException';
        return Promise.reject(error);
      }
      if (cmd._type === 'Query') {
        return Promise.resolve(marshalledQueryItems([{
          PK: 'SELLER#seller-dragon',
          SK: 'ORDER#2026-01-15T10:00:00.000Z#order-uuid-1',
          orderUUID: 'order-uuid-1',
          status: 'pending_seller_confirmation',
        }]));
      }
      return Promise.resolve({});
    });

    const r1 = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'confirmed',
      actor: 'seller',
      actorId: 'seller-dragon',
    });
    expect(r1.success).toBe(true);

    // Same seller tries again (double-click)
    const r2 = await orderService.transitionOrder({
      orderId: 'order-uuid-1',
      targetStatus: 'confirmed',
      actor: 'seller',
      actorId: 'seller-dragon',
    });
    expect(r2.success).toBe(false);
    expect(r2.error).toContain('concurrently');
    expect(transactCallCount).toBe(2);
  });

  it('state machine rejects invalid actor for acceptance', () => {
    // Customer cannot accept an order
    const r1 = validateTransition('pending_seller_confirmation', 'confirmed', 'customer');
    expect(r1.valid).toBe(false);
    expect(r1.error).toContain('not allowed');

    // Webhook cannot accept an order
    const r2 = validateTransition('pending_seller_confirmation', 'confirmed', 'webhook');
    expect(r2.valid).toBe(false);

    // Only seller can accept
    const r3 = validateTransition('pending_seller_confirmation', 'confirmed', 'seller');
    expect(r3.valid).toBe(true);
  });
});
