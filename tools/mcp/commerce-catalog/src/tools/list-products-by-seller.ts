/**
 * Tool: list_products_by_seller
 * Lists all products for a specific seller.
 */

import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import { Env } from "../env.js";

export const listProductsBySellerSchema = z.object({
  sellerId: z.string().min(1, "sellerId is required"),
  limit: z.number().int().min(1).max(100).default(20),
});

export async function listProductsBySeller(args: unknown, env: Env) {
  try {
    // 1. Validate input parameters
    const { sellerId, limit } = listProductsBySellerSchema.parse(args);
    
    // 2. Get AWS client
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // 3. Execute AWS operation - Query using GSI1 for seller products
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DYNAMODB_TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `SELLER#${sellerId}`,
        },
        Limit: limit,
        ScanIndexForward: false, // Sort by created_at descending (newest first)
      })
    );
    
    // 4. Transform results to product summaries
    const products = result.Items?.map((item) => {
      const stockQuantity = item.stockQuantity || 0;
      const reservedStock = item.reservedStock || 0;
      const availableStock = stockQuantity - reservedStock;
      
      return {
        productId: item.productId,
        name: item.name,
        price: item.price,
        stockQuantity,
        reservedStock,
        availableStock,
        status: item.status,
        createdAt: item.createdAt,
      };
    }) || [];
    
    // 5. Determine if more results exist
    const hasMore = !!result.LastEvaluatedKey;
    
    // 6. Return success response
    return successResponse({
      sellerId,
      products,
      count: products.length,
      hasMore,
      message: products.length === 0 ? "No products found for this seller" : undefined,
    });
  } catch (error) {
    // 7. Handle errors with appropriate error codes
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("list_products_by_seller", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
