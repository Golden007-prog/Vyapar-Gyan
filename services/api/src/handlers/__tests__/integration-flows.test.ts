/**
 * Integration Tests — Critical Handler Flows
 *
 * Tests full Lambda handler functions with mock API Gateway events.
 * Covers: OTP send/verify, cart add/update/checkout with version conflicts,
 * approval create/approve/execute, chat sync polling with 304 optimization.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

const mockPutOTP = jest.fn();
const mockGetOTP = jest.fn();
const mockUpdateOTPFailure = jest.fn();
const mockGetUserByPhone = jest.fn();
const mockUpdateUserProfile = jest.fn();
const mockGetCart = jest.fn();
const mockPutCart = jest.fn();
const mockDeleteCart = jest.fn();
const mockQueryMessages = jest.fn();
const mockGetApproval = jest.fn();
const mockPutApproval = jest.fn();
const mockUpdateApprovalStatus = jest.fn();
const mockQueryApprovalsBySeller = jest.fn();
const mockPutAuditLog = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  putOTP: (...args: unknown[]) => mockPutOTP(...args),
  getOTP: (...args: unknown[]) => mockGetOTP(...args),
  updateOTPFailure: (...args: unknown[]) => mockUpdateOTPFailure(...args),
  getUserByPhone: (...args: unknown[]) => mockGetUserByPhone(...args),
  updateUserProfile: (...args: unknown[]) => mockUpdateUserProfile(...args),
  getCart: (...args: unknown[]) => mockGetCart(...args),
  putCart: (...args: unknown[]) => mockPutCart(...args),
  deleteCart: (...args: unknown[]) => mockDeleteCart(...args),
  queryMessages: (...args: unknown[]) => mockQueryMessages(...args),
  getApproval: (...args: unknown[]) => mockGetApproval(...args),
  putApproval: (...args: unknown[]) => mockPutApproval(...args),
  updateApprovalStatus: (...args: unknown[]) => mockUpdateApprovalStatus(...args),
  queryApprovalsBySeller: (...args: unknown[]) => mockQueryApprovalsBySeller(...args),
  putAuditLog: (...args: unknown[]) => mockPutAuditLog(...args),
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

// Mock Twilio adapter
const mockSendSMS = jest.fn().mockResolvedValue({ sid: 'SM_test' });
jest.mock('../../adapters/twilio-adapter', () => ({
  twilioAdapter: {
    sendSMS: (...args: unknown[]) => mockSendSMS(...args),
    sendWhatsAppMessage: jest.fn().mockResolvedValue({ sid: 'WA_test' }),
  },
}));

// Mock EventBridge
const mockEBSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockEBSend })),
  PutEventsCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

// Mock CatalogRepository
const mockGetProductById = jest.fn();
jest.mock('../../repositories/catalog-repository', () => ({
  CatalogRepository: jest.fn().mockImplementation(() => ({
    getProductById: (...args: unknown[]) => mockGetProductById(...args),
  })),
}));

// ---------------------------------------------------------------------------
// Helper: build mock API Gateway event
// ---------------------------------------------------------------------------

function buildApiEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/',
    rawQueryString: '',
    headers: {},
    queryStringParameters: undefined,
    pathParameters: undefined,
    body: undefined,
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789',
      apiId: 'test-api',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: { method: 'POST', path: '/', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'test-request-id',
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    stageVariables: undefined,
    ...overrides,
  } as APIGatewayProxyEventV2;
}

function buildAuthenticatedEvent(
  userId: string,
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return buildApiEvent({
    ...overrides,
    requestContext: {
      ...buildApiEvent().requestContext,
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] } },
      ...(overrides.requestContext as any),
    } as any,
  });
}


// ---------------------------------------------------------------------------
// Import handlers (after mocks are set up)
// ---------------------------------------------------------------------------

import { handler as otpSendHandler } from '../auth/otp-send-handler';
import { handler as otpVerifyHandler } from '../auth/otp-verify-handler';
import { handler as cartAddHandler } from '../cart/cart-add-handler';
import { handler as cartUpdateHandler } from '../cart/cart-update-handler';
import { handler as cartCheckoutHandler } from '../cart/cart-checkout-handler';
import { handler as approvalApproveHandler } from '../seller/approval-approve-handler';
import { handler as chatSyncHandler } from '../chat/chat-sync-handler';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: OTP Send → Verify Flow', () => {
  beforeEach(() => jest.clearAllMocks());

  it('send OTP → verify correct OTP → success', async () => {
    // Step 1: Send OTP
    mockGetOTP.mockResolvedValue(null); // no existing OTP (no cooldown/lockout)
    mockPutOTP.mockResolvedValue(undefined);

    const sendEvent = buildApiEvent({
      body: JSON.stringify({ phoneNumber: '9876543210' }),
    });

    const sendResult = await otpSendHandler(sendEvent);
    expect(sendResult.statusCode).toBe(200);
    const sendBody = JSON.parse(sendResult.body as string);
    expect(sendBody.success).toBe(true);
    expect(sendBody.cooldownSeconds).toBe(60);
    expect(mockSendSMS).toHaveBeenCalledWith(
      '+919876543210',
      expect.stringContaining('verification code'),
    );

    // Capture the OTP that was stored
    const storedRecord = mockPutOTP.mock.calls[0][0];
    expect(storedRecord.otpHash).toHaveLength(64); // SHA-256 hex

    // Step 2: Verify with correct OTP — we need to set up the mock to return
    // the stored record so verifyOTP can hash-compare
    mockGetOTP.mockResolvedValue({
      phoneNumber: '9876543210',
      otpHash: storedRecord.otpHash,
      failureCount: 0,
      createdAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    mockGetUserByPhone.mockResolvedValue({ userId: 'user-123' });
    mockUpdateUserProfile.mockResolvedValue(undefined);

    // We need the actual OTP value — extract from the SMS call
    const smsMessage = mockSendSMS.mock.calls[0][1] as string;
    const otpMatch = smsMessage.match(/(\d{6})/);
    expect(otpMatch).not.toBeNull();
    const actualOTP = otpMatch![1];

    // Re-compute hash for the mock (since verifyOTP hashes the input)
    const { createHash } = require('crypto');
    const expectedHash = createHash('sha256').update(actualOTP).digest('hex');
    mockGetOTP.mockResolvedValue({
      phoneNumber: '9876543210',
      otpHash: expectedHash,
      failureCount: 0,
      createdAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });

    const verifyEvent = buildApiEvent({
      body: JSON.stringify({ phoneNumber: '9876543210', otp: actualOTP }),
    });

    const verifyResult = await otpVerifyHandler(verifyEvent);
    expect(verifyResult.statusCode).toBe(200);
    const verifyBody = JSON.parse(verifyResult.body as string);
    expect(verifyBody.success).toBe(true);
    expect(verifyBody.verified).toBe(true);
    expect(verifyBody.userId).toBe('user-123');
    expect(mockUpdateUserProfile).toHaveBeenCalledWith('user-123', {
      phoneVerificationStatus: 'verified',
    });
  });

  it('send OTP → verify wrong OTP → failure with attempts remaining', async () => {
    // Send OTP first
    mockGetOTP.mockResolvedValue(null);
    mockPutOTP.mockResolvedValue(undefined);

    const sendEvent = buildApiEvent({
      body: JSON.stringify({ phoneNumber: '9876543210' }),
    });
    await otpSendHandler(sendEvent);

    // Verify with wrong OTP
    mockGetOTP.mockResolvedValue({
      phoneNumber: '9876543210',
      otpHash: 'correct-hash-that-wont-match',
      failureCount: 0,
      createdAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    mockUpdateOTPFailure.mockResolvedValue(undefined);

    const verifyEvent = buildApiEvent({
      body: JSON.stringify({ phoneNumber: '9876543210', otp: '000000' }),
    });

    const verifyResult = await otpVerifyHandler(verifyEvent);
    expect(verifyResult.statusCode).toBe(400);
    const verifyBody = JSON.parse(verifyResult.body as string);
    expect(verifyBody.error).toContain('Invalid OTP');
    expect(verifyBody.attemptsRemaining).toBe(2);
  });

  it('send OTP blocked by lockout returns 429', async () => {
    // Simulate lockout — getOTP returns a record with lockoutUntil in the future
    mockGetOTP.mockResolvedValue({
      phoneNumber: '9876543210',
      otpHash: 'h',
      failureCount: 3,
      lockoutUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });

    const sendEvent = buildApiEvent({
      body: JSON.stringify({ phoneNumber: '9876543210' }),
    });

    const result = await otpSendHandler(sendEvent);
    expect(result.statusCode).toBe(429);
    const body = JSON.parse(result.body as string);
    expect(body.error).toContain('Too many failed attempts');
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(mockSendSMS).not.toHaveBeenCalled();
  });
});


describe('Integration: Cart Add → Update → Checkout with Version Conflicts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('add item → update quantity → checkout success', async () => {
    const userId = 'customer-1';

    // Step 1: Add item — no existing cart
    mockGetCart.mockResolvedValueOnce(null); // cart-service.addItem reads cart
    mockPutCart.mockResolvedValue(undefined);
    mockGetProductById.mockResolvedValue({
      id: 'prod-1',
      sellerId: 'seller-1',
      name: 'Silk Saree',
      price: 1500,
      stockQuantity: 10,
      imageUrls: ['https://img.example.com/saree.jpg'],
      isActive: true,
    });

    const addEvent = buildAuthenticatedEvent(userId, {
      body: JSON.stringify({ productId: 'prod-1', quantity: 1 }),
    });

    const addResult = await cartAddHandler(addEvent);
    expect(addResult.statusCode).toBe(200);
    const addBody = JSON.parse(addResult.body as string);
    expect(addBody.cart.itemCount).toBe(1);
    expect(addBody.cart.subtotal).toBe(1500);
    expect(addBody.addedItem.name).toBe('Silk Saree');

    // Step 2: Update quantity — existing cart with version 1
    mockGetCart.mockResolvedValueOnce({
      userId,
      items: [{ productId: 'prod-1', sellerId: 'seller-1', name: 'Silk Saree', price: 1500, quantity: 1 }],
      subtotal: 1500,
      itemCount: 1,
      cartVersion: 1,
      updatedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 604800,
    });

    const updateEvent = buildAuthenticatedEvent(userId, {
      pathParameters: { productId: 'prod-1' },
      body: JSON.stringify({ quantity: 3 }),
    });

    const updateResult = await cartUpdateHandler(updateEvent);
    expect(updateResult.statusCode).toBe(200);
    const updateBody = JSON.parse(updateResult.body as string);
    expect(updateBody.cart.items[0].quantity).toBe(3);
    expect(updateBody.cart.subtotal).toBe(4500);

    // Step 3: Checkout — cart is valid
    mockGetCart.mockResolvedValueOnce({
      userId,
      items: [{ productId: 'prod-1', sellerId: 'seller-1', name: 'Silk Saree', price: 1500, quantity: 3 }],
      subtotal: 4500,
      itemCount: 3,
      cartVersion: 2,
      updatedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 604800,
    });
    mockDeleteCart.mockResolvedValue(undefined);

    const checkoutEvent = buildAuthenticatedEvent(userId);

    const checkoutResult = await cartCheckoutHandler(checkoutEvent);
    expect(checkoutResult.statusCode).toBe(200);
    const checkoutBody = JSON.parse(checkoutResult.body as string);
    expect(checkoutBody.orderId).toBeDefined();
    expect(checkoutBody.message).toBe('Checkout initiated');
    // EventBridge event published
    expect(mockEBSend).toHaveBeenCalled();
    // Cart cleared
    expect(mockDeleteCart).toHaveBeenCalledWith(userId);
  });

  it('concurrent add with stale version → 409 Conflict', async () => {
    const userId = 'customer-2';

    mockGetProductById.mockResolvedValue({
      id: 'prod-2',
      sellerId: 'seller-1',
      name: 'Cotton Kurta',
      price: 800,
      stockQuantity: 5,
      imageUrls: [],
      isActive: true,
    });

    // Simulate ConditionalCheckFailedException from DynamoDB (version conflict)
    mockGetCart.mockResolvedValueOnce({
      userId,
      items: [],
      subtotal: 0,
      itemCount: 0,
      cartVersion: 3,
      updatedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 604800,
    });
    const condError = new Error('The conditional request failed');
    (condError as any).name = 'ConditionalCheckFailedException';
    mockPutCart.mockRejectedValueOnce(condError);

    // For the recovery read in the catch block
    mockGetCart.mockResolvedValueOnce({
      userId,
      items: [{ productId: 'prod-x', sellerId: 'seller-1', name: 'Other', price: 500, quantity: 1 }],
      subtotal: 500,
      itemCount: 1,
      cartVersion: 4,
      updatedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 604800,
    });

    const addEvent = buildAuthenticatedEvent(userId, {
      body: JSON.stringify({ productId: 'prod-2', quantity: 1 }),
    });

    const result = await cartAddHandler(addEvent);
    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe('Cart was modified');
    expect(body.currentVersion).toBe(4);
  });

  it('checkout with empty cart → failure', async () => {
    const userId = 'customer-3';

    // validateCheckout returns invalid for empty cart
    mockGetCart.mockResolvedValueOnce(null);

    const checkoutEvent = buildAuthenticatedEvent(userId);

    const result = await cartCheckoutHandler(checkoutEvent);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error).toBe('Checkout validation failed');
    expect(body.issues).toContain('Cart is empty');
    expect(mockEBSend).not.toHaveBeenCalled();
  });
});


describe('Integration: Approval Approve → EventBridge Event Published', () => {
  beforeEach(() => jest.clearAllMocks());

  it('approve approval → verify EventBridge event published', async () => {
    const sellerId = 'seller-1';
    const approvalId = 'approval-abc';

    // getApproval returns a pending_review record owned by this seller
    mockGetApproval.mockResolvedValue({
      approvalId,
      sellerId,
      type: 'discount',
      status: 'pending_review',
      payload: { discountPercent: 20, productIds: ['prod-1'] },
      aiRationale: 'Dead stock detected — 120 days old',
      estimatedImpact: 5000,
      affectedProductIds: ['prod-1'],
      priorityScore: 72.5,
      createdAt: '2026-01-10T10:00:00.000Z',
      updatedAt: '2026-01-10T10:00:00.000Z',
    });
    mockUpdateApprovalStatus.mockResolvedValue(undefined);
    mockPutAuditLog.mockResolvedValue(undefined);

    const event = buildAuthenticatedEvent(sellerId, {
      pathParameters: { id: approvalId },
    });

    const result = await approvalApproveHandler(event);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.success).toBe(true);
    expect(body.status).toBe('approved');
    expect(body.executionTriggered).toBe(true);

    // Verify approval status was updated
    expect(mockUpdateApprovalStatus).toHaveBeenCalledWith(
      approvalId,
      sellerId,
      expect.objectContaining({ status: 'approved', approvedBy: sellerId }),
    );

    // Verify EventBridge event was published (ApprovalApproved)
    expect(mockEBSend).toHaveBeenCalled();

    // Verify audit log was written
    expect(mockPutAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: sellerId,
        actionType: 'approval_approved',
        resourceType: 'approval',
        resourceId: approvalId,
      }),
    );
  });

  it('approve non-existent approval → 404', async () => {
    const sellerId = 'seller-1';

    mockGetApproval.mockResolvedValue(null); // not found

    const event = buildAuthenticatedEvent(sellerId, {
      pathParameters: { id: 'nonexistent-id' },
    });

    const result = await approvalApproveHandler(event);
    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body as string);
    expect(body.error).toContain('not found');
  });

  it('approve approval owned by different seller → 403', async () => {
    const sellerId = 'seller-1';

    mockGetApproval.mockResolvedValue({
      approvalId: 'approval-xyz',
      sellerId: 'seller-other', // different seller
      type: 'campaign',
      status: 'pending_review',
      payload: {},
      aiRationale: 'Test',
      estimatedImpact: 1000,
      affectedProductIds: [],
      priorityScore: 50,
      createdAt: '2026-01-10T10:00:00.000Z',
      updatedAt: '2026-01-10T10:00:00.000Z',
    });

    const event = buildAuthenticatedEvent(sellerId, {
      pathParameters: { id: 'approval-xyz' },
    });

    const result = await approvalApproveHandler(event);
    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body as string);
    expect(body.error).toContain('Not authorized');
  });
});


describe('Integration: Chat Sync Polling with 304 Optimization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('first poll → returns messages + ETag', async () => {
    const userId = 'customer-1';

    mockQueryMessages.mockResolvedValue({
      messages: [
        {
          userId,
          messageId: 'msg-1',
          direction: 'inbound',
          channel: 'web',
          senderRole: 'customer',
          messageType: 'text',
          content: { body: 'Hello!' },
          deliveryStatus: 'delivered',
          createdAt: '2026-01-15T10:30:00.000Z',
        },
      ],
    });
    mockGetCart.mockResolvedValue({
      userId,
      items: [{ productId: 'p1', sellerId: 's1', name: 'Item', price: 100, quantity: 1 }],
      subtotal: 100,
      itemCount: 1,
      cartVersion: 5,
      updatedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 604800,
    });

    const event = buildAuthenticatedEvent(userId, {
      queryStringParameters: {
        lastSyncTimestamp: '2026-01-15T10:00:00.000Z',
        cartVersion: '0', // client has no cart yet
      },
    });

    const result = await chatSyncHandler(event);
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['ETag']).toBe('"5"');
    expect(result.headers?.['Cache-Control']).toBe('no-cache');

    const body = JSON.parse(result.body as string);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].messageId).toBe('msg-1');
    expect(body.cartState).not.toBeNull();
    expect(body.cartState.cartVersion).toBe(5);
    expect(body.cartVersion).toBe(5);
    expect(body.lastSyncTimestamp).toBeDefined();
  });

  it('second poll with same cartVersion and no new messages → 304 Not Modified', async () => {
    const userId = 'customer-1';

    // No new messages since last sync
    mockQueryMessages.mockResolvedValue({ messages: [] });
    // Cart version unchanged
    mockGetCart.mockResolvedValue({
      userId,
      items: [{ productId: 'p1', sellerId: 's1', name: 'Item', price: 100, quantity: 1 }],
      subtotal: 100,
      itemCount: 1,
      cartVersion: 5,
      updatedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 604800,
    });

    const event = buildAuthenticatedEvent(userId, {
      queryStringParameters: {
        lastSyncTimestamp: '2026-01-15T10:30:00.000Z',
        cartVersion: '5', // matches server version
      },
    });

    const result = await chatSyncHandler(event);
    expect(result.statusCode).toBe(304);
    expect(result.headers?.['ETag']).toBe('"5"');
    expect(result.body).toBe('');
  });

  it('new message arrives → returns updated data with new ETag', async () => {
    const userId = 'customer-1';

    // New message arrived
    mockQueryMessages.mockResolvedValue({
      messages: [
        {
          userId,
          messageId: 'msg-2',
          direction: 'outbound',
          channel: 'whatsapp',
          senderRole: 'seller',
          messageType: 'text',
          content: { body: 'Your order is ready!' },
          deliveryStatus: 'sent',
          createdAt: '2026-01-15T10:35:00.000Z',
        },
      ],
    });
    // Cart also updated (new item added)
    mockGetCart.mockResolvedValue({
      userId,
      items: [
        { productId: 'p1', sellerId: 's1', name: 'Item', price: 100, quantity: 1 },
        { productId: 'p2', sellerId: 's1', name: 'Item 2', price: 200, quantity: 1 },
      ],
      subtotal: 300,
      itemCount: 2,
      cartVersion: 6,
      updatedAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + 604800,
    });

    const event = buildAuthenticatedEvent(userId, {
      queryStringParameters: {
        lastSyncTimestamp: '2026-01-15T10:30:00.000Z',
        cartVersion: '5', // stale version
      },
    });

    const result = await chatSyncHandler(event);
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['ETag']).toBe('"6"');

    const body = JSON.parse(result.body as string);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].messageId).toBe('msg-2');
    expect(body.cartState).not.toBeNull();
    expect(body.cartState.cartVersion).toBe(6);
    expect(body.cartState.items).toHaveLength(2);
  });
});
