import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, ScanCommand, QueryCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { RazorpayAdapter } from '../../adapters/razorpay-adapter';
import { randomUUID } from 'crypto';

const dynamoDBClient = new DynamoDBClient({});

// --- Types ---

export type DisputeIssueType = 'wrong_item' | 'not_delivered' | 'quality_issue' | 'refund_request' | 'payment_failed';
export type DisputeStatus = 'open' | 'in_progress' | 'resolved' | 'dismissed';
export type ResolutionAction = 'refund_full' | 'refund_partial' | 'replace' | 'dismiss' | 'escalate';

export interface DisputeRecord {
  disputeId: string;
  orderId: string;
  customerId: string;
  sellerId: string;
  issueType: DisputeIssueType;
  status: DisputeStatus;
  adminNotes: string;
  resolution: {
    action: ResolutionAction;
    amount?: number;
    resolvedBy?: string;
    resolvedAt?: string;
    notes?: string;
  } | null;
  evidenceUrls: string[];
  createdAt: string;
  updatedAt: string;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Admin Disputes Handler
 *
 * Routes:
 *   GET    /admin/disputes          — paginated dispute list with filters
 *   GET    /admin/disputes/{id}     — dispute detail with order, chat, evidence
 *   POST   /admin/disputes/{id}/resolve — resolution actions
 *   PUT    /admin/disputes/{id}/notes   — update admin notes
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Admin disputes request', {
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

    const disputeId = event.pathParameters?.id;
    const method = event.httpMethod;
    const resourcePath = event.resource || event.path || '';

    // POST /admin/disputes/{id}/resolve
    if (method === 'POST' && disputeId && resourcePath.endsWith('/resolve')) {
      return await handleResolveDispute(disputeId, event);
    }

    // PUT /admin/disputes/{id}/notes
    if (method === 'PUT' && disputeId && resourcePath.endsWith('/notes')) {
      return await handleUpdateNotes(disputeId, event);
    }

    // GET /admin/disputes/{id}
    if (disputeId) {
      return await handleGetDisputeDetail(disputeId);
    }

    // GET /admin/disputes
    return await handleListDisputes(event);
  } catch (error) {
    logger.error('Admin disputes handler error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return respond(500, { error: 'Internal Server Error', message: 'Failed to process request' });
  }
};

// ========================================================================
// List Disputes
// ========================================================================

async function handleListDisputes(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const statusFilter = qs.status as DisputeStatus | undefined;
  const issueTypeFilter = qs.issue_type as DisputeIssueType | undefined;
  const page = Math.max(1, parseInt(qs.page || '1', 10));
  const size = Math.min(100, Math.max(1, parseInt(qs.size || '20', 10)));

  const config = await getConfig();
  const tableName = config.tableName;

  // Scan all DISPUTE# records
  const disputes = await scanDisputes(tableName);

  // Apply filters
  let filtered = disputes;
  if (statusFilter) {
    filtered = filtered.filter((d) => d.status === statusFilter);
  }
  if (issueTypeFilter) {
    filtered = filtered.filter((d) => d.issueType === issueTypeFilter);
  }

  // Sort by createdAt descending (newest first)
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Paginate
  const start = (page - 1) * size;
  const pageItems = filtered.slice(start, start + size);

  // Enrich with customer/seller names
  const enriched = await enrichDisputeList(tableName, pageItems);

  return respond(200, {
    disputes: enriched,
    total: filtered.length,
    page,
    size,
    totalPages: Math.ceil(filtered.length / size),
  });
}

// ========================================================================
// Dispute Detail
// ========================================================================

async function handleGetDisputeDetail(disputeId: string): Promise<APIGatewayProxyResult> {
  const config = await getConfig();
  const tableName = config.tableName;

  const dispute = await getDispute(tableName, disputeId);
  if (!dispute) {
    return respond(404, { error: 'Not Found', message: 'Dispute not found' });
  }

  // Get order details
  const order = await getOrderForDispute(tableName, dispute.orderId, dispute.customerId);

  // Get chat transcript (last 50 messages)
  const chatTranscript = await getChatTranscript(tableName, dispute.customerId);

  // Get customer and seller names
  const customerName = await getUserDisplayName(tableName, dispute.customerId);
  const sellerName = await getUserDisplayName(tableName, dispute.sellerId);

  // Get resolution history (audit logs for this dispute)
  const timeline = await getDisputeTimeline(tableName, disputeId);

  return respond(200, {
    dispute: {
      ...dispute,
      customerName,
      sellerName,
    },
    order,
    chatTranscript,
    timeline,
  });
}

// ========================================================================
// Resolve Dispute
// ========================================================================

