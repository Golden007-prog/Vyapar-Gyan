/**
 * Tool: get_dispute
 * Retrieves detailed dispute information for admin review.
 * Supports lookup by disputeId or orderId.
 */
import { z } from "zod";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
export const getDisputeSchema = z
    .object({
    orderId: z.string().optional(),
    disputeId: z.string().optional(),
})
    .refine((data) => data.orderId || data.disputeId, {
    message: "At least one of orderId or disputeId must be provided",
});
export async function getDispute(args, env) {
    try {
        // 1. Validate input parameters
        const { orderId, disputeId } = getDisputeSchema.parse(args);
        // 2. Get AWS client
        const dynamo = getDynamoClient(env.AWS_REGION);
        // 3. Execute AWS operation based on provided parameter
        let result;
        if (disputeId) {
            // Query by disputeId using PK=DISPUTE#{disputeId}, SK=DISPUTE#{disputeId}
            result = await dynamo.send(new GetCommand({
                TableName: env.DYNAMODB_TABLE_NAME,
                Key: {
                    PK: `DISPUTE#${disputeId}`,
                    SK: `DISPUTE#${disputeId}`,
                },
            }));
            // 4. Handle not found case
            if (!result.Item) {
                return errorResponse("NOT_FOUND", `Dispute ${disputeId} not found`);
            }
            // 5. Transform and return success response with all required fields
            return successResponse({
                dispute_id: result.Item.disputeId || result.Item.dispute_id || disputeId,
                order_id: result.Item.orderId || result.Item.order_id,
                seller_id: result.Item.sellerId || result.Item.seller_id,
                customer_id: result.Item.customerId || result.Item.customer_id,
                status: result.Item.status,
                reason: result.Item.reason,
                description: result.Item.description,
                status_history: result.Item.statusHistory || result.Item.status_history || [],
                linked_payment_id: result.Item.linkedPaymentId || result.Item.linked_payment_id,
                created_at: result.Item.createdAt || result.Item.created_at,
                updated_at: result.Item.updatedAt || result.Item.updated_at,
                resolved_at: result.Item.resolvedAt || result.Item.resolved_at,
            });
        }
        else if (orderId) {
            // Query by orderId using PK=ORDER#{orderId}, SK begins_with DISPUTE#
            result = await dynamo.send(new QueryCommand({
                TableName: env.DYNAMODB_TABLE_NAME,
                KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues: {
                    ":pk": `ORDER#${orderId}`,
                    ":sk": "DISPUTE#",
                },
            }));
            // 4. Handle not found case
            if (!result.Items || result.Items.length === 0) {
                return errorResponse("NOT_FOUND", `No disputes found for order ${orderId}`);
            }
            // 5. Transform items to dispute details
            const disputes = result.Items.map((item) => ({
                dispute_id: item.disputeId || item.dispute_id,
                order_id: item.orderId || item.order_id || orderId,
                seller_id: item.sellerId || item.seller_id,
                customer_id: item.customerId || item.customer_id,
                status: item.status,
                reason: item.reason,
                description: item.description,
                status_history: item.statusHistory || item.status_history || [],
                linked_payment_id: item.linkedPaymentId || item.linked_payment_id,
                created_at: item.createdAt || item.created_at,
                updated_at: item.updatedAt || item.updated_at,
                resolved_at: item.resolvedAt || item.resolved_at,
            }));
            // Return array of disputes for the order
            return successResponse({
                disputes,
                count: disputes.length,
            });
        }
        // This should never be reached due to Zod validation
        return errorResponse("VALIDATION_ERROR", "At least one of orderId or disputeId must be provided");
    }
    catch (error) {
        // 6. Handle errors with appropriate error codes
        if (error instanceof z.ZodError) {
            return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
        }
        logError("get_dispute", error);
        const mcpError = handleAWSError(error);
        return errorResponse(mcpError.code, mcpError.message, mcpError.details);
    }
}
//# sourceMappingURL=get-dispute.js.map