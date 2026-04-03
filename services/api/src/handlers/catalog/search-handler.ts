/**
 * OpenSearch Search Handler
 *
 * GET /api/v1/search — JWT required
 *
 * Full-text product search powered by OpenSearch Serverless.
 * Supports fuzzy matching, category/seller filtering, and pagination.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { OpenSearchAdapter, OpenSearchTimeoutError } from '../../adapters/opensearch-adapter';
import { logger } from '../../utils/logger';
import { SearchQuerySchema } from '../../shared/schemas';
import type { SearchProductItem, SearchResponse } from '../../shared/schemas';

const PRODUCT_INDEX = 'products';

let adapter: OpenSearchAdapter | null = null;

function getAdapter(): OpenSearchAdapter {
  if (!adapter) {
    adapter = new OpenSearchAdapter();
  }
  return adapter;
}

/**
 * Build an OpenSearch query body from search parameters.
 *
 * - When `q` is provided: multi_match on productName^3, description, tags^2 with fuzziness AUTO
 * - When `q` is absent: match_all
 * - Always filters on status: "Active"
 * - Conditionally filters on category and sellerId
 *
 * Exported for property-based testing (Task 3.3).
 */
export function buildSearchQuery(params: {
  q?: string | undefined;
  category?: string | undefined;
  seller?: string | undefined;
}): Record<string, unknown> {
  const { q, category, seller } = params;

  const must: Record<string, unknown>[] = [];
  const filter: Record<string, unknown>[] = [];

  // Query clause
  if (q && q.trim().length > 0) {
    must.push({
      multi_match: {
        query: q,
        fields: ['productName^3', 'description', 'tags^2'],
        fuzziness: 'AUTO',
      },
    });
  } else {
    must.push({ match_all: {} });
  }

  // Always filter to active products (Req 5.3)
  filter.push({ term: { status: 'Active' } });

  // Conditional category filter (Req 5.4)
  if (category) {
    filter.push({ term: { category } });
  }

  // Conditional seller filter (Req 5.5)
  if (seller) {
    filter.push({ term: { sellerId: seller } });
  }

  return {
    query: {
      bool: {
        must,
        filter,
      },
    },
  };
}

/**
 * Compute OpenSearch pagination values from page and size parameters.
 *
 * - `from` = (page - 1) * size
 * - `size` is clamped to [1, 100] with default 20
 *
 * Exported for property-based testing (Task 3.4).
 */
export function computePagination(params: {
  page?: number;
  size?: number;
}): { from: number; size: number } {
  const page = params.page && params.page >= 1 ? Math.floor(params.page) : 1;
  const rawSize = params.size ?? 20;
  const size = Math.max(1, Math.min(100, Math.floor(rawSize)));
  const from = (page - 1) * size;

  return { from, size };
}

/**
 * Format raw OpenSearch hits into a SearchResponse.
 *
 * Exported for property-based testing (Task 3.5).
 */
export function formatSearchResponse(
  hits: Record<string, unknown>[],
  total: number,
  page: number,
  pageSize: number,
): SearchResponse {
  const items: SearchProductItem[] = hits.map((hit) => ({
    productId: String(hit.productId ?? ''),
    productName: String(hit.productName ?? ''),
    description: String(hit.description ?? ''),
    category: String(hit.category ?? ''),
    sellerId: String(hit.sellerId ?? ''),
    price: Number(hit.price ?? 0),
    stockQuantity: Number(hit.stockQuantity ?? 0),
    imageUrls: Array.isArray(hit.imageUrls)
      ? hit.imageUrls.map(String)
      : [],
    createdAt: String(hit.createdAt ?? ''),
  }));

  return {
    items,
    total: Math.max(0, Math.floor(total)),
    page: Math.max(1, Math.floor(page)),
    pageSize: Math.max(1, Math.min(100, Math.floor(pageSize))),
  };
}

/**
 * Lambda handler for GET /api/v1/search
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    // Validate query parameters (Req 5.6, 5.7)
    const params = event.queryStringParameters || {};
    const parsed = SearchQuerySchema.safeParse(params);

    if (!parsed.success) {
      logger.warn('Invalid search query parameters', {
        requestId,
        errors: parsed.error.issues,
      });
      return response(400, {
        error: 'Invalid query parameters',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const { q, category, seller, page, size } = parsed.data;

    // Build query and pagination
    const queryBody = buildSearchQuery({ q, category, seller });
    const pagination = computePagination({ page, size });

    const searchBody = {
      ...queryBody,
      from: pagination.from,
      size: pagination.size,
    };

    // Execute search against OpenSearch
    const osAdapter = getAdapter();
    const result = await osAdapter.search<Record<string, unknown>>(
      PRODUCT_INDEX,
      searchBody,
    );

    // Format response (Req 5.7)
    const searchResponse = formatSearchResponse(
      result.hits,
      result.total,
      page,
      pagination.size,
    );

    logger.info('Search completed', {
      requestId,
      query: q,
      category,
      seller,
      page,
      size: pagination.size,
      totalResults: result.total,
    });

    return response(200, searchResponse as unknown as Record<string, unknown>);
  } catch (error: unknown) {
    // OpenSearch unreachable → 503 (Req 5.9)
    if (error instanceof OpenSearchTimeoutError) {
      logger.error('Search request timed out', error, { requestId });
      return response(503, {
        error: 'Search request timed out',
      });
    }

    if (isOpenSearchConnectionError(error)) {
      logger.error('OpenSearch unreachable', error, { requestId });
      return response(503, {
        error: 'Search is temporarily unavailable',
      });
    }

    logger.error('Search handler failed', error, { requestId });
    return response(503, {
      error: 'Search service error',
    });
  }
}

/**
 * Check if an error indicates OpenSearch is unreachable.
 */
function isOpenSearchConnectionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('connection') ||
      msg.includes('timeout') ||
      msg.includes('network')
    );
  }
  return false;
}

function response(
  statusCode: number,
  body: Record<string, unknown>,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}
