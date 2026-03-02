import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

/**
 * Market trend analysis result from Grok
 */
export interface MarketTrendAnalysis {
  category: string;
  productName: string;
  demandLevel: 'high' | 'medium' | 'low';
  priceRecommendation: 'increase' | 'maintain' | 'decrease';
  suggestedDiscountPercent?: number;
  suggestedPriceIncrease?: number;
  reasoning: string;
  marketInsights: string;
}

/**
 * GrokAdapter
 * 
 * Adapter for xAI Grok API for market trend research and dynamic pricing recommendations.
 * Provides AI-powered insights for inventory optimization and pricing strategies.
 */
export class GrokAdapter {
  private client: AxiosInstance | null = null;
  private apiKey: string | null = null;

  /**
   * Initialize Grok API client with API key from config
   */
  private async getClient(): Promise<AxiosInstance> {
    if (this.client) {
      return this.client;
    }

    const config = await getConfig();
    this.apiKey = config.grokApiKey;

    this.client = axios.create({
      baseURL: 'https://api.x.ai/v1',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
    });

    return this.client;
  }

  /**
   * Analyze market trends for a specific product
   * 
   * @param category - Product category (e.g., "Sarees", "Electronics")
   * @param productName - Specific product name (e.g., "Silk Saree Red")
   * @param currentPrice - Current price in INR
   * @param stockAge - Days since stock was added
   * @returns Market trend analysis with pricing recommendations
   */
  async analyzeMarketTrend(
    category: string,
    productName: string,
    currentPrice: number,
    stockAge: number
  ): Promise<MarketTrendAnalysis> {
    try {
      const client = await this.getClient();

      // Construct prompt for market analysis
      const prompt = `You are an expert market analyst for the Indian retail market, specializing in local commerce and pricing strategies.

Analyze the following product and provide actionable pricing recommendations:

Product Details:
- Category: ${category}
- Product Name: ${productName}
- Current Price: ₹${currentPrice}
- Stock Age: ${stockAge} days

Please analyze:
1. Current market demand for this product category in India
2. Seasonal trends and timing factors
3. Competitive pricing landscape
4. Whether the stock age indicates dead stock risk
5. Recommended pricing action (increase, maintain, or decrease)

Provide your response in the following JSON format ONLY (no other text):
{
  "demandLevel": "high" | "medium" | "low",
  "priceRecommendation": "increase" | "maintain" | "decrease",
  "suggestedDiscountPercent": <number or null>,
  "suggestedPriceIncrease": <number or null>,
  "reasoning": "<brief explanation>",
  "marketInsights": "<key market insights>"
}

Rules:
- If stock age > 60 days and demand is low/medium, recommend discount
- If demand is high and stock is fresh, consider price increase
- Discount should be 10-30% for dead stock
- Price increase should be 5-15% for high demand items
- Be specific and actionable`;

      logger.info('Requesting market trend analysis from Grok', {
        category,
        productName,
        currentPrice,
        stockAge,
      });

      // Call Grok API
      const response = await client.post('/chat/completions', {
        model: 'grok-beta',
        messages: [
          {
            role: 'system',
            content: 'You are a market analysis expert for Indian retail. Provide concise, actionable pricing recommendations in JSON format.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent analysis
        max_tokens: 500,
      });

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from Grok API');
      }

      logger.info('Grok API response received', {
        responseLength: content.length,
      });

      // Parse JSON response
      const analysis = this.parseAnalysisResponse(content, category, productName);

      logger.info('Market trend analysis completed', {
        category,
        productName,
        demandLevel: analysis.demandLevel,
        priceRecommendation: analysis.priceRecommendation,
      });

      return analysis;
    } catch (error) {
      logger.error('Failed to analyze market trend', {
        category,
        productName,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return conservative fallback analysis
      return this.getFallbackAnalysis(category, productName, stockAge);
    }
  }

  /**
   * Parse JSON response from Grok API
   */
  private parseAnalysisResponse(
    content: string,
    category: string,
    productName: string
  ): MarketTrendAnalysis {
    try {
      // Remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/```\n?/g, '');
      }

      // Parse JSON
      const parsed = JSON.parse(cleanContent);

      // Validate and construct analysis
      const analysis: MarketTrendAnalysis = {
        category,
        productName,
        demandLevel: this.validateDemandLevel(parsed.demandLevel),
        priceRecommendation: this.validatePriceRecommendation(parsed.priceRecommendation),
        reasoning: parsed.reasoning || 'No reasoning provided',
        marketInsights: parsed.marketInsights || 'No market insights available',
      };

      // Add optional fields
      if (parsed.suggestedDiscountPercent && typeof parsed.suggestedDiscountPercent === 'number') {
        analysis.suggestedDiscountPercent = Math.min(Math.max(parsed.suggestedDiscountPercent, 5), 50);
      }

      if (parsed.suggestedPriceIncrease && typeof parsed.suggestedPriceIncrease === 'number') {
        analysis.suggestedPriceIncrease = Math.min(Math.max(parsed.suggestedPriceIncrease, 5), 25);
      }

      return analysis;
    } catch (error) {
      logger.error('Failed to parse Grok analysis response', {
        error: error instanceof Error ? error.message : String(error),
        responseText: content.substring(0, 500),
      });
      throw new Error('Invalid JSON response from Grok API');
    }
  }

  /**
   * Validate demand level value
   */
  private validateDemandLevel(value: any): 'high' | 'medium' | 'low' {
    if (value === 'high' || value === 'medium' || value === 'low') {
      return value;
    }
    return 'medium'; // Default fallback
  }

  /**
   * Validate price recommendation value
   */
  private validatePriceRecommendation(value: any): 'increase' | 'maintain' | 'decrease' {
    if (value === 'increase' || value === 'maintain' || value === 'decrease') {
      return value;
    }
    return 'maintain'; // Default fallback
  }

  /**
   * Get fallback analysis when API fails
   */
  private getFallbackAnalysis(
    category: string,
    productName: string,
    stockAge: number
  ): MarketTrendAnalysis {
    // Conservative fallback logic based on stock age
    if (stockAge > 90) {
      return {
        category,
        productName,
        demandLevel: 'low',
        priceRecommendation: 'decrease',
        suggestedDiscountPercent: 20,
        reasoning: 'Stock age exceeds 90 days, suggesting clearance discount',
        marketInsights: 'Fallback analysis due to API unavailability',
      };
    } else if (stockAge > 60) {
      return {
        category,
        productName,
        demandLevel: 'medium',
        priceRecommendation: 'decrease',
        suggestedDiscountPercent: 15,
        reasoning: 'Stock age exceeds 60 days, suggesting moderate discount',
        marketInsights: 'Fallback analysis due to API unavailability',
      };
    } else {
      return {
        category,
        productName,
        demandLevel: 'medium',
        priceRecommendation: 'maintain',
        reasoning: 'Stock is relatively fresh, maintain current pricing',
        marketInsights: 'Fallback analysis due to API unavailability',
      };
    }
  }
}
