/**
 * Trend Scheduler Service
 *
 * Manages per-seller EventBridge Scheduler rules for automated Grok/Gemini
 * market trend analysis. Sellers configure their preferred alert interval
 * via WhatsApp, and this service creates/updates/deletes the corresponding
 * EventBridge Scheduler rules.
 *
 * DynamoDB record: PK=SELLER#{id}, SK=TREND_CONFIG
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import {
  SchedulerClient,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  FlexibleTimeWindowMode,
  ActionAfterCompletion,
} from '@aws-sdk/client-scheduler';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrendInterval = '30m' | '1h' | '8h' | '24h';

export interface TrendConfig {
  sellerId: string;
  interval: TrendInterval;
  enabled: boolean;
  schedulerRuleArn?: string;
  schedulerRuleName?: string;
  phoneNumber: string;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Interval → rate expression mapping
// ---------------------------------------------------------------------------

const INTERVAL_TO_RATE: Record<TrendInterval, string> = {
  '30m': 'rate(30 minutes)',
  '1h': 'rate(1 hour)',
  '8h': 'rate(8 hours)',
  '24h': 'rate(24 hours)',
};

export const VALID_INTERVALS: TrendInterval[] = ['30m', '1h', '8h', '24h'];

const INTERVAL_LABELS: Record<TrendInterval, string> = {
  '30m': '30 minutes',
  '1h': '1 hour',
  '8h': '8 hours',
  '24h': '24 hours',
};

/**
 * Return a human-readable label for an interval.
 */
export function intervalLabel(interval: TrendInterval): string {
  return INTERVAL_LABELS[interval] ?? interval;
}

/**
 * Map an interval to an EventBridge Scheduler rate expression.
 */
export function intervalToRate(interval: TrendInterval): string {
  const rate = INTERVAL_TO_RATE[interval];
  if (!rate) {
    throw new Error(`Invalid trend interval: ${interval}`);
  }
  return rate;
}

// ---------------------------------------------------------------------------
// Clients (singletons)
// ---------------------------------------------------------------------------

const schedulerClient = new SchedulerClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

function resolveTableName(): string {
  const table = process.env.TABLE_NAME;
  if (!table) throw new Error('TABLE_NAME environment variable is required');
  return table;
}

function resolveSchedulerRoleArn(): string {
  const arn = process.env.TREND_SCHEDULER_ROLE_ARN;
  if (!arn) throw new Error('TREND_SCHEDULER_ROLE_ARN environment variable is required');
  return arn;
}

function resolveTrendAnalyzerArn(): string {
  const arn = process.env.TREND_ANALYZER_FUNCTION_ARN;
  if (!arn) throw new Error('TREND_ANALYZER_FUNCTION_ARN environment variable is required');
  return arn;
}

function schedulerRuleName(sellerId: string): string {
  const env = process.env.ENVIRONMENT || 'dev';
  // Sanitise sellerId for use in rule name (alphanumeric + hyphens only)
  const safe = sellerId.replace(/[^a-zA-Z0-9-]/g, '-');
  return `vyapargyan-${env}-trend-${safe}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create or update an EventBridge Scheduler rule for a seller's trend alerts.
 *
 * 1. Maps interval to rate expression
 * 2. Creates/updates EventBridge Scheduler rule targeting trend-analyzer-worker
 * 3. Stores config in DynamoDB: PK=SELLER#{id}, SK=TREND_CONFIG
 */
export async function createOrUpdateSchedule(
  sellerId: string,
  interval: TrendInterval,
  phoneNumber: string,
): Promise<void> {
  const tableName = resolveTableName();
  const roleArn = resolveSchedulerRoleArn();
  const targetArn = resolveTrendAnalyzerArn();
  const ruleName = schedulerRuleName(sellerId);
  const rateExpression = intervalToRate(interval);
  const now = new Date().toISOString();

  logger.info('Creating/updating trend schedule', {
    sellerId,
    interval,
    rateExpression,
    ruleName,
  });

  // Check if schedule already exists
  let scheduleExists = false;
  try {
    await schedulerClient.send(new GetScheduleCommand({ Name: ruleName }));
    scheduleExists = true;
  } catch (err: any) {
    if (err.name !== 'ResourceNotFoundException') {
      throw err;
    }
  }

  const input = {
    sellerId,
    phoneNumber,
    interval,
  };

  const scheduleParams = {
    Name: ruleName,
    Description: `Trend analysis alerts for seller ${sellerId} every ${intervalLabel(interval)}`,
    ScheduleExpression: rateExpression,
    FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
    Target: {
      Arn: targetArn,
      RoleArn: roleArn,
      Input: JSON.stringify(input),
    },
    State: 'ENABLED' as const,
    ActionAfterCompletion: ActionAfterCompletion.NONE,
  };

  let scheduleArn: string | undefined;

  if (scheduleExists) {
    const result = await schedulerClient.send(
      new UpdateScheduleCommand(scheduleParams),
    );
    scheduleArn = result.ScheduleArn;
    logger.info('Updated EventBridge Scheduler rule', { ruleName, scheduleArn });
  } else {
    const result = await schedulerClient.send(
      new CreateScheduleCommand(scheduleParams),
    );
    scheduleArn = result.ScheduleArn;
    logger.info('Created EventBridge Scheduler rule', { ruleName, scheduleArn });
  }

  // Persist config in DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `SELLER#${sellerId}`,
        SK: 'TREND_CONFIG',
        sellerId,
        interval,
        enabled: true,
        schedulerRuleArn: scheduleArn,
        schedulerRuleName: ruleName,
        phoneNumber,
        lastUpdated: now,
      },
    }),
  );

  logger.info('Trend config saved to DynamoDB', { sellerId, interval, enabled: true });
}

/**
 * Disable (delete) the EventBridge Scheduler rule for a seller and mark
 * the DynamoDB config as disabled.
 */
export async function disableSchedule(sellerId: string): Promise<void> {
  const tableName = resolveTableName();
  const now = new Date().toISOString();

  logger.info('Disabling trend schedule', { sellerId });

  // Read existing config to get the rule name
  const existing = await getTrendConfig(sellerId);

  if (existing?.schedulerRuleName) {
    try {
      await schedulerClient.send(
        new DeleteScheduleCommand({ Name: existing.schedulerRuleName }),
      );
      logger.info('Deleted EventBridge Scheduler rule', {
        ruleName: existing.schedulerRuleName,
      });
    } catch (err: any) {
      // If the rule doesn't exist, that's fine
      if (err.name !== 'ResourceNotFoundException') {
        throw err;
      }
      logger.warn('Scheduler rule not found during disable, continuing', {
        ruleName: existing.schedulerRuleName,
      });
    }
  }

  // Update DynamoDB config
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SELLER#${sellerId}`, SK: 'TREND_CONFIG' },
      UpdateExpression: 'SET enabled = :e, lastUpdated = :now REMOVE schedulerRuleArn, schedulerRuleName',
      ExpressionAttributeValues: {
        ':e': false,
        ':now': now,
      },
    }),
  );

  logger.info('Trend config disabled in DynamoDB', { sellerId });
}

/**
 * Retrieve the current trend config for a seller, or null if none exists.
 */
export async function getTrendConfig(sellerId: string): Promise<TrendConfig | null> {
  const tableName = resolveTableName();
  const res = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `SELLER#${sellerId}`, SK: 'TREND_CONFIG' },
    }),
  );
  return (res.Item as TrendConfig) ?? null;
}
