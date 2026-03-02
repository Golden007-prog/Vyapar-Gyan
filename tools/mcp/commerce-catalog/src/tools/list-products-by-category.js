/**
 * Tool: list_products_by_category
 * Lists all products in a specific category.
 */
import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
export const listProductsByCategorySchema = z.object({
    categoryId: z.string().min(1, "categoryId is required"),
    limit: z.number().int().min(1).max(100).default(20),
});
export async function listProductsByCategory(args, env) {
    try {
        // 1. Validate input parameters
        const { categoryId, limit } = listProductsByCategorySchema.parse(args);
        // 2. Get AWS client
        const dynamo = getDynamoClient(env.AWS_REGION);
        // 3. Execute AWS operation - Query using GSI2 for category products
        const result = await dynamo.send(new QueryCommand({
            TableName: env.DYNAMODB_TABLE_NAME,
            IndexName: "GSI2",
            KeyConditionExpression: "GSI2PK = :pk",
            ExpressionAttributeValues: {
                ":pk": `CATEGORY#${categoryId}`,
            },
            Limit: limit,
            ScanIndexForward: false, // Sort by created_at descending (newest first)
        }));
        // 4. Transform results to product summaries
        const products = result.Items?.map((item) => {
            const stockQuantity = item.stockQuantity || 0;
            return {
                productId: item.productId,
                sellerId: item.sellerId,
                name: item.name,
                price: item.price,
                stockQuantity,
                status: item.status,
                createdAt: item.createdAt,
            };
        }) || [];
        // 5. Determine if more results exist
        const hasMore = !!result.LastEvaluatedKey;
        // 6. Return success response
        return successResponse({
            categoryId,
            products,
            count: products.length,
            hasMore,
            message: products.length === 0 ? "No products found for this category" : undefined,
        });
    }
    catch (error) {
        // 7. Handle errors with appropriate error codes
        if (error instanceof z.ZodError) {
            return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
        }
        logError("list_products_by_category", error);
        const mcpError = handleAWSError(error);
        return errorResponse(mcpError.code, mcpError.message, mcpError.details);
    }
}
//# sourceMappingURL=list-products-by-category.js.map