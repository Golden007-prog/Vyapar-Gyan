import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
export const getPaymentSchema = z.object({
    orderId: z.string().min(1, "orderId is required"),
});
export async function getPayment(args, env) {
    try {
        const { orderId } = getPaymentSchema.parse(args);
        const dynamo = getDynamoClient(env.AWS_REGION);
        // Query for payment items linked to this order
        const result = await dynamo.send(new QueryCommand({
            TableName: env.DDB_TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": `ORDER#${orderId}`,
                ":sk": "PAYMENT#",
            },
            Limit: 50,
        }));
        if (!result.Items || result.Items.length === 0) {
            return errorResponse("NOT_FOUND", `No payments found for order ${orderId}`);
        }
        const payments = result.Items.map((item) => ({
            paymentId: item.paymentId,
            orderId: item.orderId || orderId,
            amount: item.amount,
            currency: item.currency || "INR",
            status: item.status,
            method: item.method,
            provider: item.provider,
            transactionId: item.transactionId,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
        }));
        const truncated = result.Items.length >= 50;
        return successResponse({
            orderId,
            payments,
            count: payments.length,
            truncated,
        });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
        }
        logError("get_payment", error);
        const mcpError = handleAWSError(error);
        return errorResponse(mcpError.code, mcpError.message, mcpError.details);
    }
}
//# sourceMappingURL=get-payment.js.map