import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const listProductsBySellerSchema = z.object({
  sellerId: z.string().min(1, "sellerId is required"),
  limit: z.number().int().positive().max(100).default(20),
});

export async function listProductsBySeller(args: unknown, env: Env) {
  try {
    const { sellerId, limit } = listProductsBySellerSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // Query using GSI1 (assuming GSI1PK = SELLER#sellerId, GSI1SK = PRODUCT#productId)
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DDB_TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `SELLER#${sellerId}`,
        },
        Limit: limit,
      })
    );
    
    const products = result.Items?.map((item) => ({
      productId: item.productId,
      name: item.name,
      price: item.price,
      currency: item.currency || "INR",
      stock: item.stock || 0,
      status: item.status,
      categoryId: item.categoryId,
      createdAt: item.createdAt,
    })) || [];
    
    return successResponse({
      sellerId,
      products,
      count: products.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_products_by_seller", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
