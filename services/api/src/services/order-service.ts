import { DynamoDBClient, TransactWriteItemsCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';
import { CartItem } from '../repositories/session-repository';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Order item structure
 */
export interface OrderItem {
  productId: string;
  sellerId: string;
  name: string;
  price: number;
  quantity: number;
}

/**
 * Order structure
 */
export interface Order {
  id: string;
  orderId: string; // Human-readable format: VG-YYYYMMDD-NNNN
  customerId: string;
  customerPhone: string;
  sellerId: string;
  items: OrderItem[];
  subtotal: number;
  commissionRate: number;
  commissionAmount: number;
  sellerAmount: number;
  totalAmount: number;
  status: 'PENDING_PAYMENT' | 'PAID' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  paymentId?: string;
  shippingAddress?: {
    name: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    pincode: string;
  } | undefined;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create order input
 */
export interface CreateOrderInput {
  customerId: string;
  customerPhone: string;
  cartItems: CartItem[];
  shippingAddress?: Order['shippingAddress'];
}

/**
 * Create order result
 */
export interface CreateOrderResult {
  success: boolean;
  order?: Order;
  error?: string;
  outOfStockItems?: string[];
}

/**
 * OrderService
 * 
 * Handles order creation with DynamoDB transactions to ensure:
 * 1. Inventory is deducted atomically
 * 2. Order is created only if all items are in stock
 * 3. No overselling occurs
 */
export class OrderService {
  private tableName: string;
  private commissionRate: number = 0.15; // 15% platform commission

  constructor(tableName?: string) {
    this.tableName = tableName || '';
  }

  private async getTableName(): Promise<string> {
    if (this.tableName) {
      return this.tableName;
    }
    const config = await getConfig();
    this.tableName = config.tableName;
    return this.tableName;
  }

  /**
   * Create order using DynamoDB TransactWriteItems
   * 
   * This ensures atomic inventory deduction and order creation.
   * If any item is out of stock, the entire transaction fails.
   */
  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const { customerId, customerPhone, cartItems, shippingAddress } = input;

    if (!cartItems || cartItems.length === 0) {
      return {
        success: false,
        error: 'Cart is empty',
      };
    }

    // Group items by seller (for multi-seller support in future)
    const sellerGroups = this.groupItemsBySeller(cartItems);
    
    // For MVP, we only support single-seller orders
    if (Object.keys(sellerGroups).length > 1) {
      return {
        success: false,
        error: 'Multi-seller orders not supported yet. Please checkout items from one seller at a time.',
      };
    }

    const sellerId = Object.keys(sellerGroups)[0];
    if (!sellerId) {
      return {
        success: false,
        error: 'No seller found for cart items',
        outOfStockItems: [],
      };
    }
    
    const orderItems = sellerGroups[sellerId];
    if (!orderItems) {
      return {
        success: false,
        error: 'No items found for seller',
        outOfStockItems: [],
      };
    }

    try {
      // Verify all products exist and have sufficient stock
      const stockCheck = await this.verifyStock(orderItems);
      
      if (!stockCheck.success) {
        return {
          success: false,
          error: 'Some items are out of stock',
          outOfStockItems: stockCheck.outOfStockItems || [],
        };
      }

      // Calculate order totals
      const subtotal = orderItems.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
      const commissionAmount = Math.round(subtotal * this.commissionRate);
      const sellerAmount = subtotal - commissionAmount;

      // Generate order ID
      const orderId = this.generateOrderId();
      const orderUUID = randomUUID();

      // Create order object
      const order: Order = {
        id: orderUUID,
        orderId,
        customerId,
        customerPhone,
        sellerId,
        items: orderItems,
        subtotal,
        commissionRate: this.commissionRate,
        commissionAmount,
        sellerAmount,
        totalAmount: subtotal,
        status: 'PENDING_PAYMENT',
        shippingAddress,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Execute transaction
      await this.executeOrderTransaction(order, orderItems);

      logger.info('Order created successfully', {
        orderId: order.orderId,
        customerId,
        sellerId,
        totalAmount: order.totalAmount,
        itemCount: orderItems.length,
      });

      return {
        success: true,
        order,
      };
    } catch (error) {
      logger.error('Failed to create order', {
        customerId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Check if it's a transaction cancellation due to condition failure
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        return {
          success: false,
          error: 'Transaction failed: One or more items are out of stock or have been updated',
        };
      }

      return {
        success: false,
        error: 'Failed to create order. Please try again.',
      };
    }
  }

  /**
   * Execute DynamoDB transaction to create order and deduct inventory
   * 
   * CRITICAL: This uses TransactWriteItems to ensure atomicity
   */
  private async executeOrderTransaction(order: Order, items: OrderItem[]): Promise<void> {
    const tableName = await this.getTableName();

    // Build transaction items
    const transactItems = [];

    // 1. Create ORDER item
    transactItems.push({
      Put: {
        TableName: tableName,
        Item: marshall({
          PK: `ORDER#${order.id}`,
          SK: 'METADATA',
          ...order,
        }),
      },
    });

    // 2. For each product, deduct inventory with condition check
    for (const item of items) {
      transactItems.push({
        Update: {
          TableName: tableName,
          Key: marshall({
            PK: `PRODUCT#${item.productId}`,
            SK: 'METADATA',
          }),
          UpdateExpression: 'SET stockQuantity = stockQuantity - :quantity, updatedAt = :updatedAt',
          ConditionExpression: 'stockQuantity >= :quantity AND isActive = :active',
          ExpressionAttributeValues: marshall({
            ':quantity': item.quantity,
            ':updatedAt': new Date().toISOString(),
            ':active': true,
          }),
        },
      });
    }

    // 3. Create order index entry for seller (for querying seller's orders)
    transactItems.push({
      Put: {
        TableName: tableName,
        Item: marshall({
          PK: `SELLER#${order.sellerId}`,
          SK: `ORDER#${order.createdAt}#${order.id}`,
          orderId: order.orderId,
          orderUUID: order.id,
          customerId: order.customerId,
          totalAmount: order.totalAmount,
          status: order.status,
          createdAt: order.createdAt,
        }),
      },
    });

    // 4. Create order index entry for customer (for querying customer's orders)
    transactItems.push({
      Put: {
        TableName: tableName,
        Item: marshall({
          PK: `CUSTOMER#${order.customerId}`,
          SK: `ORDER#${order.createdAt}#${order.id}`,
          orderId: order.orderId,
          orderUUID: order.id,
          sellerId: order.sellerId,
          totalAmount: order.totalAmount,
          status: order.status,
          createdAt: order.createdAt,
        }),
      },
    });

    // Execute transaction
    const command = new TransactWriteItemsCommand({
      TransactItems: transactItems,
    });

    await dynamoDBClient.send(command);
  }

  /**
   * Verify all products have sufficient stock
   */
  private async verifyStock(items: OrderItem[]): Promise<{
    success: boolean;
    outOfStockItems?: string[];
  }> {
    const tableName = await this.getTableName();
    const outOfStockItems: string[] = [];

    for (const item of items) {
      const command = new GetItemCommand({
        TableName: tableName,
        Key: marshall({
          PK: `PRODUCT#${item.productId}`,
          SK: 'METADATA',
        }),
      });

      const response = await dynamoDBClient.send(command);

      if (!response.Item) {
        outOfStockItems.push(item.name);
        continue;
      }

      const product = unmarshall(response.Item);

      if (!product.isActive || product.stockQuantity < item.quantity) {
        outOfStockItems.push(item.name);
      }
    }

    return {
      success: outOfStockItems.length === 0,
      outOfStockItems: outOfStockItems.length > 0 ? outOfStockItems : [],
    };
  }

  /**
   * Group cart items by seller
   */
  private groupItemsBySeller(cartItems: CartItem[]): Record<string, OrderItem[]> {
    const groups: Record<string, OrderItem[]> = {};

    for (const item of cartItems) {
      if (!groups[item.sellerId]) {
        groups[item.sellerId] = [];
      }

      groups[item.sellerId]!.push({
        productId: item.productId,
        sellerId: item.sellerId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      });
    }

    return groups;
  }

  /**
   * Generate human-readable order ID
   * Format: VG-YYYYMMDD-NNNN
   */
  private generateOrderId(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

    return `VG-${year}${month}${day}-${random}`;
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<Order | null> {
    const tableName = await this.getTableName();
    
    const command = new GetItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `ORDER#${orderId}`,
        SK: 'METADATA',
      }),
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as Order;
  }
}
