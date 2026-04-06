/**
 * Bug Condition Exploration Property Test — Omnichannel Sync Fix
 *
 * Property 1: Bug Condition — Cross-Channel Message Delivery Broken
 *
 * This test encodes the EXPECTED (correct) behavior for all 5 defects.
 * On UNFIXED code, these tests FAIL — confirming the bugs exist.
 * After the fix is applied, these tests PASS — confirming the bugs are resolved.
 *
 * Defects tested:
 *   1. seller-reply-handler: no message.created event published
 *   2. WebSocket sendMessage: no EventBridge call
 *   3. WhatsApp worker: no EventBridge event after putMessage()
 *   4. fanout GSI1 query: queries wrong key pattern
 *   5. fanout missing env var: WEBSOCKET_API_ENDPOINT not set
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 */

import * as fc from 'fast-check';

// ── Generators ──────────────────────────────────────────────────────────

/** Generate a valid userId (alphanumeric, 8-36 chars). */
const userIdArb = fc.stringMatching(/^[a-z0-9]{8,36}$/);

/** Generate a valid connectionId (alphanumeric, 8-20 chars). */
const connectionIdArb = fc.stringMatching(/^[a-zA-Z0-9]{8,20}$/);

/** Generate a non-empty message content string (1-200 chars, no /ai command). */
const messageContentArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0 && s.trim() !== '/ai');

// ============================================================================
// Defect 1: seller-reply-handler does NOT publish message.created
// ============================================================================

