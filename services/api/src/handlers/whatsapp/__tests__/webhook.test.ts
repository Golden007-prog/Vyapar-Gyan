import { handler } from '../webhook';
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import crypto from 'crypto';

const eventBridgeMock = mockClient(EventBridgeClient);

// Mock config
jest.mock('../../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    whatsappVerifyToken: 'test-verify-token',
    whatsappAppSecret: 'test-app-secret',
    eventBusName: 'test-event-bus',
  }),
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('WhatsApp Webhook Handler', () => {
  beforeEach(() => {
    eventBridgeMock.reset();
  });

  describe('GET - Webhook Verification', () => {
    it('should verify webhook with correct token', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/api/v1/whatsapp/webhook',
        queryStringParameters: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test-verify-token',
          'hub.challenge': 'test-challenge-123',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(result.body).toBe('test-challenge-123');
    });

    it('should reject webhook with incorrect token', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/api/v1/whatsapp/webhook',
        queryStringParameters: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': 'test-challenge-123',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(403);
    });
  });

  describe('POST - Incoming Webhook', () => {
    it('should process valid webhook and publish to EventBridge', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry-id',
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [
                    {
                      id: 'msg-123',
                      from: '919876543210',
                      type: 'text',
                      text: { body: 'Hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const body = JSON.stringify(payload);
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'test-app-secret')
        .update(body)
        .digest('hex');

      eventBridgeMock.on(PutEventsCommand).resolves({
        FailedEntryCount: 0,
        Entries: [{ EventId: 'event-123' }],
      });

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/api/v1/whatsapp/webhook',
        headers: {
          'x-hub-signature-256': signature,
        },
        body,
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).status).toBe('received');
      expect(eventBridgeMock.calls()).toHaveLength(1);
    });

    it('should reject webhook with invalid signature', async () => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [],
      };

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/api/v1/whatsapp/webhook',
        headers: {
          'x-hub-signature-256': 'sha256=invalid-signature',
        },
        body: JSON.stringify(payload),
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).status).toBe('invalid_signature');
      expect(eventBridgeMock.calls()).toHaveLength(0);
    });

    it('should ignore non-WhatsApp business account webhooks', async () => {
      const payload = {
        object: 'page',
        entry: [],
      };

      const body = JSON.stringify(payload);
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'test-app-secret')
        .update(body)
        .digest('hex');

      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/api/v1/whatsapp/webhook',
        headers: {
          'x-hub-signature-256': signature,
        },
        body,
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).status).toBe('ignored');
      expect(eventBridgeMock.calls()).toHaveLength(0);
    });
  });
});
