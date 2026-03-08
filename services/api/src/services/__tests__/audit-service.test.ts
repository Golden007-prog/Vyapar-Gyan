/**
 * Unit tests for Audit Service
 *
 * Validates: logAction creates audit entries, fire-and-forget error handling.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPutAuditLog = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  putAuditLog: (...args: unknown[]) => mockPutAuditLog(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { logAction } from '../audit-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Audit Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('logAction', () => {
    it('creates an audit log entry with all fields', async () => {
      mockPutAuditLog.mockResolvedValue(undefined);

      const auditId = await logAction({
        actorId: 'seller-1',
        actorRole: 'seller',
        actionType: 'approval_approved',
        resourceType: 'approval',
        resourceId: 'appr-1',
        oldValues: { status: 'pending_review' },
        newValues: { status: 'approved' },
        approvalId: 'appr-1',
        metadata: { source: 'web' },
      });

      expect(auditId).toBeDefined();
      expect(typeof auditId).toBe('string');
      expect(mockPutAuditLog).toHaveBeenCalledTimes(1);

      const stored = mockPutAuditLog.mock.calls[0][0];
      expect(stored.actorId).toBe('seller-1');
      expect(stored.actorRole).toBe('seller');
      expect(stored.actionType).toBe('approval_approved');
      expect(stored.resourceType).toBe('approval');
      expect(stored.resourceId).toBe('appr-1');
      expect(stored.oldValues).toEqual({ status: 'pending_review' });
      expect(stored.newValues).toEqual({ status: 'approved' });
      expect(stored.createdAt).toBeDefined();
    });

    it('does not throw when DynamoDB write fails (fire-and-forget)', async () => {
      mockPutAuditLog.mockRejectedValue(new Error('DynamoDB error'));

      // Should not throw — audit logging is non-blocking
      const auditId = await logAction({
        actorId: 'system',
        actorRole: 'system',
        actionType: 'campaign_sent',
        resourceType: 'campaign',
        resourceId: 'camp-1',
      });

      expect(auditId).toBeDefined();
    });

    it('generates unique auditIds for each call', async () => {
      mockPutAuditLog.mockResolvedValue(undefined);

      const id1 = await logAction({
        actorId: 'a1',
        actorRole: 'admin',
        actionType: 'test',
        resourceType: 'test',
        resourceId: 'r1',
      });
      const id2 = await logAction({
        actorId: 'a1',
        actorRole: 'admin',
        actionType: 'test',
        resourceType: 'test',
        resourceId: 'r2',
      });

      expect(id1).not.toBe(id2);
    });
  });
});
