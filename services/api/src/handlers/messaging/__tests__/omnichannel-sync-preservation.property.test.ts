/**
 * Preservation Property Tests — Omnichannel Sync Fix
 *
 * Property 2: Preservation — Existing Behavior Unchanged
 *
 * These tests capture the CURRENT (unfixed) behavior that MUST be preserved
 * after the bug fix is applied. They run on UNFIXED code and PASS, confirming
 * the baseline behavior we need to protect.
 *
 * Preservation areas:
 *   1. WebSocket sendMessage dual-thread storage + WebSocket push
 *   2. WhatsApp worker putMessage() storage with correct fields
 *   3. seller-reply-handler handoff state management
 *   4. seller-reply-handler SellerReplySent event (backward compat)
 *   5. fanout filterOriginatingChannel no-echo behavior
 *   6. Connection Registry schema (connect/disconnect handlers)
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 */

import * as fc from 'fast-check';

// ── Generators ──────────────────────────────────────────────────────────

const userIdArb = fc.stringMatching(/^[a-z0-9]{8,36}$/);
const connectionIdArb = fc.stringMatching(/^[a-zA-Z0-9]{8,20}$/);
const messageContentArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0 && s.trim() !== '/ai');
const roleArb = fc.constantFrom('customer', 'seller', 'admin') as fc.Arbitrary<'customer' | 'seller' | 'admin'>;

// ============================================================================
// Preservation 1: WebSocket sendMessage dual-thread storage + push
// ============================================================================

describe('Preservation 1 — WebSocket sendMessage stores in dual threads and pushes to recipient', () => {
  /**
   * **Validates: Requirements 3.1, 3.3**
   *
   * For any valid sendMessage call, the handler MUST:
   * - Store the message in THREAD#{senderId} (outbound) and THREAD#{recipientId} (inbound)
   * - Push the message to recipient WebSocket connections via PostToConnectionCommand
   */
  it('stores messages in both sender and recipient threads', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        messageContentArb,
        connectionIdArb,
        async (senderId, recipientId, content, connectionId) => {
          // Skip when sender === recipient
          fc.pre(senderId !== recipientId);

          await new Promise<void>((resolve, reject) => {
            jest.isolateModules(async () => {
              try {
                const storedItems: any[] = [];
                const pushedConnections: string[] = [];

                jest.doMock('@aws-sdk/client-eventbridge', () => ({
                  EventBridgeClient: jest.fn().mockImplementation(() => ({
                    send: jest.fn().mockResolvedValue({}),
                  })),
                  PutEventsCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                }));

                jest.doMock('@aws-sdk/client-dynamodb', () => ({
                  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
                }));

                const mockDocSend = jest.fn().mockImplementation((cmd: any) => {
                  // PutCommand — capture stored items
                  if (cmd?.input?.Item?.PK?.startsWith('THREAD#')) {
                    storedItems.push({ ...cmd.input.Item });
                    return Promise.resolve({});
                  }
                  // GetCommand for CONN# (getUserIdForConnection)
                  if (cmd?.input?.Key?.PK?.startsWith('CONN#')) {
                    return Promise.resolve({
                      Item: { userId: senderId, role: 'customer' },
                    });
                  }
                  // QueryCommand for GSI1 (getConnectionsForUser)
                  if (cmd?.input?.IndexName === 'GSI1') {
                    const pk = cmd.input.ExpressionAttributeValues?.[':pk'];
                    if (pk === `USER_CONN#${recipientId}`) {
                      return Promise.resolve({
                        Items: [{ connectionId: 'recipient-conn-1' }],
                      });
                    }
                    return Promise.resolve({ Items: [] });
                  }
                  // GetCommand for PRESENCE#
                  if (cmd?.input?.Key?.PK?.startsWith('PRESENCE#')) {
                    return Promise.resolve({ Item: undefined });
                  }
                  return Promise.resolve({});
                });

                jest.doMock('@aws-sdk/lib-dynamodb', () => ({
                  DynamoDBDocumentClient: {
                    from: jest.fn().mockReturnValue({ send: mockDocSend }),
                  },
                  GetCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                  PutCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                  QueryCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                  DeleteCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                  UpdateCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                }));

                jest.doMock('@aws-sdk/client-apigatewaymanagementapi', () => ({
                  ApiGatewayManagementApiClient: jest.fn().mockImplementation(() => ({
                    send: jest.fn().mockImplementation((cmd: any) => {
                      if (cmd?.input?.ConnectionId) {
                        pushedConnections.push(cmd.input.ConnectionId);
                      }
                      return Promise.resolve({});
                    }),
                  })),
                  PostToConnectionCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                }));

                jest.doMock('../../../shared/websocket-schemas', () => ({
                  SendMessagePayloadSchema: {
                    safeParse: jest.fn().mockReturnValue({
                      success: true,
                      data: {
                        action: 'sendMessage',
                        recipientId,
                        messageType: 'text',
                        content: { body: content },
                      },
                    }),
                  },
                  contentSchemaByType: {
                    text: { safeParse: jest.fn().mockReturnValue({ success: true }) },
                  },
                }));

                jest.doMock('../../../utils/logger', () => ({
                  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
                }));

                process.env.TABLE_NAME = 'test-table';
                process.env.WEBSOCKET_API_ENDPOINT = 'https://test.execute-api.us-east-1.amazonaws.com/prod';

                const mod = require('../../websocket/send-message');

                await mod.handler({
                  requestContext: { connectionId },
                  body: JSON.stringify({
                    action: 'sendMessage',
                    recipientId,
                    messageType: 'text',
                    content: { body: content },
                  }),
                } as any);

                // Assert: dual-thread storage
                const senderThread = storedItems.filter((i) => i.PK === `THREAD#${senderId}`);
                const recipientThread = storedItems.filter((i) => i.PK === `THREAD#${recipientId}`);

                expect(senderThread.length).toBeGreaterThanOrEqual(1);
                expect(recipientThread.length).toBeGreaterThanOrEqual(1);

                // Verify directions
                expect(senderThread[0].direction).toBe('outbound');
                expect(recipientThread[0].direction).toBe('inbound');

                // Assert: pushed to recipient connections
                expect(pushedConnections).toContain('recipient-conn-1');

                resolve();
              } catch (err) {
                reject(err);
              }
            });
          });
        },
      ),
      { numRuns: 10 },
    );
  });
});


