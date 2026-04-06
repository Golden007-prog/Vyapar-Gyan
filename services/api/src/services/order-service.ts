import { DynamoDBClient, TransactWriteItemsCommand, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';
import { CartItem } from '../repositories/session-repository';
import type { OrderStatus, TransitionActor } from './order-state-machine';
import { validateTransition, requiresStockUnreservation, requiresStockFinalization } from './order-state-machine';

const dynamoDBClient = new DynamoDBClient({});
const eventBridgeClient = new EventBridgeClient({});

/** EventBridge source for order events */
const ORDER_EVENT_SOURCE = 'vyapargyan.orders';

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
  status: OrderStatus;
  channel: 'whatsapp' | 'web';
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
  sellerId: string;
  cartItems: CartItem[];
  channel: 'whatsapp' | 'web';
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
 * Transition order input
 */
export interface TransitionOrderInput {
  orderId: string;
  targetStatus: OrderStatus;
  actor: TransitionActor;
  actorId: string;
  reason?: string;
}

/**
 * Transition order result
 */
export interface TransitionOrderResult {
  success: boolean;
  order?: Order;
  error?: string;
}

/**
 * Order summary for list queries (seller and customer index entries)
 */
export interface OrderSummary {
  orderId: string;
  orderUUID: string;
  customerId?: string;
  sellerId?: string;
  totalAmount: number;
  status: string;
  createdAt: string;
}

/**
 * OrderService
 *
 * Handles order creation with DynamoDB transactions to ensure:
 * 1. Stock is reserved atomically via reserved_stock
 * 2. Order is created only if all items have available stock
 * 3. No overselling occurs
 * 4. Audit log entry is created for every order
 * 5. EventBridge event is published after successful transaction
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
   * Create order using DynamoDB TransactWriteItems.
   *
   * Atomic transaction:
   *  1. Put ORDER#{orderUUID} METADATA with status pending_seller_confirmation
   *  2. Update PRODUCT#{productId} METADATA to increment reserved_stock
   *  3. Put SELLER#{sellerId} ORDER#{createdAt}#{orderUUID} index entry
   *  4. Put CUSTOMER#{customerId} ORDER#{createdAt}#{orderUUID} index entry
   *  5. Put AUDIT#{date}#{auditUUID} ORDER#{orderUUID} audit log entry
   *
   * After success, publishes order.created event to EventBridge.
   */
  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    const { customerId, customerPhone, cartItems, shippingAddress, channel } = input;

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

    const sellerId = input.sellerId || Object.keys(sellerGroups)[0];
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
      const subtotal = orderItems.reduce((sum: number, item: OrderItem) => sum + (item.price * item.quantity), 0);
      const commissionAmount = Math.round(subtotal * this.commissionRate);
      const sellerAmount = subtotal - commissionAmount;

      // Generate order ID
      const orderId = this.generateOrderId();
      const orderUUID = randomUUID();
      const now = new Date().toISOString();

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
        status: 'pending_seller_confirmation',
        channel,
        shippingAddress,
        createdAt: now,
        updatedAt: now,
      };

      // Execute transaction
      await this.executeOrderTransaction(order, orderItems);

      logger.info('Order created successfully', {
        orderId: order.orderId,
        customerId,
        sellerId,
        totalAmount: order.totalAmount,
        itemCount: orderItems.length,
        channel,
      });

      // Publish order.created event to EventBridge (non-blocking)
      await this.publishOrderEvent('order.created', order);

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
   * Execute DynamoDB transaction to create order and reserve stock.
   *
   * CRITICAL: Uses TransactWriteItems for atomicity.
   * Stock reservation uses reserved_stock instead of direct stockQuantity deduction.
   */
  private async executeOrderTransaction(order: Order, items: OrderItem[]): Promise<void> {
    const tableName = await this.getTableName();
    const now = order.createdAt;
    const auditUUID = randomUUID();

    // Build transaction items
    const transactItems = [];

    // 1. Create ORDER item with status pending_seller_confirmation
    transactItems.push({
      Put: {
        TableName: tableName,
        Item: marshall({
          PK: `ORDER#${order.id}`,
          SK: 'METADATA',
          ...order,
        }),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    });

    // 2. For each product, reserve stock with condition check
    for (const item of items) {
      transactItems.push({
        Update: {
          TableName: tableName,
          Key: marshall({
            PK: `PRODUCT#${item.productId}`,
            SK: 'METADATA',
          }),
          UpdateExpression: 'SET reserved_stock = if_not_exists(reserved_stock, :zero) + :qty, updatedAt = :updatedAt',
          ConditionExpression: 'stockQuantity - if_not_exists(reserved_stock, :zero) >= :qty',
          ExpressionAttributeValues: marshall({
            ':qty': item.quantity,
            ':updatedAt': now,
            ':zero': 0,
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
          SK: `ORDER#${now}#${order.id}`,
          orderId: order.orderId,
          orderUUID: order.id,
          customerId: order.customerId,
          totalAmount: order.totalAmount,
          status: order.status,
          createdAt: now,
        }),
      },
    });

    // 4. Create order index entry for customer (for querying customer's orders)
    transactItems.push({
      Put: {
        TableName: tableName,
        Item: marshall({
          PK: `CUSTOMER#${order.customerId}`,
          SK: `ORDER#${now}#${order.id}`,
          orderId: order.orderId,
          orderUUID: order.id,
          sellerId: order.sellerId,
          totalAmount: order.totalAmount,
          status: order.status,
          createdAt: now,
        }),
      },
    });

    // 5. Create audit log entry
    transactItems.push({
      Put: {
        TableName: tableName,
        Item: marshall({
          PK: `AUDIT#${now.slice(0, 10)}#${auditUUID}`,
          SK: `ORDER#${order.id}`,
          actorId: order.customerId,
          actorRole: 'customer',
          oldStatus: null,
          newStatus: 'pending_seller_confirmation',
          timestamp: now,
          orderId: order.orderId,
          channel: order.channel,
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
   * Publish an order event to EventBridge.
   * Non-fatal — logs errors but does not throw.
   */
  private async publishOrderEvent(detailType: string, order: Order): Promise<void> {
    try {
      const eventBusName = process.env.EVENT_BUS_NAME || 'default';
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: ORDER_EVENT_SOURCE,
              DetailType: detailType,
              Detail: JSON.stringify({
                orderId: order.id,
                humanReadableId: order.orderId,
                sellerId: order.sellerId,
                customerId: order.customerId,
                items: order.items,
                subtotal: order.subtotal,
                totalAmount: order.totalAmount,
                commissionRate: order.commissionRate,
                commissionAmount: order.commissionAmount,
                sellerAmount: order.sellerAmount,
                status: order.status,
                channel: order.channel,
                timestamp: order.createdAt,
              }),
              EventBusName: eventBusName,
            },
          ],
        }),
      );
      logger.debug('Order event published', { detailType, orderId: order.orderId });
    } catch (err) {
      // Non-fatal — the transaction already succeeded
      logger.error('Failed to publish order event', err, {
        detailType,
        orderId: order.orderId,
      });
    }
  }

  /**
   * Verify all products have sufficient available stock.
   * Available stock = stockQuantity - reserved_stock.
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
      const reservedStock = (product.reserved_stock as number) || 0;
      const availableStock = (product.stockQuantity as number) - reservedStock;

      if (!product.isActive || availableStock < item.quantity) {
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
    return generateOrderId(new Date());
  }

  /**
   * Transition order to a new status with validation and optimistic concurrency.
   *
   * 1. Fetch current order
   * 2. Validate transition via state machine
   * 3. Query seller and customer index entries (SK includes createdAt)
   * 4. Build TransactWriteItems:
   *    - Update ORDER metadata with ConditionExpression on current status
   *    - Update SELLER index entry status
   *    - Update CUSTOMER index entry status
   *    - Put AUDIT log entry
   *    - If unreservation needed: decrement reserved_stock per item
   *    - If finalization needed: decrement both stockQuantity and reserved_stock per item
   * 5. Publish EventBridge event order.{targetStatus}
   */
  async transitionOrder(input: TransitionOrderInput): Promise<TransitionOrderResult> {
    const { orderId, targetStatus, actor, actorId, reason } = input;

    try {
      // 1. Fetch current order
      const order = await this.getOrder(orderId);
      if (!order) {
        return { success: false, error: `Order ${orderId} not found` };
      }

      const currentStatus = order.status;

      // 2. Validate transition
      const validation = validateTransition(currentStatus, targetStatus, actor);
      if (!validation.valid) {
        return { success: false, error: validation.error || 'Invalid transition' };
      }

      const tableName = await this.getTableName();
      const now = new Date().toISOString();
      const auditUUID = randomUUID();

      // 3. Find seller and customer index entries via Query
      const [sellerIndexSK, customerIndexSK] = await Promise.all([
        this.findIndexEntrySK(tableName, `SELLER#${order.sellerId}`, order.id),
        this.findIndexEntrySK(tableName, `CUSTOMER#${order.customerId}`, order.id),
      ]);

      // Build transaction items
      const transactItems: any[] = [];

      // 4a. Update ORDER metadata with conditional check on current status
      const updateExprParts = [
        '#status = :newStatus',
        'updatedAt = :now',
      ];
      const exprAttrNames: Record<string, string> = { '#status': 'status' };
      const exprAttrValues: Record<string, any> = {
        ':newStatus': targetStatus,
        ':expectedStatus': currentStatus,
        ':now': now,
      };

      // Add reason for rejections
      if (reason) {
        updateExprParts.push('rejectionReason = :reason');
        exprAttrValues[':reason'] = reason;
      }

      // Add timestamp fields based on target status
      if (targetStatus === 'confirmed') {
        updateExprParts.push('confirmedAt = :now');
      } else if (targetStatus === 'paid') {
        updateExprParts.push('paidAt = :now');
      } else if (targetStatus === 'delivered') {
        updateExprParts.push('deliveredAt = :now');
      }

      transactItems.push({
        Update: {
          TableName: tableName,
          Key: marshall({ PK: `ORDER#${order.id}`, SK: 'METADATA' }),
          UpdateExpression: `SET ${updateExprParts.join(', ')}`,
          ConditionExpression: '#status = :expectedStatus',
          ExpressionAttributeNames: exprAttrNames,
          ExpressionAttributeValues: marshall(exprAttrValues),
        },
      });

      // 4b. Update SELLER index entry status
      if (sellerIndexSK) {
        transactItems.push({
          Update: {
            TableName: tableName,
            Key: marshall({ PK: `SELLER#${order.sellerId}`, SK: sellerIndexSK }),
            UpdateExpression: 'SET #status = :newStatus',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: marshall({ ':newStatus': targetStatus }),
          },
        });
      }

      // 4c. Update CUSTOMER index entry status
      if (customerIndexSK) {
        transactItems.push({
          Update: {
            TableName: tableName,
            Key: marshall({ PK: `CUSTOMER#${order.customerId}`, SK: customerIndexSK }),
            UpdateExpression: 'SET #status = :newStatus',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: marshall({ ':newStatus': targetStatus }),
          },
        });
      }

      // 4d. Audit log entry
      transactItems.push({
        Put: {
          TableName: tableName,
          Item: marshall({
            PK: `AUDIT#${now.slice(0, 10)}#${auditUUID}`,
            SK: `ORDER#${order.id}`,
            actorId,
            actorRole: actor,
            oldStatus: currentStatus,
            newStatus: targetStatus,
            reason: reason || null,
            timestamp: now,
            orderId: order.orderId,
          }),
        },
      });

      // 4e. Stock unreservation for rejected, cancelled, expired
      if (requiresStockUnreservation(targetStatus)) {
        for (const item of order.items) {
          transactItems.push({
            Update: {
              TableName: tableName,
              Key: marshall({ PK: `PRODUCT#${item.productId}`, SK: 'METADATA' }),
              UpdateExpression: 'SET reserved_stock = reserved_stock - :qty, updatedAt = :now',
              ExpressionAttributeValues: marshall({ ':qty': item.quantity, ':now': now }),
            },
          });
        }
      }

      // 4f. Stock finalization for paid (decrement both stockQuantity and reserved_stock)
      if (requiresStockFinalization(targetStatus)) {
        for (const item of order.items) {
          transactItems.push({
            Update: {
              TableName: tableName,
              Key: marshall({ PK: `PRODUCT#${item.productId}`, SK: 'METADATA' }),
              UpdateExpression: 'SET stockQuantity = stockQuantity - :qty, reserved_stock = reserved_stock - :qty, updatedAt = :now',
              ExpressionAttributeValues: marshall({ ':qty': item.quantity, ':now': now }),
            },
          });
        }
      }

      // Execute transaction
      await dynamoDBClient.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));

      // Build updated order for response
      const updatedOrder: Order = {
        ...order,
        status: targetStatus,
        updatedAt: now,
        ...(reason ? { rejectionReason: reason } : {}),
      };

      logger.info('Order transitioned successfully', {
        orderId: order.orderId,
        from: currentStatus,
        to: targetStatus,
        actor,
        actorId,
      });

      // 5. Publish EventBridge event (non-blocking)
      await this.publishOrderEvent(`order.${targetStatus}`, updatedOrder);

      return { success: true, order: updatedOrder };
    } catch (error) {
      // Handle optimistic concurrency failure
      if (error instanceof Error && error.name === 'TransactionCanceledException') {
        logger.warn('Order transition conflict — status changed concurrently', {
          orderId,
          targetStatus,
          actor,
        });
        return {
          success: false,
          error: 'Order status has been modified concurrently. Please retry.',
        };
      }

      logger.error('Failed to transition order', error, {
        orderId,
        targetStatus,
        actor,
      });

      return {
        success: false,
        error: 'Failed to transition order. Please try again.',
      };
    }
  }

  /**
   * Find the SK of a seller or customer index entry for a given orderUUID.
   * The SK format is ORDER#{createdAt}#{orderUUID}, so we query by PK and
   * SK begins_with 'ORDER#' then filter by orderUUID.
   */
  private async findIndexEntrySK(tableName: string, pk: string, orderUUID: string): Promise<string | null> {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'orderUUID = :orderUUID',
      ExpressionAttributeValues: marshall({
        ':pk': pk,
        ':skPrefix': 'ORDER#',
        ':orderUUID': orderUUID,
      }),
      Limit: 10,
    });

    const response = await dynamoDBClient.send(command);

    if (response.Items && response.Items.length > 0) {
      const item = unmarshall(response.Items[0]!);
      return item.SK as string;
    }

    logger.warn('Index entry not found', { pk, orderUUID });
    return null;
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

  /**
   * List orders for a seller, sorted by creation date descending.
   * Uses PK: SELLER#{sellerId}, SK begins_with ORDER#.
   * Supports optional status filter and limit.
   */
  async listSellerOrders(sellerId: string, statusFilter?: OrderStatus, limit: number = 50): Promise<OrderSummary[]> {
    const tableName = await this.getTableName();

    const expressionAttrValues: Record<string, any> = {
      ':pk': `SELLER#${sellerId}`,
      ':skPrefix': 'ORDER#',
    };

    let filterExpression: string | undefined;
    if (statusFilter) {
      filterExpression = '#status = :statusFilter';
      expressionAttrValues[':statusFilter'] = statusFilter;
    }

    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ...(filterExpression ? {
        FilterExpression: filterExpression,
        ExpressionAttributeNames: { '#status': 'status' },
      } : {}),
      ExpressionAttributeValues: marshall(expressionAttrValues),
      ScanIndexForward: false,
      Limit: limit,
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map(item => {
      const record = unmarshall(item);
      return {
        orderId: record.orderId as string,
        orderUUID: record.orderUUID as string,
        customerId: record.customerId as string,
        totalAmount: record.totalAmount as number,
        status: record.status as string,
        createdAt: record.createdAt as string,
      };
    });
  }

  /**
   * List orders for a customer, sorted by creation date descending.
   * Uses PK: CUSTOMER#{customerId}, SK begins_with ORDER#.
   * Supports optional status filter and limit.
   */
  async listCustomerOrders(customerId: string, statusFilter?: OrderStatus, limit: number = 50): Promise<OrderSummary[]> {
    const tableName = await this.getTableName();

    const expressionAttrValues: Record<string, any> = {
      ':pk': `CUSTOMER#${customerId}`,
      ':skPrefix': 'ORDER#',
    };

    let filterExpression: string | undefined;
    if (statusFilter) {
      filterExpression = '#status = :statusFilter';
      expressionAttrValues[':statusFilter'] = statusFilter;
    }

    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ...(filterExpression ? {
        FilterExpression: filterExpression,
        ExpressionAttributeNames: { '#status': 'status' },
      } : {}),
      ExpressionAttributeValues: marshall(expressionAttrValues),
      ScanIndexForward: false,
      Limit: limit,
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map(item => {
      const record = unmarshall(item);
      return {
        orderId: record.orderId as string,
        orderUUID: record.orderUUID as string,
        sellerId: record.sellerId as string,
        totalAmount: record.totalAmount as number,
        status: record.status as string,
        createdAt: record.createdAt as string,
      };
    });
  }
}


/**
 * Generate human-readable order ID for a given date.
 * Format: VG-YYYYMMDD-NNNN
 *
 * Exported for testability (Property 9).
 */
export function generateOrderId(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');

  return `VG-${year}${month}${day}-${random}`;
}
