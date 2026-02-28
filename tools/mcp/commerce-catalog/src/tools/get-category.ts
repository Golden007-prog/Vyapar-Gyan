import { z } from "zod";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const getCategorySchema = z.object({
  categoryId: z.string().min(1, "categoryId is required"),
});

export async function getCategory(args: unknown, env: Env) {
  try {
    const { categoryId } = getCategorySchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    const result = await dynamo.send(
      new GetCommand({
        TableName: env.DDB_TABLE_NAME,
        Key: {
          PK: `CATEGORY#${categoryId}`,
          SK: `CATEGORY#${categoryId}`,
        },
      })
    );
    
    if (!result.Item) {
      return errorResponse("NOT_FOUND", `Category ${categoryId} not found`);
    }
    
    return successResponse({
      categoryId: result.Item.categoryId || categoryId,
      name: result.Item.name,
      description: result.Item.description,
      parentCategoryId: result.Item.parentCategoryId,
      level: result.Item.level || 0,
      status: result.Item.status,
      metadata: result.Item.metadata || {},
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_category", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
