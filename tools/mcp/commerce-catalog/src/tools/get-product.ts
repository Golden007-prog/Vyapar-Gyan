/**
 * Tool: get_product
 * Retrieves product details by product ID.
 */

import { z } from "zod";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import { Env } from "../env.js";

export const getProductSchema = z.object({
  productId: z.string().min(1, "productId is required"),
});

export async function getProduct(args: unknown, env: Env) {
  try {
    // 1. Validate input parameters
    const { productId } = getProductSchema.parse(args);
    
    // 2. Get AWS client
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // 3. Execute AWS operation
    const result = await dynamo.send(
      new GetCommand({
        TableName: env.DYNAMODB_TABLE_NAME,
        Key: {
          PK: `PRODUCT#${productId}`,
          SK: `PRODUCT`,
        },
      })
    );
    
    // 4. Handle not found case
    if (!result.Item) {
      return errorResponse("NOT_FOUND", `Product ${productId} not found`);
    }
    
    // 5. Calculate available stock
    const stockQuantity = result.Item.stockQuantity || 0;
    const reservedStock = result.Item.reservedStock || 0;
    const availableStock = stockQuantity - reservedStock;
    
    // 6. Transform and return success response
    return successResponse({
      productId: result.Item.productId || productId,
      sellerId: result.Item.sellerId,
      categoryId: result.Item.categoryId,
      name: result.Item.name,
      description: result.Item.description,
      price: result.Item.price,
      currency: result.Item.currency || "INR",
      stockQuantity,
      reservedStock,
      availableStock,
      status: result.Item.status,
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt,
    });
  } catch (error) {
    // 7. Handle errors with appropriate error codes
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_product", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
