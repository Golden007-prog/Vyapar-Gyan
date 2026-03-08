import type { SQSEvent, SQSRecord } from 'aws-lambda';

// ---------------------------------------------------------------------------
// All mocks must be self-contained inside jest.mock factories because the
// worker instantiates clients at module scope. We expose mock fns via
// jest.requireMock after the module loads.
// ---------------------------------------------------------------------------

jest.mock('../../../adapters/twilio-adapter', () => {
  const sendWhatsAppMessage = jest.fn().mockResolvedValue({
    messageId: 'SM123',
    status: 'queued',
    dateCreated: new Date(),
    statusCallbackConfigured: false,
  });
  return { twilioAdapter: { sendWhatsAppMessage } };
});

jest.mock('../../../adapters/gemini-adapter', () => {
  const transcribeVoiceNote = jest.fn();
  const analyzeProductImage = jest.fn();
  return {
    GeminiAdapter: jest.fn().mockImplementation(() => ({
      transcribeVoiceNote,
      analyzeProductImage,
    })),
    __mocks: { transcribeVoiceNote, analyzeProductImage },
  };
});

jest.mock('../../../adapters/dynamodb-adapter', () => {
  const getUserProfile = jest.fn();
  return { getUserProfile, __mocks: { getUserProfile } };
});

jest.mock('../../../services/cart-service', () => {
  const addItem = jest.fn();
  return { addItem, __mocks: { addItem } };
});

jest.mock('../../../repositories/catalog-repository', () => {
  const searchProducts = jest.fn();
  const getProductsByCategory = jest.fn();
  return {
    CatalogRepository: jest.fn().mockImplementation(() => ({
      searchProducts,
      getProductsByCategory,
    })),
    __mocks: { searchProducts, getProductsByCategory },
  };
});

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    GetObjectCommand: jest.fn().mockImplementation((p: any) => p),
    __mocks: { send },
  };
});

jest.mock('../../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    productImagesBucket: 'test-media-bucket',
    tableName: 'test-table',
    eventBusName: 'test-bus',
    twilioAccountSid: 'AC123',
    twilioAuthToken: 'token',
    twilioPhoneNumber: '+14155551234',
    geminiApiKey: 'test-key',
  }),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import handler AFTER mocks are set up
// ---------------------------------------------------------------------------
import { handler } from '../media-processing-worker';

// Grab mock references
const { __mocks: geminiMocks } = jest.requireMock('../../../adapters/gemini-adapter') as any;
const { __mocks: dbMocks } = jest.requireMock('../../../adapters/dynamodb-adapter') as any;
const { __mocks: cartMocks } = jest.requireMock('../../../services/cart-service') as any;
const { __mocks: catalogMocks } = jest.requireMock('../../../repositories/catalog-repository') as any;
const { __mocks: s3Mocks } = jest.requireMock('@aws-sdk/client-s3') as any;
const twilioMod = jest.requireMock('../../../adapters/twilio-adapter') as any;

const mockTranscribe = geminiMocks.transcribeVoiceNote as jest.Mock;
const mockAnalyze = geminiMocks.analyzeProductImage as jest.Mock;
const mockGetUser = dbMocks.getUserProfile as jest.Mock;
const mockAddItem = cartMocks.addItem as jest.Mock;
const mockSearch = catalogMocks.searchProducts as jest.Mock;
const mockByCategory = catalogMocks.getProductsByCategory as jest.Mock;
const mockS3Send = s3Mocks.send as jest.Mock;
const mockSendWA = twilioMod.twilioAdapter.sendWhatsAppMessage as jest.Mock;


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSQSEvent(body: Record<string, unknown>, receiveCount = 1): SQSEvent {
  const record: SQSRecord = {
    messageId: 'msg-1',
    receiptHandle: 'handle-1',
    body: JSON.stringify(body),
    attributes: {
      ApproximateReceiveCount: String(receiveCount),
      ApproximateFirstReceiveTimestamp: '0',
      SenderId: 'sender',
      SentTimestamp: '0',
    },
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123:media-retry',
    awsRegion: 'us-east-1',
  };
  return { Records: [record] };
}

function makeS3Body(data: string) {
  const { Readable } = require('stream');
  const s = new Readable();
  s.push(Buffer.from(data));
  s.push(null);
  return s;
}

