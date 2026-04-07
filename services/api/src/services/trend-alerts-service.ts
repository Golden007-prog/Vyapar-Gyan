/**
 * Trend Alerts Service
 *
 * Generates AI-powered inventory trend reports for sellers.
 * Used by the seller copilot when seller types "2" (AI Trend Alerts).
 *
 * Queries all products for the seller, builds a summary, and sends to
 * Gemini for analysis with stock alerts, trending products, pricing insights.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GeminiAdapter } from '../adapters/gemini-adapter';
import { getVoicePipelineConfig } from '../utils/config';
import { logger } from '../utils/logger';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

interface ProductSummary {
  name: string;
  price: number;
  quantity: number;
  category: string;
  stockAddedDate?: string;
  daysSinceAdded: number;
}

/**
 * Generate an AI trend report for a seller's inventory.
 */
export async function generateTrendReport(
  sellerId: string,
  storeName: string,
): Promise<string> {
  // 1. Query ALL products for seller
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    return 'Unable to generate report — configuration error. Type "menu" to go back.';
  }

  let products: ProductSummary[];
  try {
    products = await queryAllProducts(tableName, sellerId);
  } catch (err) {
    logger.error('Trend report: failed to query products', {
      sellerId, error: err instanceof Error ? err.message : String(err),
    });
    return 'Unable to fetch inventory data. Please try again later.\n\nType "menu" to go back.';
  }

  if (products.length === 0) {
    return '📦 No products in your inventory yet. Upload your inventory first!\n\nType "menu" to go back.';
  }

  // 2. Build product summary
  const productList = products
    .map(p => `- ${p.name}: ₹${p.price}, ${p.quantity} units, ${p.category}, ${p.daysSinceAdded} days old`)
    .join('\n');

  // 3. Send to Gemini for analysis
  const prompt = `You are VyaparGyan AI, an inventory advisor for Indian kirana stores.

Store: ${storeName}
Current inventory (${products.length} products):
${productList}

Analyze and respond in this format:

🚨 *STOCK ALERTS:*
- [dead stock 60+ days, low stock <10 units, overstocked items]

📈 *TRENDING PRODUCTS TO ADD:*
- [5-7 high-demand products missing from inventory, based on store type and categories]

💰 *PRICING INSIGHTS:*
- [overpriced or underpriced items vs typical Indian market rates]

📊 *STORE HEALTH SCORE:* X/10
[one-line summary]

Keep concise — this goes in a WhatsApp message. Use ₹ for prices. Be specific with names and quantities.`;

  try {
    let apiKey: string | undefined;
    try {
      const voiceConfig = await getVoicePipelineConfig();
      apiKey = voiceConfig.geminiApiKey;
    } catch {
      apiKey = process.env.GEMINI_API_KEY;
    }

    if (!apiKey) {
      return generateFallbackReport(products, storeName);
    }

    const gemini = new GeminiAdapter(apiKey);
    const client = await (gemini as any).getClient();
    const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    logger.info('Trend report generated via Gemini', { sellerId, productCount: products.length });

    return `${text}\n\n✅ Reply "add [product name]" to add a suggested product\n📊 Reply "4" for quick inventory summary\n🏠 Reply "menu" to go back`;
  } catch (err) {
    logger.error('Gemini trend analysis failed', {
      sellerId, error: err instanceof Error ? err.message : String(err),
    });
    return generateFallbackReport(products, storeName);
  }
}

/**
 * Query all products for a seller from SellerStockIndex.
 */
async function queryAllProducts(tableName: string, sellerId: string): Promise<ProductSummary[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'SellerStockIndex',
      KeyConditionExpression: 'sellerId = :sellerId',
      ExpressionAttributeValues: { ':sellerId': sellerId },
      ScanIndexForward: false,
      Limit: 200,
    }),
  );

  const now = Date.now();
  return (result.Items || []).map(item => {
    const addedDate = item.stockAddedDate ? new Date(item.stockAddedDate as string).getTime() : now;
    const daysSinceAdded = Math.floor((now - addedDate) / (1000 * 60 * 60 * 24));
    return {
      name: (item.name as string) || 'Unknown',
      price: (item.price as number) || 0,
      quantity: (item.stockQuantity as number) || 0,
      category: (item.categoryId as string) || 'general',
      ...(item.stockAddedDate ? { stockAddedDate: item.stockAddedDate as string } : {}),
      daysSinceAdded,
    };
  });
}

/**
 * Fallback report when Gemini is unavailable.
 */
function generateFallbackReport(products: ProductSummary[], storeName: string): string {
  const totalProducts = products.length;
  const totalStock = products.reduce((s, p) => s + p.quantity, 0);
  const totalValue = products.reduce((s, p) => s + p.price * p.quantity, 0);
  const deadStock = products.filter(p => p.daysSinceAdded >= 60);
  const lowStock = products.filter(p => p.quantity > 0 && p.quantity < 10);
  const outOfStock = products.filter(p => p.quantity === 0);

  let report = `📊 *${storeName} — Trend Report*\n\n`;
  report += `📦 ${totalProducts} products · ${totalStock} total units · ₹${totalValue.toLocaleString('en-IN')} value\n\n`;

  if (deadStock.length > 0) {
    report += `🚨 *STOCK ALERTS:*\n`;
    deadStock.slice(0, 5).forEach(p => {
      report += `- ${p.name}: ${p.quantity} units, ${p.daysSinceAdded} days old (consider discounting)\n`;
    });
    report += '\n';
  }

  if (lowStock.length > 0) {
    report += `⚠️ *LOW STOCK:*\n`;
    lowStock.slice(0, 5).forEach(p => {
      report += `- ${p.name}: only ${p.quantity} units left\n`;
    });
    report += '\n';
  }

  if (outOfStock.length > 0) {
    report += `🔴 *OUT OF STOCK:*\n`;
    outOfStock.slice(0, 5).forEach(p => {
      report += `- ${p.name}\n`;
    });
    report += '\n';
  }

  report += `📊 *STORE HEALTH SCORE:* ${Math.max(1, 10 - deadStock.length - outOfStock.length)}/10\n`;
  report += '\n✅ Reply "add [product name]" to add a suggested product\n📊 Reply "4" for quick inventory summary\n🏠 Reply "menu" to go back';

  return report;
}
