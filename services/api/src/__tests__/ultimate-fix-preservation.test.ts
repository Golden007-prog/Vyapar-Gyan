/**
 * Preservation Property Tests — Ultimate Fix Deploy
 *
 * These tests capture EXISTING baseline behavior that must be preserved
 * after the 7 bug fixes are applied. They MUST PASS on unfixed code.
 *
 * Observation-first methodology: behavior was observed on unfixed code,
 * then property-based tests were written to encode those observations.
 *
 * Uses Jest + fast-check for property-based testing.
 */

import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mocks — declared before imports
// ---------------------------------------------------------------------------

const mockPutMessage = jest.fn().mockResolvedValue(undefined);
const mockGetUserByPhone = jest.fn();
const mockUpdateSessionState = jest.fn().mockResolvedValue(undefined);
const mockUpdateSessionIntent = jest.fn().mockResolvedValue(undefined);

jest.mock('../adapters/dynamodb-adapter', () => ({
  putMessage: (...a: unknown[]) => mockPutMessage(...a),
  getUserByPhone: (...a: unknown[]) => mockGetUserByPhone(...a),
  updateSessionState: (...a: unknown[]) => mockUpdateSessionState(...a),
  updateSessionIntent: (...a: unknown[]) => mockUpdateSessionIntent(...a),
}));

const mockSendMessage = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/whatsapp-sender', () => ({
  whatsappSender: { sendMessage: (...a: unknown[]) => mockSendMessage(...a) },
}));

// Mock greeting handler
const mockGreetingHandler = jest.fn().mockResolvedValue(undefined);
jest.mock('../handlers/whatsapp/states/greeting-handler', () => ({
  greetingHandler: (...a: unknown[]) => mockGreetingHandler(...a),
}));

// Mock browsing handler
const mockBrowsingHandler = jest.fn().mockResolvedValue(undefined);
jest.mock('../handlers/whatsapp/states/browsing-handler', () => ({
  browsingHandler: (...a: unknown[]) => mockBrowsingHandler(...a),
}));

// Mock checkout handler
const mockCheckoutHandler = jest.fn().mockResolvedValue(undefined);
jest.mock('../handlers/whatsapp/states/checkout-handler', () => ({
  checkoutHandler: (...a: unknown[]) => mockCheckoutHandler(...a),
}));

// Mock tracking handler
const mockTrackingHandler = jest.fn().mockResolvedValue(undefined);
jest.mock('../handlers/whatsapp/states/tracking-handler', () => ({
  trackingHandler: (...a: unknown[]) => mockTrackingHandler(...a),
}));

// Mock seller order handler
const mockSellerOrderHandler = jest.fn().mockResolvedValue(undefined);
jest.mock('../handlers/whatsapp/states/seller-order-handler', () => ({
  sellerOrderHandler: (...a: unknown[]) => mockSellerOrderHandler(...a),
}));

// Mock onboarding handler
const mockOnboardingHandler = jest.fn().mockResolvedValue(undefined);
jest.mock('../handlers/whatsapp/states/onboarding-handler', () => ({
  onboardingHandler: (...a: unknown[]) => mockOnboardingHandler(...a),
}));

// Mock session service
const mockResolveOrCreateSession = jest.fn();
const mockResolveOrCreateOnboardingSession = jest.fn().mockResolvedValue({
  session: { welcomeSent: false },
});
const mockMarkOnboardingWelcomeSent = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/session-service', () => ({
  resolveOrCreateSession: (...a: unknown[]) => mockResolveOrCreateSession(...a),
  resolveOrCreateOnboardingSession: (...a: unknown[]) => mockResolveOrCreateOnboardingSession(...a),
  markOnboardingWelcomeSent: (...a: unknown[]) => mockMarkOnboardingWelcomeSent(...a),
  shouldBypassAI: jest.fn().mockReturnValue(false),
  updateState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../repositories/favorites', () => ({
  listFavorites: jest.fn().mockResolvedValue([]),
}));

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    eventBusName: 'test-bus',
    tableName: 'test-table',
    twilioAccountSid: 'AC123',
    twilioAuthToken: 'token',
  }),
  getVoicePipelineConfig: jest.fn().mockResolvedValue({}),
}));

