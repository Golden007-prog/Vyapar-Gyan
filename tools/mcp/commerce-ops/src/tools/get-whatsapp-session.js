import { z } from "zod";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
export const getWhatsappSessionSchema = z.object({
    phone: z.string().optional(),
    sessionId: z.string().optional(),
}).refine((data) => data.phone || data.sessionId, {
    message: "Either phone or sessionId must be provided",
});
export async function getWhatsappSession(args, env) {
    try {
        const { phone, sessionId } = getWhatsappSessionSchema.parse(args);
        const dynamo = getDynamoClient(env.AWS_REGION);
        let session = null;
        let sessionPK = "";
        if (sessionId) {
            // Direct lookup by session ID
            const result = await dynamo.send(new GetCommand({
                TableName: env.DDB_TABLE_NAME,
                Key: {
                    PK: `WHATSAPP_SESSION#${sessionId}`,
                    SK: `SESSION`,
                },
            }));
            session = result.Item;
            sessionPK = `WHATSAPP_SESSION#${sessionId}`;
        }
        else if (phone) {
            // Query by phone using GSI1
            const result = await dynamo.send(new QueryCommand({
                TableName: env.DDB_TABLE_NAME,
                IndexName: "GSI1",
                KeyConditionExpression: "GSI1PK = :pk",
                ExpressionAttributeValues: {
                    ":pk": `PHONE#${phone}`,
                },
                Limit: 1,
                ScanIndexForward: false, // Most recent first
            }));
            session = result.Items?.[0];
            sessionPK = session?.PK || "";
        }
        if (!session) {
            return errorResponse("NOT_FOUND", `No WhatsApp session found for ${sessionId || phone}`);
        }
        // Get recent messages for this session
        const messagesResult = await dynamo.send(new QueryCommand({
            TableName: env.DDB_TABLE_NAME,
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
                ":pk": sessionPK,
                ":sk": "MESSAGE#",
            },
            Limit: 50,
            ScanIndexForward: false,
        }));
        const truncated = (messagesResult.Items?.length || 0) >= 50;
        return successResponse({
            session: {
                sessionId: session.sessionId,
                phone: session.phone,
                status: session.status,
                currentStep: session.currentStep,
                context: session.context || {},
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
            },
            recentMessages: messagesResult.Items?.map((msg) => ({
                messageId: msg.messageId,
                direction: msg.direction,
                content: msg.content,
                timestamp: msg.timestamp || msg.createdAt,
            })) || [],
            truncated,
        });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
        }
        logError("get_whatsapp_session", error);
        const mcpError = handleAWSError(error);
        return errorResponse(mcpError.code, mcpError.message, mcpError.details);
    }
}
//# sourceMappingURL=get-whatsapp-session.js.map