import { IdempotencyService } from '../idempotency';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

const dynamoDBMock = mockClient(DynamoDBClient);

// Mock config
jest.mock('../config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    tableName: 'test-table',
  }),
}));

// Mock logger
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(() => {
    dynamoDBMock.reset();
    service = new IdempotencyService({ tableName: 'test-table', ttlSeconds: 60 });
  });

  describe('acquireLock', () => {
    it('should acquire lock for new message', async () => {
      dynamoDBMock.on(PutItemCommand).resolves({});

      const result = await service.acquireLock('msg-123', { from: '919876543210' });

      expect(result).toBe(true);
      expect(dynamoDBMock.calls()).toHaveLength(1);
      
      const call = dynamoDBMock.call(0);
      expect(call.args[0].input).toMatchObject({
        TableName: 'test-table',
        ConditionExpression: 'attribute_not_exists(PK)',
      });
    });

    it('should return false for duplicate message', async () => {
      const error = new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
      });
      dynamoDBMock.on(PutItemCommand).rejects(error);

      const result = await service.acquireLock('msg-123');

      expect(result).toBe(false);
      expect(dynamoDBMock.calls()).toHaveLength(1);
    });

    it('should throw error for other DynamoDB errors', async () => {
      dynamoDBMock.on(PutItemCommand).rejects(new Error('DynamoDB error'));

      await expect(service.acquireLock('msg-123')).rejects.toThrow('DynamoDB error');
    });

    it('should set TTL correctly', async () => {
      dynamoDBMock.on(PutItemCommand).resolves({});

      await service.acquireLock('msg-123');

      const call = dynamoDBMock.call(0);
      const item = call.args[0].input.Item;
      
      // Check that expiresAt is set and is in the future
      expect(item.expiresAt).toBeDefined();
      const expiresAt = item.expiresAt.N;
      const now = Math.floor(Date.now() / 1000);
      expect(Number(expiresAt)).toBeGreaterThan(now);
      expect(Number(expiresAt)).toBeLessThanOrEqual(now + 60);
    });
  });

  describe('isDuplicate', () => {
    it('should return false for new message', async () => {
      dynamoDBMock.on(PutItemCommand).resolves({});

      const result = await service.isDuplicate('msg-456');

      expect(result).toBe(false);
    });

    it('should return true for duplicate message', async () => {
      const error = new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
      });
      dynamoDBMock.on(PutItemCommand).rejects(error);

      const result = await service.isDuplicate('msg-456');

      expect(result).toBe(true);
    });
  });
});
