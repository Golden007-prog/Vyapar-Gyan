/**
 * Unit tests for Template Registry Service
 *
 * Validates: getTemplate, validateParameters (valid/invalid/missing template).
 */

import type { TemplateRegistry } from '../../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetTemplate = jest.fn();
const mockScanTemplates = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  getTemplate: (...args: unknown[]) => mockGetTemplate(...args),
  scanTemplates: (...args: unknown[]) => mockScanTemplates(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getTemplate, validateParameters, listTemplates } from '../template-registry-service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleTemplate: TemplateRegistry = {
  templateSid: 'HX123',
  templateName: 'order_confirmation',
  category: 'utility',
  language: 'en',
  parameterSchema: { customerName: 'string', orderId: 'string', amount: 'string' },
  approvalStatus: 'approved',
  createdAt: '2025-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Template Registry Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getTemplate', () => {
    it('returns template when found', async () => {
      mockGetTemplate.mockResolvedValue(sampleTemplate);
      const result = await getTemplate('HX123');
      expect(result).toEqual(sampleTemplate);
      expect(mockGetTemplate).toHaveBeenCalledWith('HX123');
    });

    it('returns null when template not found', async () => {
      mockGetTemplate.mockResolvedValue(null);
      const result = await getTemplate('MISSING');
      expect(result).toBeNull();
    });
  });

  describe('validateParameters', () => {
    it('returns valid when all required params are provided', async () => {
      mockGetTemplate.mockResolvedValue(sampleTemplate);

      const result = await validateParameters('HX123', {
        customerName: 'Rajesh',
        orderId: 'ORD-001',
        amount: '₹500',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('returns invalid when required params are missing', async () => {
      mockGetTemplate.mockResolvedValue(sampleTemplate);

      const result = await validateParameters('HX123', {
        customerName: 'Rajesh',
        // orderId and amount missing
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('returns invalid when template does not exist', async () => {
      mockGetTemplate.mockResolvedValue(null);

      const result = await validateParameters('MISSING', { foo: 'bar' });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Template MISSING not found');
    });

    it('returns valid when template has no parameter schema', async () => {
      mockGetTemplate.mockResolvedValue({
        ...sampleTemplate,
        parameterSchema: {},
      });

      const result = await validateParameters('HX123', {});
      expect(result.valid).toBe(true);
    });
  });

  describe('listTemplates', () => {
    it('returns all templates when no category filter', async () => {
      mockScanTemplates.mockResolvedValue([sampleTemplate]);
      const result = await listTemplates();
      expect(result).toHaveLength(1);
      expect(mockScanTemplates).toHaveBeenCalledWith(undefined);
    });

    it('passes category filter to scan', async () => {
      mockScanTemplates.mockResolvedValue([]);
      await listTemplates('marketing');
      expect(mockScanTemplates).toHaveBeenCalledWith('marketing');
    });
  });
});
