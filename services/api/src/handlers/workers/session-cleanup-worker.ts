/**
 * Session Cleanup Worker
 *
 * EventBridge scheduled worker — cron 11:30 PM IST (18:00 UTC) daily.
 * Scans sessions with lastActivityAt older than 24 hours, marks state=closed.
 * Cart and message entities are preserved per their own TTLs
 * (cart: 7 days, messages: 30 days).
 *
 * Lambda config: timeout 120s, memory 256MB
 */

import type { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sessions inactive for more than 24 hours are marked as closed */
const INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Max sessions to process per invocation */
const MAX_SESSIONS_PER_RUN = 200;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: ScheduledEvent): Promise<void> {
  logger.info('Session cleanup worker started', { time: event.time });

  try {
    const config = await getConfig();
    const cutoff = new Date(Date.now() - INACTIVITY_THRESHOLD_MS).toISOString();

    const expiredSessions = await queryExpiredSessions(config.tableName, cutoff);

    logger.info('Expired sessions found', { count: expiredSessions.length });

    let closedCount = 0;
    let errorCount = 0;

    for (const session of expiredSessions) {
      try {
        await markSessionClosed(config.tableName, session.userId);
        closedCount++;
      } catch (error) {
        logger.error('Failed to close session', error, {
          userId: session.userId,
        });
        errorCount++;
      }
    }

    logger.info('Session cleanup worker completed', {
      closedCount,
      errorCount,
      totalProcessed: expiredSessions.length,
    });
  } catch (error) {
    logger.error('Session cleanup worker failed', error);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExpiredSession {
  userId: string;
  state: string;
  lastActivityAt: string;
}

// ---------------------------------------------------------------------------
// Query expired sessions
// ---------------------------------------------------------------------------

async function queryExpiredSessions(
  tableName: string,
  cutoff: string,
): Promise<ExpiredSession[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression:
        'begins_with(PK, :sessionPrefix) AND SK = :active AND lastActivityAt < :cutoff AND #state <> :closed',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: {
        ':sessionPrefix': 'SESSION#',
        ':active': 'ACTIVE',
        ':cutoff': cutoff,
        ':closed': 'closed',
      },
      ProjectionExpression: 'userId, #state, lastActivityAt',
      Limit: MAX_SESSIONS_PER_RUN,
    }),
  );

  return (result.Items ?? []).map((item) => ({
    userId: item.userId,
    state: item.state,
    lastActivityAt: item.lastActivityAt,
  }));
}

// ---------------------------------------------------------------------------
// Mark session as closed
// ---------------------------------------------------------------------------

async function markSessionClosed(
  tableName: string,
  userId: string,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${userId}`, SK: 'ACTIVE' },
      UpdateExpression: 'SET #state = :closed, updatedAt = :now',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: {
        ':closed': 'closed',
        ':now': new Date().toISOString(),
      },
    }),
  );

  logger.debug('Session marked as closed', { userId });
}
