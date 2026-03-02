/**
 * Tool: list_low_stock_products
 * Lists products with low stock for a specific seller.
 */
import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
export const listLowStockProductsSchema = z.object({
    sellerId: z.string().min(1, "sellerId is required"),
    threshold: z.number().int().min(0).default(5),
    limit: z.number().int().min(1).max(100).default(20),
});
export async function listLowStockProducts(args, env) {
    try {
        // 1. Validate input parameters
        const { sellerId, threshold, limit } = listLowStockProductsSchema.parse(args);
        // 2. Get AWS client
        const dynamo = getDynamoClient(env.AWS_REGION);
        // 3. Execute AWS operation - Query using GSI1 for seller products
        // Note: We query all products for the seller and filter client-side
        const result = await dynamo.send(new QueryCommand({
            TableName: env.DYNAMODB_TABLE_NAME,
            IndexName: "GSI1",
            KeyConditionExpression: "GSI1PK = :pk",
            ExpressionAttributeValues: {
                ":pk": `SELLER#${sellerId}`,
            },
            // Query more items than limit to account for filtering
            Limit: Math.min(limit * 5, 500),
        }));
        // 4. Calculate available stock and filter for low stock products
        const lowStockProducts = result.Items?.map((item) => {
            const stockQuantity = item.stockQuantity || 0;
            const reservedStock = item.reservedStock || 0;
            const availableStock = stockQuantity - reservedStock;
            return {
                productId: item.productId,
                name: item.name,
                stockQuantity,
                reservedStock,
                availableStock,
                status: item.status,
            };
        })
            .filter((product) => product.availableStock < threshold)
            .sort((a, b) => a.availableStock - b.availableStock) // Sort by available_stock ascending
            .slice(0, limit) || []; // Apply limit after filtering
        // 5. Return success response
        return successResponse({
            sellerId,
            threshold,
            products: lowStockProducts,
            count: lowStockProducts.length,
            message: lowStockProducts.length === 0 ? "No low stock products found for this seller" : undefined,
        });
    }
    catch (error) {
        // 6. Handle errors with appropriate error codes
        if (error instanceof z.ZodError) {
            return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
        }
        logError("list_low_stock_products", error);
        const mcpError = handleAWSError(error);
        return errorResponse(mcpError.code, mcpError.message, mcpError.details);
    }
}
//# sourceMappingURL=list-low-stock-products.js.map