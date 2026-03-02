import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

/**
 * Extracted product data from Khata book image
 */
export interface KhataBookProduct {
  name: string;
  quantity: number;
  price: number;
}

/**
 * GeminiAdapter
 * 
 * Adapter for Google Gemini AI API.
 * Provides OCR capabilities for extracting structured data from handwritten Khata books.
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
}
