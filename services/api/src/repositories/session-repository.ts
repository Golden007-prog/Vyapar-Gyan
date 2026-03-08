import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

const dynamoDBClient = new DynamoDBClient({});

export interface CartItem {
  productId: string;
  sellerId: string;
  name: string;
  price: number;
  quantity: number;
  addedAt: string;
}

export interface Session {
  id: string;
  customerId: string;
  phoneNumber: string;
  channelType: 'whatsapp';
  state: string;
  context?: Record<string, any>;
  cart?: CartItem[];
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ResolveOrCreateSessionInput {
  customerId: string;
  phoneNumber: string;
  channelType: 'whatsapp';
}

/**
 * SessionRepository
 * 
 * Manages WhatsApp session data in DynamoDB.
 * Uses PK: SESSION#{customerId}, SK: WHATSAPP#{phoneNumber} pattern.
 */
export class SessionRepository {
  private tableName: string;

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
   * Resolve existing session or create new one
   */
  async resolveOrCreate(input: ResolveOrCreateSessionInput): Promise<Session> {
    const { customerId, phoneNumber, channelType } = input;

    // Try to get existing session
    const existing = await this.getByCustomer(customerId, phoneNumber);
    if (existing) {
      // Update last activity timestamp
      await this.updateLastActivity(customerId, phoneNumber);
      logger.info('Existing session found', { sessionId: existing.id, customerId });
      return { ...existing, lastActivityAt: new Date().toISOString() };
    }

    // Create new session
    const session: Session = {
      id: randomUUID(),
      customerId,
      phoneNumber,
      channelType,
      state: 'greeting',
      context: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    await this.create(session);
    logger.info('New session created', { sessionId: session.id, customerId });
    
    return session;
  }

  /**
   * Get session by customer ID and phone number
   */
  async getByCustomer(customerId: string, phoneNumber: string): Promise<Session | null> {
    const tableName = await this.getTableName();
    const command = new GetItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
    });

    const response = await dynamoDBClient.send(command);
    
    if (!response.Item) {
      return null;
    }

    return unmarshall(response.Item) as Session;
  }

  /**
   * Create new session
   */
  async create(session: Session): Promise<void> {
    const tableName = await this.getTableName();
    const item = {
      PK: `SESSION#${session.customerId}`,
      SK: `WHATSAPP#${session.phoneNumber}`,
      ...session,
    };

    const command = new PutItemCommand({
      TableName: tableName,
      Item: marshall(item, { removeUndefinedValues: true }),
    });

    await dynamoDBClient.send(command);
  }

