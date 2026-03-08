/**
 * Unit tests for Approval Service
 *
 * Validates: createApproval with priority score, transitionStatus,
 * calculatePriorityScore, error handling.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPutApproval = jest.fn();
const mockGetApproval = jest.fn();
const mockUpdateApprovalStatus = jest.fn();
const mockQueryApprovalsBySeller = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  putApproval: (...args: unknown[]) => mockPutApproval(...args),
  getApproval: (...args: unknown[]) => mockGetApproval(...args),
  updateApprovalStatus: (...args: unknown[]) => mockUpdateApprovalStatus(...args),
  queryApprovalsBySeller: (...args: unknown[]) => mockQueryApprovalsBySeller(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({ eventBusName: 'test-bus' }),
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutEventsCommand: jest.fn(),
}));

import {
  createApproval,
  transitionStatus,
  calculatePriorityScore,
  ApprovalNotFoundError,
  ApprovalForbiddenError,
} from '../approval-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Approval Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('calculatePriorityScore', () => {
    it('returns weighted composite of revenue, stock age, and time sensitivity', () => {
      // revenue: 50000 → norm = min(50, 100) = 50
      // stockAge: 180 → norm = min((180/365)*100, 100) ≈ 49.32
      // timeSensitivity: 70 → norm = 70
      // score = 50*0.4 + 49.32*0.3 + 70*0.3 = 20 + 14.796 + 21 = 55.80
      const score = calculatePriorityScore(50000, 180, 70);
      expect(score).toBeGreaterThan(50);
      expect(score).toBeLessThan(60);
    });

    it('caps all inputs at their max normalised values', () => {
      // All maxed: revenue 200000 → 100, stockAge 500 → 100, time 150 → 100
      // score = 100*0.4 + 100*0.3 + 100*0.3 = 100
      const score = calculatePriorityScore(200000, 500, 150);
      expect(score).toBe(100);
    });

    it('returns 0 when all inputs are 0', () => {
      expect(calculatePriorityScore(0, 0, 0)).toBe(0);
    });
  });

  describe('createApproval', () => {
    it('creates an approval with pending_review status and computed priority', async () => {
      mockPutApproval.mockResolvedValue(undefined);

      const result = await createApproval({
        sellerId: 'seller-1',
        type: 'discount',
        payload: { discountPercent: 20 },
        aiRationale: 'Dead stock detected',
        estimatedImpact: 10000,
        affectedProductIds: ['prod-1', 'prod-2'],
        stockAgeDays: 120,
        timeSensitivityScore: 50,
      });

      expect(result.approvalId).toBeDefined();
      expect(result.status).toBe('pending_review');
      expect(result.sellerId).toBe('seller-1');
      expect(result.type).toBe('discount');
      expect(result.priorityScore).toBeGreaterThan(0);
      expect(mockPutApproval).toHaveBeenCalledTimes(1);
    });
  });

  describe('transitionStatus', () => {
    it('transitions from pending_review to approved', async () => {
      mockGetApproval.mockResolvedValue({
        approvalId: 'appr-1',
        sellerId: 'seller-1',
        status: 'pending_review',
        type: 'discount',
        payload: {},
        aiRationale: 'test',
        estimatedImpact: 1000,
        affectedProductIds: [],
        priorityScore: 50,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      mockUpdateApprovalStatus.mockResolvedValue(undefined);

      const result = await transitionStatus({
        approvalId: 'appr-1',
        sellerId: 'seller-1',
        newStatus: 'approved',
        approvedBy: 'seller-1',
      });

      expect(result.status).toBe('approved');
      expect(result.approvedBy).toBe('seller-1');
      expect(result.approvedAt).toBeDefined();
      expect(mockUpdateApprovalStatus).toHaveBeenCalledWith(
        'appr-1',
        'seller-1',
        expect.objectContaining({ status: 'approved' }),
      );
    });

    it('throws ApprovalNotFoundError when approval does not exist', async () => {
      mockGetApproval.mockResolvedValue(null);

      await expect(
        transitionStatus({ approvalId: 'missing', sellerId: 'seller-1', newStatus: 'approved' }),
      ).rejects.toThrow(ApprovalNotFoundError);
    });

    it('throws ApprovalForbiddenError when sellerId does not match', async () => {
      mockGetApproval.mockResolvedValue({
        approvalId: 'appr-1',
        sellerId: 'seller-other',
        status: 'pending_review',
      });

      await expect(
        transitionStatus({ approvalId: 'appr-1', sellerId: 'seller-1', newStatus: 'approved' }),
      ).rejects.toThrow(ApprovalForbiddenError);
    });
  });
});