async function handleResolveDispute(
  disputeId: string,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { action, amount, notes } = body as {
    action: ResolutionAction;
    amount?: number;
    notes?: string;
  };

  if (!action) {
    return respond(400, { error: 'Bad Request', message: 'Resolution action is required' });
  }

  const validActions: ResolutionAction[] = ['refund_full', 'refund_partial', 'replace', 'dismiss', 'escalate'];
  if (!validActions.includes(action)) {
    return respond(400, { error: 'Bad Request', message: `Invalid action. Must be one of: ${validActions.join(', ')}` });
  }

  if ((action === 'refund_partial') && (!amount || amount <= 0)) {
    return respond(400, { error: 'Bad Request', message: 'Partial refund requires a positive amount' });
  }

  const config = await getConfig();
  const tableName = config.tableName;

  const dispute = await getDispute(tableName, disputeId);
  if (!dispute) {
    return respond(404, { error: 'Not Found', message: 'Dispute not found' });
  }

  if (dispute.status === 'resolved' || dispute.status === 'dismissed') {
    return respond(409, { error: 'Conflict', message: 'Dispute is already resolved or dismissed' });
  }

  const adminId = extractUserId(event) || 'admin';
  const now = new Date().toISOString();

  // Handle refund via Razorpay
  if (action === 'refund_full' || action === 'refund_partial') {
    try {
      const order = await getOrderForDispute(tableName, dispute.orderId, dispute.customerId);
      const refundAmount = action === 'refund_full' ? (order?.totalAmount || 0) : (amount || 0);

      if (order?.razorpayPaymentId) {
        const razorpay = new RazorpayAdapter();
        await razorpay.createRefund(order.razorpayPaymentId, refundAmount);
        logger.info('Razorpay refund initiated', { disputeId, refundAmount, paymentId: order.razorpayPaymentId });
      }
    } catch (err) {
      logger.error('Razorpay refund failed', {
        disputeId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue with resolution even if refund API fails — admin can retry
    }
  }

  const newStatus: DisputeStatus = action === 'dismiss' ? 'dismissed' : action === 'escalate' ? 'in_progress' : 'resolved';

  const resolution = {
    action,
    amount: amount || undefined,
    resolvedBy: adminId,
    resolvedAt: now,
    notes: notes || undefined,
  };

  await updateDisputeResolution(tableName, disputeId, newStatus, resolution, now);

  // Write audit log
  await writeAuditLog(tableName, {
    actorId: adminId,
    actionType: `dispute.${action}`,
    resourceType: 'DISPUTE',
    resourceId: disputeId,
    newValues: { status: newStatus, resolution },
  });

  return respond(200, {
    message: 'Dispute resolved successfully',
    dispute: { disputeId, status: newStatus, resolution },
  });
}

// ========================================================================
// Update Admin Notes
// ========================================================================

async function handleUpdateNotes(
  disputeId: string,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { notes } = body as { notes: string };

  if (!notes || typeof notes !== 'string') {
    return respond(400, { error: 'Bad Request', message: 'Notes field is required' });
  }

  const config = await getConfig();
  const tableName = config.tableName;

  const dispute = await getDispute(tableName, disputeId);
  if (!dispute) {
    return respond(404, { error: 'Not Found', message: 'Dispute not found' });
  }

  const now = new Date().toISOString();
  await updateDisputeNotes(tableName, disputeId, notes, now);

  const adminId = extractUserId(event) || 'admin';
  await writeAuditLog(tableName, {
    actorId: adminId,
    actionType: 'dispute.notes_updated',
    resourceType: 'DISPUTE',
    resourceId: disputeId,
    newValues: { adminNotes: notes },
  });

  return respond(200, { message: 'Notes updated', disputeId, adminNotes: notes });
}

// ========================================================================
// DynamoDB Helpers
// ========================================================================

async function scanDisputes(tableName: string): Promise<DisputeRecord[]> {
  const disputes: DisputeRecord[] = [];
  let lastKey: Record<string, any> | undefined;

  do {
    const res = await dynamoDBClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
        ExpressionAttributeValues: {
          ':prefix': { S: 'DISPUTE#' },
          ':sk': { S: 'METADATA' },
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const rec = unmarshall(item);
      disputes.push(mapToDisputeRecord(rec));
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return disputes;
}

async function getDispute(tableName: string, disputeId: string): Promise<DisputeRecord | null> {
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `DISPUTE#${disputeId}` },
        ':sk': { S: 'METADATA' },
      },
      Limit: 1,
    }),
  );
  if (!res.Items || res.Items.length === 0) return null;
  return mapToDisputeRecord(unmarshall(res.Items![0]!));
}

function mapToDisputeRecord(rec: Record<string, any>): DisputeRecord {
  return {
    disputeId: rec.disputeId || rec.PK?.replace('DISPUTE#', '') || '',
    orderId: rec.orderId || '',
    customerId: rec.customerId || '',
    sellerId: rec.sellerId || '',
    issueType: rec.issueType || 'refund_request',
    status: rec.status || 'open',
    adminNotes: rec.adminNotes || '',
    resolution: rec.resolution || null,
    evidenceUrls: rec.evidenceUrls || [],
    createdAt: rec.createdAt || '',
    updatedAt: rec.updatedAt || rec.createdAt || '',
  };
}

