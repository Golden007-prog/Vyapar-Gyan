import { EventBridgeHandler } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { GrokAdapter } from '../../adapters/grok-adapter';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Product with aging stock information
 */
interface AgingProduct {
  id: string;
  sellerId: string;
  categoryId: string;
  name: string;
  price: number;
  stockQuantity: number;
  stockAddedDate: string;
  stockAgeDays: number;
}

/**
 * Seller insight recommendation
 */
interface SellerInsight {
  id: string;
  sellerId: string;
  productId: string;
  insightType: 'pricing_recommendation' | 'dead_stock_alert' | 'market_trend';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  actionRecommended: string;
  suggestedDiscountPercent?: number;
  suggestedPriceIncrease?: number;
  marketInsights?: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  createdAt: string;
  expiresAt: string;
}

/**
 * Trend Analyzer Worker
 * 
 * Scheduled Lambda function that runs daily to:
 * 1. Query DynamoDB for aging inventory (products > 60 days old)
 * 2. Analyze market trends using Grok API
 * 3. Generate pricing recommendations
 * 4. Save insights to DynamoDB for seller review
 * 
 * Triggered by: EventBridge scheduled rule (daily at 2:00 AM)
 */
export const handler: EventBridgeHandler<'Scheduled Event', any, void> = async (event) => {
  const config = await getConfig();
  const grokAdapter = new GrokAdapter();

  logger.info('Trend analyzer worker started', {
    time: event.time,
    resources: event.resources,
  });

  try {
    // Calculate cutoff date (60 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 60);
    const cutoffDateISO = cutoffDate.toISOString();

    logger.info('Querying aging inventory', {
      cutoffDate: cutoffDateISO,
    });

    // Query all sellers and their aging products
    const agingProducts = await queryAgingInventory(config.tableName, cutoffDateISO);

    logger.info('Found aging products', {
      count: agingProducts.length,
    });

    if (agingProducts.length === 0) {
      logger.info('No aging products found, worker completed');
      return;
    }

    // Process products in batches to avoid overwhelming Grok API
    const batchSize = 10;
    let processedCount = 0;
    let insightsGenerated = 0;

    for (let i = 0; i < agingProducts.length; i += batchSize) {
      const batch = agingProducts.slice(i, i + batchSize);

      logger.info('Processing batch', {
        batchNumber: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
      });

      // Process each product in the batch
      for (const product of batch) {
        try {
          // Analyze market trend using Grok
          const analysis = await grokAdapter.analyzeMarketTrend(
            product.categoryId,
            product.name,
            product.price,
            product.stockAgeDays
          );

          // Generate insight only if action is recommended
          if (analysis.priceRecommendation !== 'maintain') {
            const insight = createSellerInsight(product, analysis);
            await saveInsight(config.tableName, insight);
            insightsGenerated++;

            logger.info('Generated seller insight', {
              sellerId: product.sellerId,
              productId: product.id,
              recommendation: analysis.priceRecommendation,
            });
          }

          processedCount++;
        } catch (error) {
          logger.error('Failed to process product', {
            productId: product.id,
            error: error instanceof Error ? error.message : String(error),
          });
          // Continue processing other products
        }
      }

      // Add delay between batches to respect API rate limits
      if (i + batchSize < agingProducts.length) {
        await delay(2000); // 2 second delay between batches
      }
    }

    logger.info('Trend analyzer worker completed', {
      totalProducts: agingProducts.length,
      processedCount,
      insightsGenerated,
    });
  } catch (error) {
    logger.error('Trend analyzer worker failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};

/**
 * Query aging inventory from DynamoDB using SellerStockIndex
 */
async function queryAgingInventory(
  tableName: string,
  cutoffDate: string
): Promise<AgingProduct[]> {
  const products: AgingProduct[] = [];

  // Note: In a real implementation, you would need to query each seller separately
  // or use a scan operation. For now, we'll use a scan with filter.
  // In production, consider maintaining a separate GSI or using DynamoDB Streams.

  try {
    // Scan for products older than cutoff date
    // This is not optimal for large datasets - consider using GSI in production
    // For MVP, we'll do a simpler scan approach
    // In production, iterate through sellers and query their aging stock
    const scanCommand = {
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :pk) AND stockAddedDate < :cutoffDate AND isActive = :active AND stockQuantity > :zero',
      ExpressionAttributeValues: marshall({
        ':pk': 'PRODUCT#',
        ':cutoffDate': cutoffDate,
        ':active': true,
        ':zero': 0,
      }),
      Limit: 100,
    };

    const response = await dynamoDBClient.send(new QueryCommand(scanCommand as any));

    if (response.Items) {
      for (const item of response.Items) {
        const product = unmarshall(item);
        
        // Calculate stock age in days
        const stockAddedDate = new Date(product.stockAddedDate);
        const now = new Date();
        const stockAgeDays = Math.floor((now.getTime() - stockAddedDate.getTime()) / (1000 * 60 * 60 * 24));

        products.push({
          id: product.id,
          sellerId: product.sellerId,
          categoryId: product.categoryId,
          name: product.name,
          price: product.price,
          stockQuantity: product.stockQuantity,
          stockAddedDate: product.stockAddedDate,
          stockAgeDays,
        });
      }
    }

    return products;
  } catch (error) {
    logger.error('Failed to query aging inventory', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Create seller insight from market analysis
 */
function createSellerInsight(
  product: AgingProduct,
  analysis: any
): SellerInsight {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days expiry

  let title: string;
  let description: string;
  let actionRecommended: string;
  let priority: 'high' | 'medium' | 'low';

  if (analysis.priceRecommendation === 'decrease') {
    priority = product.stockAgeDays > 90 ? 'high' : 'medium';
    title = `Dead Stock Alert: ${product.name}`;
    description = `Your ${product.name} has been in stock for ${product.stockAgeDays} days. ${analysis.reasoning}`;
    actionRecommended = analysis.suggestedDiscountPercent
      ? `Apply ${analysis.suggestedDiscountPercent}% discount to liquidate inventory`
      : 'Consider discounting this product to clear inventory';
  } else {
    priority = 'medium';
    title = `Price Increase Opportunity: ${product.name}`;
    description = `Market analysis suggests strong demand for ${product.name}. ${analysis.reasoning}`;
    actionRecommended = analysis.suggestedPriceIncrease
      ? `Consider increasing price by ${analysis.suggestedPriceIncrease}%`
      : 'Consider increasing price based on market demand';
  }

  return {
    id: `insight-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    sellerId: product.sellerId,
    productId: product.id,
    insightType: product.stockAgeDays > 60 ? 'dead_stock_alert' : 'pricing_recommendation',
    priority,
    title,
    description,
    actionRecommended,
    suggestedDiscountPercent: analysis.suggestedDiscountPercent,
    suggestedPriceIncrease: analysis.suggestedPriceIncrease,
    marketInsights: analysis.marketInsights,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Save seller insight to DynamoDB
 */
async function saveInsight(tableName: string, insight: SellerInsight): Promise<void> {
  const command = new PutItemCommand({
    TableName: tableName,
    Item: marshall({
      PK: `SELLER#${insight.sellerId}`,
      SK: `INSIGHT#${insight.id}`,
      ...insight,
    }),
  });

  await dynamoDBClient.send(command);
}

/**
 * Delay helper function
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
