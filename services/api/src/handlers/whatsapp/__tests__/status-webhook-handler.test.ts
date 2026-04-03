import type { APIGatewayProxyEvent } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mocks — declared before handler import
// ---------------------------------------------------------------------------

const mockValidateRequest = jest.fn();
jest.mock('twilio', () => ({
  validateRequest: (...args: any[]) => mockValidateRequest(...args),
}));

jest.mock('../../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    tableName: 'test-table',
    environment: 'staging', // not 'dev' so signature validation runs
    twilioAuthToken: 'test-auth-token',
    twilioAccountSid: 'AC123',
    twilioPhoneNumber: '+14155551234',
    eventBusName: 'test-bus',
    userPoolId: 'pool-1',
    userPoolClientId: 'client-1',
    razorpayKeyId: 'rk',
    razorpayKeySecret: 'rs',
    razorpayWebhookSecret: 'rw',
    geminiApiKey: 'gk',
    grokApiKey: 'xk',
    productImagesBucket: 'bucket',
    documentsBucket: 'docs',
    region: 'us-east-1',
  }),
}));

jest.mock('../../../adapters/dynamodb-adapter', () => ({
  getUserByPhone: jest.fn(),
  updateMessageDeliveryStatus: jest.fn().mockResolvedValue(undefined),
  findMessageSortKeyBySid: jest.fn(),
}));

const mockDDBSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockDDBSend })),
  };
});

const mockDocClientSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({ send: mockDocClientSend }),
    },
  };
});

const mockApigwSend = jest.fn();
jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: jest.fn().mockImplementation(() => ({ send: mockApigwSend })),
  PostToConnectionCommand: jest.fn().mockImplementation((input: any) => input),
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { handler, mapTwilioStatus } from '../status-webhook-handler';

