import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const listProductsByCategorySchema = z.object({
  categoryId: z.string().min(1, "categoryId is required"),
  limit: z.number().int().positive().max(100).default(20),
});

export async function listProductsByCategory(args: unknown, env: Env) {
  try {
    const { categoryId, limit } = listProductsByCategorySchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // Query using GSI2 (assuming GSI2PK = CATEGORY#categoryId, GSI2SK = PRODUCT#productId)
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DDB_TABLE_NAME,
        IndexName: "GSI2",
        KeyConditionExpression: "GSI2PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `CATEGORY#${categoryId}`,
        },
        Limit: limit,
      })
    );
    
    const products = result.Items?.map((item) => ({
      productId: item.productId,
      name: item.name,
      sellerId: item.sellerId,
      price: item.price,
      currency: item.currency || "INR",
      stock: item.stock || 0,
      status: item.status,
      createdAt: item.createdAt,
    })) || [];
    
    return successResponse({
      categoryId,
      products,
      count: products.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_products_by_category", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
