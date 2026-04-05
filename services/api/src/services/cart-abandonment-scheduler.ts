/**
 * Cart Abandonment Scheduler Service
 *
 * Manages EventBridge Scheduler one-time rules for abandoned cart nudges.
 * When a customer adds/updates cart items, a 2-hour timer is created/reset.
 * When checkout completes, the timer is cancelled.
 *
 * DynamoDB record: PK=CART#{userId}, SK=NUDGE_TIMER
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6
 */

import {
  SchedulerClient,
  CreateScheduleCommand,
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
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NudgeTimer {
  userId: string;
  cartId: string;
  schedulerRuleName: string;
  timerType: 'first_nudge' | 'second_nudge';
  firstNudgeSentAt?: string;
  secondNudgeSentAt?: string;
  cartRecovered: boolean;
  channel?: string;
  createdAt: string;
}

export interface NudgeRecord {
  userId: string;
  nudgeType: 'first' | 'second';
  channel: 'whatsapp' | 'web';
  sentAt: string;
  cartRecovered: boolean;
  recoveredAt?: string;
  cartValue: number;
  itemCount: number;
}

// ---------------------------------------------------------------------------
// Pure functions (exported for property testing)
// ---------------------------------------------------------------------------

/**
 * Format a nudge message for the given item count, amount, and nudge type.
 *
 * First nudge: "You have {n} items in your cart worth ₹{amount}. Ready to checkout?"
 * Second nudge: includes a small incentive (free delivery).
 */
export function formatNudgeMessage(
  itemCount: number,
  amount: number,
  nudgeType: 'first' | 'second',
): string {
  const formattedAmount = `₹${amount.toLocaleString('en-IN')}`;
  const itemLabel = itemCount === 1 ? 'item' : 'items';

  if (nudgeType === 'first') {
    return `🛒 You have ${itemCount} ${itemLabel} in your cart worth ${formattedAmount}. Ready to checkout?`;
  }

  // Second nudge includes incentive
  return (
    `🛒 Your cart is still waiting! ${itemCount} ${itemLabel} worth ${formattedAmount}.\n\n` +
    `Complete your order now and get free delivery! 🚚`
  );
}

/**
 * Select the nudge channel based on whether the customer has an active
 * WhatsApp session.
 *
 * Active WhatsApp session → 'whatsapp'
 * Otherwise → 'web'
 */
export function selectNudgeChannel(
  hasActiveWhatsAppSession: boolean,
): 'whatsapp' | 'web' {
  return hasActiveWhatsAppSession ? 'whatsapp' : 'web';
}

// ---------------------------------------------------------------------------
// Clients (singletons)
// ---------------------------------------------------------------------------

const schedulerClient = new SchedulerClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveTableName(): string {
  const table = process.env.TABLE_NAME;
  if (!table) throw new Error('TABLE_NAME environment variable is required');
  return table;
}

function resolveSchedulerRoleArn(): string {
  const arn = process.env.CART_NUDGE_SCHEDULER_ROLE_ARN || process.env.TREND_SCHEDULER_ROLE_ARN;
  if (!arn) throw new Error('CART_NUDGE_SCHEDULER_ROLE_ARN environment variable is required');
  return arn;
}

function resolveWorkerArn(): string {
  const arn = process.env.CART_ABANDONMENT_WORKER_ARN;
  if (!arn) throw new Error('CART_ABANDONMENT_WORKER_ARN environment variable is required');
  return arn;
}

function nudgeRuleName(userId: string, cartId: string): string {
  const env = process.env.ENVIRONMENT || 'dev';
  const safeUser = userId.replace(/[^a-zA-Z0-9-]/g, '-');
  const safeCart = cartId.replace(/[^a-zA-Z0-9-]/g, '-');
  return `vyapargyan-${env}-cart-nudge-${safeUser}-${safeCart}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create or reset a 2-hour inactivity timer for a cart.
 * If a timer already exists, it is deleted and recreated.
 *
 * The timer fires the cart-abandonment-worker Lambda after 2 hours.
 */
export async function createOrResetTimer(
  userId: string,
  cartId: string,
): Promise<void> {
  const tableName = resolveTableName();
  const roleArn = resolveSchedulerRoleArn();
  const targetArn = resolveWorkerArn();
  const ruleName = nudgeRuleName(userId, cartId);
  const now = new Date();
  const fireAt = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now

  logger.info('Creating/resetting cart nudge timer', { userId, cartId, ruleName });

  // Delete existing schedule if present
  try {
    await schedulerClient.send(new GetScheduleCommand({ Name: ruleName }));
    await schedulerClient.send(new DeleteScheduleCommand({ Name: ruleName }));
    logger.debug('Deleted existing cart nudge schedule', { ruleName });
  } catch (err: any) {
    if (err.name !== 'ResourceNotFoundException') {
      throw err;
    }
  }

  // Create one-time schedule firing in 2 hours
  const result = await schedulerClient.send(
    new CreateScheduleCommand({
      Name: ruleName,
      Description: `Cart abandonment nudge for user ${userId}`,
      ScheduleExpression: `at(${fireAt.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      Target: {
        Arn: targetArn,
        RoleArn: roleArn,
        Input: JSON.stringify({
          userId,
          cartId,
          nudgeType: 'first',
        }),
      },
      ActionAfterCompletion: ActionAfterCompletion.DELETE,
    }),
  );

  // Store timer record in DynamoDB
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `CART#${userId}`,
        SK: 'NUDGE_TIMER',
        userId,
        cartId,
        schedulerRuleName: ruleName,
        timerType: 'first_nudge',
        cartRecovered: false,
        createdAt: now.toISOString(),
      },
    }),
  );

  logger.info('Cart nudge timer created', {
    userId,
    cartId,
    ruleName,
    fireAt: fireAt.toISOString(),
    scheduleArn: result.ScheduleArn,
  });
}

