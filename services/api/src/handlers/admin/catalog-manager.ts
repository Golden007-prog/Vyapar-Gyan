/**
 * Admin Catalog Manager Handler
 *
 * CRUD operations for global product categories, aliases, and merge operations.
 * DynamoDB schema: CATEGORY#{id} / METADATA, CATEGORY#{id} / ALIAS#{alias}
 *
 * Routes:
 *   GET    /admin/catalog/categories                        — master list
 *   POST   /admin/catalog/categories                        — add new category
 *   PUT    /admin/catalog/categories/{id}                   — rename category
 *   POST   /admin/catalog/categories/merge                  — merge two categories
 *   DELETE /admin/catalog/categories/{id}                   — soft deactivate
 *   GET    /admin/catalog/categories/merge-preview           — preview merge impact
 *   GET    /admin/catalog/categories/{id}/aliases            — list aliases
 *   POST   /admin/catalog/categories/{id}/aliases            — add alias
 *   DELETE /admin/catalog/categories/{id}/aliases/{alias}    — remove alias
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6
 */

import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  ScanCommand,
  QueryCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { randomUUID } from 'crypto';

const dynamoDBClient = new DynamoDBClient({});

// --- Types ---

export interface CategoryRecord {
  categoryId: string;
  name: string;
  status: 'active' | 'inactive';
  productCount: number;
  activeSellers: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryAlias {
  alias: string;
  language: string;
  canonicalName: string;
  categoryId: string;
  createdAt: string;
}

export interface MergePreviewResult {
  affectedProducts: number;
  affectedSellers: number;
  sourceName: string;
  targetName: string;
}

export interface ProductRecord {
  productId: string;
  sellerId: string;
  categoryId: string;
  name: string;
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

// ============================================================================
// Pure functions — exported for property-based testing
// ============================================================================

/**
 * Resolve an alias to its canonical category name.
 * Searches the alias list for a match (case-insensitive) and returns the canonical name.
 */
export function resolveAlias(
  aliases: CategoryAlias[],
  input: string,
): string | null {
  const normalized = input.trim().toLowerCase();
  const match = aliases.find(a => a.alias.toLowerCase() === normalized);
  return match ? match.canonicalName : null;
}

/**
 * Compute merge preview: count affected products and distinct sellers
 * when merging sourceId into targetId.
 */
export function computeMergePreview(
  products: ProductRecord[],
  sourceId: string,
  targetId: string,
): { affectedProducts: number; affectedSellers: number } {
  const affected = products.filter(p => p.categoryId === sourceId);
  const distinctSellers = new Set(affected.map(p => p.sellerId));
  return {
    affectedProducts: affected.length,
    affectedSellers: distinctSellers.size,
  };
}

/**
 * Filter categories to only active ones (for customer-facing queries).
 */
export function filterActiveCategories(categories: CategoryRecord[]): CategoryRecord[] {
  return categories.filter(c => c.status === 'active');
}

/**
 * Propagate a category rename: update all products from oldCategoryId to newCategoryId.
 * Returns a new array with updated products (immutable).
 */
export function propagateRename(
  products: ProductRecord[],
  oldCategoryId: string,
  newCategoryId: string,
): ProductRecord[] {
  return products.map(p =>
    p.categoryId === oldCategoryId
      ? { ...p, categoryId: newCategoryId }
      : p,
  );
}

// ============================================================================
// Lambda Handler
// ============================================================================

function getTableName(): string {
  return process.env.TABLE_NAME || 'vyapargyan-dev-main';
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Admin catalog manager request', {
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
    const categoryId = event.pathParameters?.id;
    const aliasParam = event.pathParameters?.alias;

    // DELETE /admin/catalog/categories/{id}/aliases/{alias}
    if (method === 'DELETE' && categoryId && aliasParam) {
      return await handleDeleteAlias(categoryId, aliasParam);
    }

    // POST /admin/catalog/categories/{id}/aliases
    if (method === 'POST' && categoryId && path.includes('/aliases')) {
      return await handleAddAlias(categoryId, event);
    }

    // GET /admin/catalog/categories/{id}/aliases
    if (method === 'GET' && categoryId && path.includes('/aliases')) {
      return await handleListAliases(categoryId);
    }

    // GET /admin/catalog/categories/merge-preview
    if (method === 'GET' && path.includes('/merge-preview')) {
      return await handleMergePreview(event);
    }

    // POST /admin/catalog/categories/merge
    if (method === 'POST' && path.endsWith('/merge')) {
      return await handleMergeCategories(event);
    }

    // DELETE /admin/catalog/categories/{id}
    if (method === 'DELETE' && categoryId) {
      return await handleDeactivateCategory(categoryId);
    }

    // PUT /admin/catalog/categories/{id}
    if (method === 'PUT' && categoryId) {
      return await handleRenameCategory(categoryId, event);
    }

    // POST /admin/catalog/categories
    if (method === 'POST') {
      return await handleCreateCategory(event);
    }

    // GET /admin/catalog/categories
    if (method === 'GET') {
      return await handleListCategories();
    }

    return respond(404, { error: 'Not Found' });
  } catch (error) {
    logger.error('Admin catalog manager error', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return respond(500, { error: 'Internal Server Error', message: 'Failed to process request' });
  }
};

// ============================================================================
// Route Handlers
// ============================================================================

async function handleListCategories(): Promise<APIGatewayProxyResult> {
  const tableName = getTableName();
  const categories = await scanCategories(tableName);
  return respond(200, { categories });
}

async function handleCreateCategory(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { name } = body;

  if (!name || typeof name !== 'string') {
    return respond(400, { error: 'Bad Request', message: 'Category name is required' });
  }

  const tableName = getTableName();
  const categoryId = `cat-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const record: CategoryRecord = {
    categoryId,
    name,
    status: 'active',
    productCount: 0,
    activeSellers: 0,
    createdAt: now,
    updatedAt: now,
  };

  await dynamoDBClient.send(new PutItemCommand({
    TableName: tableName,
    Item: marshall({
      PK: `CATEGORY#${categoryId}`,
      SK: 'METADATA',
      ...record,
    }, { removeUndefinedValues: true }),
  }));

  return respond(201, { category: record });
}

