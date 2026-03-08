/**
 * Audit Service
 *
 * Creates permanent audit log entries for all significant platform actions.
 * Each entry is stored as AUDIT#{auditId} with GSI indexes for querying
 * by actor (GSI1: ACTOR#{actorId}) and by resource (GSI2: RESOURCE#{type}#{id}).
 *
 * Audit logs have NO TTL — they are retained permanently for compliance
 * and dispute resolution.
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { putAuditLog, type AuditLog } from '../adapters/dynamodb-adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogActionParams {
  actorId: string;
  actorRole: AuditLog['actorRole'];
  actionType: string;
  resourceType: string;
  resourceId: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  approvalId?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an audit log entry.
 *
 * The entry is written to DynamoDB with:
 * - PK: AUDIT#{auditId}  SK: TS#{timestamp}
 * - GSI1PK: ACTOR#{actorId}  GSI1SK: TS#{timestamp}
 * - GSI2PK: RESOURCE#{resourceType}#{resourceId}  GSI2SK: TS#{timestamp}
 *
 * This is a fire-and-forget operation — failures are logged but do not
 * propagate to the caller, so audit logging never blocks business logic.
 */
export async function logAction(params: LogActionParams): Promise<string> {
  const auditId = randomUUID();
  const now = new Date().toISOString();

  const log: AuditLog = {
    auditId,
    actorId: params.actorId,
    actorRole: params.actorRole,
    actionType: params.actionType,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    oldValues: params.oldValues,
    newValues: params.newValues,
    approvalId: params.approvalId,
    metadata: params.metadata,
    createdAt: now,
  };

  try {
    await putAuditLog(log);
    logger.info('Audit log created', {
      auditId,
      actorId: params.actorId,
      actionType: params.actionType,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
    });
  } catch (err) {
    // Audit logging should never block the caller
    logger.error('Failed to write audit log', err, {
      auditId,
      actionType: params.actionType,
      resourceId: params.resourceId,
    });
  }

  return auditId;
}
