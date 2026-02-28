/**
 * Tool: list_recent_payments
 * Lists recent payment transactions with optional status filtering.
 * Queries DynamoDB for Payment_Record items.
 */

import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const listRecentPaymentsSchema = z.object({
  status: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20).optional(),
});

export async function listRecentPayments(args: unknown, env: Env) {
  try {
    // 1. Validate input parameters with default
    const parsed = listRecentPaymentsSchema.parse(args || {});
    const limit = parsed.limit ?? 20;
    const status = parsed.status;
    
    // 2. Get AWS client
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // 3. Query DynamoDB for payment records
    // Using GSI3 for workflow/admin access pattern
    // GSI3PK = WORKFLOW#PAYMENT, GSI3SK = STATUS#status#<created_at> or TIMESTAMP#<created_at>
    const queryParams: any = {
      TableName: env.DYNAMODB_TABLE_NAME,
      IndexName: "GSI3",
      KeyConditionExpression: status
        ? "GSI3PK = :pk AND begins_with(GSI3SK, :sk)"
        : "GSI3PK = :pk",
      ExpressionAttributeValues: status
        ? {
            ":pk": "WORKFLOW#PAYMENT",
            ":sk": `STATUS#${status}#`,
          }
        : {
            ":pk": "WORKFLOW#PAYMENT",
          },
      Limit: limit,
      ScanIndexForward: false, // Descending order - most recent first
    };
    
    const result = await dynamo.send(new QueryCommand(queryParams));
    
    // 4. Handle empty results
    if (!result.Items || result.Items.length === 0) {
      return successResponse({
        payments: [],
        count: 0,
        hasMore: false,
        message: status 
          ? `No payments found with status: ${status}`
          : "No payments found",
      });
    }
    
    // 5. Transform items to payment summaries
    const payments = result.Items.map((item) => ({
      payment_id: item.paymentId || item.payment_id,
      order_id: item.orderId || item.order_id,
      amount: item.amount,
      currency: item.currency || "INR",
      status: item.status,
      provider: item.provider,
      gateway_payment_id: item.gatewayPaymentId || item.gateway_payment_id,
      created_at: item.createdAt || item.created_at,
      updated_at: item.updatedAt || item.updated_at,
    }));
    
    // 6. Include hasMore indicator
    const hasMore = !!result.LastEvaluatedKey;
    
    // 7. Return success response
    return successResponse({
      payments,
      count: payments.length,
      hasMore,
      ...(status && { status }),
    });
  } catch (error) {
    // 8. Handle errors with appropriate error codes
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_recent_payments", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
