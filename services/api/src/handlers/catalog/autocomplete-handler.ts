/**
 * OpenSearch Autocomplete Handler
 *
 * GET /api/v1/autocomplete — JWT required
 *
 * Product name autocomplete powered by OpenSearch Serverless.
 * Returns prefix-matched suggestions for active products.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { OpenSearchAdapter } from '../../adapters/opensearch-adapter';
import { logger } from '../../utils/logger';
import { AutocompleteQuerySchema } from '../../shared/schemas';
import type { AutocompleteResponse } from '../../shared/schemas';

const PRODUCT_INDEX = 'products';
const EMPTY_RESPONSE: AutocompleteResponse = { suggestions: [] };

let adapter: OpenSearchAdapter | null = null;

function getAdapter(): OpenSearchAdapter {
  if (!adapter) {
    adapter = new OpenSearchAdapter();
  }
  return adapter;
}

/**
 * Clamp a limit value to [1, 10] with default 5.
 *
 * Exported for property-based testing (Task 4.3).
 */
export function clampLimit(limit?: number): number {
  if (limit === undefined || limit === null) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.floor(limit)));
}

/**
 * Build an OpenSearch query body for autocomplete.
 *
 * - Prefix query on `productName.keyword` with the given prefix
 * - Always filters on status: "Active"
 *
 * Exported for property-based testing (Task 4.2).
 */
export function buildAutocompleteQuery(prefix: string): Record<string, unknown> {
  return {
    query: {
      bool: {
        must: [
          {
            prefix: {
              'productName.keyword': {
                value: prefix,
              },
            },
          },
        ],
        filter: [
          {
            term: { status: 'Active' },
          },
        ],
      },
    },
    _source: ['productName', 'category', 'productId'],
  };
}

/**
 * Format raw OpenSearch hits into an AutocompleteResponse.
 *
 * Exported for property-based testing (Task 4.5).
 */
export function formatAutocompleteResponse(
  hits: Record<string, unknown>[],
): AutocompleteResponse {
  return {
    suggestions: hits.map((hit) => ({
      name: String(hit.productName ?? ''),
      category: String(hit.category ?? ''),
      productId: String(hit.productId ?? ''),
    })),
  };
}

/**
 * Lambda handler for GET /api/v1/autocomplete
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const requestId = event.requestContext.requestId;

  try {
    // Validate query parameters
    const params = event.queryStringParameters || {};
    const parsed = AutocompleteQuerySchema.safeParse(params);

    if (!parsed.success) {
      logger.warn('Invalid autocomplete query parameters', {
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

    const { q, limit } = parsed.data;

    // Short prefix → empty suggestions without querying OpenSearch (Req 6.5)
    if (q.length < 2) {
      logger.info('Autocomplete short prefix, returning empty', {
        requestId,
        prefix: q,
      });
      return response(200, EMPTY_RESPONSE as unknown as Record<string, unknown>);
    }

    const effectiveLimit = clampLimit(limit);
    const queryBody = buildAutocompleteQuery(q);
    const searchBody = {
      ...queryBody,
      size: effectiveLimit,
    };

    // Execute search against OpenSearch
    const osAdapter = getAdapter();
    const result = await osAdapter.search<Record<string, unknown>>(
      PRODUCT_INDEX,
      searchBody,
    );

    const autocompleteResponse = formatAutocompleteResponse(result.hits);

    logger.info('Autocomplete completed', {
      requestId,
      prefix: q,
      limit: effectiveLimit,
      suggestionsCount: autocompleteResponse.suggestions.length,
    });

    return response(200, autocompleteResponse as unknown as Record<string, unknown>);
  } catch (error: unknown) {
    // Graceful degradation: return empty suggestions on any OpenSearch error (Req 6.6)
    logger.error('Autocomplete handler failed, returning empty suggestions', error, {
      requestId,
    });
    return response(200, EMPTY_RESPONSE as unknown as Record<string, unknown>);
  }
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