// ============================================================================
// Preservation 2: WhatsApp worker putMessage() storage with correct fields
// ============================================================================

describe('Preservation 2 — WhatsApp worker stores inbound messages with correct fields', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For any inbound WhatsApp customer message, the worker MUST store it in
   * THREAD#{userId} via putMessage() with direction='inbound', channel='whatsapp',
   * senderRole='customer'.
   */
  it('stores messages with direction=inbound, channel=whatsapp, senderRole=customer', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.stringMatching(/^[0-9]{10,15}$/),
        messageContentArb,
        async (userId, phoneNumber, content) => {
          await new Promise<void>((resolve, reject) => {
            jest.isolateModules(async () => {
              try {
                const storedMessages: any[] = [];

                jest.doMock('../../../adapters/dynamodb-adapter', () => ({
                  getUserByPhone: jest.fn().mockResolvedValue({
                    userId,
                    phoneNumber,
                    role: 'customer',
                    displayName: 'Test Customer',
                  }),
                  putMessage: jest.fn().mockImplementation((msg: any) => {
                    storedMessages.push({ ...msg });
                    return Promise.resolve();
                  }),
                  getSession: jest.fn().mockResolvedValue(null),
                  updateSessionIntent: jest.fn().mockResolvedValue(undefined),
                  updateSessionState: jest.fn().mockResolvedValue(undefined),
                }));

                jest.doMock('../../../services/session-service', () => ({
                  resolveOrCreateSession: jest.fn().mockResolvedValue({
                    session: {
                      state: 'greeting',
                      isHumanHandoff: false,
                      handoffExpiresAt: 0,
                      createdAt: new Date().toISOString(),
                      lastActivityAt: new Date().toISOString(),
                      expiresAt: Math.floor(Date.now() / 1000) + 3600,
                    },
                    isNew: true,
                    restoredCart: null,
                  }),
                  shouldBypassAI: jest.fn().mockReturnValue(false),
                }));

                jest.doMock('../../../services/consent-service', () => ({
                  recordInboundMessage: jest.fn().mockResolvedValue(undefined),
                  handleOptOut: jest.fn().mockResolvedValue(false),
                }));

                jest.doMock('../../../utils/logger', () => ({
                  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
                }));

                jest.doMock('../../../utils/idempotency', () => ({
                  idempotencyService: {
                    acquireLock: jest.fn().mockResolvedValue(true),
                  },
                }));

                jest.doMock('../../../repositories/customer-repository', () => ({
                  CustomerRepository: jest.fn().mockImplementation(() => ({
                    resolveOrCreate: jest.fn().mockResolvedValue({ id: userId }),
                  })),
                }));

                jest.doMock('../../../utils/config', () => ({
                  getConfig: jest.fn().mockResolvedValue({
                    twilioAccountSid: 'test',
                    twilioAuthToken: 'test',
                    eventBusName: 'test-bus',
                  }),
                  getVoicePipelineConfig: jest.fn().mockResolvedValue({}),
                }));

                jest.doMock('../../../services/whatsapp-sender', () => ({
                  whatsappSender: {
                    sendMessage: jest.fn().mockResolvedValue(undefined),
                  },
                }));

                jest.doMock('../../../core/metrics', () => ({
                  publishCountMetric: jest.fn(),
                  publishLatencyMetric: jest.fn(),
                }));

                // Mock customer discovery to prevent further routing
                jest.doMock('../../whatsapp/customer-discovery', () => ({
                  handleCustomerDiscovery: jest.fn().mockResolvedValue(undefined),
                }));

                jest.doMock('../../whatsapp/seller-copilot', () => ({
                  handleSellerCopilotMessage: jest.fn().mockResolvedValue('OK'),
                }));

                jest.doMock('../../whatsapp/states/router', () => ({
                  routeMessage: jest.fn().mockResolvedValue(undefined),
                }));

                jest.doMock('../../../services/intent-extraction', () => ({
                  extractAndRouteIntent: jest.fn().mockResolvedValue({
                    intent: { product: null, store: null, language: 'en' },
                    routing: { type: 'unknown' },
                  }),
                  isLikelyFinancialQuery: jest.fn().mockReturnValue(false),
                  LANGUAGE_NAMES: {},
                }));

                jest.doMock('../../../services/financial-query', () => ({
                  executeFinancialQuery: jest.fn(),
                  isLikelyFinancialQuery: jest.fn().mockReturnValue(false),
                  LANGUAGE_NAMES: {},
                }));

                jest.doMock('../../whatsapp/inventory-upload', () => ({
                  detectMediaType: jest.fn().mockReturnValue('unknown'),
                  handleInventoryUpload: jest.fn(),
                  commitInventory: jest.fn(),
                  applyInventoryEdit: jest.fn(),
                  parseInventoryEditCommand: jest.fn(),
                  formatInventoryList: jest.fn(),
                }));

                jest.doMock('@aws-sdk/client-s3', () => ({
                  S3Client: jest.fn().mockImplementation(() => ({})),
                  PutObjectCommand: jest.fn(),
                  GetObjectCommand: jest.fn(),
                }));

                jest.doMock('@aws-sdk/s3-request-presigner', () => ({
                  getSignedUrl: jest.fn(),
                }));

                jest.doMock('@aws-sdk/client-sqs', () => ({
                  SQSClient: jest.fn().mockImplementation(() => ({})),
                  SendMessageCommand: jest.fn(),
                }));

                jest.doMock('../../../adapters/gemini-adapter', () => ({
                  GeminiAdapter: jest.fn().mockImplementation(() => ({})),
                }));

                jest.doMock('../../../utils/whatsapp-sanitizer', () => ({
                  sanitizeForTTS: jest.fn((s: string) => s),
                }));

                const mod = require('../../whatsapp/worker');

                const sqsEvent = {
                  Records: [
                    {
                      messageId: 'sqs-msg-1',
                      body: JSON.stringify({
                        detail: {
                          requestId: 'test-req',
                          payload: {
                            entry: [
                              {
                                changes: [
                                  {
                                    field: 'messages',
                                    value: {
                                      messages: [
                                        {
                                          id: `msg-${userId.substring(0, 8)}`,
                                          from: phoneNumber,
                                          type: 'text',
                                          text: { body: content },
                                          timestamp: String(Math.floor(Date.now() / 1000)),
                                        },
                                      ],
                                      contacts: [
                                        {
                                          wa_id: phoneNumber,
                                          profile: { name: 'Test Customer' },
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            ],
                          },
                        },
                      }),
                    },
                  ],
                };

                await mod.handler(sqsEvent);

                // Assert: putMessage was called with correct fields
                expect(storedMessages.length).toBeGreaterThanOrEqual(1);
                const msg = storedMessages[0];
                expect(msg.userId).toBe(userId);
                expect(msg.direction).toBe('inbound');
                expect(msg.channel).toBe('whatsapp');
                expect(msg.senderRole).toBe('customer');

                resolve();
              } catch (err) {
                reject(err);
              }
            });
          });
        },
      ),
      { numRuns: 5 },
    );
  });
});


// ============================================================================
// Preservation 3: seller-reply-handler handoff state management
// ============================================================================

describe('Preservation 3 — seller-reply-handler manages handoff state correctly', () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * - /ai command → endHandoff is called
   * - Normal reply when no handoff → startHandoff is called
   * - Normal reply when handoff active → extendHandoff is called
   */
  it('/ai triggers endHandoff, normal reply triggers startHandoff or extendHandoff', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        fc.boolean(),
        async (sellerId, customerUserId, isHandoffActive) => {
          fc.pre(sellerId !== customerUserId);

          // Test /ai command
          await new Promise<void>((resolve, reject) => {
            jest.isolateModules(async () => {
              try {
                const endHandoffMock = jest.fn().mockResolvedValue(undefined);
                const startHandoffMock = jest.fn().mockResolvedValue(undefined);
                const extendHandoffMock = jest.fn().mockResolvedValue(undefined);

                jest.doMock('@aws-sdk/client-eventbridge', () => ({
                  EventBridgeClient: jest.fn().mockImplementation(() => ({
                    send: jest.fn().mockResolvedValue({}),
                  })),
                  PutEventsCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                }));

                jest.doMock('../../../adapters/dynamodb-adapter', () => ({
                  putMessage: jest.fn().mockResolvedValue(undefined),
                  getSession: jest.fn().mockResolvedValue({
                    isHumanHandoff: isHandoffActive,
                    handoffExpiresAt: isHandoffActive ? Date.now() + 600000 : 0,
                    state: 'greeting',
                  }),
                }));

                jest.doMock('../../../services/session-service', () => ({
                  startHandoff: startHandoffMock,
                  extendHandoff: extendHandoffMock,
                  endHandoff: endHandoffMock,
                  shouldBypassAI: jest.fn().mockReturnValue(isHandoffActive),
                }));

                jest.doMock('../../../core/auth', () => ({
                  extractUserId: jest.fn().mockReturnValue(sellerId),
                  UnauthorizedError: class UnauthorizedError extends Error {},
                }));

                jest.doMock('../../../utils/config', () => ({
                  getConfig: jest.fn().mockResolvedValue({ eventBusName: 'test-bus' }),
                }));

                jest.doMock('../../../utils/logger', () => ({
                  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
                }));

                const mod = require('../../seller/seller-reply-handler');

                // Test /ai command → endHandoff
                const aiEvent = {
                  requestContext: { requestId: 'test-req' },
                  pathParameters: { userId: customerUserId },
                  body: JSON.stringify({ content: '/ai' }),
                  headers: {},
                } as any;

                await mod.handler(aiEvent);
                expect(endHandoffMock).toHaveBeenCalledWith(customerUserId);

                resolve();
              } catch (err) {
                reject(err);
              }
            });
          });

          // Test normal reply → startHandoff or extendHandoff
          await new Promise<void>((resolve, reject) => {
            jest.isolateModules(async () => {
              try {
                const endHandoffMock = jest.fn().mockResolvedValue(undefined);
                const startHandoffMock = jest.fn().mockResolvedValue(undefined);
                const extendHandoffMock = jest.fn().mockResolvedValue(undefined);

                jest.doMock('@aws-sdk/client-eventbridge', () => ({
                  EventBridgeClient: jest.fn().mockImplementation(() => ({
                    send: jest.fn().mockResolvedValue({}),
                  })),
                  PutEventsCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                }));

                jest.doMock('../../../adapters/dynamodb-adapter', () => ({
                  putMessage: jest.fn().mockResolvedValue(undefined),
                  getSession: jest.fn().mockResolvedValue({
                    isHumanHandoff: isHandoffActive,
                    handoffExpiresAt: isHandoffActive ? Date.now() + 600000 : 0,
                    state: 'greeting',
                  }),
                }));

                jest.doMock('../../../services/session-service', () => ({
                  startHandoff: startHandoffMock,
                  extendHandoff: extendHandoffMock,
                  endHandoff: endHandoffMock,
                  shouldBypassAI: jest.fn().mockReturnValue(isHandoffActive),
                }));

                jest.doMock('../../../core/auth', () => ({
                  extractUserId: jest.fn().mockReturnValue(sellerId),
                  UnauthorizedError: class UnauthorizedError extends Error {},
                }));

                jest.doMock('../../../utils/config', () => ({
                  getConfig: jest.fn().mockResolvedValue({ eventBusName: 'test-bus' }),
                }));

                jest.doMock('../../../utils/logger', () => ({
                  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
                }));

                const mod = require('../../seller/seller-reply-handler');

                const normalEvent = {
                  requestContext: { requestId: 'test-req' },
                  pathParameters: { userId: customerUserId },
                  body: JSON.stringify({ content: 'Your order is ready' }),
                  headers: {},
                } as any;

                await mod.handler(normalEvent);

                // endHandoff should NOT be called for normal replies
                expect(endHandoffMock).not.toHaveBeenCalled();

                // Either startHandoff or extendHandoff should be called
                if (isHandoffActive) {
                  expect(extendHandoffMock).toHaveBeenCalledWith(customerUserId);
                } else {
                  expect(startHandoffMock).toHaveBeenCalledWith(customerUserId, sellerId);
                }

                resolve();
              } catch (err) {
                reject(err);
              }
            });
          });
        },
      ),
      { numRuns: 5 },
    );
  });
});


