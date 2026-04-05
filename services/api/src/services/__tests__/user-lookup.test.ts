const mockGetUserByPhone = jest.fn();

jest.mock('../../adapters/dynamodb-adapter', () => ({
  getUserByPhone: (...args: unknown[]) => mockGetUserByPhone(...args),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { resolveUserByPhone } from '../user-lookup';

describe('resolveUserByPhone', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns resolved user for a registered seller', async () => {
    const profile = {
      userId: 'seller-123',
      role: 'seller' as const,
      displayName: 'Test Seller',
      phoneNumber: '9876543210',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    mockGetUserByPhone.mockResolvedValue(profile);

    const result = await resolveUserByPhone('+919876543210');

    expect(result).toEqual({
      userId: 'seller-123',
      role: 'seller',
      profile,
    });
    expect(mockGetUserByPhone).toHaveBeenCalledWith('9876543210');
  });

  it('returns resolved user for a registered customer', async () => {
    const profile = {
      userId: 'cust-456',
      role: 'customer' as const,
      displayName: 'Test Customer',
      phoneNumber: '8765432109',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    mockGetUserByPhone.mockResolvedValue(profile);

    const result = await resolveUserByPhone('8765432109');

    expect(result).toEqual({
      userId: 'cust-456',
      role: 'customer',
      profile,
    });
  });

  it('returns null for unregistered phone number', async () => {
    mockGetUserByPhone.mockResolvedValue(null);

    const result = await resolveUserByPhone('+919999999999');

    expect(result).toBeNull();
  });

  it('returns null for invalid phone number (normalization fails)', async () => {
    const result = await resolveUserByPhone('invalid');

    expect(result).toBeNull();
    expect(mockGetUserByPhone).not.toHaveBeenCalled();
  });

  it('normalizes phone before querying DynamoDB', async () => {
    mockGetUserByPhone.mockResolvedValue(null);

    await resolveUserByPhone('+91 987-654-3210');

    expect(mockGetUserByPhone).toHaveBeenCalledWith('9876543210');
  });
});