// Mock EventBridge
const mockEBSend = jest.fn().mockResolvedValue({});
const mockPutEventsCommand = jest.fn();
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    send: (...a: unknown[]) => mockEBSend(...a),
  })),
  PutEventsCommand: jest.fn().mockImplementation((params: any) => {
    mockPutEventsCommand(params);
    return params;
  }),
}));

// Mock DynamoDB client for customer-discovery
const mockDocClientSend = jest.fn().mockResolvedValue({ Items: [] });
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: (...a: unknown[]) => mockDocClientSend(...a) }),
  },
  QueryCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'QueryCommand' })),
  ScanCommand: jest.fn().mockImplementation((params: any) => ({ ...params, _type: 'ScanCommand' })),
}));

jest.mock('@opensearch-project/opensearch', () => ({
  Client: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue({ body: { hits: { hits: [] } } }),
  })),
}));

// Mock seller copilot
const mockHandleSellerCopilotMessage = jest.fn().mockResolvedValue('Seller menu response');
jest.mock('../handlers/whatsapp/seller-copilot', () => ({
  handleSellerCopilotMessage: (...a: unknown[]) => mockHandleSellerCopilotMessage(...a),
}));

// Mock consent service
jest.mock('../services/consent-service', () => ({
  recordInboundMessage: jest.fn().mockResolvedValue(undefined),
  handleOptOut: jest.fn().mockResolvedValue(false),
  checkSendPermission: jest.fn().mockResolvedValue({ allowed: true }),
}));

// Mock customer repository
jest.mock('../repositories/customer-repository', () => ({
  CustomerRepository: jest.fn().mockImplementation(() => ({
    resolveOrCreate: jest.fn().mockResolvedValue({ id: 'customer-1', phoneNumber: '+919999999999' }),
  })),
}));

// Mock idempotency
jest.mock('../utils/idempotency', () => ({
  idempotencyService: {
    acquireLock: jest.fn().mockResolvedValue(true),
  },
}));

// Mock intent extraction
jest.mock('../services/intent-extraction', () => ({
  extractAndRouteIntent: jest.fn().mockRejectedValue(new Error('Not configured')),
}));

// Mock SQS and S3
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  SendMessageCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://presigned-url'),
}));

// Mock metrics
jest.mock('../core/metrics', () => ({
  publishCountMetric: jest.fn().mockResolvedValue(undefined),
  publishLatencyMetric: jest.fn().mockResolvedValue(undefined),
}));

// Mock financial query
jest.mock('../services/financial-query', () => ({
  executeFinancialQuery: jest.fn(),
  isLikelyFinancialQuery: jest.fn().mockReturnValue(false),
  LANGUAGE_NAMES: {},
}));

// Mock Gemini adapter
jest.mock('../adapters/gemini-adapter', () => ({
  GeminiAdapter: jest.fn().mockImplementation(() => ({
    transcribeAudio: jest.fn().mockResolvedValue('transcribed text'),
  })),
}));

// Mock whatsapp sanitizer
jest.mock('../utils/whatsapp-sanitizer', () => ({
  sanitizeForTTS: jest.fn().mockImplementation((text: string) => text),
}));