async function handleRenameCategory(
  categoryId: string,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { name: newName } = body;

  if (!newName || typeof newName !== 'string') {
    return respond(400, { error: 'Bad Request', message: 'New category name is required' });
  }

  const tableName = getTableName();
  const now = new Date().toISOString();

  // Update category metadata
  await dynamoDBClient.send(new UpdateItemCommand({
    TableName: tableName,
    Key: marshall({ PK: `CATEGORY#${categoryId}`, SK: 'METADATA' }),
    UpdateExpression: 'SET #n = :name, updatedAt = :now',
    ExpressionAttributeNames: { '#n': 'name' },
    ExpressionAttributeValues: marshall({ ':name': newName, ':now': now }),
  }));

  // Update all aliases to point to new canonical name
  const aliases = await queryAliases(tableName, categoryId);
  for (const alias of aliases) {
    await dynamoDBClient.send(new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ PK: `CATEGORY#${categoryId}`, SK: `ALIAS#${alias.alias}` }),
      UpdateExpression: 'SET canonicalName = :cn',
      ExpressionAttributeValues: marshall({ ':cn': newName }),
    }));
  }

  // Note: In production, product record updates would be done via SQS batch processing
  // For now, we scan and update products referencing this category
  const products = await scanProductsByCategory(tableName, categoryId);
  for (const product of products) {
    await dynamoDBClient.send(new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ PK: `PRODUCT#${product.productId}`, SK: 'METADATA' }),
      UpdateExpression: 'SET categoryName = :cn, updatedAt = :now',
      ExpressionAttributeValues: marshall({ ':cn': newName, ':now': now }),
    }));
  }

  return respond(200, {
    message: `Category renamed to "${newName}"`,
    updatedProducts: products.length,
  });
}

