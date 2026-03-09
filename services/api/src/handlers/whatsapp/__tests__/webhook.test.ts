import { handler } from '../webhook';
import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';

const eventBridgeMock = mockClient(EventBridgeClient);
const dynamoDBMock = mockClient(DynamoDBClient);

jest.mock('../../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    environment: 'dev',
    region: 'ap-south-1',
    tableName: 'test-table',
    eventBusName: 'test-event-bus',
    userPoolId: 'test-pool',
    userPoolClientId: 'test-client',
    twilioAccountSid: 'ACtest123',
    twilioAuthToken: 'test-auth-token',
    twilioPhoneNumber: '+19472349399',
    razorpayKeyId: 'rzp_test',
    razorpayKeySecret: 'rzp_secret',
    razorpayWebhookSecret: 'rzp_webhook',
    geminiApiKey: 'gemini-key',
    grokApiKey: 'grok-key',
    productImagesBucket: 'test-images',
    documentsBucket: 'test-docs',
    logLevel: 'info',
  }),
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../core/metrics', () => ({
  publishLatencyMetric: jest.fn(),
  publishCountMetric: jest.fn(),
}));

jest.mock('twilio', () => ({ validateRequest: jest.fn().mockReturnValue(true) }));

jest.mock('../../../repositories/user-repository', () => ({
  UserRepository: jest.fn().mockImplementation(() => ({
    getUserByPhone: jest.fn().mockResolvedValue(null),
  })),
}));

function buildTwilioBody(p: Record<string, string>): string {
  return Object.entries(p).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

function buildPostEvent(body: string, overrides?: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/api/v1/whatsapp/webhook',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': 'test-sig',
      Host: 'example.com',
      'X-Forwarded-Proto': 'https',
      ...overrides?.headers,
    },
    body,
    isBase64Encoded: false,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    resource: '',
    requestContext: { requestId: 'test-request-id' } as any,
    ...overrides,
  } as APIGatewayProxyEvent;
}

describe('WhatsApp Webhook Handler (Twilio)', () => {
  beforeEach(() => {
    eventBridgeMock.reset();
    dynamoDBMock.reset();
    dynamoDBMock.on(PutItemCommand).resolves({});
    eventBridgeMock.on(PutEventsCommand).resolves({
      FailedEntryCount: 0,
      Entries: [{ EventId: 'evt-123' }],
    });
  });

  it('should return 405 for GET requests', async () => {
    const event = {
      httpMethod: 'GET',
      path: '/api/v1/whatsapp/webhook',
      headers: {},
      queryStringParameters: {},
      requestContext: { requestId: 'test-req' },
    } as unknown as APIGatewayProxyEvent;
    const result = await handler(event);
    expect(result.statusCode).toBe(405);
  });

  it('should process a valid text message and publish to EventBridge', async () => {
    const body = buildTwilioBody({
      MessageSid: 'SM123abc',
      From: 'whatsapp:+917001124396',
      To: 'whatsapp:+19472349399',
      Body: 'Hello',
      ProfileName: 'Test Customer',
      SmsStatus: 'received',
      NumMedia: '0',
    });
    const result = await handler(buildPostEvent(body));
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Content-Type']).toBe('text/xml');
    expect(result.body).toContain('<Response>');
    expect(result.body).toContain('<?xml');
    expect(eventBridgeMock.calls()).toHaveLength(1);
    const ebCall = eventBridgeMock.calls()[0].args[0] as any;
    const detail = JSON.parse(ebCall.input.Entries[0].Detail);
    expect(detail.source).toBe('twilio');
    expect(detail.payload.entry[0].changes[0].value.messages[0].from).toBe('+917001124396');
    expect(detail.payload.entry[0].changes[0].value.messages[0].text.body).toBe('Hello');
  });

  it('should return TwiML for empty body', async () => {
    const result = await handler(buildPostEvent('', { body: '' }));
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('<Response>');
    expect(eventBridgeMock.calls()).toHaveLength(0);
  });

  it('should return TwiML for null body', async () => {
    const result = await handler(buildPostEvent('', { body: null as any }));
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('<Response>');
    expect(eventBridgeMock.calls()).toHaveLength(0);
  });

  it('should handle image media messages', async () => {
    const body = buildTwilioBody({
      MessageSid: 'SM456def',
      From: 'whatsapp:+917001124396',
      To: 'whatsapp:+19472349399',
      Body: 'Check this product',
      ProfileName: 'Test Customer',
      SmsStatus: 'received',
      NumMedia: '1',
      MediaContentType0: 'image/jpeg',
      MediaUrl0: 'https://api.twilio.com/media/img123.jpg',
    });
    const result = await handler(buildPostEvent(body));
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('<Response>');
    expect(eventBridgeMock.calls()).toHaveLength(1);
    const ebCall = eventBridgeMock.calls()[0].args[0] as any;
    const detail = JSON.parse(ebCall.input.Entries[0].Detail);
    const msg = detail.payload.entry[0].changes[0].value.messages[0];
    expect(msg.type).toBe('image');
    expect(msg.image.url).toContain('img123.jpg');
    expect(msg.image.caption).toBe('Check this product');
  });

  it('should skip duplicate messages via idempotency check', async () => {
    const body = buildTwilioBody({
      MessageSid: 'SM789dup',
      From: 'whatsapp:+917001124396',
      To: 'whatsapp:+19472349399',
      Body: 'Duplicate test',
      ProfileName: 'Test',
      SmsStatus: 'received',
      NumMedia: '0',
    });
    const event = buildPostEvent(body);
    const result1 = await handler(event);
    expect(result1.statusCode).toBe(200);
    expect(eventBridgeMock.calls()).toHaveLength(1);

    dynamoDBMock.reset();
    dynamoDBMock.on(PutItemCommand).rejects(
      new ConditionalCheckFailedException({ message: 'Duplicate', $metadata: {} })
    );
    const result2 = await handler(event);
    expect(result2.statusCode).toBe(200);
    expect(result2.body).toContain('<Response>');
    expect(eventBridgeMock.calls()).toHaveLength(1);
  });

  it('should never return raw JSON in the response body', async () => {
    const body = buildTwilioBody({
      MessageSid: 'SM999json',
      From: 'whatsapp:+917001124396',
      To: 'whatsapp:+19472349399',
      Body: 'Test no JSON leak',
      ProfileName: 'Test',
      SmsStatus: 'received',
      NumMedia: '0',
    });
    const result = await handler(buildPostEvent(body));
    expect(result.body).not.toContain('"status"');
    expect(result.body).not.toContain('"received"');
    expect(result.body).toContain('<Response>');
  });
});
