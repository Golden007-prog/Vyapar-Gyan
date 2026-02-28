import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../../../shared/aws-clients.js";
import { successResponse, errorResponse } from "../../../shared/response-formatter.js";
import { handleAWSError, logError } from "../../../shared/error-handler.js";
import type { Env } from "../env.js";

export const listOpenDisputesSchema = z.object({
  limit: z.number().int().positive().max(100).default(20),
});

export async function listOpenDisputes(args: unknown, env: Env) {
  try {
    const { limit } = listOpenDisputesSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // Query using GSI3 for workflow/admin access pattern
    // Assuming GSI3PK = WORKFLOW#DISPUTE, GSI3SK = STATUS#open#timestamp
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DDB_TABLE_NAME,
        IndexName: "GSI3",
        KeyConditionExpression: "GSI3PK = :pk AND begins_with(GSI3SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": "WORKFLOW#DISPUTE",
          ":sk": "STATUS#open#",
        },
        Limit: limit,
        ScanIndexForward: false, // Most recent first
      })
    );
    
    const disputes = result.Items?.map((item) => ({
      disputeId: item.disputeId,
      orderId: item.orderId,
      customerId: item.customerId,
      sellerId: item.sellerId,
      reason: item.reason,
      status: item.status,
      amount: item.amount,
      createdAt: item.createdAt,
    })) || [];
    
    return successResponse({
      disputes,
      count: disputes.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_open_disputes", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
