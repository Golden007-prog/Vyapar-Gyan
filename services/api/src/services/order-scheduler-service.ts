/**
 * Order Scheduler Service
 *
 * Uses EventBridge Scheduler to create one-time schedules for:
 * - Seller confirmation reminders (30min reminder + 2h customer notify)
 * - Payment nudges (2h first nudge + 24h second nudge)
 *
 * All schedules target the notification router Lambda ARN.
 * Schedules are cancelled when an order reaches a terminal state
 * (paid, cancelled, rejected, expired).
 *
 * Requirements: 4.6, 4.7, 11.1, 11.2, 11.3, 11.4
 */

import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import { logger } from '../utils/logger';

const scheduler = new SchedulerClient({});

const SCHEDULE_GROUP = 'default';

/**
 * Add minutes to a Date and return the new Date.
 */
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * Format a Date as an EventBridge Scheduler `at()` expression.
 * Format: at(YYYY-MM-DDThh:mm:ss)
 */
function toScheduleExpression(date: Date): string {
  return `at(${date.toISOString().slice(0, 19)})`;
}

/**
 * Schedule seller confirmation reminders for a new order.
 *
 * - 30min: Remind seller on all channels
 * - 2h: Notify customer that seller hasn't responded
 *
 * Non-fatal — logs errors but does not throw.
 */
export async function scheduleSellerReminders(orderId: string, sellerId: string): Promise<void> {
  const notificationRouterArn = process.env.NOTIFICATION_ROUTER_ARN;
  const schedulerRoleArn = process.env.SCHEDULER_ROLE_ARN;

  if (!notificationRouterArn || !schedulerRoleArn) {
    logger.warn('Scheduler env vars not configured, skipping seller reminders', { orderId });
    return;
  }

  const now = new Date();

  try {
    // 30-minute seller reminder
    await scheduler.send(new CreateScheduleCommand({
      Name: `order-seller-remind-${orderId}`,
      GroupName: SCHEDULE_GROUP,
      ScheduleExpression: toScheduleExpression(addMinutes(now, 30)),
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: notificationRouterArn,
        RoleArn: schedulerRoleArn,
        Input: JSON.stringify({
          type: 'seller_reminder',
          orderId,
          sellerId,
        }),
      },
      ActionAfterCompletion: 'DELETE',
    }));

    // 2-hour customer notification
    await scheduler.send(new CreateScheduleCommand({
      Name: `order-customer-notify-${orderId}`,
      GroupName: SCHEDULE_GROUP,
      ScheduleExpression: toScheduleExpression(addMinutes(now, 120)),
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: notificationRouterArn,
        RoleArn: schedulerRoleArn,
        Input: JSON.stringify({
          type: 'seller_timeout_customer_notify',
          orderId,
          sellerId,
        }),
      },
      ActionAfterCompletion: 'DELETE',
    }));

    logger.info('Scheduled seller reminders', { orderId, sellerId });
  } catch (error) {
    logger.error('Failed to schedule seller reminders (non-fatal)', error, { orderId, sellerId });
  }
}

/**
 * Schedule payment reminder nudges after payment link generation.
 *
 * - 2h: First nudge with payment link
 * - 24h: Second nudge with urgency
 *
 * Non-fatal — logs errors but does not throw.
 */
export async function schedulePaymentNudges(
  orderId: string,
  customerId: string,
  paymentLinkUrl: string,
): Promise<void> {
  const notificationRouterArn = process.env.NOTIFICATION_ROUTER_ARN;
  const schedulerRoleArn = process.env.SCHEDULER_ROLE_ARN;

  if (!notificationRouterArn || !schedulerRoleArn) {
    logger.warn('Scheduler env vars not configured, skipping payment nudges', { orderId });
    return;
  }

  const now = new Date();

  try {
    // 2-hour first nudge
    await scheduler.send(new CreateScheduleCommand({
      Name: `order-pay-nudge1-${orderId}`,
      GroupName: SCHEDULE_GROUP,
      ScheduleExpression: toScheduleExpression(addMinutes(now, 120)),
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: notificationRouterArn,
        RoleArn: schedulerRoleArn,
        Input: JSON.stringify({
          type: 'payment_nudge_1',
          orderId,
          customerId,
          paymentLinkUrl,
        }),
      },
      ActionAfterCompletion: 'DELETE',
    }));

    // 24-hour second nudge (1440 minutes)
    await scheduler.send(new CreateScheduleCommand({
      Name: `order-pay-nudge2-${orderId}`,
      GroupName: SCHEDULE_GROUP,
      ScheduleExpression: toScheduleExpression(addMinutes(now, 1440)),
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: {
        Arn: notificationRouterArn,
        RoleArn: schedulerRoleArn,
        Input: JSON.stringify({
          type: 'payment_nudge_2',
          orderId,
          customerId,
          paymentLinkUrl,
        }),
      },
      ActionAfterCompletion: 'DELETE',
    }));

    logger.info('Scheduled payment nudges', { orderId, customerId });
  } catch (error) {
    logger.error('Failed to schedule payment nudges (non-fatal)', error, { orderId, customerId });
  }
}

/**
 * Cancel all pending schedules for an order.
 *
 * Called on payment success, cancellation, rejection, or expiry.
 * Uses Promise.allSettled so individual delete failures don't block others.
 * Silently ignores ResourceNotFoundException (schedule already fired/deleted).
 *
 * Non-fatal — logs errors but does not throw.
 */
export async function cancelOrderSchedules(orderId: string): Promise<void> {
  const scheduleNames = [
    `order-seller-remind-${orderId}`,
    `order-customer-notify-${orderId}`,
    `order-pay-nudge1-${orderId}`,
    `order-pay-nudge2-${orderId}`,
  ];

  const results = await Promise.allSettled(
    scheduleNames.map(name =>
      scheduler.send(new DeleteScheduleCommand({ Name: name, GroupName: SCHEDULE_GROUP }))
        .catch(error => {
          // Silently ignore if schedule doesn't exist (already fired or never created)
          if (error instanceof ResourceNotFoundException || error?.name === 'ResourceNotFoundException') {
            return;
          }
          throw error;
        }),
    ),
  );

  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    logger.warn('Some schedule deletions failed (non-fatal)', {
      orderId,
      failureCount: failures.length,
    });
  } else {
    logger.info('Cancelled order schedules', { orderId });
  }
}

/**
 * Determine whether a nudge should be suppressed based on customer consent
 * and quiet hours.
 *
 * Rules:
 * - If customer has optedOut=true, suppress all nudges
 * - During quiet hours (22:00–09:00 IST), suppress all nudges
 *
 * @param customer - Object with optedOut boolean
 * @param currentTimeIST - Current time in IST (hours 0-23)
 * @returns true if the nudge should be suppressed
 */
export function shouldSuppressNudge(
  customer: { optedOut: boolean },
  currentTimeIST: number,
): boolean {
  // Opted-out customers never receive nudges
  if (customer.optedOut) {
    return true;
  }

  // Quiet hours: 22:00–09:00 IST (i.e., hour >= 22 or hour < 9)
  if (currentTimeIST >= 22 || currentTimeIST < 9) {
    return true;
  }

  return false;
}
