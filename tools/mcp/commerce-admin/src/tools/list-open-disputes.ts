/**
 * Tool: list_open_disputes
 * Lists open disputes for admin monitoring and prioritization.
 * Queries DynamoDB for Dispute_Record items with open status.
 */

import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const listOpenDisputesSchema = z.object({
  limit: z.number().int().positive().max(100).default(20).optional(),
});

export async function listOpenDisputes(args: unknown, env: Env) {
  try {
    // 1. Validate input parameters with default
    const parsed = listOpenDisputesSchema.parse(args || {});
    const limit = parsed.limit ?? 20;
    
    // 2. Get AWS client
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // 3. Query DynamoDB for open dispute records
    // Using GSI3 for workflow/admin access pattern
    // GSI3PK = WORKFLOW#DISPUTE, GSI3SK = STATUS#open#<created_at>
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DYNAMODB_TABLE_NAME,
        IndexName: "GSI3",
        KeyConditionExpression: "GSI3PK = :pk AND begins_with(GSI3SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": "WORKFLOW#DISPUTE",
          ":sk": "STATUS#open#",
        },
        Limit: limit,
        ScanIndexForward: true, // Ascending order - oldest first
      })
    );
    
    // 4. Handle empty results
    if (!result.Items || result.Items.length === 0) {
      return successResponse({
        disputes: [],
        count: 0,
        hasMore: false,
        message: "No open disputes found",
      });
    }
    
    // 5. Transform items to dispute summaries
    const disputes = result.Items.map((item) => ({
      dispute_id: item.disputeId || item.dispute_id,
      order_id: item.orderId || item.order_id,
      seller_id: item.sellerId || item.seller_id,
      customer_id: item.customerId || item.customer_id,
      status: item.status,
      reason: item.reason,
      created_at: item.createdAt || item.created_at,
      last_updated_at: item.updatedAt || item.updated_at || item.lastUpdatedAt || item.last_updated_at,
    }));
    
    // 6. Include hasMore indicator
    const hasMore = !!result.LastEvaluatedKey;
    
    // 7. Return success response
    return successResponse({
      disputes,
      count: disputes.length,
      hasMore,
    });
  } catch (error) {
    // 8. Handle errors with appropriate error codes
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_open_disputes", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
