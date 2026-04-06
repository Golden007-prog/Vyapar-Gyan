import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { getConfig, getVoicePipelineConfig } from '../utils/config';

/** Safely serialize any thrown value into a readable string */
function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return String(err); }
}

/** Default timeout for Gemini API calls (30 seconds) */
const GEMINI_TIMEOUT_MS = 30_000;

/** Wrap a promise with a timeout. Rejects with a descriptive error if the promise doesn't resolve in time. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Wrap raw PCM audio data in a WAV container header.
 * Gemini TTS returns raw L16 PCM — adding this 44-byte header makes
 * the audio playable by Twilio/WhatsApp without any encoding library.
 */
// @ts-ignore — kept for future use when Gemini returns raw PCM
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _wrapPcmAsWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);                        // ChunkID
  header.writeUInt32LE(36 + dataSize, 4);          // ChunkSize
  header.write('WAVE', 8);                         // Format
  header.write('fmt ', 12);                        // Subchunk1ID
  header.writeUInt32LE(16, 16);                    // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20);                     // AudioFormat (1 = PCM)
  header.writeUInt16LE(channels, 22);              // NumChannels
  header.writeUInt32LE(sampleRate, 24);            // SampleRate
  header.writeUInt32LE(byteRate, 28);              // ByteRate
  header.writeUInt16LE(blockAlign, 32);            // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34);         // BitsPerSample
  header.write('data', 36);                        // Subchunk2ID
  header.writeUInt32LE(dataSize, 40);              // Subchunk2Size

  return Buffer.concat([header, pcm]);
}

/** Supported languages for voice transcription */
const SUPPORTED_LANGUAGES = [
  'English', 'Hindi', 'Tamil', 'Telugu', 'Marathi', 'Bengali', 'Gujarati', 'Kannada',
] as const;

/**
 * Extracted product data from Khata book image
 */
export interface KhataBookProduct {
  name: string;
  quantity: number;
  price: number;
}

/**
 * Voice transcription result with shopping intent extraction
 */
export interface VoiceTranscription {
  transcript: string;
  products: Array<{ name: string; quantity: number; confidence: number }>;
  detectedLanguage: string;
  /** Overall transcription confidence score (0-100) */
  confidence: number;
}

/**
 * Product image analysis result with extracted attributes
 */
export interface ProductImageAnalysis {
  category: string;
  color: string;
  material: string;
  style: string;
  brand: string | null;
  description: string;
}

/**
 * CSV column mapping result from Gemini
 */
export interface CsvColumnMapping {
  name: number | null;
  price: number | null;
  quantity: number | null;
  category: number | null;
  sku: number | null;
  brand: number | null;
  variant: number | null;
  confidence: number;
  reasoning: string;
}

/**
 * GeminiAdapter
 * 
 * Adapter for Google Gemini AI API.
 * Provides OCR capabilities for extracting structured data from handwritten Khata books,
 * smart CSV column mapping, voice transcription, and product image analysis.
 */
export class GeminiAdapter {
  private client: GoogleGenerativeAI | null = null;
  private apiKey: string | undefined;

  /**
   * @param apiKey Optional direct API key. When provided the adapter skips
   *              config loading entirely — useful for the voice pipeline where
   *              we resolve the Gemini key independently.
   */
  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  /**
   * Initialize Gemini client.
   * If an apiKey was provided at construction time, use it directly.
   * Otherwise fall back to the voice pipeline config (isolated from full config).
   */
  private async getClient(): Promise<GoogleGenerativeAI> {
    if (this.client) {
      return this.client;
    }

    if (this.apiKey) {
      this.client = new GoogleGenerativeAI(this.apiKey);
      return this.client;
    }

    // Use voice pipeline config to avoid full-config dependency
    try {
      const voiceConfig = await getVoicePipelineConfig();
      this.client = new GoogleGenerativeAI(voiceConfig.geminiApiKey);
      return this.client;
    } catch {
      // Final fallback: full config
      const config = await getConfig();
      this.client = new GoogleGenerativeAI(config.geminiApiKey);
      return this.client;
    }
  }


