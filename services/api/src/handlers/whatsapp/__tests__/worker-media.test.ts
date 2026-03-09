import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { SQSEvent } from 'aws-lambda';

const s3Mock = mockClient(S3Client);
const sqsMock = mockClient(SQSClient);

// Track whatsappSender calls
const mockSendMessage = jest.fn().mockResolvedValue('msg-sid');

// Mock whatsapp-sender — must be before importing handler
jest.mock('../../../services/whatsapp-sender', () => ({
  whatsappSender: { sendMessage: (...args: any[]) => mockSendMessage(...args) },
}));

// Mock config
jest.mock('../../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    twilioAccountSid: 'AC_TEST_SID',
    twilioAuthToken: 'test_auth_token',
    productImagesBucket: 'test-media-bucket',
    eventBusName: 'test-event-bus',
    tableName: 'test-table',
  }),
}));

// Mock logger
jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock idempotency
jest.mock('../../../utils/idempotency', () => ({
  idempotencyService: {
    acquireLock: jest.fn().mockResolvedValue(true),
  },
}));

// Mock DynamoDB adapter
const mockGetUserByPhone = jest.fn().mockResolvedValue({
  userId: 'user-123',
  role: 'customer',
  displayName: 'Test Customer',
  phoneNumber: '919876543210',
});
jest.mock('../../../adapters/dynamodb-adapter', () => ({
  getUserByPhone: (...args: any[]) => mockGetUserByPhone(...args),
  putMessage: jest.fn().mockResolvedValue(undefined),
}));

// Mock session service
jest.mock('../../../services/session-service', () => ({
  resolveOrCreateSession: jest.fn().mockResolvedValue({
    session: {
      state: 'browsing',
      createdAt: '2025-01-01T00:00:00.000Z',
      lastActivityAt: '2025-01-01T00:00:00.000Z',
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
    },
    isNew: false,
    restoredCart: null,
  }),
}));

// Mock consent service
jest.mock('../../../services/consent-service', () => ({
  recordInboundMessage: jest.fn().mockResolvedValue(undefined),
  handleOptOut: jest.fn().mockResolvedValue(false),
}));

// Mock customer repository
jest.mock('../../../repositories/customer-repository', () => ({
  CustomerRepository: jest.fn().mockImplementation(() => ({
    resolveOrCreate: jest.fn().mockResolvedValue({ id: 'user-123' }),
  })),
}));

// Mock router to prevent unrelated errors on text messages
jest.mock('../states/router', () => ({
  routeMessage: jest.fn().mockResolvedValue(undefined),
}));

// Mock Gemini adapter for voice pipeline transcription and TTS
const mockTranscribeVoiceNote = jest.fn().mockResolvedValue({
  transcript: 'Hello I want to buy something',
  detectedLanguage: 'English',
  confidence: 85,
  products: [],
});
const mockTextToSpeech = jest.fn().mockResolvedValue(Buffer.from('fake-tts-audio'));
jest.mock('../../../adapters/gemini-adapter', () => ({
  GeminiAdapter: jest.fn().mockImplementation(() => ({
    transcribeVoiceNote: (...args: any[]) => mockTranscribeVoiceNote(...args),
    textToSpeech: (...args: any[]) => mockTextToSpeech(...args),
  })),
}));

// Mock @aws-sdk/s3-request-presigner for pre-signed URL generation
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.amazonaws.com/test-media-bucket/voice/outbound/presigned-url'),
}));

// Mock global fetch for Twilio media download
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// Environment variables
process.env.MEDIA_PROCESSING_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/test-media-queue';
process.env.TWILIO_ACCOUNT_SID = 'AC_TEST_SID';

// Import handler AFTER all mocks are set up
import { handler } from '../worker';

/**
 * Helper to build an SQS event wrapping a WhatsApp message via EventBridge.
 */