// ============================================================================
// Preservation 4: seller-reply-handler publishes SellerReplySent event
// ============================================================================

describe('Preservation 4 — seller-reply-handler publishes SellerReplySent event', () => {
  /**
   * **Validates: Requirements 3.5, 3.7**
   *
   * For any valid seller reply, the handler MUST publish a SellerReplySent event
   * with source 'vyapargyan.chat' for backward compatibility with notification-router.
   */
  it('publishes SellerReplySent event with source vyapargyan.chat', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        messageContentArb,
        async (sellerId, customerUserId, content) => {
          fc.pre(sellerId !== customerUserId);

          await new Promise<void>((resolve, reject) => {
            jest.isolateModules(async () => {
              try {
                const capturedEvents: any[] = [];

                jest.doMock('@aws-sdk/client-eventbridge', () => ({
                  EventBridgeClient: jest.fn().mockImplementation(() => ({
                    send: jest.fn().mockImplementation((cmd: any) => {
                      if (cmd?.input?.Entries) {
                        capturedEvents.push(...cmd.input.Entries);
                      }
                      return Promise.resolve({});
                    }),
                  })),
                  PutEventsCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                }));

                jest.doMock('../../../adapters/dynamodb-adapter', () => ({
                  putMessage: jest.fn().mockResolvedValue(undefined),
                  getSession: jest.fn().mockResolvedValue({
                    isHumanHandoff: false,
                    handoffExpiresAt: 0,
                    state: 'greeting',
                  }),
                }));

                jest.doMock('../../../services/session-service', () => ({
                  startHandoff: jest.fn().mockResolvedValue(undefined),
                  extendHandoff: jest.fn().mockResolvedValue(undefined),
                  endHandoff: jest.fn().mockResolvedValue(undefined),
                  shouldBypassAI: jest.fn().mockReturnValue(false),
                }));

                jest.doMock('../../../core/auth', () => ({
                  extractUserId: jest.fn().mockReturnValue(sellerId),
                  UnauthorizedError: class UnauthorizedError extends Error {},
                }));

                jest.doMock('../../../utils/config', () => ({
                  getConfig: jest.fn().mockResolvedValue({ eventBusName: 'test-bus' }),
                }));

                jest.doMock('../../../utils/logger', () => ({
                  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
                }));

                const mod = require('../../seller/seller-reply-handler');

                const event = {
                  requestContext: { requestId: 'test-req' },
                  pathParameters: { userId: customerUserId },
                  body: JSON.stringify({ content }),
                  headers: {},
                } as any;

                await mod.handler(event);

                // Assert: SellerReplySent event with source vyapargyan.chat
                const sellerReplySentEvents = capturedEvents.filter(
                  (e: any) =>
                    e.Source === 'vyapargyan.chat' &&
                    e.DetailType === 'SellerReplySent',
                );

                expect(sellerReplySentEvents.length).toBeGreaterThanOrEqual(1);

                // Verify event detail contains expected fields
                const detail = JSON.parse(sellerReplySentEvents[0].Detail);
                expect(detail.sellerId).toBe(sellerId);
                expect(detail.userId).toBe(customerUserId);
                expect(detail.channel).toBe('web');

                resolve();
              } catch (err) {
                reject(err);
              }
            });
          });
        },
      ),
      { numRuns: 10 },
    );
  });
});


