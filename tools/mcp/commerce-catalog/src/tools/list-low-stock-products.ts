import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const listLowStockProductsSchema = z.object({
  sellerId: z.string().min(1, "sellerId is required"),
  threshold: z.number().int().nonnegative().default(10),
  limit: z.number().int().positive().max(100).default(20),
});

export async function listLowStockProducts(args: unknown, env: Env) {
  try {
    const { sellerId, threshold, limit } = listLowStockProductsSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // Query seller products and filter by stock threshold
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DDB_TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `SELLER#${sellerId}`,
        },
        Limit: 100, // Query more to filter
      })
    );
    
    const lowStockProducts = (result.Items || [])
      .filter((item) => (item.stock || 0) <= threshold)
      .slice(0, limit)
      .map((item) => ({
        productId: item.productId,
        name: item.name,
        stock: item.stock || 0,
        price: item.price,
        currency: item.currency || "INR",
        status: item.status,
        categoryId: item.categoryId,
      }));
    
    return successResponse({
      sellerId,
      threshold,
      products: lowStockProducts,
      count: lowStockProducts.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_low_stock_products", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