// Mock inventory upload
jest.mock('../handlers/whatsapp/inventory-upload', () => ({
  detectMediaType: jest.fn().mockReturnValue('unknown'),
  handleInventoryUpload: jest.fn().mockResolvedValue([]),
  commitInventory: jest.fn().mockResolvedValue(undefined),
  applyInventoryEdit: jest.fn().mockReturnValue({ items: [] }),
  parseInventoryEditCommand: jest.fn().mockReturnValue(null),
  formatInventoryList: jest.fn().mockReturnValue(''),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { routeMessage, type MessageContext } from '../handlers/whatsapp/states/router';
import { classifyLocationInput } from '../handlers/whatsapp/customer-discovery';
import { handler as workerHandler } from '../handlers/whatsapp/worker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRouterContext(text: string, state: string): MessageContext {
  return {
    message: { type: 'text', text: { body: text }, id: 'msg-1' },
    customer: { id: 'cust-1', phoneNumber: '+919999999999', profileName: 'Test' },
    session: { id: 'session-1', state, customerId: 'cust-1', phoneNumber: '+919999999999' },
    requestId: 'req-1',
  };
}

// ---------------------------------------------------------------------------
// Arbitraries (generators)
// ---------------------------------------------------------------------------

/** Direct intent phrases that match DIRECT_INTENT_PATTERNS in router.ts */
const STOCK_WORDS = ['stock', 'available', 'availability', 'do you have', 'is there', 'check stock', 'in stock'];
const PRICE_WORDS = ['price', 'cost', 'how much', 'kitna', 'kya rate', 'rate'];
const SEARCH_WORDS = ['search', 'find', 'show me', 'looking for', 'i want', 'i need'];
const CART_WORDS = ['cart', 'my cart', 'view cart', 'show cart'];
const CHECKOUT_WORDS = ['checkout', 'pay', 'order now', 'place order'];
const MENU_WORDS = ['categories', 'menu', 'browse', 'list'];
const HELP_WORDS = ['help', 'support', 'assist'];

const ALL_INTENT_WORDS = [
  ...STOCK_WORDS, ...PRICE_WORDS, ...SEARCH_WORDS,
  ...CART_WORDS, ...CHECKOUT_WORDS, ...MENU_WORDS, ...HELP_WORDS,
];

/** Generate a direct intent string by combining an intent keyword with optional product name */
const arbDirectIntent = fc.oneof(
  // "check stock of <product>"
  fc.constantFrom(...STOCK_WORDS).map(w => `${w} of Amul Butter`),
  // "price of <product>"
  fc.constantFrom(...PRICE_WORDS).map(w => `${w} of Tata Salt`),
  // "search <product>"
  fc.constantFrom(...SEARCH_WORDS).map(w => `${w} milk`),
  // standalone intent words
  fc.constantFrom(...ALL_INTENT_WORDS),
);

/** Generate a 6-digit pincode string */
const arbPincode = fc.stringOf(
  fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
  { minLength: 6, maxLength: 6 },
);

/** Generate a non-6-digit string (city name) */
const arbCityName = fc.oneof(
  fc.constantFrom('Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Kolkata', 'Pune', 'Jaipur'),
  fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e'), { minLength: 1, maxLength: 5 }),
  // 5-digit string (not 6)
  fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 5, maxLength: 5 }),
  // 7-digit string (not 6)
  fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 7, maxLength: 7 }),
);

/** Single or double digit numeric strings */
const arbNumericReply = fc.integer({ min: 1, max: 99 }).map(n => String(n));

/** Non-greeting, non-menu text messages */
const arbNonGreetingText = fc.constantFrom(
  'check stock of Amul Butter',
  'price of Tata Salt',
  'show me milk products',
  'I want paneer',
  'where is my order',
  'track order',
  'what categories do you have',
  'help me',
  'add to cart',
);

/** Session states that route to browsingHandler */
const arbBrowsingStates = fc.constantFrom('browsing', 'product_inquiry', 'idle');

/** Session states that route to checkoutHandler */
const arbCheckoutStates = fc.constantFrom('checkout', 'ordering', 'payment');

// =========================================================================
// Test 2.1 — Direct intent bypasses greeting
// =========================================================================