// ============================================================================
// Preservation 5: filterOriginatingChannel no-echo behavior
// ============================================================================

describe('Preservation 5 — filterOriginatingChannel filters out originating channel', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * filterOriginatingChannel() MUST remove the originating channel from the
   * active channels list to prevent echo (duplicate delivery on same channel).
   */
  it('removes originating channel from active channels list', () => {
    // Import directly — this is a pure function, no mocking needed
    const { filterOriginatingChannel } = require('../../messaging/fanout');

    fc.assert(
      fc.property(
        fc.subarray(['web', 'whatsapp'] as const, { minLength: 0, maxLength: 2 }),
        fc.constantFrom('web', 'whatsapp'),
        (activeChannels, originatingChannel) => {
          const result = filterOriginatingChannel(activeChannels, originatingChannel);

          // The originating channel must NOT be in the result
          expect(result).not.toContain(originatingChannel);

          // All non-originating channels must still be present
          const expectedChannels = activeChannels.filter((ch) => ch !== originatingChannel);
          expect(result).toEqual(expectedChannels);

          // Result length must be <= input length
          expect(result.length).toBeLessThanOrEqual(activeChannels.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('returns all channels when originating channel is not in the list', () => {
    const { filterOriginatingChannel } = require('../../messaging/fanout');

    fc.assert(
      fc.property(
        fc.subarray(['web', 'whatsapp'] as const, { minLength: 0, maxLength: 2 }),
        (activeChannels) => {
          // Use 'system' as originating — never in the active channels list
          const result = filterOriginatingChannel(activeChannels, 'system');
          expect(result).toEqual(activeChannels);
        },
      ),
      { numRuns: 20 },
    );
  });
});


// ============================================================================
// Preservation 6: Connection Registry schema unchanged by connect/disconnect
// ============================================================================

describe('Preservation 6 — Connection Registry schema uses CONN# PK and USER_CONN# GSI1PK', () => {
  /**
   * **Validates: Requirements 3.6**
   *
   * The connect handler MUST store Connection Registry items with:
   *   PK = CONN#{connectionId}, SK = META
   *   GSI1PK = USER_CONN#{userId}, GSI1SK = CONN#{connectionId}
   *
   * The disconnect handler MUST:
   *   - Read from PK = CONN#{connectionId}, SK = META
   *   - Delete from PK = CONN#{connectionId}, SK = META
   *   - Query GSI1 with GSI1PK = USER_CONN#{userId} for remaining connections
   */
  it('connect handler stores items with correct PK=CONN# and GSI1PK=USER_CONN# schema', async () => {
    /**
     * We verify the Connection Registry schema by reading the connect handler
     * source and the buildConnectionRegistryItem function source to confirm
     * the key patterns: PK=CONN#{connectionId}, SK=META, GSI1PK=USER_CONN#{userId}.
     */
    await fc.assert(
      fc.asyncProperty(
        connectionIdArb,
        userIdArb,
        async (connectionId, userId) => {
          const fs = require('fs');
          const path = require('path');

          // Read connect handler source
          const connectPath = path.resolve(__dirname, '../../websocket/connect.ts');
          const connectSource = fs.readFileSync(connectPath, 'utf-8');

          // Assert: connect handler uses buildConnectionRegistryItem
          expect(connectSource).toContain('buildConnectionRegistryItem');

          // Assert: connect handler stores via PutCommand
          expect(connectSource).toContain('PutCommand');

          // Read the schema builder source
          const schemaPath = path.resolve(__dirname, '../../../shared/websocket-schemas.ts');
          const schemaSource = fs.readFileSync(schemaPath, 'utf-8');

          // Assert: schema uses CONN# prefix for PK
          expect(schemaSource).toContain('`CONN#${params.connectionId}`');

          // Assert: schema uses META for SK
          expect(schemaSource).toContain("SK: 'META'");

          // Assert: schema uses USER_CONN# prefix for GSI1PK
          expect(schemaSource).toContain('`USER_CONN#${params.userId}`');

          // Assert: schema uses CONN# prefix for GSI1SK
          expect(schemaSource).toContain('`CONN#${params.connectionId}`');
        },
      ),
      { numRuns: 3 },
    );
  });

  it('disconnect handler reads and deletes CONN# items and queries GSI1 USER_CONN#', async () => {
    /**
     * We verify the disconnect handler uses the correct key patterns by
     * reading the source code and confirming the DynamoDB key patterns.
     * This is a static analysis approach that avoids complex module-level mocking.
     */
    await fc.assert(
      fc.asyncProperty(
        connectionIdArb,
        userIdArb,
        async (connectionId, userId) => {
          const fs = require('fs');
          const path = require('path');
          const disconnectPath = path.resolve(__dirname, '../../websocket/disconnect.ts');
          const source = fs.readFileSync(disconnectPath, 'utf-8');

          // Assert: disconnect handler reads from CONN#{connectionId} PK
          expect(source).toContain('`CONN#${connectionId}`');

          // Assert: disconnect handler uses SK = 'META'
          expect(source).toContain("SK: 'META'");

          // Assert: disconnect handler queries GSI1 with USER_CONN# prefix
          expect(source).toContain("IndexName: 'GSI1'");
          expect(source).toContain('`USER_CONN#${userId}`');

          // Assert: disconnect handler deletes CONN# items
          expect(source).toContain('DeleteCommand');
        },
      ),
      { numRuns: 3 },
    );
  });
});
