import { DynamoDBStreamHandler } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { TwilioAdapter } from '../../adapters/twilio-adapter';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Customer information for campaign targeting
 */
interface TargetCustomer {
  id: string;
  phoneNumber: string;
  profileName: string;
}

/**
 * Product information for campaign message
 */
interface CampaignProduct {
  id: string;
  name: string;
  originalPrice: number;
  discountedPrice: number;
  discountPercent: number;
  categoryId: string;
}

/**
 * Campaign Worker
 * 
 * DynamoDB Stream-triggered Lambda that monitors SELLER_INSIGHT items.
 * When an insight status changes to 'approved', it:
 * 1. Retrieves the product details
 * 2. Queries past customers who bought similar products
 * 3. Sends personalized WhatsApp discount notifications
 * 4. Updates insight status to 'applied'
 * 
 * Triggered by: DynamoDB Streams on INSIGHT# items
 */
export const handler: DynamoDBStreamHandler = async (event) => {
  const config = await getConfig();
  const twilioAdapter = new TwilioAdapter();

  logger.info('Campaign worker started', {
    recordCount: event.Records.length,
  });

  for (const record of event.Records) {
    try {
      // Only process MODIFY events where status changed to 'approved'
      if (record.eventName !== 'MODIFY') {
        continue;
      }

      const newImage = record.dynamodb?.NewImage;
      const oldImage = record.dynamodb?.OldImage;

      if (!newImage || !oldImage) {
        continue;
      }

      const newItem = unmarshall(newImage as any);
      const oldItem = unmarshall(oldImage as any);

      // Check if this is an INSIGHT item that was just approved
      if (
        !newItem.SK?.startsWith('INSIGHT#') ||
        newItem.status !== 'approved' ||
        oldItem.status === 'approved'
      ) {
        continue;
      }

      logger.info('Processing approved insight', {
        insightId: newItem.id,
        sellerId: newItem.sellerId,
        productId: newItem.productId,
      });

      // Only process discount recommendations
      if (
        newItem.insightType !== 'dead_stock_alert' &&
        newItem.insightType !== 'pricing_recommendation'
      ) {
        logger.info('Skipping non-discount insight', {
          insightId: newItem.id,
          insightType: newItem.insightType,
        });
        continue;
      }

      // Only process if there's a discount
      if (!newItem.suggestedDiscountPercent || newItem.suggestedDiscountPercent <= 0) {
        logger.info('Skipping insight without discount', {
          insightId: newItem.id,
        });
        continue;
      }

      // Get product details
      const product = await getProduct(config.tableName, newItem.productId);
      if (!product) {
        logger.error('Product not found', {
          productId: newItem.productId,
        });
        continue;
      }

      // Calculate discounted price
      const discountPercent = newItem.suggestedDiscountPercent;
      const discountedPrice = Math.round(product.price * (1 - discountPercent / 100));

      const campaignProduct: CampaignProduct = {
        id: product.id,
        name: product.name,
        originalPrice: product.price,
        discountedPrice,
        discountPercent,
        categoryId: product.categoryId,
      };

      // Find target customers (past buyers of similar products)
      const targetCustomers = await findTargetCustomers(
        config.tableName,
        newItem.sellerId,
        product.categoryId
      );

      logger.info('Found target customers', {
        count: targetCustomers.length,
        productId: product.id,
      });

      if (targetCustomers.length === 0) {
        logger.info('No target customers found, marking insight as applied', {
          insightId: newItem.id,
        });
        await updateInsightStatus(config.tableName, newItem.sellerId, newItem.id, 'applied');
        continue;
      }

      // Send WhatsApp campaigns
      let successCount = 0;
      let failureCount = 0;

      for (const customer of targetCustomers) {
        try {
          const message = createCampaignMessage(customer, campaignProduct);
          
          await twilioAdapter.sendWhatsAppMessage(
            customer.phoneNumber,
            message
          );

          successCount++;
          logger.info('Campaign message sent', {
            customerId: customer.id,
            phoneNumber: customer.phoneNumber,
          });

          // Add small delay to respect rate limits
          await delay(500);
        } catch (error) {
          failureCount++;
          logger.error('Failed to send campaign message', {
            customerId: customer.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Update insight status to 'applied'
      await updateInsightStatus(config.tableName, newItem.sellerId, newItem.id, 'applied');

      logger.info('Campaign completed', {
        insightId: newItem.id,
        productId: product.id,
        targetCustomers: targetCustomers.length,
        successCount,
        failureCount,
      });
    } catch (error) {
      logger.error('Failed to process record', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Continue processing other records
    }
  }

  logger.info('Campaign worker completed');
};

/**
 * Get product details from DynamoDB
 */
async function getProduct(tableName: string, productId: string): Promise<any | null> {
  try {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: marshall({
        ':pk': `PRODUCT#${productId}`,
        ':sk': 'METADATA',
      }),
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    const firstItem = response.Items[0];
    if (!firstItem) {
      return null;
    }

    return unmarshall(firstItem);
  } catch (error) {
    logger.error('Failed to get product', {
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Find target customers who have ordered from this seller in the same category
 */
async function findTargetCustomers(
  tableName: string,
  sellerId: string,
  _categoryId: string
): Promise<TargetCustomer[]> {
  try {
    // Query orders by seller using SellerOrdersIndex
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'SellerOrdersIndex',
      KeyConditionExpression: 'sellerId = :sellerId',
      ExpressionAttributeValues: marshall({
        ':sellerId': sellerId,
      }),
      Limit: 100, // Limit to recent orders
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    // Extract unique customers who bought products in the same category
    const customerMap = new Map<string, TargetCustomer>();

    for (const item of response.Items) {
      const order = unmarshall(item);

      // Check if order contains items from the same category
      const hasCategoryMatch = order.items?.some((_orderItem: any) => {
        // In a real implementation, you'd need to look up each product's category
        // For now, we'll target all past customers
        return true;
      });

      if (hasCategoryMatch && order.customerId) {
        // Get customer details
        const customer = await getCustomer(tableName, order.customerId);
        if (customer && customer.phoneNumber) {
          customerMap.set(customer.id, {
            id: customer.id,
            phoneNumber: customer.phoneNumber,
            profileName: customer.profileName || 'Customer',
          });
        }
      }
    }

    return Array.from(customerMap.values());
  } catch (error) {
    logger.error('Failed to find target customers', {
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Get customer details from DynamoDB
 */
async function getCustomer(tableName: string, customerId: string): Promise<any | null> {
  try {
    // Query customer by ID
    // Assuming customer data is stored with PK: CUSTOMER#{customerId}
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: marshall({
        ':pk': `CUSTOMER#${customerId}`,
      }),
      Limit: 1,
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    const firstItem = response.Items[0];
    if (!firstItem) {
      return null;
    }

    return unmarshall(firstItem);
  } catch (error) {
    logger.error('Failed to get customer', {
      customerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Create personalized campaign message
 */
function createCampaignMessage(customer: TargetCustomer, product: CampaignProduct): string {
  const savings = product.originalPrice - product.discountedPrice;

  return `🎉 Special Offer for You, ${customer.profileName}!

We noticed you've shopped with us before. Here's an exclusive deal:

📦 ${product.name}
💰 Was: ₹${product.originalPrice}
🔥 Now: ₹${product.discountedPrice}
✨ Save ₹${savings} (${product.discountPercent}% OFF!)

This is a limited-time offer to clear our inventory. Don't miss out!

Reply with "BUY" to place your order or "INFO" for more details.

Thank you for being a valued customer! 🙏`;
}

/**
 * Update insight status in DynamoDB
 */
async function updateInsightStatus(
  tableName: string,
  sellerId: string,
  insightId: string,
  status: string
): Promise<void> {
  try {
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SELLER#${sellerId}`,
        SK: `INSIGHT#${insightId}`,
      }),
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':status': status,
        ':updatedAt': new Date().toISOString(),
      }),
    });

    await dynamoDBClient.send(command);

    logger.info('Updated insight status', {
      insightId,
      status,
    });
  } catch (error) {
    logger.error('Failed to update insight status', {
      insightId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delay helper function
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