function buildSQSEvent(message: any): SQSEvent {
  const eventBridgePayload = {
    detail: {
      requestId: 'req-test-123',
      payload: {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  messages: [message],
                  contacts: [
                    { wa_id: message.from, profile: { name: 'Test User' } },
                  ],
                },
              },
            ],
          },
        ],
      },
    },
  };

  return {
    Records: [
      {
        messageId: 'sqs-msg-1',
        body: JSON.stringify(eventBridgePayload),
        receiptHandle: 'handle-1',
        attributes: {} as any,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test-queue',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

describe('WhatsApp Worker — Media Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    s3Mock.reset();
    sqsMock.reset();
    s3Mock.on(PutObjectCommand).resolves({});
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'sqs-out-1' });
  });

  describe('Voice Note Detection — Inline Pipeline', () => {
    it('should download audio, store inbound in S3, transcribe, and route through voice pipeline', async () => {
      const audioBuffer = Buffer.from('fake-ogg-audio-data');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => name === 'content-type' ? 'audio/ogg' : null },
        arrayBuffer: () => Promise.resolve(audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength)),
      });

      const event = buildSQSEvent({
        id: 'wamid.voice-1',
        from: '919876543210',
        type: 'audio',
        timestamp: '1700000000',
        audio: { id: 'media-audio-id', url: 'https://api.twilio.com/media/audio-123', mime_type: 'audio/ogg' },
      });

      await handler(event);

      // Should download audio from Twilio
      expect(mockFetch).toHaveBeenCalled();

      // Should store inbound audio in S3 under voice/inbound/ prefix
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls.length).toBeGreaterThanOrEqual(1);
      const inboundCall = s3Calls.find(c => c.args[0].input.Key?.startsWith('voice/inbound/'));
      expect(inboundCall).toBeTruthy();
      expect(inboundCall!.args[0].input.Bucket).toBe('test-media-bucket');
      expect(inboundCall!.args[0].input.Key).toMatch(/^voice\/inbound\/user-123\/\d+\.ogg$/);
      expect(inboundCall!.args[0].input.ContentType).toBe('audio/ogg');

      // Should call Gemini transcription
      expect(mockTranscribeVoiceNote).toHaveBeenCalledWith(
        expect.any(Buffer),
        'auto',
        [],
      );

      // Should NOT publish to SQS media queue (inline processing, no offload)
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    });

    it('should send fallback message when media download fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const event = buildSQSEvent({
        id: 'wamid.voice-fail',
        from: '919876543210',
        type: 'audio',
        timestamp: '1700000000',
        audio: { url: 'https://api.twilio.com/media/audio-fail' },
      });

      await handler(event);

      // Should send download-failure fallback
      const fallbackCall = mockSendMessage.mock.calls.find(
        (call: any[]) => typeof call[1]?.text === 'string' && call[1].text.includes("couldn't process that voice note")
      );
      expect(fallbackCall).toBeTruthy();

      // Should NOT upload to S3 or call transcription
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
      expect(mockTranscribeVoiceNote).not.toHaveBeenCalled();
    });
  });

  describe('Image Detection (Task 17.2)', () => {
    it('should download image, store in S3, and publish ImageSearchRequested to SQS', async () => {
      const imageBuffer = Buffer.alloc(1024, 0xff);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => name === 'content-type' ? 'image/jpeg' : null },
        arrayBuffer: () => Promise.resolve(imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength)),
      });

      const event = buildSQSEvent({
        id: 'wamid.img-1',
        from: '919876543210',
        type: 'image',
        timestamp: '1700000000',
        image: { id: 'media-img-id', url: 'https://api.twilio.com/media/img-123', mime_type: 'image/jpeg' },
      });

      await handler(event);

      // Should send processing acknowledgment
      expect(mockSendMessage).toHaveBeenCalledWith(
        '919876543210',
        { type: 'text', text: '🔄 Processing your image...' },
        expect.stringContaining('media-ack-'),
      );

      // Should upload to S3 with correct key pattern
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(1);
      const s3Input = s3Calls[0].args[0].input;
      expect(s3Input.Bucket).toBe('test-media-bucket');
      expect(s3Input.Key).toMatch(/^image-search\/user-123\/\d+\.jpg$/);
      expect(s3Input.ContentType).toBe('image/jpeg');

      // Should publish to SQS media queue
      const sqsCalls = sqsMock.commandCalls(SendMessageCommand);
      expect(sqsCalls).toHaveLength(1);
      const sqsBody = JSON.parse(sqsCalls[0].args[0].input.MessageBody!);
      expect(sqsBody.mediaType).toBe('image_search');
      expect(sqsBody.userId).toBe('user-123');
      expect(sqsBody.s3Key).toMatch(/^image-search\/user-123\/\d+\.jpg$/);
      expect(sqsBody.mimeType).toBe('image/jpeg');
      expect(sqsBody.channel).toBe('whatsapp');
    });

    it('should reject unsupported image formats', async () => {
      const gifBuffer = Buffer.alloc(512);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => name === 'content-type' ? 'image/gif' : null },
        arrayBuffer: () => Promise.resolve(gifBuffer.buffer.slice(gifBuffer.byteOffset, gifBuffer.byteOffset + gifBuffer.byteLength)),
      });

      const event = buildSQSEvent({
        id: 'wamid.img-gif',
        from: '919876543210',
        type: 'image',
        timestamp: '1700000000',
        image: { url: 'https://api.twilio.com/media/img-gif', mime_type: 'image/gif' },
      });

      await handler(event);

      // Should send format error message
      const formatCall = mockSendMessage.mock.calls.find(
        (call: any[]) => typeof call[1]?.text === 'string' && call[1].text.includes('Unsupported image format')
      );
      expect(formatCall).toBeTruthy();

      // Should NOT upload to S3 or publish to SQS
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    });

    it('should reject images larger than 5MB', async () => {
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => name === 'content-type' ? 'image/png' : null },
        arrayBuffer: () => Promise.resolve(largeBuffer.buffer.slice(largeBuffer.byteOffset, largeBuffer.byteOffset + largeBuffer.byteLength)),
      });

      const event = buildSQSEvent({
        id: 'wamid.img-large',
        from: '919876543210',
        type: 'image',
        timestamp: '1700000000',
        image: { url: 'https://api.twilio.com/media/img-large', mime_type: 'image/png' },
      });

      await handler(event);

      // Should send size error message
      const sizeCall = mockSendMessage.mock.calls.find(
        (call: any[]) => typeof call[1]?.text === 'string' && call[1].text.includes('too large')
      );
      expect(sizeCall).toBeTruthy();

      // Should NOT upload to S3 or publish to SQS
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    });

    it('should accept WebP images with correct extension', async () => {
      const webpBuffer = Buffer.alloc(2048);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: (name: string) => name === 'content-type' ? 'image/webp' : null },
        arrayBuffer: () => Promise.resolve(webpBuffer.buffer.slice(webpBuffer.byteOffset, webpBuffer.byteOffset + webpBuffer.byteLength)),
      });

      const event = buildSQSEvent({
        id: 'wamid.img-webp',
        from: '919876543210',
        type: 'image',
        timestamp: '1700000000',
        image: { url: 'https://api.twilio.com/media/img-webp', mime_type: 'image/webp' },
      });

      await handler(event);

      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(1);
      expect(s3Calls[0].args[0].input.Key).toMatch(/\.webp$/);
    });
  });

  describe('Text messages still route normally', () => {
    it('should not trigger media handling for text messages', async () => {
      const event = buildSQSEvent({
        id: 'wamid.text-1',
        from: '919876543210',
        type: 'text',
        timestamp: '1700000000',
        text: { body: 'Hello, I want to buy something' },
      });

      await handler(event);

      // Should NOT send media processing acknowledgment
      const mediaAckCall = mockSendMessage.mock.calls.find(
        (call: any[]) => typeof call[1]?.text === 'string' && call[1].text.includes('Processing your')
      );
      expect(mediaAckCall).toBeUndefined();

      // Should NOT upload to S3 or publish to media queue
      expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
      expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
    });
  });
});
