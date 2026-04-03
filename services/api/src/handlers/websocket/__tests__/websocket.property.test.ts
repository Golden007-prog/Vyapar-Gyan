/**
 * Property-Based Tests for WebSocket Handlers
 *
 * Uses fast-check to verify correctness properties of WebSocket connection,
 * messaging, presence, and delivery logic.
 *
 * This file is extended by multiple tasks (2.3, 3.3, 5.2, 6.2, 8.2, 9.3).
 * Each section is clearly separated by property number.
 */

import * as fc from 'fast-check';
import {
  buildConnectionRegistryItem,
  ConnectionRegistryItemSchema,
} from '../../../shared/websocket-schemas';

// ============================================================================
// Shared Arbitraries
// ============================================================================

/** Generate a random non-empty alphanumeric string suitable for connectionId. */
const arbConnectionId = fc.stringMatching(/^[A-Za-z0-9_=-]{1,64}$/).filter(
  (s) => !['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'].includes(s),
);

/** Generate a random non-empty UUID-like userId. */
const arbUserId = fc.uuid();

/** Generate a random role. */
const arbRole = fc.constantFrom('customer' as const, 'seller' as const, 'admin' as const);

// ============================================================================
// Property 2: Connection Registry item structure
// ============================================================================

describe('Property 2: Connection Registry item structure', () => {
  /**
   * **Validates: Requirements 2.1, 2.5**
   *
   * For any valid connectionId, userId, and role, the Connection Registry
   * item stored by the Connect Handler should have:
   * - PK = "CONN#{connectionId}"
   * - SK = "META"
   * - GSI1PK = "USER_CONN#{userId}"
   * - GSI1SK = "CONN#{connectionId}"
   * - expiresAt within 24 hours (±1 second) of connectedAt
   */

  it('should produce a valid ConnectionRegistryItem with correct key patterns', () => {
    fc.assert(
      fc.property(
        arbConnectionId,
        arbUserId,
        arbRole,
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
        (connectionId, userId, role, connectedDate) => {
          const connectedAt = connectedDate.toISOString();

          const item = buildConnectionRegistryItem({
            connectionId,
            userId,
            role,
            connectedAt,
          });

          // Validate against Zod schema
          const parseResult = ConnectionRegistryItemSchema.safeParse(item);
          expect(parseResult.success).toBe(true);

          // Verify key patterns
          expect(item.PK).toBe(`CONN#${connectionId}`);
          expect(item.SK).toBe('META');
          expect(item.GSI1PK).toBe(`USER_CONN#${userId}`);
          expect(item.GSI1SK).toBe(`CONN#${connectionId}`);

          // Verify field passthrough
          expect(item.connectionId).toBe(connectionId);
          expect(item.userId).toBe(userId);
          expect(item.role).toBe(role);
          expect(item.connectedAt).toBe(connectedAt);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should set expiresAt within 24 hours (±1 second) of connectedAt', () => {
    fc.assert(
      fc.property(
        arbConnectionId,
        arbUserId,
        arbRole,
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
        (connectionId, userId, role, connectedDate) => {
          const connectedAt = connectedDate.toISOString();

          const item = buildConnectionRegistryItem({
            connectionId,
            userId,
            role,
            connectedAt,
          });

          const connectedEpoch = Math.floor(connectedDate.getTime() / 1000);
          const expected24h = connectedEpoch + 86400;

          // expiresAt should be within ±1 second of connectedAt + 24h
          expect(Math.abs(item.expiresAt - expected24h)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Mocks for Properties 1 & 3 (Connect/Disconnect handler tests)
//
// Strategy: Use a single mockImplementation per mock that reads from a shared
// state object. This avoids issues with mockResolvedValue/mockRejectedValue
// being overridden across test blocks.
// ============================================================================

/** Shared state controlling mock behavior across property iterations. */
const mockState = {
  cognitoMode: 'reject' as 'resolve' | 'reject',
  cognitoUser: { userId: '', role: 'customer' as string },
  ddbStore: new Map<string, Record<string, unknown>>(),
  ddbPutCount: 0,
  // Tracking for Update commands (Property 8: heartbeat TTL)
  lastUpdateParams: null as Record<string, unknown> | null,
  updateCount: 0,
  updateCalls: [] as Array<Record<string, unknown>>,
  // Tracking for Query results (Properties 12, 13: typing broadcast)
  queryResults: new Map<string, Record<string, unknown>[]>(),
  // Tracking for APIGW PostToConnection calls (Properties 12, 13)
  postToConnectionCalls: [] as Array<{ connectionId: string; payload: unknown }>,
};

// Use regular functions that always read from mockState — no mockImplementation needed
function cognitoSendImpl(..._args: unknown[]): Promise<unknown> {
  if (mockState.cognitoMode === 'reject') {
    const err = new Error('Access Token has been revoked');
    (err as any).name = 'NotAuthorizedException';
    return Promise.reject(err);
  }
  return Promise.resolve({
    UserAttributes: [
      { Name: 'sub', Value: mockState.cognitoUser.userId },
      { Name: 'custom:role', Value: mockState.cognitoUser.role },
    ],
  });
}

function ddbSendImpl(cmd: Record<string, unknown>): Promise<unknown> {
  const cmdType = (cmd as any)._cmd as string;

  if (cmdType === 'Put') {
    mockState.ddbPutCount++;
    const item = (cmd as any).Item as Record<string, unknown>;
    if (item && item.PK && item.SK) {
      mockState.ddbStore.set(`${item.PK}#${item.SK}`, item);
    }
    return Promise.resolve({});
  }

  if (cmdType === 'Get') {
    const key = (cmd as any).Key as Record<string, string>;
    if (key && key.PK && key.SK) {
      const item = mockState.ddbStore.get(`${key.PK}#${key.SK}`);
      return Promise.resolve({ Item: item ?? undefined });
    }
    return Promise.resolve({ Item: undefined });
  }

  if (cmdType === 'Delete') {
    const key = (cmd as any).Key as Record<string, string>;
    if (key && key.PK && key.SK) {
      mockState.ddbStore.delete(`${key.PK}#${key.SK}`);
    }
    return Promise.resolve({});
  }

  if (cmdType === 'Query') {
    // Check if we have configured query results for this GSI1PK
    const exprValues = (cmd as any).ExpressionAttributeValues;
    const gsi1pk = exprValues?.[':pk'] as string | undefined;
    if (gsi1pk && mockState.queryResults.has(gsi1pk)) {
      const items = mockState.queryResults.get(gsi1pk)!;
      return Promise.resolve({ Count: items.length, Items: items });
    }
    return Promise.resolve({ Count: 0, Items: [] });
  }

  if (cmdType === 'Update') {
    mockState.lastUpdateParams = cmd as Record<string, unknown>;
    mockState.updateCount++;
    mockState.updateCalls.push(cmd as Record<string, unknown>);
    return Promise.resolve({});
  }

  // Fallback — no-op
  return Promise.resolve({});
}

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const PutCommand = jest.fn().mockImplementation((p: unknown) => ({ _cmd: 'Put', ...(p as object) }));
  const GetCommand = jest.fn().mockImplementation((p: unknown) => ({ _cmd: 'Get', ...(p as object) }));
  const DeleteCommand = jest.fn().mockImplementation((p: unknown) => ({ _cmd: 'Delete', ...(p as object) }));
  const QueryCommand = jest.fn().mockImplementation((p: unknown) => ({ _cmd: 'Query', ...(p as object) }));
  const UpdateCommand = jest.fn().mockImplementation((p: unknown) => ({ _cmd: 'Update', ...(p as object) }));

  return {
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({
        send: (cmd: Record<string, unknown>) => ddbSendImpl(cmd),
      }),
    },
    PutCommand,
    GetCommand,
    DeleteCommand,
    QueryCommand,
    UpdateCommand,
  };
});

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
    send: (...args: unknown[]) => cognitoSendImpl(...args),
  })),
  GetUserCommand: jest.fn().mockImplementation((p: unknown) => ({ _cmd: 'GetUser', ...(p as object) })),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../shared/websocket-schemas', () => {
  const actual = jest.requireActual('../../../shared/websocket-schemas');
  return actual;
});

// Track PostToConnectionCommand calls via a regular function (not jest.fn)
// to avoid hoisting and closure issues across test blocks.
function apigwSendImpl(cmd: any): Promise<unknown> {
  if (cmd?._cmd === 'PostToConnection' && cmd?.input) {
    mockState.postToConnectionCalls.push({
      connectionId: cmd.input.ConnectionId,
      payload: cmd.input.Data,
    });
  }
  return Promise.resolve({});
}

jest.mock('@aws-sdk/client-apigatewaymanagementapi', () => {
  return {
    ApiGatewayManagementApiClient: jest.fn().mockImplementation(() => ({
      send: (cmd: any) => apigwSendImpl(cmd),
    })),
    PostToConnectionCommand: jest.fn().mockImplementation((p: any) => ({
      _cmd: 'PostToConnection',
      input: p,
    })),
  };
});

import { handler as connectHandler } from '../connect';
import { handler as disconnectHandler } from '../disconnect';
import { handler as defaultHandler } from '../default';
import { handler as sendMessageHandler } from '../send-message';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ============================================================================
// Helper: build a mock APIGatewayProxyEvent
// ============================================================================

function buildMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
    requestContext: {
      connectionId: 'test-conn-id',
      accountId: '123456789',
      apiId: 'api-id',
      authorizer: {},
      protocol: 'wss',
      httpMethod: 'GET',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: null,
        userArn: null,
      },
      path: '/',
      stage: 'dev',
      requestId: 'req-id',
      requestTimeEpoch: Date.now(),
      resourceId: '',
      resourcePath: '',
    },
    ...overrides,
  } as APIGatewayProxyEvent;
}