describe('2.1 Direct intent bypasses greeting', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * **Validates: Requirements 3.2**
   *
   * Observed: routeMessage with text "check stock of Amul Butter" in greeting
   * state routes to browsingHandler (not greetingHandler).
   *
   * Property: for all direct-intent strings matching stock/price/search patterns,
   * routing in greeting state always goes to browsing handler.
   */
  it('direct intent messages in greeting state always route to browsingHandler', async () => {
    await fc.assert(
      fc.asyncProperty(arbDirectIntent, async (intentText) => {
        mockGreetingHandler.mockClear();
        mockBrowsingHandler.mockClear();
        mockCheckoutHandler.mockClear();

        const ctx = makeRouterContext(intentText, 'greeting');
        await routeMessage(ctx);

        // browsingHandler should be called, NOT greetingHandler
        expect(mockBrowsingHandler).toHaveBeenCalledTimes(1);
        expect(mockGreetingHandler).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

// =========================================================================
// Test 2.2 — Numeric replies route correctly
// =========================================================================

describe('2.2 Numeric replies route correctly', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * **Validates: Requirements 3.4**
   *
   * Observed: routeMessage with text "1", "2", "3" routes to browsingHandler
   * for menu resolution.
   *
   * Property: for all single/double digit numeric strings, routing always
   * goes to browsing handler regardless of session state.
   */
  it('numeric replies always route to browsingHandler regardless of state', async () => {
    const arbState = fc.constantFrom(
      'greeting', 'browsing', 'product_inquiry', 'idle',
      'checkout', 'ordering', 'payment', 'tracking',
    );

    await fc.assert(
      fc.asyncProperty(arbNumericReply, arbState, async (numText, state) => {
        mockGreetingHandler.mockClear();
        mockBrowsingHandler.mockClear();
        mockCheckoutHandler.mockClear();
        mockTrackingHandler.mockClear();

        const ctx = makeRouterContext(numText, state);
        await routeMessage(ctx);

        // browsingHandler should always be called for numeric replies
        expect(mockBrowsingHandler).toHaveBeenCalledTimes(1);
        expect(mockGreetingHandler).not.toHaveBeenCalled();
        expect(mockCheckoutHandler).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

// =========================================================================
// Test 2.3 — Pincode search uses GSI2
// =========================================================================

describe('2.3 Pincode classification', () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * Observed: classifyLocationInput("400001") returns {type: 'pincode', value: '400001'}.
   *
   * Property: for all 6-digit strings, classifyLocationInput returns type 'pincode'.
   * For all non-6-digit strings, returns type 'city'.
   */
  it('6-digit strings always classify as pincode', () => {
    fc.assert(
      fc.property(arbPincode, (pincode) => {
        const result = classifyLocationInput(pincode);
        expect(result.type).toBe('pincode');
        expect(result.value).toBe(pincode);
      }),
      { numRuns: 200 },
    );
  });

  it('non-6-digit strings always classify as city', () => {
    fc.assert(
      fc.property(arbCityName, (city) => {
        const result = classifyLocationInput(city);
        expect(result.type).toBe('city');
        expect(result.value).toBe(city.trim().toLowerCase());
      }),
      { numRuns: 200 },
    );
  });
});

// =========================================================================
// Test 2.4 — Non-greeting messages in browsing/ordering state
// =========================================================================

describe('2.4 Non-greeting messages in browsing/ordering state', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * **Validates: Requirements 3.1**
   *
   * Observed: messages in browsing state route to browsingHandler,
   * messages in ordering state route to checkoutHandler.
   *
   * Property: for all non-greeting text messages, session state determines
   * handler routing — browsing/product_inquiry/idle→browsingHandler,
   * ordering/checkout/payment→checkoutHandler.
   */
  it('browsing-family states always route to browsingHandler', async () => {
    await fc.assert(
      fc.asyncProperty(arbNonGreetingText, arbBrowsingStates, async (text, state) => {
        mockGreetingHandler.mockClear();
        mockBrowsingHandler.mockClear();
        mockCheckoutHandler.mockClear();

        const ctx = makeRouterContext(text, state);
        await routeMessage(ctx);

        expect(mockBrowsingHandler).toHaveBeenCalledTimes(1);
        expect(mockCheckoutHandler).not.toHaveBeenCalled();
        expect(mockGreetingHandler).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  it('checkout-family states always route to checkoutHandler for non-intent non-numeric text', async () => {
    // Use text that does NOT match direct intent patterns and is NOT numeric
    const arbPlainText = fc.constantFrom(
      'where is my order',
      'track order',
      'yes',
      'no',
      'confirm',
      'cancel',
    );

    await fc.assert(
      fc.asyncProperty(arbPlainText, arbCheckoutStates, async (text, state) => {
        mockGreetingHandler.mockClear();
        mockBrowsingHandler.mockClear();
        mockCheckoutHandler.mockClear();

        const ctx = makeRouterContext(text, state);
        await routeMessage(ctx);

        expect(mockCheckoutHandler).toHaveBeenCalledTimes(1);
        expect(mockGreetingHandler).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

// =========================================================================
// Test 2.5 — Message storage independent of EventBridge
// =========================================================================

describe('2.5 Message storage independent of EventBridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVENT_BUS_NAME = 'test-bus';
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * Observed: putMessage() is called before EventBridge publish in
   * handleCustomerMessage. Message storage succeeds regardless of
   * EventBridge success or failure.
   *
   * Test: verify putMessage is called regardless of EventBridge publish
   * success or failure.
   */
  it('putMessage is called even when EventBridge publish fails', async () => {
    // Make EventBridge fail
    mockEBSend.mockRejectedValueOnce(new Error('EventBridge unavailable'));

    // Mock session resolution
    mockResolveOrCreateSession.mockResolvedValue({
      session: {
        state: 'browsing',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
        lastActiveChannel: 'whatsapp',
      },
      isNew: false,
    });

    mockGetUserByPhone.mockResolvedValue(null);

    const sqsEvent = {
      Records: [{
        messageId: 'sqs-1',
        body: JSON.stringify({
          detail: {
            requestId: 'req-1',
            payload: {
              entry: [{
                changes: [{
                  field: 'messages',
                  value: {
                    messages: [{
                      id: 'wa-msg-1',
                      from: '+919999999999',
                      type: 'text',
                      text: { body: 'test message' },
                    }],
                    contacts: [{ wa_id: '+919999999999', profile: { name: 'Test' } }],
                  },
                }],
              }],
            },
          },
        }),
      }],
    } as any;

    await workerHandler(sqsEvent);

    // putMessage should have been called regardless of EventBridge failure
    expect(mockPutMessage).toHaveBeenCalled();
    const putMessageCall = mockPutMessage.mock.calls[0][0];
    expect(putMessageCall.userId).toBeDefined();
    expect(putMessageCall.direction).toBe('inbound');
    expect(putMessageCall.channel).toBe('whatsapp');
  });

  it('putMessage is called when EventBridge publish succeeds', async () => {
    mockEBSend.mockResolvedValue({});

    mockResolveOrCreateSession.mockResolvedValue({
      session: {
        state: 'browsing',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
        lastActiveChannel: 'whatsapp',
      },
      isNew: false,
    });

    mockGetUserByPhone.mockResolvedValue(null);

    const sqsEvent = {
      Records: [{
        messageId: 'sqs-2',
        body: JSON.stringify({
          detail: {
            requestId: 'req-2',
            payload: {
              entry: [{
                changes: [{
                  field: 'messages',
                  value: {
                    messages: [{
                      id: 'wa-msg-2',
                      from: '+919999999998',
                      type: 'text',
                      text: { body: 'another message' },
                    }],
                    contacts: [{ wa_id: '+919999999998', profile: { name: 'Test2' } }],
                  },
                }],
              }],
            },
          },
        }),
      }],
    } as any;

    await workerHandler(sqsEvent);

    expect(mockPutMessage).toHaveBeenCalled();
  });
});

// =========================================================================
// Test 2.6 — Seller routing preserved
// =========================================================================

describe('2.6 Seller routing preserved', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EVENT_BUS_NAME = 'test-bus';
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * Observed: when getUserByPhone returns a user with role: 'seller' and
   * sellerStatus: 'approved', the message routes to handleSellerMessage
   * (seller copilot handler).
   *
   * Property: for all phone numbers resolving to approved sellers, routing
   * always goes to seller copilot handler.
   */
  it('approved sellers always route to seller copilot handler', async () => {
    const arbPhone = fc.stringOf(
      fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
      { minLength: 10, maxLength: 10 },
    ).map(p => `+91${p}`);

    await fc.assert(
      fc.asyncProperty(arbPhone, async (phone) => {
        jest.clearAllMocks();

        // getUserByPhone returns an approved seller
        mockGetUserByPhone.mockResolvedValue({
          userId: 'seller-user-1',
          phoneNumber: phone,
          role: 'seller',
          sellerStatus: 'approved',
          displayName: 'Test Seller',
          PK: 'USER#seller-user-1',
          SK: 'PROFILE',
          cognitoId: 'cognito-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        const sqsEvent = {
          Records: [{
            messageId: `sqs-seller-${phone}`,
            body: JSON.stringify({
              detail: {
                requestId: `req-seller-${phone}`,
                payload: {
                  entry: [{
                    changes: [{
                      field: 'messages',
                      value: {
                        messages: [{
                          id: `wa-seller-${phone}`,
                          from: phone.replace('+', ''),
                          type: 'text',
                          text: { body: 'menu' },
                        }],
                        contacts: [{ wa_id: phone.replace('+', ''), profile: { name: 'Seller' } }],
                      },
                    }],
                  }],
                },
              },
            }),
          }],
        } as any;

        await workerHandler(sqsEvent);

        // handleSellerCopilotMessage should have been called
        expect(mockHandleSellerCopilotMessage).toHaveBeenCalled();
      }),
      { numRuns: 20 },
    );
  });
});
