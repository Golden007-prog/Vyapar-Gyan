/**
 * Tool: list_pending_seller_approvals
 * Lists pending seller approval requests for admin review.
 * Queries DynamoDB for Approval_Record items with pending status.
 */

import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const listPendingSellerApprovalsSchema = z.object({
  limit: z.number().int().positive().max(100).default(20).optional(),
});

export async function listPendingSellerApprovals(args: unknown, env: Env) {
  try {
    // 1. Validate input parameters with default
    const parsed = listPendingSellerApprovalsSchema.parse(args || {});
    const limit = parsed.limit ?? 20;
    
    // 2. Get AWS client
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // 3. Query DynamoDB for pending approval records
    // Using GSI3 for workflow/admin access pattern
    // GSI3PK = WORKFLOW#SELLER_APPROVAL, GSI3SK = STATUS#pending#<created_at>
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DYNAMODB_TABLE_NAME,
        IndexName: "GSI3",
        KeyConditionExpression: "GSI3PK = :pk AND begins_with(GSI3SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": "WORKFLOW#SELLER_APPROVAL",
          ":sk": "STATUS#pending#",
        },
        Limit: limit,
        ScanIndexForward: true, // Ascending order - oldest first
      })
    );
    
    // 4. Handle empty results
    if (!result.Items || result.Items.length === 0) {
      return successResponse({
        sellers: [],
        count: 0,
        hasMore: false,
        message: "No pending seller approvals found",
      });
    }
    
    // 5. Transform items to seller summaries
    const sellers = result.Items.map((item) => ({
      seller_id: item.sellerId || item.seller_id,
      business_name: item.businessName || item.business_name,
      owner_name: item.ownerName || item.owner_name,
      contact_phone: item.contactPhone || item.contact_phone || item.phone,
      contact_email: item.contactEmail || item.contact_email || item.email,
      verification_status: item.verificationStatus || item.verification_status || "pending",
      created_at: item.createdAt || item.created_at,
      review_state: item.reviewState || item.review_state || "pending",
    }));
    
    // 6. Include hasMore indicator
    const hasMore = !!result.LastEvaluatedKey;
    
    // 7. Return success response
    return successResponse({
      sellers,
      count: sellers.length,
      hasMore,
    });
  } catch (error) {
    // 8. Handle errors with appropriate error codes
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_pending_seller_approvals", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
