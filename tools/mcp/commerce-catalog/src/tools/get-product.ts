import { z } from "zod";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const getProductSchema = z.object({
  productId: z.string().min(1, "productId is required"),
});

export async function getProduct(args: unknown, env: Env) {
  try {
    const { productId } = getProductSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    const result = await dynamo.send(
      new GetCommand({
        TableName: env.DDB_TABLE_NAME,
        Key: {
          PK: `PRODUCT#${productId}`,
          SK: `PRODUCT#${productId}`,
        },
      })
    );
    
    if (!result.Item) {
      return errorResponse("NOT_FOUND", `Product ${productId} not found`);
    }
    
    return successResponse({
      productId: result.Item.productId || productId,
      name: result.Item.name,
      description: result.Item.description,
      sellerId: result.Item.sellerId,
      categoryId: result.Item.categoryId,
      price: result.Item.price,
      currency: result.Item.currency || "INR",
      stock: result.Item.stock || 0,
      status: result.Item.status,
      images: result.Item.images || [],
      metadata: result.Item.metadata || {},
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_product", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