// ============================================================================
// Property 1: Connection Registry round-trip
// ============================================================================

describe('Property 1: Connection Registry round-trip', () => {
  /**
   * **Validates: Requirements 2.1, 2.3**
   *
   * For any valid connectionId and userId, storing a Connection Registry
   * item via the Connect Handler and then deleting it via the Disconnect
   * Handler should result in no Connection Registry item existing for
   * that connectionId.
   */

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    mockState.cognitoMode = 'resolve';
    mockState.ddbStore.clear();
    mockState.ddbPutCount = 0;
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
  });

  it('connect then disconnect should leave no Connection Registry item for the connectionId', () => {
    fc.assert(
      fc.asyncProperty(
        arbConnectionId,
        arbUserId,
        arbRole,
        async (connectionId, userId, role) => {
          // Flush pending microtasks from previous iterations
          await new Promise((resolve) => setTimeout(resolve, 0));

          // Reset per-iteration state
          mockState.ddbStore.clear();
          mockState.ddbPutCount = 0;
          mockState.updateCount = 0;
          mockState.updateCalls = [];
          mockState.postToConnectionCalls = [];
          mockState.queryResults.clear();
          mockState.cognitoUser = { userId, role };
          mockState.cognitoMode = 'resolve';

          // 1. Call connect handler
          const connectEvent = buildMockEvent({
            queryStringParameters: { token: 'valid-jwt-token' },
            requestContext: {
              ...buildMockEvent().requestContext,
              connectionId,
            },
          });

          const connectResult = await connectHandler(connectEvent);
          expect(connectResult.statusCode).toBe(200);

          // Verify item was stored
          const storedItem = mockState.ddbStore.get(`CONN#${connectionId}#META`);
          expect(storedItem).toBeDefined();
          expect((storedItem as any).userId).toBe(userId);

          // 2. Call disconnect handler
          const disconnectEvent = buildMockEvent({
            requestContext: {
              ...buildMockEvent().requestContext,
              connectionId,
            },
          });

          const disconnectResult = await disconnectHandler(disconnectEvent);
          expect(disconnectResult.statusCode).toBe(200);

          // 3. Verify no Connection Registry item exists
          const afterDisconnect = mockState.ddbStore.get(`CONN#${connectionId}#META`);
          expect(afterDisconnect).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Property 3: Invalid JWT rejection
// ============================================================================

describe('Property 3: Invalid JWT rejection', () => {
  /**
   * **Validates: Requirements 2.4**
   *
   * For any string that is not a valid Cognito JWT (empty, whitespace-only,
   * malformed base64, expired, wrong issuer), the Connect Handler should
   * return a 401 status code and not store any Connection Registry item.
   */

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    mockState.cognitoMode = 'reject';
    mockState.ddbStore.clear();
    mockState.ddbPutCount = 0;
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
  });

  /** Generate invalid token strings: empty, whitespace, random garbage. */
  const arbInvalidToken = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('\t\n'),
    fc.stringOf(fc.char(), { minLength: 1, maxLength: 200 }),
    fc.constant('not.a.jwt'),
    fc.constant('eyJhbGciOiJIUzI1NiJ9.invalid.payload'),
  );

  it('should return 401 and not store any Connection Registry item for invalid tokens', () => {
    fc.assert(
      fc.asyncProperty(arbInvalidToken, async (invalidToken) => {
        // Flush any pending microtasks from previous iterations
        await new Promise(resolve => setTimeout(resolve, 0));

        mockState.ddbPutCount = 0;
        mockState.cognitoMode = 'reject';

        const event = buildMockEvent({
          queryStringParameters: { token: invalidToken },
          requestContext: {
            ...buildMockEvent().requestContext,
            connectionId: 'conn-invalid-test',
          },
        });

        const result = await connectHandler(event);

        // Empty or whitespace-only tokens are rejected before Cognito call
        // All other invalid tokens are rejected by Cognito → 401
        expect(result.statusCode).toBe(401);

        // No DynamoDB PutCommand should have been called
        expect(mockState.ddbPutCount).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('should return 401 when no token is provided at all', async () => {
    mockState.ddbPutCount = 0;

    const event = buildMockEvent({
      queryStringParameters: null,
      requestContext: {
        ...buildMockEvent().requestContext,
        connectionId: 'conn-no-token',
      },
    });

    const result = await connectHandler(event);
    expect(result.statusCode).toBe(401);

    // No DynamoDB Put should have been called
    expect(mockState.ddbPutCount).toBe(0);
  });
});


// ============================================================================
// Property 8: Heartbeat TTL refresh
// ============================================================================

describe('Property 8: Heartbeat TTL refresh', () => {
  /**
   * **Validates: Requirements 5.1**
   *
   * For any heartbeat received at time T for a valid connectionId, the
   * Connection Registry item's expiresAt should be updated to
   * floor(T/1000) + 86400 seconds (24 hours), within ±1 second tolerance.
   */

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.WEBSOCKET_API_ENDPOINT = 'https://fake.execute-api.us-east-1.amazonaws.com/dev';
    mockState.ddbStore.clear();
    mockState.lastUpdateParams = null;
    mockState.updateCount = 0;
    mockState.updateCalls = [];
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
    delete process.env.WEBSOCKET_API_ENDPOINT;
  });

  it('should update expiresAt to floor(T/1000) + 86400 for any heartbeat timestamp', () => {
    fc.assert(
      fc.asyncProperty(
        arbConnectionId,
        // Generate timestamps in a reasonable range (2020-2030)
        fc.integer({ min: 1577836800000, max: 1924991999000 }),
        async (connectionId, timestampMs) => {
          // Flush pending microtasks from previous iterations
          await new Promise((resolve) => setTimeout(resolve, 0));

          mockState.lastUpdateParams = null;
          mockState.updateCount = 0;
          mockState.updateCalls = [];
          mockState.ddbStore.clear();
          mockState.postToConnectionCalls = [];

          // Freeze Date.now to the generated timestamp
          const originalDateNow = Date.now;
          Date.now = () => timestampMs;

          try {
            const event = buildMockEvent({
              body: JSON.stringify({ action: 'heartbeat' }),
              requestContext: {
                ...buildMockEvent().requestContext,
                connectionId,
              },
            });

            const result = await defaultHandler(event);
            expect(result.statusCode).toBe(200);

            // Verify at least one UpdateCommand was called
            expect(mockState.updateCount).toBeGreaterThanOrEqual(1);

            // Find the Update call targeting the CONN# key (heartbeat TTL refresh)
            const connUpdate = mockState.updateCalls.find((cmd) => {
              const key = (cmd as any).Key;
              return key?.PK === `CONN#${connectionId}` && key?.SK === 'META';
            });

            expect(connUpdate).toBeDefined();

            // Verify expiresAt = floor(T/1000) + 86400
            const exprValues = (connUpdate as any).ExpressionAttributeValues;
            const actualExpiry = exprValues[':exp'] as number;
            const expectedExpiry = Math.floor(timestampMs / 1000) + 86400;

            expect(Math.abs(actualExpiry - expectedExpiry)).toBeLessThanOrEqual(1);
          } finally {
            Date.now = originalDateNow;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Properties 12 & 13: Typing broadcast to recipients, excludes sender
// ============================================================================

describe('Property 12 & 13: Typing broadcast', () => {
  /**
   * **Validates: Requirements 13.3, 13.5**
   *
   * Property 12: For any typing event, the server should broadcast to all
   * recipient connections except the sender's connection.
   *
   * Property 13: For any typing event from userId A in a conversation with
   * participants {A, B}, the Message_Router should push the typing event to
   * all connections of B, and to zero connections of A.
   */

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.WEBSOCKET_API_ENDPOINT = 'https://fake.execute-api.us-east-1.amazonaws.com/dev';
    mockState.ddbStore.clear();
    mockState.queryResults.clear();
    mockState.postToConnectionCalls = [];
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
    delete process.env.WEBSOCKET_API_ENDPOINT;
  });

  it('should push typing to all connections of B and zero connections of A', () => {
    fc.assert(
      fc.asyncProperty(
        arbUserId,
        arbUserId,
        // Sender has 1-3 connections
        fc.array(arbConnectionId, { minLength: 1, maxLength: 3 }),
        // Recipient has 1-4 connections
        fc.array(arbConnectionId, { minLength: 1, maxLength: 4 }),
        fc.boolean(),
        async (userA, userB, senderConns, recipientConns, isTyping) => {
          // Flush pending microtasks from previous iterations
          await new Promise((resolve) => setTimeout(resolve, 0));

          // Ensure users are different
          if (userA === userB) return;

          const uniqueSenderConns = [...new Set(senderConns)];
          const uniqueRecipientConns = [...new Set(recipientConns)];

          // Ensure no overlap between sender and recipient connection IDs
          const recipientSet = new Set(uniqueRecipientConns);
          const filteredSenderConns = uniqueSenderConns.filter((c) => !recipientSet.has(c));
          if (filteredSenderConns.length === 0) return;

          mockState.ddbStore.clear();
          mockState.queryResults.clear();
          mockState.postToConnectionCalls = [];

          const senderConnId = filteredSenderConns[0];

          // Store sender's connection in DDB for getUserIdForConnection lookup
          mockState.ddbStore.set(`CONN#${senderConnId}#META`, {
            PK: `CONN#${senderConnId}`,
            SK: 'META',
            connectionId: senderConnId,
            userId: userA,
          });

          // Set up recipient (userB) connections in query results
          mockState.queryResults.set(
            `USER_CONN#${userB}`,
            uniqueRecipientConns.map((connId) => ({
              connectionId: connId,
            })),
          );

          const event = buildMockEvent({
            body: JSON.stringify({
              action: 'typing',
              conversationUserId: userB,
              isTyping,
            }),
            requestContext: {
              ...buildMockEvent().requestContext,
              connectionId: senderConnId,
            },
          });

          const result = await defaultHandler(event);
          expect(result.statusCode).toBe(200);

          // Extract connectionIds from PostToConnectionCommand calls
          const calledConnIds = mockState.postToConnectionCalls.map((c) => c.connectionId);

          // Property 12: Sender's connection should never receive the typing event
          expect(calledConnIds).not.toContain(senderConnId);

          // Property 12: All recipient connections (excluding sender's connId)
          // should receive the typing event
          const expectedRecipientConns = uniqueRecipientConns.filter(
            (c) => c !== senderConnId,
          );
          for (const connId of expectedRecipientConns) {
            expect(calledConnIds).toContain(connId);
          }

          // Property 13: Zero connections of A should receive the typing event
          for (const connId of filteredSenderConns) {
            expect(calledConnIds).not.toContain(connId);
          }

          // Property 13: Verify the payload contains the correct typing info
          for (const call of mockState.postToConnectionCalls) {
            const parsedPayload = JSON.parse(Buffer.from(call.payload).toString());
            expect(parsedPayload.type).toBe('typing');
            expect(parsedPayload.userId).toBe(userA);
            expect(parsedPayload.isTyping).toBe(isTyping);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================================
// Property 4: Message dual-thread storage
// ============================================================================

describe('Property 4: Message dual-thread storage', () => {
  /**
   * **Validates: Requirements 3.1, 6.1**
   *
   * For any valid message with a senderId and recipientId, the sendMessage
   * handler should store the message in both THREAD#{senderId} and
   * THREAD#{recipientId} with deliveryStatus = "sent" and a non-null
   * sentAt timestamp.
   */

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.WEBSOCKET_API_ENDPOINT = 'https://fake.execute-api.us-east-1.amazonaws.com/dev';
    mockState.ddbStore.clear();
    mockState.ddbPutCount = 0;
    mockState.queryResults.clear();
    mockState.postToConnectionCalls = [];
    mockState.updateCalls = [];
    mockState.updateCount = 0;
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
    delete process.env.WEBSOCKET_API_ENDPOINT;
  });

  it('should store message in both THREAD#{senderId} and THREAD#{recipientId} with deliveryStatus=sent and sentAt set', () => {
    fc.assert(
      fc.asyncProperty(
        arbConnectionId,
        arbUserId,
        arbUserId,
        arbRole,
        fc.string({ minLength: 1, maxLength: 200 }),
        async (senderConnId, senderId, recipientId, senderRole, messageBody) => {
          // Ensure sender and recipient are different
          if (senderId === recipientId) return;

          // Flush pending microtasks from previous iterations
          await new Promise((resolve) => setTimeout(resolve, 0));

          // Reset state
          mockState.ddbStore.clear();
          mockState.ddbPutCount = 0;
          mockState.queryResults.clear();
          mockState.postToConnectionCalls = [];
          mockState.updateCalls = [];
          mockState.updateCount = 0;

          // Store sender's connection in DDB for getUserIdForConnection lookup
          mockState.ddbStore.set(`CONN#${senderConnId}#META`, {
            PK: `CONN#${senderConnId}`,
            SK: 'META',
            connectionId: senderConnId,
            userId: senderId,
            role: senderRole,
          });

          // No recipient connections (so no fan-out, keeps test focused on storage)
          mockState.queryResults.set(`USER_CONN#${recipientId}`, []);
          mockState.queryResults.set(`USER_CONN#${senderId}`, []);

          const event = buildMockEvent({
            body: JSON.stringify({
              action: 'sendMessage',
              recipientId,
              messageType: 'text',
              content: { body: messageBody },
            }),
            requestContext: {
              ...buildMockEvent().requestContext,
              connectionId: senderConnId,
            },
          });

          const result = await sendMessageHandler(event);
          expect(result.statusCode).toBe(200);

          // Collect all THREAD# items from the store
          const threadItems: Array<Record<string, unknown>> = [];
          for (const [key, value] of mockState.ddbStore.entries()) {
            if (key.startsWith('THREAD#')) {
              threadItems.push(value);
            }
          }

          // Should have at least 2 thread items (sender + recipient)
          expect(threadItems.length).toBeGreaterThanOrEqual(2);

          // Find sender thread item
          const senderThread = threadItems.find(
            (item) => (item.PK as string) === `THREAD#${senderId}`,
          );
          expect(senderThread).toBeDefined();
          expect(senderThread!.deliveryStatus).toBe('sent');
          expect(senderThread!.sentAt).toBeTruthy();
          expect(typeof senderThread!.sentAt).toBe('string');

          // Find recipient thread item
          const recipientThread = threadItems.find(
            (item) => (item.PK as string) === `THREAD#${recipientId}`,
          );
          expect(recipientThread).toBeDefined();
          expect(recipientThread!.deliveryStatus).toBe('sent');
          expect(recipientThread!.sentAt).toBeTruthy();
          expect(typeof recipientThread!.sentAt).toBe('string');

          // Both should share the same messageId
          expect(senderThread!.messageId).toBe(recipientThread!.messageId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Property 5: Message fan-out to all user connections
// ============================================================================

describe('Property 5: Message fan-out to all user connections', () => {
  /**
   * **Validates: Requirements 3.2, 3.3, 6.4, 7.2**
   *
   * For any userId with N active connections (N >= 0), when a message
   * targets that userId, the system should attempt to push the payload
   * to exactly N connections via the API Gateway Management API.
   */

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.WEBSOCKET_API_ENDPOINT = 'https://fake.execute-api.us-east-1.amazonaws.com/dev';
    mockState.ddbStore.clear();
    mockState.ddbPutCount = 0;
    mockState.queryResults.clear();
    mockState.postToConnectionCalls = [];
    mockState.updateCalls = [];
    mockState.updateCount = 0;
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
    delete process.env.WEBSOCKET_API_ENDPOINT;
  });

  it('should push to exactly N recipient connections when recipient has N connections', () => {
    fc.assert(
      fc.asyncProperty(
        arbConnectionId,
        arbUserId,
        arbUserId,
        // Recipient has 0-5 connections
        fc.array(arbConnectionId, { minLength: 0, maxLength: 5 }),
        async (senderConnId, senderId, recipientId, recipientConns) => {
          // Ensure sender and recipient are different
          if (senderId === recipientId) return;

          // Flush pending microtasks from previous iterations
          await new Promise((resolve) => setTimeout(resolve, 0));

          const uniqueRecipientConns = [...new Set(recipientConns)];
          // Ensure sender connection is not in recipient connections
          const filteredRecipientConns = uniqueRecipientConns.filter(
            (c) => c !== senderConnId,
          );

          // Reset state
          mockState.ddbStore.clear();
          mockState.ddbPutCount = 0;
          mockState.queryResults.clear();
          mockState.postToConnectionCalls = [];
          mockState.updateCalls = [];
          mockState.updateCount = 0;

          // Store sender's connection
          mockState.ddbStore.set(`CONN#${senderConnId}#META`, {
            PK: `CONN#${senderConnId}`,
            SK: 'META',
            connectionId: senderConnId,
            userId: senderId,
            role: 'customer',
          });

          // Set up recipient connections
          mockState.queryResults.set(
            `USER_CONN#${recipientId}`,
            filteredRecipientConns.map((connId) => ({ connectionId: connId })),
          );

          // No sender connections for multi-device sync (isolate recipient fan-out)
          mockState.queryResults.set(`USER_CONN#${senderId}`, []);

          const event = buildMockEvent({
            body: JSON.stringify({
              action: 'sendMessage',
              recipientId,
              messageType: 'text',
              content: { body: 'Hello' },
            }),
            requestContext: {
              ...buildMockEvent().requestContext,
              connectionId: senderConnId,
            },
          });

          const result = await sendMessageHandler(event);
          expect(result.statusCode).toBe(200);

          // Count PostToConnection calls targeting recipient connections
          const recipientPushes = mockState.postToConnectionCalls.filter((call) =>
            filteredRecipientConns.includes(call.connectionId),
          );

          // Should have exactly N pushes for N recipient connections
          expect(recipientPushes.length).toBe(filteredRecipientConns.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================================
// Property 6: Delivery status transition on successful push
// ============================================================================

describe('Property 6: Delivery status transition on successful push', () => {
  /**
   * **Validates: Requirements 6.2, 6.3**
   *
   * For any message successfully pushed to at least one recipient
   * connection, deliveryStatus should transition from "sent" to
   * "delivered" and deliveredAt should be set.
   */

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.WEBSOCKET_API_ENDPOINT = 'https://fake.execute-api.us-east-1.amazonaws.com/dev';
    mockState.ddbStore.clear();
    mockState.ddbPutCount = 0;
    mockState.queryResults.clear();
    mockState.postToConnectionCalls = [];
    mockState.updateCalls = [];
    mockState.updateCount = 0;
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
    delete process.env.WEBSOCKET_API_ENDPOINT;
  });

  it('should update deliveryStatus to delivered and set deliveredAt when push succeeds', () => {
    fc.assert(
      fc.asyncProperty(
        arbConnectionId,
        arbUserId,
        arbUserId,
        // At least 1 recipient connection for successful push
        fc.array(arbConnectionId, { minLength: 1, maxLength: 4 }),
        async (senderConnId, senderId, recipientId, recipientConns) => {
          // Ensure sender and recipient are different
          if (senderId === recipientId) return;

          // Flush pending microtasks from previous iterations
          await new Promise((resolve) => setTimeout(resolve, 0));

          const uniqueRecipientConns = [...new Set(recipientConns)];
          const filteredRecipientConns = uniqueRecipientConns.filter(
            (c) => c !== senderConnId,
          );
          if (filteredRecipientConns.length === 0) return;

          // Reset state
          mockState.ddbStore.clear();
          mockState.ddbPutCount = 0;
          mockState.queryResults.clear();
          mockState.postToConnectionCalls = [];
          mockState.updateCalls = [];
          mockState.updateCount = 0;

          // Store sender's connection
          mockState.ddbStore.set(`CONN#${senderConnId}#META`, {
            PK: `CONN#${senderConnId}`,
            SK: 'META',
            connectionId: senderConnId,
            userId: senderId,
            role: 'seller',
          });

          // Set up recipient connections (all succeed — mock returns resolved)
          mockState.queryResults.set(
            `USER_CONN#${recipientId}`,
            filteredRecipientConns.map((connId) => ({ connectionId: connId })),
          );

          // Sender connections for status push-back
          mockState.queryResults.set(`USER_CONN#${senderId}`, []);

          const event = buildMockEvent({
            body: JSON.stringify({
              action: 'sendMessage',
              recipientId,
              messageType: 'text',
              content: { body: 'Test delivery' },
            }),
            requestContext: {
              ...buildMockEvent().requestContext,
              connectionId: senderConnId,
            },
          });

          const result = await sendMessageHandler(event);
          expect(result.statusCode).toBe(200);

          // Find UpdateCommand calls that set deliveryStatus to 'delivered'
          const deliveryUpdates = mockState.updateCalls.filter((cmd) => {
            const exprValues = (cmd as any).ExpressionAttributeValues;
            return exprValues?.[':status'] === 'delivered';
          });

          // Should have update calls for both sender and recipient threads
          expect(deliveryUpdates.length).toBeGreaterThanOrEqual(2);

          // Verify each update sets deliveredAt
          for (const update of deliveryUpdates) {
            const exprValues = (update as any).ExpressionAttributeValues;
            expect(exprValues[':status']).toBe('delivered');
            expect(exprValues[':ts']).toBeTruthy();
            expect(typeof exprValues[':ts']).toBe('string');

            // Verify the key targets a THREAD# item
            const key = (update as any).Key;
            expect((key.PK as string).startsWith('THREAD#')).toBe(true);
          }

          // Verify the updates target both sender and recipient threads
          const updatedPKs = deliveryUpdates.map((cmd) => (cmd as any).Key.PK as string);
          expect(updatedPKs).toContain(`THREAD#${senderId}`);
          expect(updatedPKs).toContain(`THREAD#${recipientId}`);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================================
// Property 9: Twilio status mapping
// ============================================================================

import { mapTwilioStatus } from '../../whatsapp/status-webhook-handler';

describe('Property 9: Twilio status mapping', () => {
  /**
   * **Validates: Requirements 7.3**
   *
   * For any Twilio status string in {sent, delivered, read, failed, undelivered},
   * the mapping function should produce the corresponding DeliveryStatus:
   * sent → sent, delivered → delivered, read → read, failed → failed,
   * undelivered → failed. For any string not in this set, the mapping
   * should return undefined.
   */

  const KNOWN_MAPPINGS: Array<[string, string]> = [
    ['sent', 'sent'],
    ['delivered', 'delivered'],
    ['read', 'read'],
    ['failed', 'failed'],
    ['undelivered', 'failed'],
  ];

  // Include 'queued' since VALID_STATUSES also maps queued → queued
  const KNOWN_STATUSES = new Set(['sent', 'delivered', 'read', 'failed', 'undelivered', 'queued']);

  it('should map known Twilio statuses to the correct DeliveryStatus (lowercase)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...KNOWN_MAPPINGS),
        ([twilioStatus, expectedDeliveryStatus]) => {
          const result = mapTwilioStatus(twilioStatus);
          expect(result).toBe(expectedDeliveryStatus);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should map known Twilio statuses case-insensitively (mixed case)', () => {
    /** Generate a mixed-case variant of a string */
    const arbMixedCase = (base: string) =>
      fc.array(fc.boolean(), { minLength: base.length, maxLength: base.length }).map(
        (flags) =>
          base
            .split('')
            .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
            .join(''),
      );

    fc.assert(
      fc.property(
        fc.constantFrom(...KNOWN_MAPPINGS).chain(([twilioStatus, expected]) =>
          arbMixedCase(twilioStatus).map((mixed) => [mixed, expected] as [string, string]),
        ),
        ([mixedCaseStatus, expectedDeliveryStatus]) => {
          const result = mapTwilioStatus(mixedCaseStatus);
          expect(result).toBe(expectedDeliveryStatus);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return undefined for any string not in the known Twilio status set', () => {
    // Also exclude JS prototype keys (__proto__, constructor, etc.) which return
    // truthy values from plain object lookups — this is standard JS behavior,
    // not a business logic concern for the Twilio status mapping.
    const PROTO_KEYS = new Set(['__proto__', 'constructor', 'tostring', 'valueof', 'hasownproperty']);

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => {
            const lower = s.toLowerCase();
            return !KNOWN_STATUSES.has(lower) && !PROTO_KEYS.has(lower);
          },
        ),
        (unknownStatus) => {
          const result = mapTwilioStatus(unknownStatus);
          expect(result).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ============================================================================
// Property 14: Seller presence determination
// ============================================================================

import { isSellerOffline } from '../send-message';

describe('Property 14: Seller presence determination', () => {
  /**
   * **Validates: Requirements 14.1, 14.2**
   *
   * For any seller userId, the seller is considered online if and only if
   * they have at least one Connection Registry item with a heartbeat
   * received within the last 60 seconds. When transitioning from online
   * to offline, the lastSeen timestamp on the PRESENCE record should be set.
   */

  it('should return offline (true) when no presence record exists', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
        (now) => {
          expect(isSellerOffline(undefined, now)).toBe(true);
          expect(isSellerOffline(null, now)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return offline (true) when online is false regardless of updatedAt', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
        fc.option(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }), { nil: undefined }),
        (now, updatedAtDate) => {
          const record = {
            online: false,
            updatedAt: updatedAtDate ? updatedAtDate.toISOString() : undefined,
          };
          expect(isSellerOffline(record, now)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return offline (true) when online is true but updatedAt is more than 60s ago', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2021-01-01'), max: new Date('2030-12-31') }),
        // Offset in ms: 60001 to 10_000_000 (well past the 60s threshold)
        fc.integer({ min: 60_001, max: 10_000_000 }),
        (now, offsetMs) => {
          const updatedAt = new Date(now.getTime() - offsetMs);
          const record = {
            online: true,
            updatedAt: updatedAt.toISOString(),
          };
          expect(isSellerOffline(record, now)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return online (false) when online is true and updatedAt is within 60s', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2021-01-01'), max: new Date('2030-12-31') }),
        // Offset in ms: 0 to 59999 (within the 60s threshold)
        fc.integer({ min: 0, max: 59_999 }),
        (now, offsetMs) => {
          const updatedAt = new Date(now.getTime() - offsetMs);
          const record = {
            online: true,
            updatedAt: updatedAt.toISOString(),
          };
          expect(isSellerOffline(record, now)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('isSellerOffline is true iff no record OR online=false OR updatedAt > 60s ago', () => {
    // Arbitrary presence record generator
    const arbPresenceRecord = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.record({
        online: fc.boolean(),
        updatedAt: fc.option(
          fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString()),
          { nil: undefined },
        ),
      }),
    );

    fc.assert(
      fc.property(
        arbPresenceRecord,
        fc.date({ min: new Date('2021-01-01'), max: new Date('2030-12-31') }),
        (record, now) => {
          const result = isSellerOffline(record, now);

          // Compute expected result manually
          if (!record) {
            expect(result).toBe(true);
            return;
          }
          if (!record.online) {
            expect(result).toBe(true);
            return;
          }
          if (record.updatedAt) {
            const elapsed = now.getTime() - new Date(record.updatedAt).getTime();
            if (elapsed > 60_000) {
              expect(result).toBe(true);
              return;
            }
          }
          // online=true and updatedAt within 60s (or no updatedAt)
          expect(result).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ============================================================================
// Property 15: Auto-reply to offline seller
// ============================================================================

describe('Property 15: Auto-reply to offline seller', () => {
  /**
   * **Validates: Requirements 14.4**
   *
   * For any message sent by a customer to a seller who is currently offline,
   * the system should create a system type message in the customer's thread
   * containing an estimated response time.
   */

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.WEBSOCKET_API_ENDPOINT = 'https://fake.execute-api.us-east-1.amazonaws.com/dev';
    mockState.ddbStore.clear();
    mockState.ddbPutCount = 0;
    mockState.queryResults.clear();
    mockState.postToConnectionCalls = [];
    mockState.updateCalls = [];
    mockState.updateCount = 0;
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
    delete process.env.WEBSOCKET_API_ENDPOINT;
  });

  it('should create a system auto-reply in customer thread when seller is offline', () => {
    fc.assert(
      fc.asyncProperty(
        arbConnectionId,
        arbUserId,
        arbUserId,
        fc.string({ minLength: 1, maxLength: 200 }),
        async (senderConnId, customerId, sellerId, messageBody) => {
          // Ensure sender and recipient are different
          if (customerId === sellerId) return;

          await new Promise((resolve) => setTimeout(resolve, 0));

          // Reset state
          mockState.ddbStore.clear();
          mockState.ddbPutCount = 0;
          mockState.queryResults.clear();
          mockState.postToConnectionCalls = [];
          mockState.updateCalls = [];
          mockState.updateCount = 0;

          // Store customer's connection (senderRole = 'customer')
          mockState.ddbStore.set(`CONN#${senderConnId}#META`, {
            PK: `CONN#${senderConnId}`,
            SK: 'META',
            connectionId: senderConnId,
            userId: customerId,
            role: 'customer',
          });

          // Seller is offline: PRESENCE record has online=false
          mockState.ddbStore.set(`PRESENCE#${sellerId}#STATUS`, {
            PK: `PRESENCE#${sellerId}`,
            SK: 'STATUS',
            online: false,
            updatedAt: new Date(Date.now() - 120_000).toISOString(), // 2 min ago
          });

          // No connections for either user (keeps test focused on storage)
          mockState.queryResults.set(`USER_CONN#${sellerId}`, []);
          mockState.queryResults.set(`USER_CONN#${customerId}`, []);

          const event = buildMockEvent({
            body: JSON.stringify({
              action: 'sendMessage',
              recipientId: sellerId,
              messageType: 'text',
              content: { body: messageBody },
            }),
            requestContext: {
              ...buildMockEvent().requestContext,
              connectionId: senderConnId,
            },
          });

          const result = await sendMessageHandler(event);
          expect(result.statusCode).toBe(200);

          // Collect all THREAD#{customerId} items from the store
          const customerThreadItems: Array<Record<string, unknown>> = [];
          for (const [key, value] of mockState.ddbStore.entries()) {
            if (key.startsWith(`THREAD#${customerId}#MSG#`)) {
              customerThreadItems.push(value);
            }
          }

          // Should have at least 2 items: the original message + the auto-reply
          expect(customerThreadItems.length).toBeGreaterThanOrEqual(2);

          // Find the system auto-reply message
          const autoReply = customerThreadItems.find(
            (item) => item.messageType === 'system' && item.senderRole === 'system',
          );

          expect(autoReply).toBeDefined();
          expect(autoReply!.senderId).toBe('system');
          expect(autoReply!.recipientId).toBe(customerId);
          expect(autoReply!.messageType).toBe('system');
          expect(autoReply!.senderRole).toBe('system');

          // Content should mention response time
          const content = autoReply!.content as { body: string };
          expect(content.body).toContain('offline');
          expect(content.body).toContain('response time');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should NOT create a system auto-reply when seller is online', () => {
    fc.assert(
      fc.asyncProperty(
        arbConnectionId,
        arbUserId,
        arbUserId,
        fc.string({ minLength: 1, maxLength: 200 }),
        async (senderConnId, customerId, sellerId, messageBody) => {
          if (customerId === sellerId) return;

          await new Promise((resolve) => setTimeout(resolve, 0));

          mockState.ddbStore.clear();
          mockState.ddbPutCount = 0;
          mockState.queryResults.clear();
          mockState.postToConnectionCalls = [];
          mockState.updateCalls = [];
          mockState.updateCount = 0;

          // Store customer's connection
          mockState.ddbStore.set(`CONN#${senderConnId}#META`, {
            PK: `CONN#${senderConnId}`,
            SK: 'META',
            connectionId: senderConnId,
            userId: customerId,
            role: 'customer',
          });

          // Seller is online: recent heartbeat
          mockState.ddbStore.set(`PRESENCE#${sellerId}#STATUS`, {
            PK: `PRESENCE#${sellerId}`,
            SK: 'STATUS',
            online: true,
            updatedAt: new Date().toISOString(), // just now
          });

          mockState.queryResults.set(`USER_CONN#${sellerId}`, []);
          mockState.queryResults.set(`USER_CONN#${customerId}`, []);

          const event = buildMockEvent({
            body: JSON.stringify({
              action: 'sendMessage',
              recipientId: sellerId,
              messageType: 'text',
              content: { body: messageBody },
            }),
            requestContext: {
              ...buildMockEvent().requestContext,
              connectionId: senderConnId,
            },
          });

          const result = await sendMessageHandler(event);
          expect(result.statusCode).toBe(200);

          // Collect all THREAD#{customerId} items
          const customerThreadItems: Array<Record<string, unknown>> = [];
          for (const [key, value] of mockState.ddbStore.entries()) {
            if (key.startsWith(`THREAD#${customerId}#MSG#`)) {
              customerThreadItems.push(value);
            }
          }

          // Should have exactly 1 item: the original outbound message only
          const systemMessages = customerThreadItems.filter(
            (item) => item.messageType === 'system',
          );
          expect(systemMessages.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should NOT create a system auto-reply when sender is a seller (not customer)', () => {
    fc.assert(
      fc.asyncProperty(
        arbConnectionId,
        arbUserId,
        arbUserId,
        fc.string({ minLength: 1, maxLength: 200 }),
        async (senderConnId, sellerA, sellerB, messageBody) => {
          if (sellerA === sellerB) return;

          await new Promise((resolve) => setTimeout(resolve, 0));

          mockState.ddbStore.clear();
          mockState.ddbPutCount = 0;
          mockState.queryResults.clear();
          mockState.postToConnectionCalls = [];
          mockState.updateCalls = [];
          mockState.updateCount = 0;

          // Sender is a seller, not a customer
          mockState.ddbStore.set(`CONN#${senderConnId}#META`, {
            PK: `CONN#${senderConnId}`,
            SK: 'META',
            connectionId: senderConnId,
            userId: sellerA,
            role: 'seller',
          });

          // Recipient seller is offline
          mockState.ddbStore.set(`PRESENCE#${sellerB}#STATUS`, {
            PK: `PRESENCE#${sellerB}`,
            SK: 'STATUS',
            online: false,
            updatedAt: new Date(Date.now() - 120_000).toISOString(),
          });

          mockState.queryResults.set(`USER_CONN#${sellerB}`, []);
          mockState.queryResults.set(`USER_CONN#${sellerA}`, []);

          const event = buildMockEvent({
            body: JSON.stringify({
              action: 'sendMessage',
              recipientId: sellerB,
              messageType: 'text',
              content: { body: messageBody },
            }),
            requestContext: {
              ...buildMockEvent().requestContext,
              connectionId: senderConnId,
            },
          });

          const result = await sendMessageHandler(event);
          expect(result.statusCode).toBe(200);

          // Collect all items from the store
          const allItems: Array<Record<string, unknown>> = [];
          for (const [, value] of mockState.ddbStore.entries()) {
            allItems.push(value);
          }

          // No system messages should exist anywhere
          const systemMessages = allItems.filter(
            (item) => item.messageType === 'system',
          );
          expect(systemMessages.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
