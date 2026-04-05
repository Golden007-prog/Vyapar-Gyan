import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, ScanCommand, QueryCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { RazorpayAdapter } from '../../adapters/razorpay-adapter';
import { randomUUID } from 'crypto';

const dynamoDBClient = new DynamoDBClient({});

// --- Types ---

export type TransferStatus = 'completed' | 'pending' | 'failed' | 'reversed';

export interface TransferRecord {
  transferId: string;
  orderId: string;
  sellerId: string;
  sellerName: string;
  orderAmount: number;
  commissionRate: number;
  commissionAmount: number;
  sellerAmount: number;
  transferStatus: TransferStatus;
  razorpayTransferId: string;
  createdAt: string;
  updatedAt: string;
}

interface FinancialSummary {
  totalPlatformRevenue: number;
  totalCommissionEarned: number;
  pendingSettlements: number;
  failedPayouts: number;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Admin Financials Handler
 *
 * Routes:
 *   GET  /admin/financials/summary                  — financial summary cards
 *   GET  /admin/financials/transactions              — paginated transactions with filters
 *   POST /admin/financials/transactions/{id}/retry   — retry failed payout
 *   GET  /admin/financials/export                    — CSV export of filtered transactions
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Admin financials request', {
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

    const method = event.httpMethod;
    const path = event.path || '';
    const transferId = event.pathParameters?.id;

    // POST /admin/financials/transactions/{id}/retry
    if (method === 'POST' && transferId && path.includes('/retry')) {
      return await handleRetryTransfer(transferId, event);
    }

    // GET /admin/financials/export
    if (method === 'GET' && path.endsWith('/export')) {
      return await handleExportCSV(event);
    }

    // GET /admin/financials/summary
    if (method === 'GET' && path.endsWith('/summary')) {
      return await handleGetSummary();
    }

    // GET /admin/financials/transactions
    if (method === 'GET' && path.includes('/transactions')) {
      return await handleListTransactions(event);
    }

    // Fallback: GET /admin/financials → summary
    if (method === 'GET') {
      return await handleGetSummary();
    }

    return respond(404, { error: 'Not Found' });
  } catch (error) {
    logger.error('Admin financials handler error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return respond(500, { error: 'Internal Server Error', message: 'Failed to process request' });
  }
};


// ========================================================================
// Summary
// ========================================================================

async function handleGetSummary(): Promise<APIGatewayProxyResult> {
  const config = await getConfig();
  const tableName = config.tableName;

  const transfers = await scanTransfers(tableName);

  let totalRevenue = 0;
  let totalCommission = 0;
  let pendingSettlements = 0;
  let failedPayouts = 0;

  for (const t of transfers) {
    totalRevenue += t.orderAmount;
    totalCommission += t.commissionAmount;
    if (t.transferStatus === 'pending') pendingSettlements++;
    if (t.transferStatus === 'failed') failedPayouts++;
  }

  const summary: FinancialSummary = {
    totalPlatformRevenue: Math.round(totalRevenue),
    totalCommissionEarned: Math.round(totalCommission),
    pendingSettlements,
    failedPayouts,
  };

  return respond(200, { summary });
}

// ========================================================================
// List Transactions
// ========================================================================

async function handleListTransactions(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const dateFrom = qs.date_from ?? '';
  const dateTo = qs.date_to ?? '';
  const sellerFilter = qs.seller ?? '';
  const statusFilter = qs.status as TransferStatus | undefined;
  const page = Math.max(1, parseInt(qs.page || '1', 10));
  const size = Math.min(100, Math.max(1, parseInt(qs.size || '20', 10)));

  const config = await getConfig();
  const tableName = config.tableName;

  let transfers: TransferRecord[];

  // If filtering by seller, use GSI query
  if (sellerFilter) {
    transfers = await queryTransfersBySeller(tableName, sellerFilter);
  } else {
    transfers = await scanTransfers(tableName);
  }

  // Enrich with seller names
  transfers = await enrichTransfersWithSellerNames(tableName, transfers);

  // Apply filters
  let filtered = transfers;
  if (dateFrom) {
    filtered = filtered.filter((t) => t.createdAt >= dateFrom);
  }
  if (dateTo) {
    filtered = filtered.filter((t) => t.createdAt <= dateTo);
  }
  if (statusFilter) {
    filtered = filtered.filter((t) => t.transferStatus === statusFilter);
  }

  // Sort by createdAt descending
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Paginate
  const start = (page - 1) * size;
  const pageItems = filtered.slice(start, start + size);

  return respond(200, {
    transactions: pageItems,
    total: filtered.length,
    page,
    size,
    totalPages: Math.ceil(filtered.length / size),
  });
}

