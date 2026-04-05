import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, ScanCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

// --- Types ---

interface CustomerRecord {
  userId: string;
  displayName: string;
  phoneNumber: string;
  preferredChannel: 'whatsapp' | 'web' | 'both';
  createdAt: string;
  updatedAt: string;
}

interface CustomerListItem {
  userId: string;
  name: string;
  phone: string;
  registeredDate: string;
  totalOrders: number;
  ltv: number;
  storesVisited: number;
  lastActive: string;
  preferredChannel: string;
}

interface CustomerSummary {
  totalCustomers: number;
  newThisMonth: number;
  averageLTV: number;
  averageOrdersPerCustomer: number;
}

interface CustomerDetail extends CustomerListItem {
  orders: OrderSummary[];
  chatHistory: ChatMessage[];
  favoriteStores: FavoriteStore[];
}

interface OrderSummary {
  orderId: string;
  sellerId: string;
  totalAmount: number;
  status: string;
  createdAt: string;
}

interface ChatMessage {
  messageId: string;
  content: unknown;
  channel: string;
  senderRole: string;
  createdAt: string;
}

interface FavoriteStore {
  sellerId: string;
  storeName: string;
  addedAt: string;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Admin Customers Handler
 *
 * Routes:
 *   GET /admin/customers          — paginated customer list with filters
 *   GET /admin/customers/{id}     — customer detail
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Admin customers request', {
    requestId,
    method: event.httpMethod,
    path: event.path,
    pathParams: event.pathParameters,
  });

  try {
    const userRole = extractUserRole(event);
    if (userRole !== 'admin') {
      return respond(403, { error: 'Forbidden', message: 'Admin access required' });
    }

    const customerId = event.pathParameters?.id;

    if (customerId) {
      return await handleGetCustomerDetail(customerId);
    }
    return await handleListCustomers(event);
  } catch (error) {
    logger.error('Admin customers handler error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return respond(500, { error: 'Internal Server Error', message: 'Failed to process request' });
  }
};


// ========================================================================
// List Customers
// ========================================================================

async function handleListCustomers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const search = qs.search?.toLowerCase() ?? '';
  const page = Math.max(1, parseInt(qs.page || '1', 10));
  const size = Math.min(100, Math.max(1, parseInt(qs.size || '20', 10)));
  const sort = qs.sort || 'registeredDate';
  const ltvMin = qs.ltv_min ? parseFloat(qs.ltv_min) : undefined;
  const ltvMax = qs.ltv_max ? parseFloat(qs.ltv_max) : undefined;
  const dateFrom = qs.date_from ?? '';
  const dateTo = qs.date_to ?? '';

  const config = await getConfig();
  const tableName = config.tableName;

  // Step 1: Scan all customer profiles
  const customers = await scanCustomerProfiles(tableName);

  // Step 2: For each customer, aggregate order data
  const enriched: CustomerListItem[] = [];
  for (const cust of customers) {
    const orderData = await aggregateCustomerOrders(tableName, cust.userId);
    enriched.push({
      userId: cust.userId,
      name: cust.displayName || 'Unknown',
      phone: cust.phoneNumber || '',
      registeredDate: cust.createdAt,
      totalOrders: orderData.totalOrders,
      ltv: orderData.ltv,
      storesVisited: orderData.distinctSellers,
      lastActive: cust.updatedAt || cust.createdAt,
      preferredChannel: cust.preferredChannel || 'web',
    });
  }

  // Step 3: Apply filters
  let filtered = enriched;

  if (search) {
    filtered = filtered.filter(
      (c) =>
        c.name.toLowerCase().includes(search) ||
        c.phone.includes(search),
    );
  }

  if (dateFrom) {
    filtered = filtered.filter((c) => c.registeredDate >= dateFrom);
  }
  if (dateTo) {
    filtered = filtered.filter((c) => c.registeredDate <= dateTo);
  }
  if (ltvMin !== undefined) {
    filtered = filtered.filter((c) => c.ltv >= ltvMin);
  }
  if (ltvMax !== undefined) {
    filtered = filtered.filter((c) => c.ltv <= ltvMax);
  }

  // Step 4: Sort
  filtered.sort((a, b) => {
    switch (sort) {
      case 'name': return a.name.localeCompare(b.name);
      case 'ltv': return b.ltv - a.ltv;
      case 'orders': return b.totalOrders - a.totalOrders;
      case 'lastActive': return b.lastActive.localeCompare(a.lastActive);
      default: return b.registeredDate.localeCompare(a.registeredDate);
    }
  });

  // Step 5: Compute summary
  const totalLTV = enriched.reduce((s, c) => s + c.ltv, 0);
  const totalOrders = enriched.reduce((s, c) => s + c.totalOrders, 0);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const newThisMonth = enriched.filter((c) => c.registeredDate >= monthStart).length;

  const summary: CustomerSummary = {
    totalCustomers: enriched.length,
    newThisMonth,
    averageLTV: enriched.length > 0 ? Math.round(totalLTV / enriched.length) : 0,
    averageOrdersPerCustomer: enriched.length > 0 ? Math.round((totalOrders / enriched.length) * 10) / 10 : 0,
  };

  // Step 6: Paginate
  const start = (page - 1) * size;
  const pageItems = filtered.slice(start, start + size);

  return respond(200, {
    customers: pageItems,
    summary,
    total: filtered.length,
    page,
    size,
    totalPages: Math.ceil(filtered.length / size),
  });
}

// ========================================================================
// Customer Detail
// ========================================================================

