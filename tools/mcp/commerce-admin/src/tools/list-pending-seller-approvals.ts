import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../../../shared/aws-clients.js";
import { successResponse, errorResponse } from "../../../shared/response-formatter.js";
import { handleAWSError, logError } from "../../../shared/error-handler.js";
import type { Env } from "../env.js";

export const listPendingSellerApprovalsSchema = z.object({
  limit: z.number().int().positive().max(100).default(20),
});

export async function listPendingSellerApprovals(args: unknown, env: Env) {
  try {
    const { limit } = listPendingSellerApprovalsSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // Query using GSI3 for workflow/admin access pattern
    // Assuming GSI3PK = WORKFLOW#SELLER_APPROVAL, GSI3SK = STATUS#pending#timestamp
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DDB_TABLE_NAME,
        IndexName: "GSI3",
        KeyConditionExpression: "GSI3PK = :pk AND begins_with(GSI3SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": "WORKFLOW#SELLER_APPROVAL",
          ":sk": "STATUS#pending#",
        },
        Limit: limit,
        ScanIndexForward: false, // Most recent first
      })
    );
    
    const sellers = result.Items?.map((item) => ({
      sellerId: item.sellerId,
      businessName: item.businessName,
      email: item.email,
      phone: item.phone,
      status: item.status,
      submittedAt: item.submittedAt || item.createdAt,
      documents: item.documents || [],
    })) || [];
    
    return successResponse({
      sellers,
      count: sellers.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_pending_seller_approvals", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
