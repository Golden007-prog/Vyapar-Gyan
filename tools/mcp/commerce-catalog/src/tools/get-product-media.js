/**
 * Tool: get_product_media
 * Retrieves product media metadata by product ID.
 */
import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
export const getProductMediaSchema = z.object({
    productId: z.string().min(1, "productId is required"),
});
export async function getProductMedia(args, env) {
    try {
        // 1. Validate input parameters
        const { productId } = getProductMediaSchema.parse(args);
        // 2. Get AWS client
        const dynamo = getDynamoClient(env.AWS_REGION);
        // 3. Execute AWS operation - Query for product media items
        const result = await dynamo.send(new QueryCommand({
            TableName: env.DYNAMODB_TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `PRODUCT#${productId}`,
                ":sk": "MEDIA#",
            },
        }));
        // 4. Transform results to media metadata array
        const media = result.Items?.map((item) => ({
            mediaId: item.mediaId,
            mediaType: item.mediaType,
            s3Key: item.s3Key,
            sortOrder: item.sortOrder,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        })) || [];
        // 5. Sort results by sort_order ascending
        media.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        // 6. Return success response
        return successResponse({
            productId,
            media,
            count: media.length,
            message: media.length === 0 ? "No media found for this product" : undefined,
        });
    }
    catch (error) {
        // 7. Handle errors with appropriate error codes
        if (error instanceof z.ZodError) {
            return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
        }
        logError("get_product_media", error);
        const mcpError = handleAWSError(error);
        return errorResponse(mcpError.code, mcpError.message, mcpError.details);
    }
}
//# sourceMappingURL=get-product-media.js.map