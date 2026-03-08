import { GeminiAdapter } from '../gemini-adapter';

// Mock config
jest.mock('../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    geminiApiKey: 'test-gemini-key',
  }),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the GoogleGenerativeAI module
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn().mockReturnValue({
  generateContent: mockGenerateContent,
});

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;

  beforeEach(() => {
    adapter = new GeminiAdapter();
    jest.clearAllMocks();
    // Re-setup mock after clearAllMocks
    mockGetGenerativeModel.mockReturnValue({
      generateContent: mockGenerateContent,
    });
  });

  describe('transcribeVoiceNote', () => {
    const audioBuffer = Buffer.from('fake-audio-data');
    const languageHint = 'Hindi';
    const browsingContext = ['Basmati Rice', 'Toor Dal'];

    it('should transcribe voice note and extract product intents', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            transcript: 'Mujhe 2 kilo Basmati Rice chahiye aur 1 kilo Toor Dal',
            products: [
              { name: 'Basmati Rice', quantity: 2, confidence: 95 },
              { name: 'Toor Dal', quantity: 1, confidence: 90 },
            ],
            detectedLanguage: 'Hindi',
          }),
        },
      });

      const result = await adapter.transcribeVoiceNote(audioBuffer, languageHint, browsingContext);

      expect(result.transcript).toBe('Mujhe 2 kilo Basmati Rice chahiye aur 1 kilo Toor Dal');
      expect(result.detectedLanguage).toBe('Hindi');
      expect(result.products).toHaveLength(2);
      expect(result.products[0]).toEqual({ name: 'Basmati Rice', quantity: 2, confidence: 95 });
      expect(result.products[1]).toEqual({ name: 'Toor Dal', quantity: 1, confidence: 90 });
    });

    it('should handle response wrapped in markdown code fences', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => '```json\n{"transcript":"hello","products":[],"detectedLanguage":"English"}\n```',
        },
      });

      const result = await adapter.transcribeVoiceNote(audioBuffer, 'English', []);

      expect(result.transcript).toBe('hello');
      expect(result.products).toHaveLength(0);
      expect(result.detectedLanguage).toBe('English');
    });

    it('should clamp confidence scores to 0-100 range', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            transcript: 'test',
            products: [
              { name: 'Rice', quantity: 1, confidence: 150 },
              { name: 'Dal', quantity: 1, confidence: -10 },
            ],
            detectedLanguage: 'English',
          }),
        },
      });

      const result = await adapter.transcribeVoiceNote(audioBuffer, 'English', []);

      expect(result.products[0].confidence).toBe(100);
      expect(result.products[1].confidence).toBe(0);
    });

    it('should default quantity to 1 when missing or invalid', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            transcript: 'test',
            products: [
              { name: 'Rice', confidence: 80 },
              { name: 'Dal', quantity: -5, confidence: 80 },
            ],
            detectedLanguage: 'English',
          }),
        },
      });

      const result = await adapter.transcribeVoiceNote(audioBuffer, 'English', []);

      expect(result.products[0].quantity).toBe(1);
      expect(result.products[1].quantity).toBe(1);
    });

    it('should skip products with missing name', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            transcript: 'test',
            products: [
              { quantity: 1, confidence: 80 },
              { name: 'Rice', quantity: 1, confidence: 90 },
            ],
            detectedLanguage: 'English',
          }),
        },
      });

      const result = await adapter.transcribeVoiceNote(audioBuffer, 'English', []);

      expect(result.products).toHaveLength(1);
      expect(result.products[0].name).toBe('Rice');
    });

    it('should fall back to languageHint when detectedLanguage is missing', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            transcript: 'test',
            products: [],
          }),
        },
      });

      const result = await adapter.transcribeVoiceNote(audioBuffer, 'Tamil', []);

      expect(result.detectedLanguage).toBe('Tamil');
    });

    it('should throw on Gemini API failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('API quota exceeded'));

      await expect(
        adapter.transcribeVoiceNote(audioBuffer, 'English', [])
      ).rejects.toThrow('Voice transcription failed: API quota exceeded');
    });

    it('should pass audio as base64 inlineData with audio/ogg mimeType', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({ transcript: '', products: [], detectedLanguage: 'English' }),
        },
      });

      await adapter.transcribeVoiceNote(audioBuffer, 'English', []);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs[1]).toEqual({
        inlineData: {
          data: audioBuffer.toString('base64'),
          mimeType: 'audio/ogg',
        },
      });
    });
  });

  describe('analyzeProductImage', () => {
    const imageBuffer = Buffer.from('fake-image-data');
    const mimeType = 'image/jpeg';

    it('should analyze product image and return attributes', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            category: 'clothing',
            color: 'red',
            material: 'cotton',
            style: 'traditional',
            brand: 'FabIndia',
            description: 'A red cotton kurta with traditional embroidery',
          }),
        },
      });

      const result = await adapter.analyzeProductImage(imageBuffer, mimeType);

      expect(result.category).toBe('clothing');
      expect(result.color).toBe('red');
      expect(result.material).toBe('cotton');
      expect(result.style).toBe('traditional');
      expect(result.brand).toBe('FabIndia');
      expect(result.description).toBe('A red cotton kurta with traditional embroidery');
    });

    it('should handle null brand', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            category: 'groceries',
            color: 'yellow',
            material: 'organic',
            style: 'packaged',
            brand: null,
            description: 'A pack of yellow toor dal',
          }),
        },
      });

      const result = await adapter.analyzeProductImage(imageBuffer, mimeType);

      expect(result.brand).toBeNull();
    });

    it('should default missing fields to "unknown" or empty', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({}),
        },
      });

      const result = await adapter.analyzeProductImage(imageBuffer, mimeType);

      expect(result.category).toBe('unknown');
      expect(result.color).toBe('unknown');
      expect(result.material).toBe('unknown');
      expect(result.style).toBe('unknown');
      expect(result.brand).toBeNull();
      expect(result.description).toBe('');
    });

    it('should handle response wrapped in markdown code fences', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => '```json\n{"category":"electronics","color":"black","material":"plastic","style":"modern","brand":"Samsung","description":"A black phone"}\n```',
        },
      });

      const result = await adapter.analyzeProductImage(imageBuffer, 'image/png');

      expect(result.category).toBe('electronics');
      expect(result.brand).toBe('Samsung');
    });

    it('should throw on Gemini API failure', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Rate limited'));

      await expect(
        adapter.analyzeProductImage(imageBuffer, mimeType)
      ).rejects.toThrow('Image analysis failed: Rate limited');
    });

    it('should pass image as base64 inlineData with correct mimeType', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            category: 'test', color: 'test', material: 'test',
            style: 'test', brand: null, description: 'test',
          }),
        },
      });

      await adapter.analyzeProductImage(imageBuffer, 'image/webp');

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs[1]).toEqual({
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: 'image/webp',
        },
      });
    });

    it('should use gemini-1.5-flash model', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            category: 'test', color: 'test', material: 'test',
            style: 'test', brand: null, description: 'test',
          }),
        },
      });

      await adapter.analyzeProductImage(imageBuffer, mimeType);

      expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-1.5-flash' });
    });
  });
});