const dbMod = jest.requireMock('../../../adapters/dynamodb-adapter') as any;
const mockGetUserByPhone = dbMod.getUserByPhone as jest.Mock;
const mockUpdateStatus = dbMod.updateMessageDeliveryStatus as jest.Mock;
const mockFindSortKey = dbMod.findMessageSortKeyBySid as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}, bodyParams?: Record<string, string>): APIGatewayProxyEvent {
  const defaultParams: Record<string, string> = {
    MessageSid: 'SM0001',
    MessageStatus: 'delivered',
    To: 'whatsapp:+919876543210',
    From: 'whatsapp:+14155551234',
    AccountSid: 'AC123',
  };

  const params = bodyParams ?? defaultParams;

  return {
    httpMethod: 'POST',
    path: '/api/v1/whatsapp/status',
    headers: {
      Host: 'api.example.com',
      'x-twilio-signature': 'valid-sig',
      'X-Forwarded-Proto': 'https',
    },
    body: buildFormBody(params),
    isBase64Encoded: false,
    queryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    resource: '',
    requestContext: {
      requestId: 'req-1',
      accountId: '123',
      apiId: 'api-1',
      authorizer: {},
      protocol: 'HTTP/1.1',
      httpMethod: 'POST',
      identity: {} as any,
      path: '/api/v1/whatsapp/status',
      stage: 'prod',
      requestTimeEpoch: Date.now(),
      resourceId: '',
      resourcePath: '',
    },
    ...overrides,
  } as APIGatewayProxyEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Status Webhook Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: signature valid, idempotency succeeds (new record)
    mockValidateRequest.mockReturnValue(true);
    mockDDBSend.mockResolvedValue({});
    mockDocClientSend.mockResolvedValue({ Items: [] }); // No active WS connections by default
    mockGetUserByPhone.mockResolvedValue({ userId: 'user-1' });
    mockFindSortKey.mockResolvedValue('MSG#2025-01-15T10:00:00Z#SM0001');
    // No WEBSOCKET_API_ENDPOINT by default — WebSocket push is skipped
    delete process.env.WEBSOCKET_API_ENDPOINT;
  });

  it('processes a valid status update with valid Twilio signature', async () => {
    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(mockValidateRequest).toHaveBeenCalledWith(
      'test-auth-token',
      'valid-sig',
      expect.stringContaining('https://api.example.com/api/v1/whatsapp/status'),
      expect.objectContaining({ MessageSid: 'SM0001', MessageStatus: 'delivered' }),
    );
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      'user-1',
      'MSG#2025-01-15T10:00:00Z#SM0001',
      'delivered',
      'deliveredAt',
      undefined,
    );
  });

  it('returns 403 for invalid Twilio signature', async () => {
    mockValidateRequest.mockReturnValue(false);

    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(403);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it('maps Twilio statuses to internal delivery statuses', async () => {
    const statusMap: Array<[string, string, string | undefined]> = [
      ['queued', 'queued', undefined],
      ['sent', 'sent', 'sentAt'],
      ['delivered', 'delivered', 'deliveredAt'],
      ['read', 'read', 'readAt'],
      ['failed', 'failed', 'failedAt'],
    ];

    for (const [twilioStatus, expectedStatus, expectedTsField] of statusMap) {
      jest.clearAllMocks();
      mockValidateRequest.mockReturnValue(true);
      mockDDBSend.mockResolvedValue({});
      mockGetUserByPhone.mockResolvedValue({ userId: 'user-1' });
      mockFindSortKey.mockResolvedValue('MSG#2025-01-15T10:00:00Z#SM0001');

      const result = await handler(makeEvent({}, {
        MessageSid: 'SM0001',
        MessageStatus: twilioStatus,
        To: 'whatsapp:+919876543210',
        From: 'whatsapp:+14155551234',
        AccountSid: 'AC123',
      }));

      expect(result.statusCode).toBe(200);
      expect(mockUpdateStatus).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        expectedStatus,
        expectedTsField,
        undefined,
      );
    }
  });

  it('skips processing on duplicate MessageSid+MessageStatus (idempotency)', async () => {
    // Simulate ConditionalCheckFailedException — record already exists
    const { ConditionalCheckFailedException } = jest.requireActual('@aws-sdk/client-dynamodb');
    mockDDBSend.mockRejectedValueOnce(new ConditionalCheckFailedException({ $metadata: {}, message: 'exists' }));

    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    // Should NOT update delivery status since it's a duplicate
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  describe('WebSocket push after status update', () => {
    it('pushes delivery status to active sender connections', async () => {
      process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.example.com/prod';
      mockDocClientSend.mockResolvedValueOnce({
        Items: [{ connectionId: 'conn-1' }, { connectionId: 'conn-2' }],
      });
      mockApigwSend.mockResolvedValue({});

      const result = await handler(makeEvent());

      expect(result.statusCode).toBe(200);
      expect(mockDocClientSend).toHaveBeenCalled();
      expect(mockApigwSend).toHaveBeenCalledTimes(2);
    });

    it('skips WebSocket push when WEBSOCKET_API_ENDPOINT is not set', async () => {
      delete process.env.WEBSOCKET_API_ENDPOINT;

      const result = await handler(makeEvent());

      expect(result.statusCode).toBe(200);
      expect(mockApigwSend).not.toHaveBeenCalled();
    });

    it('skips WebSocket push when no active connections exist', async () => {
      process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.example.com/prod';
      mockDocClientSend.mockResolvedValueOnce({ Items: [] });

      const result = await handler(makeEvent());

      expect(result.statusCode).toBe(200);
      expect(mockApigwSend).not.toHaveBeenCalled();
    });

    it('handles GoneException by deleting stale connection', async () => {
      process.env.WEBSOCKET_API_ENDPOINT = 'https://ws.example.com/prod';
      mockDocClientSend
        .mockResolvedValueOnce({ Items: [{ connectionId: 'stale-conn' }] })
        .mockResolvedValueOnce({}); // DeleteCommand for stale connection
      mockApigwSend.mockRejectedValueOnce({ $metadata: { httpStatusCode: 410 } });

      const result = await handler(makeEvent());

      expect(result.statusCode).toBe(200);
      // Should have attempted push and then deleted stale connection
      expect(mockApigwSend).toHaveBeenCalledTimes(1);
      // docClient.send called twice: once for query, once for delete
      expect(mockDocClientSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('mapTwilioStatus', () => {
    it('maps known Twilio statuses correctly', () => {
      expect(mapTwilioStatus('sent')).toBe('sent');
      expect(mapTwilioStatus('delivered')).toBe('delivered');
      expect(mapTwilioStatus('read')).toBe('read');
      expect(mapTwilioStatus('failed')).toBe('failed');
      expect(mapTwilioStatus('undelivered')).toBe('failed');
      expect(mapTwilioStatus('queued')).toBe('queued');
    });

    it('returns undefined for unknown statuses', () => {
      expect(mapTwilioStatus('unknown')).toBeUndefined();
      expect(mapTwilioStatus('pending')).toBeUndefined();
      expect(mapTwilioStatus('')).toBeUndefined();
    });

    it('is case-insensitive', () => {
      expect(mapTwilioStatus('DELIVERED')).toBe('delivered');
      expect(mapTwilioStatus('Read')).toBe('read');
      expect(mapTwilioStatus('FAILED')).toBe('failed');
    });
  });
});
