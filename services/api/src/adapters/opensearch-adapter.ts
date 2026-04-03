/**
 * OpenSearch Adapter — SigV4-signed client for OpenSearch Serverless
 *
 * Provides a reusable adapter for querying the OpenSearch Serverless
 * search collection. Handles AWS SigV4 request signing with the `aoss`
 * service name, connection reuse across Lambda invocations, and
 * timeout management.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { logger } from '../utils/logger';

/**
 * Custom error thrown when an OpenSearch request exceeds the 5-second timeout.
 */
export class OpenSearchTimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly index: string;

  constructor(index: string, timeoutMs: number = 5000) {
    super(
      `OpenSearch request to index "${index}" timed out after ${timeoutMs}ms`
    );
    this.name = 'OpenSearchTimeoutError';
    this.timeoutMs = timeoutMs;
    this.index = index;
  }
}

/**
 * Typed search result returned by the `search` method.
 */
export interface SearchResult<T> {
  hits: T[];
  total: number;
}

/**
 * Typed suggestion result returned by the `suggest` method.
 */
export interface SuggestionResult {
  suggestions: Array<{
    name: string;
    category: string;
    productId: string;
  }>;
}

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 5000;

/**
 * OpenSearchAdapter
 *
 * Adapter for querying OpenSearch Serverless collections with SigV4 signing.
 * The client instance is reused across invocations within the same Lambda
 * execution context (warm start) via HTTP keep-alive.
 */
export class OpenSearchAdapter {
  private client: Client | null = null;
  private readonly endpoint: string;

  /**
   * @param endpoint - OpenSearch Serverless collection endpoint.
   *   Falls back to the `OPENSEARCH_ENDPOINT` environment variable.
   */
  constructor(endpoint?: string) {
    const resolved = endpoint ?? process.env.OPENSEARCH_ENDPOINT;
    if (!resolved) {
      throw new Error(
        'OpenSearch endpoint not configured. Set the OPENSEARCH_ENDPOINT environment variable.'
      );
    }
    // Ensure the endpoint has a protocol prefix
    this.endpoint = resolved.startsWith('https://')
      ? resolved
      : `https://${resolved}`;
  }

  /**
   * Lazily initialise and return the OpenSearch client.
   * The client is created once and reused across invocations (Req 8.6).
   */
  private getClient(): Client {
    if (this.client) {
      return this.client;
    }

    this.client = new Client({
      ...AwsSigv4Signer({
        region: process.env.AWS_REGION ?? 'us-east-1',
        service: 'aoss', // OpenSearch Serverless service name (Req 8.1)
        getCredentials: () =>
          Promise.resolve({
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            ...(process.env.AWS_SESSION_TOKEN
              ? { sessionToken: process.env.AWS_SESSION_TOKEN }
              : {}),
          }),
      }),
      node: this.endpoint,
      requestTimeout: REQUEST_TIMEOUT_MS,
    });

    logger.info('OpenSearch client initialised', {
      endpoint: this.endpoint,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });

    return this.client;
  }

  /**
   * Execute a search query against an index.
   *
   * @param index - OpenSearch index name (e.g. "products", "sellers")
   * @param body  - OpenSearch query DSL body
   * @returns Typed search result with hits array and total count
   * @throws {OpenSearchTimeoutError} when the request exceeds 5 seconds
   */
  async search<T>(
    index: string,
    body: Record<string, unknown>
  ): Promise<SearchResult<T>> {
    const client = this.getClient();

    try {
      logger.info('Executing OpenSearch search', { index });

      const response = await client.search({ index, body });

      const responseBody = response.body;
      const hits = responseBody.hits?.hits ?? [];
      const total =
        typeof responseBody.hits?.total === 'object'
          ? responseBody.hits.total.value
          : responseBody.hits?.total ?? 0;

      return {
        hits: hits.map((hit: Record<string, unknown>) => hit._source as T),
        total: total as number,
      };
    } catch (error: unknown) {
      if (this.isTimeoutError(error)) {
        logger.error('OpenSearch search timed out', error, { index });
        throw new OpenSearchTimeoutError(index, REQUEST_TIMEOUT_MS);
      }
      throw error;
    }
  }

  /**
   * Execute a prefix-based suggestion query.
   *
   * @param index  - OpenSearch index name
   * @param prefix - Prefix string for autocomplete matching
   * @param limit  - Maximum number of suggestions (default 5)
   * @returns Suggestion result with name, category, and productId
   * @throws {OpenSearchTimeoutError} when the request exceeds 5 seconds
   */
  async suggest(
    index: string,
    prefix: string,
    limit: number = 5
  ): Promise<SuggestionResult> {
    const client = this.getClient();

    try {
      logger.info('Executing OpenSearch suggest', { index, prefix, limit });

      const body = {
        size: limit,
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

      const response = await client.search({ index, body });

      const hits = response.body.hits?.hits ?? [];

      return {
        suggestions: hits.map(
          (hit: Record<string, unknown>) => {
            const source = hit._source as Record<string, unknown>;
            return {
              name: (source.productName as string) ?? '',
              category: (source.category as string) ?? '',
              productId: (source.productId as string) ?? '',
            };
          }
        ),
      };
    } catch (error: unknown) {
      if (this.isTimeoutError(error)) {
        logger.error('OpenSearch suggest timed out', error, { index, prefix });
        throw new OpenSearchTimeoutError(index, REQUEST_TIMEOUT_MS);
      }
      throw error;
    }
  }

  /**
   * Determine whether an error is a timeout error.
   */
  private isTimeoutError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('timeout') ||
        msg.includes('timed out') ||
        msg.includes('request timed out') ||
        error.name === 'TimeoutError' ||
        error.name === 'ConnectionError'
      );
    }
    return false;
  }
}
