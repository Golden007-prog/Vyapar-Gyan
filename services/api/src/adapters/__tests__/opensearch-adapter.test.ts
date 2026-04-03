import { OpenSearchAdapter, OpenSearchTimeoutError } from '../opensearch-adapter';

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock the OpenSearch client and SigV4 signer
const mockSearch = jest.fn();

let capturedClientOptions: Record<string, unknown> | null = null;

jest.mock('@opensearch-project/opensearch', () => ({
  Client: jest.fn().mockImplementation((options: Record<string, unknown>) => {
    capturedClientOptions = options;
    return { search: mockSearch };
  }),
}));

jest.mock('@opensearch-project/opensearch/aws', () => ({
  AwsSigv4Signer: jest.fn().mockImplementation((opts: Record<string, unknown>) => ({
    __sigv4: true,
    __service: opts.service,
    __region: opts.region,
  })),
}));

describe('OpenSearchAdapter', () => {
  const TEST_ENDPOINT = 'https://abc123.us-east-1.aoss.amazonaws.com';

  beforeEach(() => {
    jest.clearAllMocks();
    capturedClientOptions = null;
    process.env.OPENSEARCH_ENDPOINT = TEST_ENDPOINT;
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'test-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  });

  afterEach(() => {
    delete process.env.OPENSEARCH_ENDPOINT;
  });

  // --- Requirement 8.2: Endpoint read from environment variable ---

  describe('endpoint configuration', () => {
    it('should read endpoint from OPENSEARCH_ENDPOINT env var', () => {
      const adapter = new OpenSearchAdapter();
      // Trigger client creation by calling search
      mockSearch.mockResolvedValue({ body: { hits: { hits: [], total: 0 } } });
      adapter.search('products', {});

      expect(capturedClientOptions).not.toBeNull();
      expect(capturedClientOptions!.node).toBe(TEST_ENDPOINT);
    });

    it('should accept an explicit endpoint parameter over env var', () => {
      const explicitEndpoint = 'https://explicit.aoss.amazonaws.com';
      const adapter = new OpenSearchAdapter(explicitEndpoint);
      mockSearch.mockResolvedValue({ body: { hits: { hits: [], total: 0 } } });
      adapter.search('products', {});

      expect(capturedClientOptions!.node).toBe(explicitEndpoint);
    });

    it('should prepend https:// if endpoint lacks protocol', () => {
      const adapter = new OpenSearchAdapter('my-endpoint.aoss.amazonaws.com');
      mockSearch.mockResolvedValue({ body: { hits: { hits: [], total: 0 } } });
      adapter.search('products', {});

      expect(capturedClientOptions!.node).toBe('https://my-endpoint.aoss.amazonaws.com');
    });

    it('should throw if no endpoint is configured', () => {
      delete process.env.OPENSEARCH_ENDPOINT;

      expect(() => new OpenSearchAdapter()).toThrow(
        'OpenSearch endpoint not configured'
      );
    });
  });

  // --- Requirement 8.1: SigV4 signer with `aoss` service ---

  describe('SigV4 signer configuration', () => {
    it('should configure SigV4 signer with aoss service name', () => {
      const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');

      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({ body: { hits: { hits: [], total: 0 } } });
      adapter.search('products', {});

      expect(AwsSigv4Signer).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'aoss',
          region: 'us-east-1',
        })
      );
    });

    it('should spread SigV4 signer options into Client constructor', () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({ body: { hits: { hits: [], total: 0 } } });
      adapter.search('products', {});

      // The mock AwsSigv4Signer returns { __sigv4: true, __service: 'aoss' }
      // which gets spread into the Client options
      expect(capturedClientOptions!.__sigv4).toBe(true);
      expect(capturedClientOptions!.__service).toBe('aoss');
    });
  });

  // --- Requirement 8.5: Timeout error handling ---

  describe('timeout error handling', () => {
    it('should throw OpenSearchTimeoutError on timeout during search', async () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockRejectedValue(new Error('Request timed out'));

      await expect(adapter.search('products', {})).rejects.toThrow(
        OpenSearchTimeoutError
      );
    });

    it('should include index name and timeout in OpenSearchTimeoutError', async () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockRejectedValue(new Error('Request timed out'));

      try {
        await adapter.search('products', {});
        fail('Expected OpenSearchTimeoutError');
      } catch (err) {
        expect(err).toBeInstanceOf(OpenSearchTimeoutError);
        const timeoutErr = err as OpenSearchTimeoutError;
        expect(timeoutErr.index).toBe('products');
        expect(timeoutErr.timeoutMs).toBe(5000);
        expect(timeoutErr.message).toContain('products');
        expect(timeoutErr.message).toContain('5000');
      }
    });

    it('should throw OpenSearchTimeoutError on TimeoutError name', async () => {
      const adapter = new OpenSearchAdapter();
      const err = new Error('connection timeout');
      err.name = 'TimeoutError';
      mockSearch.mockRejectedValue(err);

      await expect(adapter.search('products', {})).rejects.toThrow(
        OpenSearchTimeoutError
      );
    });

    it('should throw OpenSearchTimeoutError on ConnectionError name', async () => {
      const adapter = new OpenSearchAdapter();
      const err = new Error('connection failed');
      err.name = 'ConnectionError';
      mockSearch.mockRejectedValue(err);

      await expect(adapter.search('products', {})).rejects.toThrow(
        OpenSearchTimeoutError
      );
    });

    it('should throw OpenSearchTimeoutError on suggest timeout', async () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockRejectedValue(new Error('timed out'));

      await expect(adapter.suggest('products', 'ric', 5)).rejects.toThrow(
        OpenSearchTimeoutError
      );
    });

    it('should re-throw non-timeout errors as-is', async () => {
      const adapter = new OpenSearchAdapter();
      const originalError = new Error('index_not_found_exception');
      mockSearch.mockRejectedValue(originalError);

      await expect(adapter.search('products', {})).rejects.toThrow(
        originalError
      );
    });
  });

  // --- Requirement 8.6: Connection reuse (singleton client) ---

  describe('connection reuse', () => {
    it('should reuse the same client instance across multiple search calls', async () => {
      const { Client } = require('@opensearch-project/opensearch');
      Client.mockClear();

      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({ body: { hits: { hits: [], total: 0 } } });

      await adapter.search('products', {});
      await adapter.search('products', {});
      await adapter.search('sellers', {});

      // Client constructor should only be called once (lazy init, then reused)
      expect(Client).toHaveBeenCalledTimes(1);
    });

    it('should reuse the same client for search and suggest calls', async () => {
      const { Client } = require('@opensearch-project/opensearch');
      Client.mockClear();

      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({ body: { hits: { hits: [], total: 0 } } });

      await adapter.search('products', {});
      await adapter.suggest('products', 'rice', 5);

      expect(Client).toHaveBeenCalledTimes(1);
    });
  });

  // --- Requirement 8.5: Request timeout configuration ---

  describe('request timeout', () => {
    it('should set 5-second request timeout on the client', () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({ body: { hits: { hits: [], total: 0 } } });
      adapter.search('products', {});

      expect(capturedClientOptions!.requestTimeout).toBe(5000);
    });
  });

  // --- Search method response parsing ---

  describe('search method', () => {
    it('should return hits and total from OpenSearch response', async () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({
        body: {
          hits: {
            hits: [
              { _source: { productId: 'p1', productName: 'Rice' } },
              { _source: { productId: 'p2', productName: 'Dal' } },
            ],
            total: { value: 2 },
          },
        },
      });

      const result = await adapter.search('products', { query: { match_all: {} } });

      expect(result.hits).toHaveLength(2);
      expect(result.hits[0]).toEqual({ productId: 'p1', productName: 'Rice' });
      expect(result.total).toBe(2);
    });

    it('should handle total as a plain number', async () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({
        body: {
          hits: {
            hits: [],
            total: 42,
          },
        },
      });

      const result = await adapter.search('products', {});
      expect(result.total).toBe(42);
    });

    it('should return empty hits when no results', async () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({
        body: { hits: { hits: [], total: { value: 0 } } },
      });

      const result = await adapter.search('products', {});
      expect(result.hits).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // --- Suggest method response parsing ---

  describe('suggest method', () => {
    it('should return formatted suggestions from OpenSearch response', async () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({
        body: {
          hits: {
            hits: [
              {
                _source: {
                  productName: 'Basmati Rice',
                  category: 'Grains',
                  productId: 'p1',
                },
              },
            ],
          },
        },
      });

      const result = await adapter.suggest('products', 'Bas', 5);

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toEqual({
        name: 'Basmati Rice',
        category: 'Grains',
        productId: 'p1',
      });
    });

    it('should return empty suggestions when no hits', async () => {
      const adapter = new OpenSearchAdapter();
      mockSearch.mockResolvedValue({
        body: { hits: { hits: [] } },
      });

      const result = await adapter.suggest('products', 'xyz', 5);
      expect(result.suggestions).toEqual([]);
    });
  });
});
