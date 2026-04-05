/**
 * Unit tests for Trend Scheduler Service
 *
 * Validates: intervalToRate mapping, intervalLabel, createOrUpdateSchedule,
 * disableSchedule, getTrendConfig
 *
 * Requirements: 4.1, 4.2, 4.5, 4.6
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreateSchedule = jest.fn();
const mockUpdateSchedule = jest.fn();
const mockDeleteSchedule = jest.fn();
const mockGetSchedule = jest.fn();
const mockDocSend = jest.fn();

jest.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn().mockImplementation(() => ({
    send: (cmd: any) => {
      const name = cmd.constructor.name;
      if (name === 'CreateScheduleCommand') return mockCreateSchedule(cmd);
      if (name === 'UpdateScheduleCommand') return mockUpdateSchedule(cmd);
      if (name === 'DeleteScheduleCommand') return mockDeleteSchedule(cmd);
      if (name === 'GetScheduleCommand') return mockGetSchedule(cmd);
      return Promise.resolve({});
    },
  })),
  CreateScheduleCommand: jest.fn().mockImplementation((input) => ({ input, constructor: { name: 'CreateScheduleCommand' } })),
  UpdateScheduleCommand: jest.fn().mockImplementation((input) => ({ input, constructor: { name: 'UpdateScheduleCommand' } })),
  DeleteScheduleCommand: jest.fn().mockImplementation((input) => ({ input, constructor: { name: 'DeleteScheduleCommand' } })),
  GetScheduleCommand: jest.fn().mockImplementation((input) => ({ input, constructor: { name: 'GetScheduleCommand' } })),
  FlexibleTimeWindowMode: { OFF: 'OFF' },
  ActionAfterCompletion: { NONE: 'NONE' },
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({
      send: (cmd: any) => mockDocSend(cmd),
    })),
  },
  GetCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'Get' })),
  PutCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'Put' })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'Update' })),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Set env vars before importing the module
process.env.TABLE_NAME = 'test-table';
process.env.ENVIRONMENT = 'dev';
process.env.TREND_SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/test-role';
process.env.TREND_ANALYZER_FUNCTION_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:test-trend-analyzer';

import {
  intervalToRate,
  intervalLabel,
  VALID_INTERVALS,
  createOrUpdateSchedule,
  disableSchedule,
  getTrendConfig,
} from '../trend-scheduler';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Trend Scheduler Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('intervalToRate', () => {
    it('maps 30m to rate(30 minutes)', () => {
      expect(intervalToRate('30m')).toBe('rate(30 minutes)');
    });

    it('maps 1h to rate(1 hour)', () => {
      expect(intervalToRate('1h')).toBe('rate(1 hour)');
    });

    it('maps 8h to rate(8 hours)', () => {
      expect(intervalToRate('8h')).toBe('rate(8 hours)');
    });

    it('maps 24h to rate(24 hours)', () => {
      expect(intervalToRate('24h')).toBe('rate(24 hours)');
    });

    it('throws for invalid interval', () => {
      expect(() => intervalToRate('5m' as any)).toThrow('Invalid trend interval');
    });
  });

  describe('intervalLabel', () => {
    it('returns human-readable labels', () => {
      expect(intervalLabel('30m')).toBe('30 minutes');
      expect(intervalLabel('1h')).toBe('1 hour');
      expect(intervalLabel('8h')).toBe('8 hours');
      expect(intervalLabel('24h')).toBe('24 hours');
    });
  });

  describe('VALID_INTERVALS', () => {
    it('contains exactly 4 intervals', () => {
      expect(VALID_INTERVALS).toEqual(['30m', '1h', '8h', '24h']);
    });
  });

  describe('createOrUpdateSchedule', () => {
    it('creates a new schedule when none exists', async () => {
      // GetSchedule throws ResourceNotFoundException
      mockGetSchedule.mockRejectedValueOnce({ name: 'ResourceNotFoundException' });
      mockCreateSchedule.mockResolvedValueOnce({ ScheduleArn: 'arn:aws:scheduler:::schedule/test' });
      mockDocSend.mockResolvedValueOnce({}); // PutCommand

      await createOrUpdateSchedule('seller-123', '8h', '+917001124396');

      expect(mockCreateSchedule).toHaveBeenCalledTimes(1);
      expect(mockUpdateSchedule).not.toHaveBeenCalled();
      expect(mockDocSend).toHaveBeenCalledTimes(1);

      // Verify DynamoDB put
      const putCall = mockDocSend.mock.calls[0][0];
      expect(putCall.input.Item.PK).toBe('SELLER#seller-123');
      expect(putCall.input.Item.SK).toBe('TREND_CONFIG');
      expect(putCall.input.Item.interval).toBe('8h');
      expect(putCall.input.Item.enabled).toBe(true);
      expect(putCall.input.Item.phoneNumber).toBe('+917001124396');
    });

    it('updates an existing schedule', async () => {
      // GetSchedule succeeds → schedule exists
      mockGetSchedule.mockResolvedValueOnce({});
      mockUpdateSchedule.mockResolvedValueOnce({ ScheduleArn: 'arn:aws:scheduler:::schedule/test' });
      mockDocSend.mockResolvedValueOnce({}); // PutCommand

      await createOrUpdateSchedule('seller-123', '1h', '+917001124396');

      expect(mockUpdateSchedule).toHaveBeenCalledTimes(1);
      expect(mockCreateSchedule).not.toHaveBeenCalled();
    });
  });

  describe('disableSchedule', () => {
    it('deletes the scheduler rule and updates DynamoDB', async () => {
      // getTrendConfig returns existing config
      mockDocSend.mockResolvedValueOnce({
        Item: {
          sellerId: 'seller-123',
          interval: '8h',
          enabled: true,
          schedulerRuleName: 'vyapargyan-dev-trend-seller-123',
          phoneNumber: '+917001124396',
        },
      });
      mockDeleteSchedule.mockResolvedValueOnce({});
      mockDocSend.mockResolvedValueOnce({}); // UpdateCommand

      await disableSchedule('seller-123');

      expect(mockDeleteSchedule).toHaveBeenCalledTimes(1);
      expect(mockDocSend).toHaveBeenCalledTimes(2); // Get + Update
    });

    it('handles missing scheduler rule gracefully', async () => {
      mockDocSend.mockResolvedValueOnce({
        Item: {
          sellerId: 'seller-123',
          schedulerRuleName: 'vyapargyan-dev-trend-seller-123',
          enabled: true,
        },
      });
      mockDeleteSchedule.mockRejectedValueOnce({ name: 'ResourceNotFoundException' });
      mockDocSend.mockResolvedValueOnce({}); // UpdateCommand

      // Should not throw
      await disableSchedule('seller-123');
      expect(mockDocSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTrendConfig', () => {
    it('returns config when it exists', async () => {
      const config = {
        sellerId: 'seller-123',
        interval: '8h',
        enabled: true,
        phoneNumber: '+917001124396',
        lastUpdated: '2024-01-15T10:30:00.000Z',
      };
      mockDocSend.mockResolvedValueOnce({ Item: config });

      const result = await getTrendConfig('seller-123');
      expect(result).toEqual(config);
    });

    it('returns null when no config exists', async () => {
      mockDocSend.mockResolvedValueOnce({ Item: undefined });

      const result = await getTrendConfig('seller-123');
      expect(result).toBeNull();
    });
  });
});