  /**
   * Smart CSV column mapping using Gemini
   * 
   * Sends CSV headers and sample rows to Gemini to infer column meanings,
   * even when column names are messy, abbreviated, or in Hindi/Hinglish.
   * 
   * @param headers - CSV header row
   * @param sampleRows - First 3-5 data rows for context
   * @returns Column index mapping with confidence score
   */
  async mapCsvColumns(
    headers: string[],
    sampleRows: string[][]
  ): Promise<CsvColumnMapping> {
    try {
      const client = await this.getClient();
      const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const prompt = `You are an expert at understanding messy CSV files from Indian retailers.

Given these CSV headers and sample data rows, identify which column index (0-based) maps to each inventory field.

HEADERS: ${JSON.stringify(headers)}
SAMPLE ROWS: ${JSON.stringify(sampleRows.slice(0, 3))}

Map to these fields:
- name: Product name / item name / description
- price: Selling price / MRP / rate / cost (in INR)
- quantity: Stock quantity / units / count / inventory level
- category: Product category / type / department
- sku: SKU code / barcode / product code
- brand: Brand name / manufacturer
- variant: Size / color / weight / pack size

RULES:
1. Return ONLY valid JSON, no other text
2. Use column INDEX (0-based integer), not column name
3. Use null if a field cannot be identified
4. Consider Hindi/Hinglish column names (e.g. "daam" = price, "maal" = quantity, "saman" = product)
5. Look at sample data to disambiguate (text columns = name, numeric columns = price/quantity)
6. Provide a confidence score (0.0 to 1.0) and brief reasoning

Return JSON:
{
  "name": 0,
  "price": 2,
  "quantity": 1,
  "category": 3,
  "sku": null,
  "brand": null,
  "variant": null,
  "confidence": 0.92,
  "reasoning": "Column 0 contains product names, column 2 has numeric prices..."
}`;

      const result = await withTimeout(
        model.generateContent(prompt),
        GEMINI_TIMEOUT_MS,
        'Gemini CSV mapping',
      );
      const text = result.response.text();
      const cleanText = this.cleanJsonText(text);
      const parsed = JSON.parse(cleanText);

      logger.info('Gemini CSV mapping completed', {
        headerCount: headers.length,
        confidence: parsed.confidence,
      });

      return {
        name: typeof parsed.name === 'number' ? parsed.name : null,
        price: typeof parsed.price === 'number' ? parsed.price : null,
        quantity: typeof parsed.quantity === 'number' ? parsed.quantity : null,
        category: typeof parsed.category === 'number' ? parsed.category : null,
        sku: typeof parsed.sku === 'number' ? parsed.sku : null,
        brand: typeof parsed.brand === 'number' ? parsed.brand : null,
        variant: typeof parsed.variant === 'number' ? parsed.variant : null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      };
    } catch (error) {
      logger.error('Failed to map CSV columns with Gemini', error, {
        errorSerialized: serializeError(error),
        headerCount: headers.length,
      });
      throw new Error(
        `CSV mapping failed: ${serializeError(error)}`
      );
    }
  }