  /**
   * Update session state
   */
  async updateState(sessionId: string, customerId: string, phoneNumber: string, state: string): Promise<void> {
    const tableName = await this.getTableName();
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
      UpdateExpression: 'SET #state = :state, updatedAt = :updatedAt, lastActivityAt = :lastActivityAt',
      ExpressionAttributeNames: {
        '#state': 'state',
      },
      ExpressionAttributeValues: marshall({
        ':state': state,
        ':updatedAt': new Date().toISOString(),
        ':lastActivityAt': new Date().toISOString(),
      }),
    });

    await dynamoDBClient.send(command);
    logger.info('Session state updated', { sessionId, state });
  }

  /**
   * Update session context (conversation state)
   */
  async updateContext(
    sessionId: string,
    customerId: string,
    phoneNumber: string,
    context: Record<string, any>
  ): Promise<void> {
    const tableName = await this.getTableName();
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
      UpdateExpression: 'SET #context = :context, updatedAt = :updatedAt, lastActivityAt = :lastActivityAt',
      ExpressionAttributeNames: {
        '#context': 'context',
      },
      ExpressionAttributeValues: marshall({
        ':context': context,
        ':updatedAt': new Date().toISOString(),
        ':lastActivityAt': new Date().toISOString(),
      }),
    });

    await dynamoDBClient.send(command);
    logger.info('Session context updated', { sessionId });
  }

  /**
   * Update last activity timestamp
   */
  private async updateLastActivity(customerId: string, phoneNumber: string): Promise<void> {
    const tableName = await this.getTableName();
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
      UpdateExpression: 'SET lastActivityAt = :lastActivityAt',
      ExpressionAttributeValues: marshall({
        ':lastActivityAt': new Date().toISOString(),
      }, { removeUndefinedValues: true }),
    });

    await dynamoDBClient.send(command);
  }

  /**
   * Add item to cart
   */
  async addToCart(
    customerId: string,
    phoneNumber: string,
    item: Omit<CartItem, 'addedAt'>
  ): Promise<CartItem[]> {
    const tableName = await this.getTableName();
    
    // Get current session to retrieve existing cart
    const session = await this.getByCustomer(customerId, phoneNumber);
    const currentCart = session?.cart || [];

    // Check if product already in cart
    const existingItemIndex = currentCart.findIndex(
      (cartItem) => cartItem.productId === item.productId
    );

    let updatedCart: CartItem[];
    
    if (existingItemIndex >= 0) {
      // Update quantity if product already in cart
      updatedCart = [...currentCart];
      const existingItem = updatedCart[existingItemIndex];
      if (existingItem) {
        updatedCart[existingItemIndex] = {
          ...existingItem,
          quantity: existingItem.quantity + item.quantity,
          addedAt: new Date().toISOString(),
        };
      }
    } else {
      // Add new item to cart
      updatedCart = [
        ...currentCart,
        {
          ...item,
          addedAt: new Date().toISOString(),
        },
      ];
    }

    // Update cart in DynamoDB
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
      UpdateExpression: 'SET cart = :cart, updatedAt = :updatedAt, lastActivityAt = :lastActivityAt',
      ExpressionAttributeValues: marshall({
        ':cart': updatedCart,
        ':updatedAt': new Date().toISOString(),
        ':lastActivityAt': new Date().toISOString(),
      }),
    });

    await dynamoDBClient.send(command);
    logger.info('Item added to cart', { 
      customerId, 
      productId: item.productId, 
      quantity: item.quantity,
      cartSize: updatedCart.length 
    });

    return updatedCart;
  }

  /**
   * Remove item from cart
   */
  async removeFromCart(
    customerId: string,
    phoneNumber: string,
    productId: string
  ): Promise<CartItem[]> {
    const tableName = await this.getTableName();
    
    // Get current session to retrieve existing cart
    const session = await this.getByCustomer(customerId, phoneNumber);
    const currentCart = session?.cart || [];

    // Filter out the item
    const updatedCart = currentCart.filter(
      (cartItem) => cartItem.productId !== productId
    );

    // Update cart in DynamoDB
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
      UpdateExpression: 'SET cart = :cart, updatedAt = :updatedAt, lastActivityAt = :lastActivityAt',
      ExpressionAttributeValues: marshall({
        ':cart': updatedCart,
        ':updatedAt': new Date().toISOString(),
        ':lastActivityAt': new Date().toISOString(),
      }),
    });

    await dynamoDBClient.send(command);
    logger.info('Item removed from cart', { 
      customerId, 
      productId,
      cartSize: updatedCart.length 
    });

    return updatedCart;
  }

  /**
   * Get cart items
   */
  async getCart(customerId: string, phoneNumber: string): Promise<CartItem[]> {
    const session = await this.getByCustomer(customerId, phoneNumber);
    return session?.cart || [];
  }

  /**
   * Clear cart
   */
  async clearCart(customerId: string, phoneNumber: string): Promise<void> {
    const tableName = await this.getTableName();
    
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({
        PK: `SESSION#${customerId}`,
        SK: `WHATSAPP#${phoneNumber}`,
      }),
      UpdateExpression: 'SET cart = :cart, updatedAt = :updatedAt, lastActivityAt = :lastActivityAt',
      ExpressionAttributeValues: marshall({
        ':cart': [],
        ':updatedAt': new Date().toISOString(),
        ':lastActivityAt': new Date().toISOString(),
      }),
    });

    await dynamoDBClient.send(command);
    logger.info('Cart cleared', { customerId });
  }

  /**
   * Calculate cart subtotal
   */
  calculateCartSubtotal(cart: CartItem[]): number {
    return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
  }
}