async function handleMergePreview(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const qs = event.queryStringParameters ?? {};
  const sourceId = qs.source;
  const targetId = qs.target;

  if (!sourceId || !targetId) {
    return respond(400, { error: 'Bad Request', message: 'source and target query params required' });
  }

  const tableName = getTableName();
  const [sourceCategory, targetCategory, products] = await Promise.all([
    getCategory(tableName, sourceId),
    getCategory(tableName, targetId),
    scanProductsByCategory(tableName, sourceId),
  ]);

  if (!sourceCategory || !targetCategory) {
    return respond(404, { error: 'Not Found', message: 'Source or target category not found' });
  }

  const preview = computeMergePreview(
    products.map(p => ({ productId: p.productId, sellerId: p.sellerId, categoryId: sourceId, name: p.name })),
    sourceId,
    targetId,
  );

  return respond(200, {
    ...preview,
    sourceName: sourceCategory.name,
    targetName: targetCategory.name,
  });
}

async function handleMergeCategories(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { sourceId, targetId } = body;

  if (!sourceId || !targetId) {
    return respond(400, { error: 'Bad Request', message: 'sourceId and targetId are required' });
  }

  const tableName = getTableName();
  const now = new Date().toISOString();

  // 1. Get source and target categories
  const [sourceCategory, targetCategory] = await Promise.all([
    getCategory(tableName, sourceId),
    getCategory(tableName, targetId),
  ]);

  if (!sourceCategory || !targetCategory) {
    return respond(404, { error: 'Not Found', message: 'Source or target category not found' });
  }

  // 2. Update all products from source → target
  const products = await scanProductsByCategory(tableName, sourceId);
  for (const product of products) {
    await dynamoDBClient.send(new UpdateItemCommand({
      TableName: tableName,
      Key: marshall({ PK: `PRODUCT#${product.productId}`, SK: 'METADATA' }),
      UpdateExpression: 'SET categoryId = :tid, categoryName = :tn, updatedAt = :now',
      ExpressionAttributeValues: marshall({
        ':tid': targetId,
        ':tn': targetCategory.name,
        ':now': now,
      }),
    }));
  }

  // 3. Move aliases from source to target
  const sourceAliases = await queryAliases(tableName, sourceId);
  for (const alias of sourceAliases) {
    // Delete from source
    await dynamoDBClient.send(new DeleteItemCommand({
      TableName: tableName,
      Key: marshall({ PK: `CATEGORY#${sourceId}`, SK: `ALIAS#${alias.alias}` }),
    }));
    // Add to target
    await dynamoDBClient.send(new PutItemCommand({
      TableName: tableName,
      Item: marshall({
        PK: `CATEGORY#${targetId}`,
        SK: `ALIAS#${alias.alias}`,
        alias: alias.alias,
        language: alias.language,
        canonicalName: targetCategory.name,
        categoryId: targetId,
        createdAt: alias.createdAt,
      }, { removeUndefinedValues: true }),
    }));
  }

  // 4. Deactivate source category
  await dynamoDBClient.send(new UpdateItemCommand({
    TableName: tableName,
    Key: marshall({ PK: `CATEGORY#${sourceId}`, SK: 'METADATA' }),
    UpdateExpression: 'SET #s = :inactive, updatedAt = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: marshall({ ':inactive': 'inactive', ':now': now }),
  }));

  return respond(200, {
    message: `Merged "${sourceCategory.name}" into "${targetCategory.name}"`,
    affectedProducts: products.length,
    movedAliases: sourceAliases.length,
  });
}

async function handleDeactivateCategory(categoryId: string): Promise<APIGatewayProxyResult> {
  const tableName = getTableName();
  const now = new Date().toISOString();

  await dynamoDBClient.send(new UpdateItemCommand({
    TableName: tableName,
    Key: marshall({ PK: `CATEGORY#${categoryId}`, SK: 'METADATA' }),
    UpdateExpression: 'SET #s = :inactive, updatedAt = :now',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: marshall({ ':inactive': 'inactive', ':now': now }),
  }));

  return respond(200, { message: 'Category deactivated' });
}

async function handleListAliases(categoryId: string): Promise<APIGatewayProxyResult> {
  const tableName = getTableName();
  const aliases = await queryAliases(tableName, categoryId);
  return respond(200, { aliases });
}