  /**
   * Parse a Khata book image and extract product data
   * 
   * @param imageBuffer - Image file buffer
   * @param mimeType - Image MIME type (e.g., 'image/jpeg', 'image/png')
   * @returns Array of extracted products with name, quantity, and price
   */
  async parseKhataBookImage(
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<KhataBookProduct[]> {
    try {
      const client = await this.getClient();
      const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

      // Convert buffer to base64
      const base64Image = imageBuffer.toString('base64');

      // Construct prompt for structured extraction
      const prompt = `You are an expert at reading handwritten Indian Khata books (ledgers).

Analyze this image and extract ALL product entries in a structured format.

For each product entry, extract:
- Product Name (in English, transliterate if needed)
- Quantity (as a number)
- Price (as a number in INR)

IMPORTANT RULES:
1. Return ONLY a valid JSON array, no other text
2. Each product must have "name", "quantity", and "price" fields
3. If quantity is not specified, use 1
4. If you cannot read a value clearly, skip that entry
5. Ignore headers, dates, or non-product entries
6. Return empty array [] if no products found

Example output format:
[
  {"name": "Basmati Rice", "quantity": 10, "price": 500},
  {"name": "Toor Dal", "quantity": 5, "price": 150}
]

Now extract the products from this Khata book image:`;

      // Generate content with image
      const result = await withTimeout(
        model.generateContent([
          prompt,
          {
            inlineData: {
              data: base64Image,
              mimeType,
            },
          },
        ]),
        GEMINI_TIMEOUT_MS,
        'Gemini OCR',
      );

      const response = result.response;
      const text = response.text();

      logger.info('Gemini OCR response received', {
        responseLength: text.length,
      });

      // Parse JSON response
      const products = this.parseJsonResponse(text);

      logger.info('Khata book parsed successfully', {
        productCount: products.length,
      });

      return products;
    } catch (error) {
      logger.error('Failed to parse Khata book image', error, {
        errorSerialized: serializeError(error),
        mimeType,
      });
      throw new Error(
        `Gemini OCR failed: ${serializeError(error)}`
      );
    }
  }

  /**
   * Parse JSON response from Gemini, handling various formats
   */
  private parseJsonResponse(text: string): KhataBookProduct[] {
    try {
      // Remove markdown code blocks if present
      let cleanText = text.trim();
      if (cleanText.startsWith('```json')) {
        cleanText = cleanText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.replace(/```\n?/g, '');
      }

      // Parse JSON
      const parsed = JSON.parse(cleanText);

      // Validate structure
      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      // Validate and normalize each product
      const products: KhataBookProduct[] = [];
      for (const item of parsed) {
        if (!item.name || typeof item.name !== 'string') {
          logger.warn('Skipping invalid product: missing or invalid name', { item });
          continue;
        }

        const product: KhataBookProduct = {
          name: item.name.trim(),
          quantity: typeof item.quantity === 'number' ? item.quantity : 1,
          price: typeof item.price === 'number' ? item.price : 0,
        };

        // Skip products with zero or negative price
        if (product.price <= 0) {
          logger.warn('Skipping product with invalid price', { product });
          continue;
        }

        products.push(product);
      }

      return products;
    } catch (error) {
      logger.error('Failed to parse Gemini JSON response', {
        error: serializeError(error),
        responseText: text.substring(0, 500), // Log first 500 chars
      });
      throw new Error('Invalid JSON response from Gemini');
    }
  }

  /**
   * Clean markdown code fences and extract raw JSON text from Gemini response
   */
  private cleanJsonText(text: string): string {
    let clean = text.trim();
    if (clean.startsWith('```json')) {
      clean = clean.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/```\n?/g, '');
    }
    return clean.trim();
  }

  /**
   * Transcribe a voice note and extract shopping intent
   *
   * Calls Gemini 1.5 Flash with audio inlineData and a structured output prompt.
   * Supports: English, Hindi, Tamil, Telugu, Marathi, Bengali, Gujarati, Kannada.
   *
   * @param audioBuffer - Audio file buffer (e.g. OGG from WhatsApp)
   * @param languageHint - Expected language of the voice note
   * @param browsingContext - Recent product names the customer was browsing
   * @returns Transcription with extracted product intents and detected language
   */
  async transcribeVoiceNote(
    audioBuffer: Buffer,
    languageHint: string,
    browsingContext: string[]
  ): Promise<VoiceTranscription> {
    try {
      const client = await this.getClient();
      const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const base64Audio = audioBuffer.toString('base64');

      const prompt = `You are a shopping assistant for an Indian marketplace.
Transcribe this audio message and extract the customer's shopping intent.

Language hint: ${languageHint}
Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}
Recent browsing context: ${browsingContext.length > 0 ? browsingContext.join(', ') : 'none'}

IMPORTANT RULES:
1. Return ONLY valid JSON, no other text
2. Transcribe the full audio in the original language
3. Extract product names and quantities the customer wants to order
4. Assign a confidence score (0-100) to each detected product intent
5. Use browsing context to disambiguate similar product names
6. If no products are mentioned, return an empty products array
7. Detect the spoken language and return it in the detectedLanguage field
8. Assign an overall confidence score (0-100) for the transcription quality — how confident you are in the accuracy of the full transcript

Return JSON in this exact format:
{
  "transcript": "full transcription text",
  "confidence": 85,
  "products": [
    { "name": "product name", "quantity": 1, "confidence": 85 }
  ],
  "detectedLanguage": "Hindi"
}`;

      const result = await withTimeout(
        model.generateContent([
          prompt,
          {
            inlineData: {
              data: base64Audio,
              mimeType: 'audio/ogg',
            },
          },
        ]),
        GEMINI_TIMEOUT_MS,
        'Gemini voice transcription',
      );

      const response = result.response;
      const text = response.text();

      logger.info('Gemini voice transcription response received', {
        responseLength: text.length,
        languageHint,
      });

      const cleanText = this.cleanJsonText(text);
      const parsed = JSON.parse(cleanText);

      // Validate and normalize the response
      const transcription: VoiceTranscription = {
        transcript: typeof parsed.transcript === 'string' ? parsed.transcript : '',
        detectedLanguage: typeof parsed.detectedLanguage === 'string'
          ? parsed.detectedLanguage
          : languageHint,
        confidence: typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(100, parsed.confidence))
          : 80,
        products: [],
      };

      if (Array.isArray(parsed.products)) {
        for (const item of parsed.products) {
          if (item.name && typeof item.name === 'string') {
            transcription.products.push({
              name: item.name.trim(),
              quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
              confidence: typeof item.confidence === 'number'
                ? Math.max(0, Math.min(100, item.confidence))
                : 0,
            });
          }
        }
      }

      logger.info('Voice note transcribed successfully', {
        detectedLanguage: transcription.detectedLanguage,
        confidence: transcription.confidence,
        productCount: transcription.products.length,
        transcriptLength: transcription.transcript.length,
      });

      return transcription;
    } catch (error) {
      logger.error('Failed to transcribe voice note', error, {
        errorSerialized: serializeError(error),
        errorType: typeof error,
        errorConstructor: (error as any)?.constructor?.name,
        languageHint,
        browsingContextCount: browsingContext.length,
      });
      throw new Error(
        `Voice transcription failed: ${serializeError(error)}`
      );
    }
  }

  /**
   * Convert text to speech audio via AWS Polly
   *
   * Uses AWS Polly neural voices to produce spoken audio in OGG/Opus format,
   * which is natively supported by WhatsApp via Twilio.
   *
   * Note: Gemini TTS (gemini-2.5-flash-preview-tts) returns raw PCM L16 which
   * Twilio cannot deliver to WhatsApp. Polly outputs OGG/Opus directly.
   *
   * @param text - Text to convert to speech
   * @param language - Language of the text (e.g. 'Hindi', 'English')
   * @param voiceStyle - Voice style hint (unused, kept for API compat)
   * @returns Buffer containing OGG/Opus audio data
   * @throws Error if TTS generation fails (caller handles fallback)
   */
  async textToSpeech(
    text: string,
    language: string,
    voiceStyle: 'conversational' = 'conversational',
  ): Promise<Buffer> {
    try {
      const { PollyClient, SynthesizeSpeechCommand } = await import('@aws-sdk/client-polly');
      const polly = new PollyClient({ region: process.env.AWS_REGION || 'ap-south-1' });

      // Map language names to Polly voice IDs (neural where available)
      const voiceMap: Record<string, { voiceId: string; langCode: string; engine: string }> = {
        'hindi':    { voiceId: 'Kajal', langCode: 'hi-IN', engine: 'neural' },
        'english':  { voiceId: 'Kajal', langCode: 'en-IN', engine: 'neural' },
        'tamil':    { voiceId: 'Kajal', langCode: 'en-IN', engine: 'neural' },
        'telugu':   { voiceId: 'Kajal', langCode: 'en-IN', engine: 'neural' },
        'marathi':  { voiceId: 'Kajal', langCode: 'hi-IN', engine: 'neural' },
        'bengali':  { voiceId: 'Kajal', langCode: 'hi-IN', engine: 'neural' },
        'gujarati': { voiceId: 'Kajal', langCode: 'hi-IN', engine: 'neural' },
        'kannada':  { voiceId: 'Kajal', langCode: 'en-IN', engine: 'neural' },
      };

      const langKey = language.toLowerCase();
      const voice = voiceMap[langKey] ?? voiceMap['hindi']!;

      const command = new SynthesizeSpeechCommand({
        Text: text,
        OutputFormat: 'ogg_vorbis',
        VoiceId: voice.voiceId as any,
        LanguageCode: voice.langCode as any,
        Engine: voice.engine as any,
      });

      const result = await withTimeout(
        polly.send(command),
        GEMINI_TIMEOUT_MS,
        'Polly TTS generation',
      );

      if (!result.AudioStream) {
        throw new Error('No audio data in Polly TTS response');
      }

      // Convert the readable stream to a Buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of result.AudioStream as any) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);

      logger.info('TTS audio generated successfully', {
        language,
        voiceStyle,
        textLength: text.length,
        audioSizeBytes: audioBuffer.length,
        voiceId: voice.voiceId,
        engine: voice.engine,
      });

      return audioBuffer;
    } catch (error) {
      logger.error('Failed to generate TTS audio', error, {
        errorSerialized: serializeError(error),
        language,
        textLength: text.length,
      });
      throw new Error(
        `TTS generation failed: ${serializeError(error)}`
      );
    }
  }

  /**
   * Analyze a product image and extract visual attributes
   *
   * Calls Gemini Vision with inlineData to extract category, color, material,
   * style, brand, and description for catalog matching.
   *
   * @param imageBuffer - Image file buffer (JPEG, PNG, or WebP)
   * @param mimeType - Image MIME type (e.g. 'image/jpeg', 'image/png', 'image/webp')
   * @returns Extracted product attributes for catalog search
   */
  async analyzeProductImage(
    imageBuffer: Buffer,
    mimeType: string
  ): Promise<ProductImageAnalysis> {
    try {
      const client = await this.getClient();
      const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

      const base64Image = imageBuffer.toString('base64');

      const prompt = `You are a product recognition expert for an Indian marketplace.
Analyze this product image and extract visual attributes for catalog matching.

IMPORTANT RULES:
1. Return ONLY valid JSON, no other text
2. Identify the product category (e.g. "clothing", "electronics", "groceries", "home decor")
3. Identify the dominant color
4. Identify the material if visible (e.g. "cotton", "silk", "plastic", "metal", "wood")
5. Identify the style (e.g. "traditional", "modern", "casual", "formal")
6. Identify the brand if visible on the product, otherwise return null
7. Write a brief natural language description (1-2 sentences)

Return JSON in this exact format:
{
  "category": "clothing",
  "color": "red",
  "material": "cotton",
  "style": "traditional",
  "brand": null,
  "description": "A red cotton kurta with traditional embroidery patterns"
}`;

      const result = await withTimeout(
        model.generateContent([
          prompt,
          {
            inlineData: {
              data: base64Image,
              mimeType,
            },
          },
        ]),
        GEMINI_TIMEOUT_MS,
        'Gemini image analysis',
      );

      const response = result.response;
      const text = response.text();

      logger.info('Gemini image analysis response received', {
        responseLength: text.length,
        mimeType,
      });

      const cleanText = this.cleanJsonText(text);
      const parsed = JSON.parse(cleanText);

      // Validate and normalize the response
      const analysis: ProductImageAnalysis = {
        category: typeof parsed.category === 'string' ? parsed.category.trim() : 'unknown',
        color: typeof parsed.color === 'string' ? parsed.color.trim() : 'unknown',
        material: typeof parsed.material === 'string' ? parsed.material.trim() : 'unknown',
        style: typeof parsed.style === 'string' ? parsed.style.trim() : 'unknown',
        brand: typeof parsed.brand === 'string' ? parsed.brand.trim() : null,
        description: typeof parsed.description === 'string' ? parsed.description.trim() : '',
      };

      logger.info('Product image analyzed successfully', {
        category: analysis.category,
        color: analysis.color,
        hasBrand: analysis.brand !== null,
      });

      return analysis;
    } catch (error) {
      logger.error('Failed to analyze product image', error, {
        errorSerialized: serializeError(error),
        mimeType,
      });
      throw new Error(
        `Image analysis failed: ${serializeError(error)}`
      );
    }
  }
}
