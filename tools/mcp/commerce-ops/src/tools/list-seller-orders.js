import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
export const listSellerOrdersSchema = z.object({
    sellerId: z.string().min(1, "sellerId is required"),
    status: z.string().optional(),
    limit: z.number().int().positive().max(100).default(20),
});
export async function listSellerOrders(args, env) {
    try {
        const { sellerId, status, limit } = listSellerOrdersSchema.parse(args);
        const dynamo = getDynamoClient(env.AWS_REGION);
        // Query using GSI2 (assuming GSI2PK = SELLER#sellerId)
        const queryParams = {
            TableName: env.DDB_TABLE_NAME,
            IndexName: "GSI2",
            KeyConditionExpression: status
                ? "GSI2PK = :pk AND begins_with(GSI2SK, :sk)"
                : "GSI2PK = :pk",
            ExpressionAttributeValues: status
                ? {
                    ":pk": `SELLER#${sellerId}`,
                    ":sk": `STATUS#${status}#`,
                }
                : {
                    ":pk": `SELLER#${sellerId}`,
                },
            Limit: limit,
            ScanIndexForward: false, // Most recent first
        };
        const result = await dynamo.send(new QueryCommand(queryParams));
        const orders = result.Items?.map((item) => ({
            orderId: item.orderId,
            status: item.status,
            customerId: item.customerId,
            totalAmount: item.totalAmount,
            currency: item.currency || "INR",
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        })) || [];
        const hasMore = !!result.LastEvaluatedKey;
        return successResponse({
            sellerId,
            status: status || "all",
            orders,
            count: orders.length,
            hasMore,
        });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
        }
        logError("list_seller_orders", error);
        const mcpError = handleAWSError(error);
        return errorResponse(mcpError.code, mcpError.message, mcpError.details);
    }
}
//# sourceMappingURL=list-seller-orders.js.map