async function handleAddAlias(
  categoryId: string,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { alias, language } = body;

  if (!alias || typeof alias !== 'string') {
    return respond(400, { error: 'Bad Request', message: 'alias is required' });
  }

  const tableName = getTableName();
  const category = await getCategory(tableName, categoryId);
  if (!category) {
    return respond(404, { error: 'Not Found', message: 'Category not found' });
  }

  const now = new Date().toISOString();
  const aliasRecord: CategoryAlias = {
    alias: alias.toLowerCase(),
    language: language || 'en',
    canonicalName: category.name,
    categoryId,
    createdAt: now,
  };

  await dynamoDBClient.send(new PutItemCommand({
    TableName: tableName,
    Item: marshall({
      PK: `CATEGORY#${categoryId}`,
      SK: `ALIAS#${alias.toLowerCase()}`,
      ...aliasRecord,
    }, { removeUndefinedValues: true }),
  }));

  return respond(201, { alias: aliasRecord });
}

async function handleDeleteAlias(
  categoryId: string,
  alias: string,
): Promise<APIGatewayProxyResult> {
  const tableName = getTableName();

  await dynamoDBClient.send(new DeleteItemCommand({
    TableName: tableName,
    Key: marshall({ PK: `CATEGORY#${categoryId}`, SK: `ALIAS#${alias}` }),
  }));

  return respond(200, { message: `Alias "${alias}" removed` });
}

// ============================================================================
// DynamoDB Helpers
// ============================================================================

async function scanCategories(tableName: string): Promise<CategoryRecord[]> {
  const result = await dynamoDBClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk',
    ExpressionAttributeValues: marshall({ ':prefix': 'CATEGORY#', ':sk': 'METADATA' }),
  }));

  return (result.Items ?? []).map(item => {
    const rec = unmarshall(item);
    return {
      categoryId: rec.categoryId,
      name: rec.name,
      status: rec.status || 'active',
      productCount: rec.productCount || 0,
      activeSellers: rec.activeSellers || 0,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    } as CategoryRecord;
  });
}

async function getCategory(tableName: string, categoryId: string): Promise<CategoryRecord | null> {
  const result = await dynamoDBClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND SK = :sk',
    ExpressionAttributeValues: marshall({ ':pk': `CATEGORY#${categoryId}`, ':sk': 'METADATA' }),
    Limit: 1,
  }));

  if (!result.Items || result.Items.length === 0) return null;
  const rec = unmarshall(result.Items[0]);
  return {
    categoryId: rec.categoryId,
    name: rec.name,
    status: rec.status || 'active',
    productCount: rec.productCount || 0,
    activeSellers: rec.activeSellers || 0,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  } as CategoryRecord;
}

async function queryAliases(tableName: string, categoryId: string): Promise<CategoryAlias[]> {
  const result = await dynamoDBClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: marshall({ ':pk': `CATEGORY#${categoryId}`, ':prefix': 'ALIAS#' }),
  }));

  return (result.Items ?? []).map(item => {
    const rec = unmarshall(item);
    return {
      alias: rec.alias,
      language: rec.language || 'en',
      canonicalName: rec.canonicalName,
      categoryId: rec.categoryId || categoryId,
      createdAt: rec.createdAt,
    } as CategoryAlias;
  });
}

async function scanProductsByCategory(
  tableName: string,
  categoryId: string,
): Promise<Array<{ productId: string; sellerId: string; name: string }>> {
  const result = await dynamoDBClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'begins_with(PK, :prefix) AND SK = :sk AND categoryId = :cid',
    ExpressionAttributeValues: marshall({
      ':prefix': 'PRODUCT#',
      ':sk': 'METADATA',
      ':cid': categoryId,
    }),
  }));

  return (result.Items ?? []).map(item => {
    const rec = unmarshall(item);
    return {
      productId: rec.productId,
      sellerId: rec.sellerId,
      name: rec.name || rec.productName || '',
    };
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

function extractUserRole(event: APIGatewayProxyEvent): string | null {
  // Check JWT claims from Cognito authorizer
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (claims) {
    const groups = claims['cognito:groups'];
    if (typeof groups === 'string') return groups.includes('admin') ? 'admin' : groups;
    if (Array.isArray(groups)) return groups.includes('admin') ? 'admin' : groups[0];
  }
  // Fallback to x-user-role header for backward compatibility
  return event.headers?.['x-user-role'] || event.headers?.['X-User-Role'] || null;
}

function respond(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}
