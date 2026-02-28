import { z } from "zod";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const getProductMediaSchema = z.object({
  productId: z.string().min(1, "productId is required"),
});

export async function getProductMedia(args: unknown, env: Env) {
  try {
    const { productId } = getProductMediaSchema.parse(args);
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
    
    const images = result.Item.images || [];
    const mediaMetadata = images.map((img: any) => ({
      url: img.url || img,
      s3Key: img.s3Key,
      type: img.type || "image",
      order: img.order || 0,
      metadata: img.metadata || {},
    }));
    
    return successResponse({
      productId,
      media: mediaMetadata,
      count: mediaMetadata.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_product_media", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
