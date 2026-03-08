/**
 * Audit Export Worker
 *
 * EventBridge scheduled worker — cron 1st of month at midnight UTC.
 * Exports audit logs older than 90 days to S3 as NDJSON files, with
 * optional cleanup of exported records from DynamoDB.
 *
 * Cleanup is controlled by the AUDIT_CLEANUP_ENABLED environment variable
 * (default: false). When disabled, records remain in DynamoDB indefinitely
 * alongside the S3 archive.
 *
 * Lambda config: timeout 300s, memory 512MB
 */

import type { ScheduledEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { logAction } from '../../services/audit-service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Export audit logs older than 90 days */
const RETENTION_DAYS = 90;

/** Max records to scan per invocation */
const MAX_RECORDS_PER_RUN = 5000;

/** DynamoDB BatchWriteItem limit */
const BATCH_DELETE_SIZE = 25;

/** S3 key prefix for audit exports */
const S3_PREFIX = 'audit-exports';

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const rawClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const s3Client = new S3Client({});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: ScheduledEvent): Promise<void> {
  logger.info('Audit export worker started', { time: event.time });

  const cleanupEnabled = process.env.AUDIT_CLEANUP_ENABLED === 'true';

  try {
    const config = await getConfig();
    const cutoffDate = new Date(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Scan for audit logs older than 90 days
    const oldLogs = await scanOldAuditLogs(config.tableName, cutoffDate);

    if (oldLogs.length === 0) {
      logger.info('No audit logs older than 90 days — nothing to export');
      return;
    }

    logger.info('Old audit logs found for export', { count: oldLogs.length });

    // Export to S3 as NDJSON
    const bucket = process.env.DOCUMENTS_BUCKET ?? config.documentsBucket;
    const exportKey = buildExportKey();
    await exportToS3(bucket, exportKey, oldLogs);

    logger.info('Audit logs exported to S3', {
      bucket,
      key: exportKey,
      recordCount: oldLogs.length,
    });

    // Optional cleanup of exported records
    if (cleanupEnabled) {
      const deletedCount = await deleteExportedLogs(config.tableName, oldLogs);
      logger.info('Exported audit logs cleaned up from DynamoDB', {
        deletedCount,
      });
    } else {
      logger.info('Cleanup disabled — exported records retained in DynamoDB');
    }

    // Audit the export itself
    await logAction({
      actorId: 'system',
      actorRole: 'system',
      actionType: 'audit_logs_exported',
      resourceType: 'audit',
      resourceId: exportKey,
      newValues: {
        recordCount: oldLogs.length,
        s3Bucket: bucket,
        s3Key: exportKey,
        cleanupPerformed: cleanupEnabled,
      },
    });

    logger.info('Audit export worker completed', {
      exportedCount: oldLogs.length,
      cleanupEnabled,
      s3Key: exportKey,
    });
  } catch (error) {
    logger.error('Audit export worker failed', error);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditRecord {
  PK: string;
  SK: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Scan old audit logs
// ---------------------------------------------------------------------------

async function scanOldAuditLogs(
  tableName: string,
  cutoffDate: string,
): Promise<AuditRecord[]> {
  const allRecords: AuditRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'begins_with(PK, :auditPrefix) AND createdAt < :cutoff',
        ExpressionAttributeValues: {
          ':auditPrefix': 'AUDIT#',
          ':cutoff': cutoffDate,
        },
        Limit: 500,
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey }),
      }),
    );

    for (const item of result.Items ?? []) {
      allRecords.push(item as AuditRecord);
    }

    lastEvaluatedKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;

    // Safety limit
    if (allRecords.length >= MAX_RECORDS_PER_RUN) {
      logger.warn('Reached max records per run — stopping scan', {
        count: allRecords.length,
      });
      break;
    }
  } while (lastEvaluatedKey);

  return allRecords;
}

// ---------------------------------------------------------------------------
// Export to S3
// ---------------------------------------------------------------------------

function buildExportKey(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const ts = now.toISOString().replace(/[:.]/g, '-');
  return `${S3_PREFIX}/${year}/${month}/${day}/audit-export-${ts}.ndjson`;
}

async function exportToS3(
  bucket: string,
  key: string,
  records: AuditRecord[],
): Promise<void> {
  // Build NDJSON (newline-delimited JSON)
  const ndjson = records.map((r) => JSON.stringify(r)).join('\n');

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: ndjson,
      ContentType: 'application/x-ndjson',
      Metadata: {
        recordCount: String(records.length),
        exportedAt: new Date().toISOString(),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Delete exported logs (optional cleanup)
// ---------------------------------------------------------------------------

async function deleteExportedLogs(
  tableName: string,
  records: AuditRecord[],
): Promise<number> {
  let deletedCount = 0;

  // BatchWriteItem supports up to 25 items per call
  for (let i = 0; i < records.length; i += BATCH_DELETE_SIZE) {
    const batch = records.slice(i, i + BATCH_DELETE_SIZE);

    const deleteRequests = batch.map((record) => ({
      DeleteRequest: {
        Key: { PK: record.PK, SK: record.SK },
      },
    }));

    try {
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [tableName]: deleteRequests,
          },
        }),
      );
      deletedCount += batch.length;
    } catch (error) {
      logger.error('Failed to delete batch of audit logs', error, {
        batchStart: i,
        batchSize: batch.length,
      });
      // Continue with next batch — partial cleanup is acceptable
    }
  }

  return deletedCount;
}
