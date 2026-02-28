import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../../../shared/aws-clients.js";
import { successResponse, errorResponse } from "../../../shared/response-formatter.js";
import { handleAWSError, logError } from "../../../shared/error-handler.js";
import type { Env } from "../env.js";

export const getAuditTimelineSchema = z.object({
  resourceType: z.string().min(1, "resourceType is required"),
  resourceId: z.string().min(1, "resourceId is required"),
});

export async function getAuditTimeline(args: unknown, env: Env) {
  try {
    const { resourceType, resourceId } = getAuditTimelineSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // Query audit logs for this resource
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DDB_TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `${resourceType.toUpperCase()}#${resourceId}`,
          ":sk": "AUDIT#",
        },
        ScanIndexForward: true, // Chronological order
      })
    );
    
    const timeline = result.Items?.map((item) => ({
      auditId: item.auditId,
      action: item.action,
      actor: item.actor,
      actorType: item.actorType,
      changes: item.changes || {},
      metadata: item.metadata || {},
      timestamp: item.timestamp || item.createdAt,
    })) || [];
    
    return successResponse({
      resourceType,
      resourceId,
      timeline,
      count: timeline.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_audit_timeline", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
