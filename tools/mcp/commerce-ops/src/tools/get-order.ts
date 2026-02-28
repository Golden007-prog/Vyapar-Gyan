import { z } from "zod";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const getOrderSchema = z.object({
  orderId: z.string().min(1, "orderId is required"),
});

export async function getOrder(args: unknown, env: Env) {
  try {
    const { orderId } = getOrderSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    const result = await dynamo.send(
      new GetCommand({
        TableName: env.DDB_TABLE_NAME,
        Key: {
          PK: `ORDER#${orderId}`,
          SK: `ORDER`,
        },
      })
    );
    
    if (!result.Item) {
      return errorResponse("NOT_FOUND", `Order ${orderId} not found`);
    }
    
    return successResponse({
      orderId: result.Item.orderId || orderId,
      status: result.Item.status,
      customerId: result.Item.customerId,
      sellerId: result.Item.sellerId,
      totalAmount: result.Item.totalAmount,
      currency: result.Item.currency || "INR",
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt,
      metadata: result.Item.metadata || {},
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_order", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