const TEST_USER = {
  userId: 'user-123',
  phoneNumber: '+919876543210',
  role: 'customer' as const,
  displayName: 'Test User',
  phoneVerificationStatus: 'verified' as const,
  preferredChannel: 'whatsapp' as const,
  whatsappConnected: true,
  cognitoId: 'cog-123',
  status: 'active' as const,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const TEST_PRODUCT = {
  id: 'prod-1',
  sellerId: 'seller-1',
  categoryId: 'clothing',
  name: 'Blue Cotton Shirt',
  description: 'A blue cotton shirt in casual style',
  price: 599,
  stockQuantity: 10,
  imageUrls: [],
  isActive: true,
  createdAt: '2025-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Media Processing Worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue(TEST_USER);
    mockS3Send.mockResolvedValue({ Body: makeS3Body('fake-data') });
    mockSendWA.mockResolvedValue({
      messageId: 'SM123',
      status: 'queued',
      dateCreated: new Date(),
      statusCallbackConfigured: false,
    });
  });

  describe('SQS message routing', () => {
    it('routes voice_note to voice processing', async () => {
      mockTranscribe.mockResolvedValue({
        transcript: 'I want rice',
        products: [{ name: 'Basmati Rice', quantity: 2, confidence: 90 }],
        detectedLanguage: 'Hindi',
      });
      mockSearch.mockResolvedValue([{ ...TEST_PRODUCT, name: 'Basmati Rice' }]);
      mockAddItem.mockResolvedValue({});

      await handler(makeSQSEvent({
        mediaType: 'voice_note',
        userId: 'user-123',
        s3Key: 'voice/user-123/123.ogg',
        mimeType: 'audio/ogg',
        languageHint: 'Hindi',
        browsingContext: [],
        channel: 'whatsapp',
      }));

      expect(mockTranscribe).toHaveBeenCalled();
      expect(mockAnalyze).not.toHaveBeenCalled();
    });

    it('routes image_search to image processing', async () => {
      mockAnalyze.mockResolvedValue({
        category: 'clothing', color: 'blue', material: 'cotton',
        style: 'casual', brand: null, description: 'blue cotton shirt',
      });
      mockByCategory.mockResolvedValue([TEST_PRODUCT]);
      mockSearch.mockResolvedValue([]);

      await handler(makeSQSEvent({
        mediaType: 'image_search',
        userId: 'user-123',
        s3Key: 'image-search/user-123/123.jpg',
        mimeType: 'image/jpeg',
        channel: 'whatsapp',
      }));

      expect(mockAnalyze).toHaveBeenCalled();
      expect(mockTranscribe).not.toHaveBeenCalled();
    });

    it('skips unparseable messages without throwing', async () => {
      const event: SQSEvent = {
        Records: [{
          messageId: 'msg-1', receiptHandle: 'h', body: 'not-json',
          attributes: { ApproximateReceiveCount: '1', ApproximateFirstReceiveTimestamp: '0', SenderId: 's', SentTimestamp: '0' },
          messageAttributes: {}, md5OfBody: '', eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123:q', awsRegion: 'us-east-1',
        }],
      };
      await expect(handler(event)).resolves.toBeUndefined();
    });
  });

  describe('Processing indicator', () => {
    it('sends indicator before AI processing', async () => {
      mockTranscribe.mockResolvedValue({ transcript: 'hi', products: [], detectedLanguage: 'English' });

      await handler(makeSQSEvent({
        mediaType: 'voice_note', userId: 'user-123',
        s3Key: 'voice/user-123/1.ogg', mimeType: 'audio/ogg', channel: 'whatsapp',
      }));

      expect(mockSendWA).toHaveBeenCalledWith('+919876543210', '🔄 Analyzing your request...');
    });
  });

  describe('Voice note processing', () => {
    it('adds high-confidence products to cart and confirms', async () => {
      mockTranscribe.mockResolvedValue({
        transcript: '2 bags of rice',
        products: [{ name: 'Basmati Rice', quantity: 2, confidence: 95 }],
        detectedLanguage: 'Hindi',
      });
      const rice = { ...TEST_PRODUCT, id: 'rice-1', name: 'Basmati Rice', price: 250 };
      mockSearch.mockResolvedValue([rice]);
      mockAddItem.mockResolvedValue({});

      await handler(makeSQSEvent({
        mediaType: 'voice_note', userId: 'user-123',
        s3Key: 'voice/user-123/1.ogg', mimeType: 'audio/ogg',
        languageHint: 'Hindi', browsingContext: ['Rice'], channel: 'whatsapp',
      }));

      expect(mockAddItem).toHaveBeenCalledWith('user-123', expect.objectContaining({
        productId: 'rice-1', name: 'Basmati Rice', price: 250, quantity: 2,
      }));

      const confirm = mockSendWA.mock.calls.find((c: any[]) => c[1].includes('Added to your cart'));
      expect(confirm).toBeDefined();
    });

    it('sends clarification for low-confidence products', async () => {
      mockTranscribe.mockResolvedValue({
        transcript: 'some dal',
        products: [{ name: 'dal', quantity: 1, confidence: 60 }],
        detectedLanguage: 'Hindi',
      });

      await handler(makeSQSEvent({
        mediaType: 'voice_note', userId: 'user-123',
        s3Key: 'voice/user-123/1.ogg', mimeType: 'audio/ogg', channel: 'whatsapp',
      }));

      const clarify = mockSendWA.mock.calls.find((c: any[]) => c[1].includes("wasn't sure"));
      expect(clarify).toBeDefined();
      expect(mockAddItem).not.toHaveBeenCalled();
    });

    it('handles no products detected', async () => {
      mockTranscribe.mockResolvedValue({ transcript: 'Hello', products: [], detectedLanguage: 'English' });

      await handler(makeSQSEvent({
        mediaType: 'voice_note', userId: 'user-123',
        s3Key: 'voice/user-123/1.ogg', mimeType: 'audio/ogg', channel: 'whatsapp',
      }));

      const msg = mockSendWA.mock.calls.find((c: any[]) => c[1].includes("couldn't identify any products"));
      expect(msg).toBeDefined();
    });
  });

  describe('Image search processing', () => {
    it('returns top matches when similarity > 40%', async () => {
      mockAnalyze.mockResolvedValue({
        category: 'clothing', color: 'blue', material: 'cotton',
        style: 'casual', brand: null, description: 'blue cotton shirt',
      });
      mockByCategory.mockResolvedValue([{
        ...TEST_PRODUCT, categoryId: 'clothing',
        name: 'Blue Cotton Casual Shirt', description: 'A blue cotton shirt in casual style',
      }]);
      mockSearch.mockResolvedValue([]);

      await handler(makeSQSEvent({
        mediaType: 'image_search', userId: 'user-123',
        s3Key: 'image-search/user-123/1.jpg', mimeType: 'image/jpeg', channel: 'whatsapp',
      }));

      const result = mockSendWA.mock.calls.find((c: any[]) => c[1].includes("Here's what I found"));
      expect(result).toBeDefined();
    });

    it('suggests category browse when no matches > 40%', async () => {
      mockAnalyze.mockResolvedValue({
        category: 'electronics', color: 'black', material: 'plastic',
        style: 'modern', brand: 'Sony', description: 'black device',
      });
      mockByCategory.mockResolvedValue([]);
      mockSearch.mockResolvedValue([]);

      await handler(makeSQSEvent({
        mediaType: 'image_search', userId: 'user-123',
        s3Key: 'image-search/user-123/1.jpg', mimeType: 'image/jpeg', channel: 'whatsapp',
      }));

      const browse = mockSendWA.mock.calls.find((c: any[]) => c[1].includes('browse our'));
      expect(browse).toBeDefined();
    });
  });

  describe('Retry and fallback', () => {
    it('throws on transient failure to trigger SQS retry', async () => {
      mockTranscribe.mockRejectedValue(new Error('Gemini timeout'));

      await expect(handler(makeSQSEvent({
        mediaType: 'voice_note', userId: 'user-123',
        s3Key: 'voice/user-123/1.ogg', mimeType: 'audio/ogg', channel: 'whatsapp',
      }, 1))).rejects.toThrow('Gemini timeout');
    });

    it('sends voice fallback on final attempt', async () => {
      mockTranscribe.mockRejectedValue(new Error('Gemini timeout'));

      await handler(makeSQSEvent({
        mediaType: 'voice_note', userId: 'user-123',
        s3Key: 'voice/user-123/1.ogg', mimeType: 'audio/ogg', channel: 'whatsapp',
      }, 3));

      const fb = mockSendWA.mock.calls.find((c: any[]) => c[1].includes("couldn't understand the voice note"));
      expect(fb).toBeDefined();
    });

    it('sends image fallback on final attempt', async () => {
      mockAnalyze.mockRejectedValue(new Error('Vision error'));

      await handler(makeSQSEvent({
        mediaType: 'image_search', userId: 'user-123',
        s3Key: 'image-search/user-123/1.jpg', mimeType: 'image/jpeg', channel: 'whatsapp',
      }, 3));

      const fb = mockSendWA.mock.calls.find((c: any[]) => c[1].includes("couldn't analyze that image"));
      expect(fb).toBeDefined();
    });
  });
});