async function handleGetCustomerDetail(customerId: string): Promise<APIGatewayProxyResult> {
  const config = await getConfig();
  const tableName = config.tableName;

  // Get profile
  const profile = await getCustomerProfile(tableName, customerId);
  if (!profile) {
    return respond(404, { error: 'Not Found', message: 'Customer not found' });
  }

  // Get orders
  const orders = await getCustomerOrders(tableName, customerId);

  // Get chat history (last 50 messages)
  const chatHistory = await getCustomerChatHistory(tableName, customerId);

  // Get favorites
  const favorites = await getCustomerFavorites(tableName, customerId);

  // Aggregate order data
  const orderData = aggregateOrderData(orders);

  const detail: CustomerDetail = {
    userId: profile.userId,
    name: profile.displayName || 'Unknown',
    phone: profile.phoneNumber || '',
    registeredDate: profile.createdAt,
    totalOrders: orderData.totalOrders,
    ltv: orderData.ltv,
    storesVisited: orderData.distinctSellers,
    lastActive: profile.updatedAt || profile.createdAt,
    preferredChannel: profile.preferredChannel || 'web',
    orders: orders.map((o) => ({
      orderId: o.orderId || o.orderUUID || '',
      sellerId: o.sellerId || '',
      totalAmount: o.totalAmount || 0,
      status: o.status || 'unknown',
      createdAt: o.createdAt || '',
    })),
    chatHistory,
    favoriteStores: favorites,
  };

  return respond(200, { customer: detail });
}

// ========================================================================
// DynamoDB Helpers
// ========================================================================

async function scanCustomerProfiles(tableName: string): Promise<CustomerRecord[]> {
  const customers: CustomerRecord[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const res = await dynamoDBClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND #role = :role',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: {
          ':prefix': { S: 'USER#' },
          ':sk': { S: 'PROFILE' },
          ':role': { S: 'customer' },
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const rec = unmarshall(item);
      customers.push({
        userId: rec.userId,
        displayName: rec.displayName || rec.name || '',
        phoneNumber: rec.phoneNumber || rec.phone || '',
        preferredChannel: rec.preferredChannel || 'web',
        createdAt: rec.createdAt || '',
        updatedAt: rec.updatedAt || rec.createdAt || '',
      });
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return customers;
}

async function aggregateCustomerOrders(
  tableName: string,
  customerId: string,
): Promise<{ totalOrders: number; ltv: number; distinctSellers: number }> {
  const orders: any[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const res = await dynamoDBClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `CUSTOMER#${customerId}` },
          ':prefix': { S: 'ORDER#' },
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of res.Items ?? []) {
      orders.push(unmarshall(item));
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return aggregateOrderData(orders);
}

function aggregateOrderData(orders: any[]): {
  totalOrders: number;
  ltv: number;
  distinctSellers: number;
} {
  const sellerSet = new Set<string>();
  let ltv = 0;
  for (const o of orders) {
    ltv += o.totalAmount || 0;
    if (o.sellerId) sellerSet.add(o.sellerId);
  }
  return {
    totalOrders: orders.length,
    ltv: Math.round(ltv),
    distinctSellers: sellerSet.size,
  };
}

async function getCustomerProfile(tableName: string, customerId: string): Promise<CustomerRecord | null> {
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${customerId}` },
        ':sk': { S: 'PROFILE' },
      },
      Limit: 1,
    }),
  );
  if (!res.Items || res.Items.length === 0) return null;
  const rec = unmarshall(res.Items[0]);
  return {
    userId: rec.userId,
    displayName: rec.displayName || rec.name || '',
    phoneNumber: rec.phoneNumber || rec.phone || '',
    preferredChannel: rec.preferredChannel || 'web',
    createdAt: rec.createdAt || '',
    updatedAt: rec.updatedAt || rec.createdAt || '',
  };
}

async function getCustomerOrders(tableName: string, customerId: string): Promise<any[]> {
  const orders: any[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const res = await dynamoDBClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `CUSTOMER#${customerId}` },
          ':prefix': { S: 'ORDER#' },
        },
        ScanIndexForward: false,
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of res.Items ?? []) {
      orders.push(unmarshall(item));
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return orders;
}

async function getCustomerChatHistory(tableName: string, customerId: string): Promise<ChatMessage[]> {
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `THREAD#${customerId}` },
        ':prefix': { S: 'MSG#' },
      },
      ScanIndexForward: false,
      Limit: 50,
    }),
  );

  return (res.Items ?? []).map((item) => {
    const rec = unmarshall(item);
    return {
      messageId: rec.messageId || '',
      content: rec.content,
      channel: rec.channel || 'web',
      senderRole: rec.senderRole || 'system',
      createdAt: rec.createdAt || '',
    };
  });
}

async function getCustomerFavorites(tableName: string, customerId: string): Promise<FavoriteStore[]> {
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `CUSTOMER#${customerId}` },
        ':prefix': { S: 'FAVORITE#' },
      },
    }),
  );

  return (res.Items ?? []).map((item) => {
    const rec = unmarshall(item);
    return {
      sellerId: rec.sellerId || rec.SK?.replace('FAVORITE#', '') || '',
      storeName: rec.storeName || 'Unknown Store',
      addedAt: rec.addedAt || rec.createdAt || '',
    };
  });
}

// ========================================================================
// Utilities
// ========================================================================

function extractUserRole(event: APIGatewayProxyEvent): string | null {
  const authCtx = event.requestContext.authorizer;
  if (authCtx) {
    const claims = authCtx.claims || authCtx;
    if (claims['cognito:groups']) {
      const groups = claims['cognito:groups'];
      if (typeof groups === 'string' && groups.includes('admin')) return 'admin';
      if (Array.isArray(groups) && groups.includes('admin')) return 'admin';
    }
    if (claims['custom:role']) return claims['custom:role'];
  }
  const roleHeader = event.headers['x-user-role'] || event.headers['X-User-Role'];
  return roleHeader ?? null;
}

function respond(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
