/**
 * Tool: get_audit_timeline
 * Retrieves audit trail entries for a specific resource.
 * Queries DynamoDB for Audit_Record items sorted by timestamp descending.
 */

import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const getAuditTimelineSchema = z.object({
  resourceType: z.string().min(1, "resourceType is required"),
  resourceId: z.string().min(1, "resourceId is required"),
});

export async function getAuditTimeline(args: unknown, env: Env) {
  try {
    // 1. Validate input parameters
    const { resourceType, resourceId } = getAuditTimelineSchema.parse(args);
    
    // 2. Get AWS client
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // 3. Query DynamoDB for audit records
    // PK = RESOURCE#{resourceType}#{resourceId}, SK begins_with AUDIT#
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DYNAMODB_TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `RESOURCE#${resourceType}#${resourceId}`,
          ":sk": "AUDIT#",
        },
        Limit: 100, // Maximum 100 audit entries
        ScanIndexForward: false, // Descending order - most recent first
      })
    );
    
    // 4. Handle empty results
    if (!result.Items || result.Items.length === 0) {
      return successResponse({
        resource_type: resourceType,
        resource_id: resourceId,
        audit_records: [],
        count: 0,
        truncated: false,
        message: "No audit history found for this resource",
      });
    }
    
    // 5. Transform items to audit records
    const auditRecords = result.Items.map((item) => ({
      audit_id: item.auditId || item.audit_id,
      resource_type: item.resourceType || item.resource_type || resourceType,
      resource_id: item.resourceId || item.resource_id || resourceId,
      action: item.action,
      actor_id: item.actorId || item.actor_id,
      actor_type: item.actorType || item.actor_type,
      changes: item.changes || {},
      timestamp: item.timestamp || item.createdAt || item.created_at,
      metadata: item.metadata || {},
    }));
    
    // 6. Include truncated indicator if result set exceeds 100 entries
    const truncated = !!result.LastEvaluatedKey;
    
    // 7. Return success response
    return successResponse({
      resource_type: resourceType,
      resource_id: resourceId,
      audit_records: auditRecords,
      count: auditRecords.length,
      truncated,
    });
  } catch (error) {
    // 8. Handle errors with appropriate error codes
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_audit_timeline", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