async function enrichDisputeList(
  tableName: string,
  disputes: DisputeRecord[],
): Promise<(DisputeRecord & { customerName: string; sellerName: string })[]> {
  const userCache = new Map<string, string>();

  const getName = async (userId: string): Promise<string> => {
    if (userCache.has(userId)) return userCache.get(userId)!;
    const name = await getUserDisplayName(tableName, userId);
    userCache.set(userId, name);
    return name;
  };

  const enriched = [];
  for (const d of disputes) {
    enriched.push({
      ...d,
      customerName: await getName(d.customerId),
      sellerName: await getName(d.sellerId),
    });
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
  const rec = unmarshall(res.Items![0]!);
  return rec.displayName || rec.businessName || 'Unknown';
}

async function getOrderForDispute(
  tableName: string,
  orderId: string,
  customerId: string,
): Promise<any | null> {
  // Orders stored as CUSTOMER#{customerId} / ORDER#{orderId}
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': { S: `CUSTOMER#${customerId}` },
        ':sk': { S: `ORDER#${orderId}` },
      },
      Limit: 1,
    }),
  );
  if (!res.Items || res.Items.length === 0) return null;
  return unmarshall(res.Items![0]!);
}

async function getChatTranscript(tableName: string, customerId: string): Promise<any[]> {
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
      direction: rec.direction || 'inbound',
      createdAt: rec.createdAt || '',
    };
  });
}

async function getDisputeTimeline(tableName: string, disputeId: string): Promise<any[]> {
  const res = await dynamoDBClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `RESOURCE#DISPUTE#${disputeId}` },
      },
      ScanIndexForward: false,
      Limit: 50,
    }),
  );

  return (res.Items ?? []).map((item) => {
    const rec = unmarshall(item);
    return {
      auditId: rec.auditId || '',
      actorId: rec.actorId || '',
      actionType: rec.actionType || '',
      newValues: rec.newValues || {},
      createdAt: rec.createdAt || '',
    };
  });
}

async function updateDisputeResolution(
  tableName: string,
  disputeId: string,
  status: DisputeStatus,
  resolution: any,
  updatedAt: string,
): Promise<void> {
  await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ PK: `DISPUTE#${disputeId}`, SK: 'METADATA' }),
      UpdateExpression: 'SET #status = :s, resolution = :r, updatedAt = :u',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({
        ':s': status,
        ':r': resolution,
        ':u': updatedAt,
      }, { removeUndefinedValues: true }),
    }),
  );
}

async function updateDisputeNotes(
  tableName: string,
  disputeId: string,
  notes: string,
  updatedAt: string,
): Promise<void> {
  await dynamoDBClient.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ PK: `DISPUTE#${disputeId}`, SK: 'METADATA' }),
      UpdateExpression: 'SET adminNotes = :n, updatedAt = :u',
      ExpressionAttributeValues: marshall({ ':n': notes, ':u': updatedAt }),
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
// Auto-Flag Handler (EventBridge target)
// Creates DISPUTE records when negative events are detected
// ========================================================================

export const autoFlagHandler: APIGatewayProxyHandler = async (event: any): Promise<any> => {
  logger.info('Dispute auto-flag event received', { detailType: event['detail-type'], source: event.source });

  try {
    const config = await getConfig();
    const tableName = config.tableName;
    const detail = event.detail || {};
    const detailType = event['detail-type'] || '';

    let issueType: DisputeIssueType;
    switch (detailType) {
      case 'order.payment_failed':
        issueType = 'payment_failed';
        break;
      case 'order.delivery_delayed':
        issueType = 'not_delivered';
        break;
      case 'order.feedback_negative':
        issueType = 'quality_issue';
        break;
      default:
        logger.warn('Unknown auto-flag event type', { detailType });
        return;
    }

    const disputeId = randomUUID();
    const now = new Date().toISOString();

    await dynamoDBClient.send(
      new PutItemCommand({
        TableName: tableName,
        Item: marshall(
          {
            PK: `DISPUTE#${disputeId}`,
            SK: 'METADATA',
            disputeId,
            orderId: detail.orderId || '',
            customerId: detail.customerId || '',
            sellerId: detail.sellerId || '',
            issueType,
            status: 'open',
            adminNotes: `Auto-flagged: ${detailType}`,
            resolution: null,
            evidenceUrls: [],
            createdAt: now,
            updatedAt: now,
          },
          { removeUndefinedValues: true },
        ),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );

    logger.info('Auto-flagged dispute created', { disputeId, issueType, orderId: detail.orderId });
  } catch (error) {
    logger.error('Auto-flag handler error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

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