// ========================================================================
// Retry Failed Transfer
// ========================================================================

async function handleRetryTransfer(
  transferId: string,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const config = await getConfig();
  const tableName = config.tableName;

  const transfer = await getTransfer(tableName, transferId);
  if (!transfer) {
    return respond(404, { error: 'Not Found', message: 'Transfer not found' });
  }

  if (transfer.transferStatus !== 'failed') {
    return respond(409, { error: 'Conflict', message: 'Only failed transfers can be retried' });
  }

  const now = new Date().toISOString();

  try {
    const razorpay = new RazorpayAdapter();
    // Re-create the payment link with transfer to retry the payout
    const result = await razorpay.createPaymentLink({
      orderId: transfer.orderId,
      amount: transfer.orderAmount,
      customerPhone: '',
      sellerAccountId: transfer.sellerId,
      commissionAmount: transfer.commissionAmount,
    });

    // Update transfer status to pending
    await updateTransferStatus(tableName, transferId, 'pending', result.id, now);

    // Write audit log
    const adminId = extractUserId(event) || 'admin';
    await writeAuditLog(tableName, {
      actorId: adminId,
      actionType: 'transfer.retry',
      resourceType: 'TRANSFER',
      resourceId: transferId,
      newValues: { transferStatus: 'pending', razorpayTransferId: result.id },
    });

    logger.info('Transfer retry initiated', { transferId, newPaymentLinkId: result.id });

    return respond(200, {
      message: 'Transfer retry initiated',
      transfer: { transferId, transferStatus: 'pending', razorpayTransferId: result.id },
    });
  } catch (error) {
    logger.error('Transfer retry failed', {
      transferId,
      error: error instanceof Error ? error.message : String(error),
    });
    return respond(502, {
      error: 'Bad Gateway',
      message: 'Failed to retry transfer via Razorpay',
    });
  }
}

// ========================================================================
// CSV Export
// ========================================================================

async function handleExportCSV(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const dateFrom = qs.date_from ?? '';
  const dateTo = qs.date_to ?? '';
  const sellerFilter = qs.seller ?? '';
  const statusFilter = qs.status as TransferStatus | undefined;

  const config = await getConfig();
  const tableName = config.tableName;

  let transfers: TransferRecord[];
  if (sellerFilter) {
    transfers = await queryTransfersBySeller(tableName, sellerFilter);
  } else {
    transfers = await scanTransfers(tableName);
  }

  transfers = await enrichTransfersWithSellerNames(tableName, transfers);

  // Apply filters
  let filtered = transfers;
  if (dateFrom) filtered = filtered.filter((t) => t.createdAt >= dateFrom);
  if (dateTo) filtered = filtered.filter((t) => t.createdAt <= dateTo);
  if (statusFilter) filtered = filtered.filter((t) => t.transferStatus === statusFilter);

  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Build CSV
  const header = 'Date,Order ID,Seller,Order Amount,Commission %,Commission Amount,Seller Amount,Status,Razorpay Transfer ID';
  const rows = filtered.map((t) =>
    [
      t.createdAt,
      t.orderId,
      `"${t.sellerName}"`,
      t.orderAmount.toFixed(2),
      (t.commissionRate * 100).toFixed(1),
      t.commissionAmount.toFixed(2),
      t.sellerAmount.toFixed(2),
      t.transferStatus,
      t.razorpayTransferId,
    ].join(','),
  );
  const csv = [header, ...rows].join('\n');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="financials-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Access-Control-Allow-Origin': '*',
    },
    body: csv,
  };
}


// ========================================================================
// DynamoDB Helpers
// ========================================================================

