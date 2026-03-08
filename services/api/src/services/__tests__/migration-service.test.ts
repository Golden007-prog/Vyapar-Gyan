/**
 * Unit tests for Migration Service
 *
 * Validates: resolveUserByPhone with dual-read fallback from legacy patterns.
 */

import type { UserProfile } from '../../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetUserByPhone = jest.fn();
const mockCreateUserProfile = jest.fn();
const mockPutSession = jest.fn();
const mockPutCart = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  getUserByPhone: (...args: unknown[]) => mockGetUserByPhone(...args),
  createUserProfile: (...args: unknown[]) => mockCreateUserProfile(...args),
  putSession: (...args: unknown[]) => mockPutSession(...args),
  putCart: (...args: unknown[]) => mockPutCart(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/config', () => ({
  getConfig: jest.fn().mockResolvedValue({ tableName: 'test-table' }),
}));

// Mock DynamoDB Document Client for legacy record reads
const mockDocSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: (...args: unknown[]) => mockDocSend(...args) }),
  },
  GetCommand: jest.fn().mockImplementation((params) => ({ _type: 'Get', ...params })),
  UpdateCommand: jest.fn().mockImplementation((params) => ({ _type: 'Update', ...params })),
}));

import { resolveUserByPhone } from '../migration-service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Migration Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('resolveUserByPhone', () => {
    it('returns existing user when found via new pattern (no migration needed)', async () => {
      const existingUser: UserProfile = {
        userId: 'user-1',
        role: 'customer',
        displayName: 'Rajesh',
        phoneNumber: '+919876543210',
        phoneVerificationStatus: 'verified',
        preferredChannel: 'whatsapp',
        whatsappConnected: true,
        cognitoId: 'cognito-1',
        status: 'active',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      mockGetUserByPhone.mockResolvedValue(existingUser);

      const result = await resolveUserByPhone('+919876543210');

      expect(result).not.toBeNull();
      expect(result!.wasMigrated).toBe(false);
      expect(result!.userProfile.userId).toBe('user-1');
      // Should NOT touch legacy records
      expect(mockDocSend).not.toHaveBeenCalled();
      expect(mockCreateUserProfile).not.toHaveBeenCalled();
    });

    it('returns null when no user exists in either pattern', async () => {
      mockGetUserByPhone.mockResolvedValue(null);
      mockDocSend.mockResolvedValue({ Item: undefined }); // No legacy customer

      const result = await resolveUserByPhone('+910000000000');

      expect(result).toBeNull();
    });

    it('migrates legacy customer to new pattern with session and cart', async () => {
      // No new-pattern user
      mockGetUserByPhone.mockResolvedValue(null);

      // Legacy customer exists
      const legacyCustomer = {
        id: 'cust-legacy',
        phoneNumber: '+919876543210',
        profileName: 'Legacy User',
        createdAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
      };

      const legacySession = {
        id: 'sess-legacy',
        customerId: 'cust-legacy',
        phoneNumber: '+919876543210',
        channelType: 'whatsapp',
        state: 'browsing',
        cart: [
          { productId: 'p1', sellerId: 's1', name: 'Widget', price: 100, quantity: 2, addedAt: '2024-06-01T00:00:00.000Z' },
        ],
        createdAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
        lastActivityAt: '2024-06-01T00:00:00.000Z',
      };

      // First GetCommand → legacy customer, second → legacy session, third/fourth → UpdateCommands
      mockDocSend
        .mockResolvedValueOnce({ Item: legacyCustomer })   // getLegacyCustomer
        .mockResolvedValueOnce({ Item: legacySession })     // getLegacySession
        .mockResolvedValueOnce({})                          // markLegacySessionMigrated
        .mockResolvedValueOnce({});                         // markLegacyCustomerMigrated

      mockCreateUserProfile.mockResolvedValue(undefined);
      mockPutSession.mockResolvedValue(undefined);
      mockPutCart.mockResolvedValue(undefined);

      const result = await resolveUserByPhone('+919876543210');

      expect(result).not.toBeNull();
      expect(result!.wasMigrated).toBe(true);
      expect(result!.userProfile.role).toBe('customer');
      expect(result!.userProfile.displayName).toBe('Legacy User');
      expect(result!.userProfile.preferredChannel).toBe('whatsapp');

      // Session migrated
      expect(result!.session).not.toBeNull();
      expect(result!.session!.state).toBe('browsing');

      // Cart extracted from legacy session
      expect(result!.cart).not.toBeNull();
      expect(result!.cart!.items).toHaveLength(1);
      expect(result!.cart!.subtotal).toBe(200); // 100 × 2

      // Verify new records were created
      expect(mockCreateUserProfile).toHaveBeenCalledTimes(1);
      expect(mockPutSession).toHaveBeenCalledTimes(1);
      expect(mockPutCart).toHaveBeenCalledTimes(1);
    });
  });
});
