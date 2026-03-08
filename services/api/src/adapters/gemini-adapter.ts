import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

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

  /**
   * Initialize Gemini client with API key from config
   */
  private async getClient(): Promise<GoogleGenerativeAI> {
    if (this.client) {
      return this.client;
    }

    const config = await getConfig();
    this.client = new GoogleGenerativeAI(config.geminiApiKey);
    return this.client;
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
      const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

      const result = await model.generateContent(prompt);
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
      logger.error('Failed to map CSV columns with Gemini', {
        error: error instanceof Error ? error.message : String(error),
        headerCount: headers.length,
      });
      throw new Error(
        `CSV mapping failed: ${error instanceof Error ? error.message : String(error)}`
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
      const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

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
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Image,
            mimeType,
          },
        },
      ]);

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
      logger.error('Failed to parse Khata book image', {
        error: error instanceof Error ? error.message : String(error),
        mimeType,
      });
      throw new Error(
        `Gemini OCR failed: ${error instanceof Error ? error.message : String(error)}`
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
        error: error instanceof Error ? error.message : String(error),
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
      const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

Return JSON in this exact format:
{
  "transcript": "full transcription text",
  "products": [
    { "name": "product name", "quantity": 1, "confidence": 85 }
  ],
  "detectedLanguage": "Hindi"
}`;

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Audio,
            mimeType: 'audio/ogg',
          },
        },
      ]);

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
        productCount: transcription.products.length,
        transcriptLength: transcription.transcript.length,
      });

      return transcription;
    } catch (error) {
      logger.error('Failed to transcribe voice note', {
        error: error instanceof Error ? error.message : String(error),
        languageHint,
        browsingContextCount: browsingContext.length,
      });
      throw new Error(
        `Voice transcription failed: ${error instanceof Error ? error.message : String(error)}`
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
      const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Image,
            mimeType,
          },
        },
      ]);

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
      logger.error('Failed to analyze product image', {
        error: error instanceof Error ? error.message : String(error),
        mimeType,
      });
      throw new Error(
        `Image analysis failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