async function scanTransfers(tableName: string): Promise<TransferRecord[]> {
  const transfers: TransferRecord[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const res = await dynamoDBClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
        ExpressionAttributeValues: {
          ':prefix': { S: 'TRANSFER#' },
          ':sk': { S: 'METADATA' },
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const rec = unmarshall(item);
      transfers.push(mapToTransferRecord(rec));
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return transfers;
}

async function queryTransfersBySeller(tableName: string, sellerId: string): Promise<TransferRecord[]> {
  const transfers: TransferRecord[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const res = await dynamoDBClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'TransferSellerIndex',
        KeyConditionExpression: 'GSI3PK = :pk',
        ExpressionAttributeValues: {
          ':pk': { S: `SELLER#${sellerId}` },
        },
        ScanIndexForward: false,
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const rec = unmarshall(item);
      transfers.push(mapToTransferRecord(rec));
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return transfers;
}

async function getTransfer(tableName: string, transferId: string): Promise<TransferRecord | null> {
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `TRANSFER#${transferId}` },
        ':sk': { S: 'METADATA' },
      },
      Limit: 1,
    }),
  );
  if (!res.Items || res.Items.length === 0) return null;
  return mapToTransferRecord(unmarshall(res.Items[0]));
}

function mapToTransferRecord(rec: Record<string, any>): TransferRecord {
  return {
    transferId: rec.transferId || rec.PK?.replace('TRANSFER#', '') || '',
    orderId: rec.orderId || '',
    sellerId: rec.sellerId || '',
    sellerName: rec.sellerName || '',
    orderAmount: rec.orderAmount || 0,
    commissionRate: rec.commissionRate || 0,
    commissionAmount: rec.commissionAmount || 0,
    sellerAmount: rec.sellerAmount || (rec.orderAmount || 0) - (rec.commissionAmount || 0),
    transferStatus: rec.transferStatus || 'pending',
    razorpayTransferId: rec.razorpayTransferId || '',
    createdAt: rec.createdAt || '',
    updatedAt: rec.updatedAt || rec.createdAt || '',
  };
}

async function enrichTransfersWithSellerNames(
  tableName: string,
  transfers: TransferRecord[],
): Promise<TransferRecord[]> {
  const cache = new Map<string, string>();

  const getName = async (sellerId: string): Promise<string> => {
    if (!sellerId) return 'Unknown';
    if (cache.has(sellerId)) return cache.get(sellerId)!;
    const name = await getUserDisplayName(tableName, sellerId);
    cache.set(sellerId, name);
    return name;
  };

  const enriched: TransferRecord[] = [];
  for (const t of transfers) {
    enriched.push({ ...t, sellerName: t.sellerName || await getName(t.sellerId) });
  }
  return enriched;
}

async function getUserDisplayName(tableName: string, userId: string): Promise<string> {
  if (!userId) return 'Unknown';
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':sk': { S: 'PROFILE' },
      },
      ProjectionExpression: 'displayName, businessName',
      Limit: 1,
    }),
  );
  if (!res.Items || res.Items.length === 0) return 'Unknown';
  const rec = unmarshall(res.Items[0]);
  return rec.businessName || rec.displayName || 'Unknown';
}

async function updateTransferStatus(
  tableName: string,
  transferId: string,
  status: TransferStatus,
  razorpayTransferId: string,
  updatedAt: string,
): Promise<void> {
  await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ PK: `TRANSFER#${transferId}`, SK: 'METADATA' }),
      UpdateExpression: 'SET transferStatus = :s, razorpayTransferId = :r, updatedAt = :u',
      ExpressionAttributeValues: marshall({
        ':s': status,
        ':r': razorpayTransferId,
        ':u': updatedAt,
      }),
    }),
  );
}

async function writeAuditLog(
  tableName: string,
  params: {
    actorId: string;
    actionType: string;
    resourceType: string;
    resourceId: string;
    newValues?: Record<string, unknown>;
  },
): Promise<void> {
  const auditId = randomUUID();
  const now = new Date().toISOString();

  await dynamoDBClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: marshall(
        {
          PK: `AUDIT#${auditId}`,
          SK: `TS#${now}`,
          GSI1PK: `ACTOR#${params.actorId}`,
          GSI1SK: `TS#${now}`,
          GSI2PK: `RESOURCE#${params.resourceType}#${params.resourceId}`,
          GSI2SK: `TS#${now}`,
          auditId,
          actorId: params.actorId,
          actorRole: 'admin',
          actionType: params.actionType,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          newValues: params.newValues,
          createdAt: now,
        },
        { removeUndefinedValues: true },
      ),
    }),
  );
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

function extractUserId(event: APIGatewayProxyEvent): string | null {
  const authCtx = event.requestContext.authorizer;
  if (authCtx) {
    const claims = authCtx.claims || authCtx;
    if (claims.sub) return claims.sub;
  }
  return event.headers['x-user-id'] || event.headers['X-User-Id'] || null;
}

function respond(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}
