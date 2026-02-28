import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../../../shared/aws-clients.js";
import { successResponse, errorResponse } from "../../../shared/response-formatter.js";
import { handleAWSError, logError } from "../../../shared/error-handler.js";
import type { Env } from "../env.js";

export const listRecentPaymentsSchema = z.object({
  status: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
});

export async function listRecentPayments(args: unknown, env: Env) {
  try {
    const { status, limit } = listRecentPaymentsSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // Query using GSI3 for workflow/admin access pattern
    // Assuming GSI3PK = WORKFLOW#PAYMENT, GSI3SK = STATUS#status#timestamp or TIMESTAMP#timestamp
    const queryParams: any = {
      TableName: env.DDB_TABLE_NAME,
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
      ScanIndexForward: false, // Most recent first
    };
    
    const result = await dynamo.send(new QueryCommand(queryParams));
    
    const payments = result.Items?.map((item) => ({
      paymentId: item.paymentId,
      orderId: item.orderId,
      amount: item.amount,
      currency: item.currency || "INR",
      status: item.status,
      method: item.method,
      provider: item.provider,
      createdAt: item.createdAt,
    })) || [];
    
    return successResponse({
      status: status || "all",
      payments,
      count: payments.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_recent_payments", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