/**
 * Create a 24-hour second nudge timer after the first nudge is sent.
 */
export async function createSecondNudgeTimer(
  userId: string,
  cartId: string,
): Promise<void> {
  const tableName = resolveTableName();
  const roleArn = resolveSchedulerRoleArn();
  const targetArn = resolveWorkerArn();
  const ruleName = nudgeRuleName(userId, cartId) + '-2nd';
  const now = new Date();
  const fireAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  logger.info('Creating second nudge timer', { userId, cartId, ruleName });

  const result = await schedulerClient.send(
    new CreateScheduleCommand({
      Name: ruleName,
      Description: `Second cart abandonment nudge for user ${userId}`,
      ScheduleExpression: `at(${fireAt.toISOString().replace(/\.\d{3}Z$/, '')})`,
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      Target: {
        Arn: targetArn,
        RoleArn: roleArn,
        Input: JSON.stringify({
          userId,
          cartId,
          nudgeType: 'second',
        }),
      },
      ActionAfterCompletion: ActionAfterCompletion.DELETE,
    }),
  );

  // Update timer record
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `CART#${userId}`,
        SK: 'NUDGE_TIMER',
        userId,
        cartId,
        schedulerRuleName: ruleName,
        timerType: 'second_nudge',
        cartRecovered: false,
        createdAt: now.toISOString(),
      },
    }),
  );

  logger.info('Second nudge timer created', {
    userId,
    cartId,
    ruleName,
    fireAt: fireAt.toISOString(),
    scheduleArn: result.ScheduleArn,
  });
}

/**
 * Cancel the active nudge timer for a cart (e.g., on checkout).
 * Deletes the EventBridge Scheduler rule and removes the DynamoDB record.
 */
export async function cancelTimer(
  userId: string,
  cartId: string,
): Promise<void> {
  const tableName = resolveTableName();
  const ruleName = nudgeRuleName(userId, cartId);

  logger.info('Cancelling cart nudge timer', { userId, cartId });

  // Delete first nudge schedule
  for (const name of [ruleName, `${ruleName}-2nd`]) {
    try {
      await schedulerClient.send(new DeleteScheduleCommand({ Name: name }));
      logger.debug('Deleted cart nudge schedule', { ruleName: name });
    } catch (err: any) {
      if (err.name !== 'ResourceNotFoundException') {
        throw err;
      }
    }
  }

  // Remove timer record from DynamoDB
  await docClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: `CART#${userId}`, SK: 'NUDGE_TIMER' },
    }),
  );

  logger.info('Cart nudge timer cancelled', { userId, cartId });
}

/**
 * Record a nudge event for effectiveness tracking.
 * Stored as CART#{userId} / NUDGE#{timestamp}
 */
export async function trackNudge(record: NudgeRecord): Promise<void> {
  const tableName = resolveTableName();

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `CART#${record.userId}`,
        SK: `NUDGE#${record.sentAt}`,
        ...record,
      },
    }),
  );

  logger.info('Nudge tracked', {
    userId: record.userId,
    nudgeType: record.nudgeType,
    channel: record.channel,
  });
}

/**
 * Get the current nudge timer for a user, or null if none exists.
 */
export async function getNudgeTimer(userId: string): Promise<NudgeTimer | null> {
  const tableName = resolveTableName();
  const res = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `CART#${userId}`, SK: 'NUDGE_TIMER' },
    }),
  );
  return (res.Item as NudgeTimer) ?? null;
}