describe('Defect 1 — seller-reply-handler missing message.created event', () => {
  /**
   * **Validates: Requirement 1.1**
   *
   * For any valid seller reply (non-/ai content), the handler SHOULD publish
   * a message.created event with source 'vyapargyan.messaging'.
   * On UNFIXED code, only SellerReplySent (source: vyapargyan.chat) is published.
   */
  it('should publish message.created event for seller replies', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        messageContentArb,
        async (sellerId, customerUserId, content) => {
          // Use isolateModules to get fresh mocks per property run
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
                  requestContext: { requestId: 'test-req-1' },
                  pathParameters: { userId: customerUserId },
                  body: JSON.stringify({ content }),
                  headers: {},
                } as any;

                await mod.handler(event);

                // Assert: a message.created event with source vyapargyan.messaging must exist
                const messageCreatedEvents = capturedEvents.filter(
                  (e: any) =>
                    e.Source === 'vyapargyan.messaging' &&
                    e.DetailType === 'message.created',
                );

                expect(messageCreatedEvents.length).toBeGreaterThanOrEqual(1);
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
// Defect 2: WebSocket sendMessage does NOT publish to EventBridge
// ============================================================================

describe('Defect 2 — WebSocket sendMessage missing EventBridge publication', () => {
  /**
   * **Validates: Requirement 1.2**
   *
   * For any valid sendMessage call, the handler SHOULD call PutEventsCommand
   * with a message.created event. On UNFIXED code, no EventBridge call is made.
   */
  it('should publish message.created event after dual-thread store', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        userIdArb,
        messageContentArb,
        connectionIdArb,
        async (senderId, recipientId, content, connectionId) => {
          await new Promise<void>((resolve, reject) => {
            jest.isolateModules(async () => {
              try {
                let eventBridgeCalled = false;

                jest.doMock('@aws-sdk/client-eventbridge', () => ({
                  EventBridgeClient: jest.fn().mockImplementation(() => ({
                    send: jest.fn().mockImplementation(() => {
                      eventBridgeCalled = true;
                      return Promise.resolve({});
                    }),
                  })),
                  PutEventsCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                }));

                jest.doMock('@aws-sdk/client-dynamodb', () => ({
                  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
                }));

                const mockDocSend = jest.fn().mockImplementation((cmd: any) => {
                  // GetCommand for getUserIdForConnection
                  if (cmd?.input?.Key?.PK?.startsWith('CONN#')) {
                    return Promise.resolve({
                      Item: { userId: senderId, role: 'customer' },
                    });
                  }
                  // QueryCommand for getConnectionsForUser (GSI1)
                  if (cmd?.input?.IndexName === 'GSI1') {
                    return Promise.resolve({ Items: [] });
                  }
                  // GetCommand for presence
                  if (cmd?.input?.Key?.PK?.startsWith('PRESENCE#')) {
                    return Promise.resolve({ Item: undefined });
                  }
                  // PutCommand / UpdateCommand
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
                    send: jest.fn().mockResolvedValue({}),
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
                process.env.EVENT_BUS_NAME = 'test-event-bus';

                const mod = require('../../websocket/send-message');

                const event = {
                  requestContext: { connectionId },
                  body: JSON.stringify({
                    action: 'sendMessage',
                    recipientId,
                    messageType: 'text',
                    content: { body: content },
                  }),
                } as any;

                await mod.handler(event);

                // Assert: EventBridge must have been called
                expect(eventBridgeCalled).toBe(true);
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
// Defect 3: WhatsApp worker does NOT publish message.created after putMessage
// ============================================================================

describe('Defect 3 — WhatsApp worker missing EventBridge event after putMessage', () => {
  /**
   * **Validates: Requirement 1.3**
   *
   * After putMessage() stores a customer WhatsApp message, the worker SHOULD
   * publish a message.created event to EventBridge. On UNFIXED code, no event
   * is published — the worker calls putMessage() directly without EventBridge.
   *
   * We verify this by checking that the worker module does NOT import or use
   * EventBridgeClient / PutEventsCommand. This is a static code analysis test
   * that confirms the defect at the source level.
   */
  it('should publish message.created after storing customer WhatsApp message', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (userId) => {
        // Read the worker source to verify it does NOT import EventBridgeClient
        const fs = require('fs');
        const path = require('path');
        const workerPath = path.resolve(
          __dirname,
          '../../whatsapp/worker.ts',
        );
        const workerSource = fs.readFileSync(workerPath, 'utf-8');

        // The worker SHOULD import EventBridgeClient for publishing message.created
        // On UNFIXED code, it does NOT import EventBridgeClient
        const hasEventBridgeImport =
          workerSource.includes('EventBridgeClient') ||
          workerSource.includes('client-eventbridge');

        // The worker SHOULD call PutEventsCommand after putMessage
        const hasPutEventsCommand = workerSource.includes('PutEventsCommand');

        // On UNFIXED code, both should be false — confirming defect 3
        expect(hasEventBridgeImport).toBe(true);
        expect(hasPutEventsCommand).toBe(true);
      }),
      { numRuns: 3 },
    );
  });
});

// ============================================================================
// Defect 4: fanout queries wrong DynamoDB key pattern (CONNECTION# vs GSI1)
// ============================================================================

describe('Defect 4 — fanout GSI1 query uses wrong key pattern', () => {
  /**
   * **Validates: Requirement 1.4**
   *
   * getActiveChannels() SHOULD query GSI1 with GSI1PK = USER_CONN#{userId}.
   * On UNFIXED code, it queries PK = CONNECTION#{userId} (wrong key pattern),
   * which always returns 0 results because connections are stored as
   * PK = CONN#{connectionId} with GSI1PK = USER_CONN#{userId}.
   */
  it('should query GSI1 with USER_CONN#{userId} for WebSocket connections', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        connectionIdArb,
        async (userId, connectionId) => {
          await new Promise<void>((resolve, reject) => {
            jest.isolateModules(async () => {
              try {
                const queriedParams: any[] = [];

                jest.doMock('@aws-sdk/client-dynamodb', () => ({
                  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
                }));

                jest.doMock('@aws-sdk/lib-dynamodb', () => ({
                  DynamoDBDocumentClient: {
                    from: jest.fn().mockReturnValue({
                      send: jest.fn().mockImplementation((cmd: any) => {
                        if (cmd?.input?.KeyConditionExpression) {
                          queriedParams.push({ ...cmd.input });
                        }
                        // Return a connection when queried via GSI1 correctly
                        if (
                          cmd?.input?.IndexName === 'GSI1' &&
                          cmd?.input?.ExpressionAttributeValues?.[':pk'] ===
                            `USER_CONN#${userId}`
                        ) {
                          return Promise.resolve({
                            Items: [{ connectionId, userId }],
                          });
                        }
                        // Return empty for wrong key pattern or other queries
                        return Promise.resolve({ Items: [], Item: null });
                      }),
                    }),
                  },
                  QueryCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                  GetCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                }));

                jest.doMock('@aws-sdk/client-apigatewaymanagementapi', () => ({
                  ApiGatewayManagementApiClient: jest.fn().mockImplementation(() => ({
                    send: jest.fn().mockResolvedValue({}),
                  })),
                  PostToConnectionCommand: jest.fn().mockImplementation((input: any) => ({ input })),
                }));

                jest.doMock('../../../utils/logger', () => ({
                  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
                }));

                jest.doMock('../../../adapters/dynamodb-adapter', () => ({
                  getUserProfile: jest.fn().mockResolvedValue(null),
                }));

                jest.doMock('../../../adapters/twilio-adapter', () => ({
                  twilioAdapter: {
                    sendWhatsAppMessage: jest.fn().mockResolvedValue(undefined),
                  },
                }));

                const { getActiveChannels } = require('../../messaging/fanout');

                const channels = await getActiveChannels(userId, 'test-table');

                // Assert: at least one query must use GSI1 with USER_CONN# prefix
                const gsi1Queries = queriedParams.filter(
                  (p: any) =>
                    p.IndexName === 'GSI1' &&
                    p.ExpressionAttributeValues?.[':pk'] ===
                      `USER_CONN#${userId}`,
                );

                expect(gsi1Queries.length).toBeGreaterThanOrEqual(1);
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
// Defect 5: fanout missing WEBSOCKET_API_ENDPOINT env var
// ============================================================================

describe('Defect 5 — fanout missing WEBSOCKET_API_ENDPOINT env var', () => {
  /**
   * **Validates: Requirement 1.5**
   *
   * The events-stack CDK does NOT pass WEBSOCKET_API_ENDPOINT to the fan-out
   * Lambda. We verify this by reading the CDK source and confirming the env
   * var is absent from the messageFanoutFunction environment block.
   */
  it('should confirm WEBSOCKET_API_ENDPOINT is missing from fanout Lambda CDK env', async () => {
    await fc.assert(
      fc.asyncProperty(userIdArb, async (_userId) => {
        const fs = require('fs');
        const path = require('path');

        // Read the events-stack CDK source
        const eventsStackPath = path.resolve(
          __dirname,
          '../../../../../../infra/cdk/lib/stacks/events-stack.ts',
        );
        const eventsStackSource = fs.readFileSync(eventsStackPath, 'utf-8');

        // Find the messageFanoutFunction environment block
        // The CDK code defines: this.messageFanoutFunction = new Function(...)
        // with an environment: { ... } block
        const fanoutFnMatch = eventsStackSource.match(
          /messageFanoutFunction\s*=\s*new\s+Function\s*\([^)]*\)\s*,\s*\{[\s\S]*?environment\s*:\s*\{([\s\S]*?)\}/,
        );

        // The environment block SHOULD contain WEBSOCKET_API_ENDPOINT
        // On UNFIXED code, it does NOT — confirming defect 5
        const envBlock = fanoutFnMatch?.[1] ?? '';
        const hasWebSocketEndpoint = envBlock.includes('WEBSOCKET_API_ENDPOINT');

        expect(hasWebSocketEndpoint).toBe(true);
      }),
      { numRuns: 3 },
    );
  });
});
