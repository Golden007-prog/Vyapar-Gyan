/**
 * Tool: get_category
 * Retrieves category details by category ID.
 */
import { z } from "zod";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
export const getCategorySchema = z.object({
    categoryId: z.string().min(1, "categoryId is required"),
});
export async function getCategory(args, env) {
    try {
        // 1. Validate input parameters
        const { categoryId } = getCategorySchema.parse(args);
        // 2. Get AWS client
        const dynamo = getDynamoClient(env.AWS_REGION);
        // 3. Execute AWS operation
        const result = await dynamo.send(new GetCommand({
            TableName: env.DYNAMODB_TABLE_NAME,
            Key: {
                PK: `CATEGORY#${categoryId}`,
                SK: `CATEGORY`,
            },
        }));
        // 4. Handle not found case
        if (!result.Item) {
            return errorResponse("NOT_FOUND", `Category ${categoryId} not found`);
        }
        // 5. Transform and return success response
        return successResponse({
            categoryId: result.Item.categoryId || categoryId,
            name: result.Item.name,
            slug: result.Item.slug,
            parentCategoryId: result.Item.parentCategoryId || null,
            status: result.Item.status,
            createdAt: result.Item.createdAt,
            updatedAt: result.Item.updatedAt,
        });
    }
    catch (error) {
        // 6. Handle errors with appropriate error codes
        if (error instanceof z.ZodError) {
            return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
        }
        logError("get_category", error);
        const mcpError = handleAWSError(error);
        return errorResponse(mcpError.code, mcpError.message, mcpError.details);
    }
}
//# sourceMappingURL=get-category.js.map