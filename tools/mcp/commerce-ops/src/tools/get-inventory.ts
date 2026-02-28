import { z } from "zod";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const getInventorySchema = z.object({
  productId: z.string().min(1, "productId is required"),
});

export async function getInventory(args: unknown, env: Env) {
  try {
    const { productId } = getInventorySchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // Get product item
    const productResult = await dynamo.send(
      new GetCommand({
        TableName: env.DDB_TABLE_NAME,
        Key: {
          PK: `PRODUCT#${productId}`,
          SK: `PRODUCT`,
        },
      })
    );
    
    if (!productResult.Item) {
      return errorResponse("NOT_FOUND", `Product ${productId} not found`);
    }
    
    // Query for inventory logs
    const logsResult = await dynamo.send(
      new QueryCommand({
        TableName: env.DDB_TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": `PRODUCT#${productId}`,
          ":sk": "INVENTORY_LOG#",
        },
        Limit: 50,
        ScanIndexForward: false, // Most recent first
      })
    );
    
    const truncated = (logsResult.Items?.length || 0) >= 50;
    
    return successResponse({
      productId,
      currentStock: productResult.Item.stock || 0,
      reservedStock: productResult.Item.reservedStock || 0,
      availableStock: (productResult.Item.stock || 0) - (productResult.Item.reservedStock || 0),
      recentLogs: logsResult.Items?.map((log) => ({
        timestamp: log.timestamp || log.createdAt,
        type: log.type,
        quantity: log.quantity,
        reason: log.reason,
        reference: log.reference,
      })) || [],
      truncated,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_inventory", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
