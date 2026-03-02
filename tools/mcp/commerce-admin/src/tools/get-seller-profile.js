/**
 * Tool: get_seller_profile
 * Retrieves detailed seller profile information for admin review.
 */
import { z } from "zod";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
export const getSellerProfileSchema = z.object({
    sellerId: z.string().min(1, "sellerId is required"),
});
export async function getSellerProfile(args, env) {
    try {
        // 1. Validate input parameters
        const { sellerId } = getSellerProfileSchema.parse(args);
        // 2. Get AWS client
        const dynamo = getDynamoClient(env.AWS_REGION);
        // 3. Execute AWS operation with correct PK/SK pattern
        const result = await dynamo.send(new GetCommand({
            TableName: env.DYNAMODB_TABLE_NAME,
            Key: {
                PK: `SELLER#${sellerId}`,
                SK: `PROFILE`,
            },
        }));
        // 4. Handle not found case
        if (!result.Item) {
            return errorResponse("NOT_FOUND", `Seller ${sellerId} not found`);
        }
        // 5. Transform and return success response with all required fields
        return successResponse({
            seller_id: result.Item.seller_id || sellerId,
            business_name: result.Item.business_name,
            business_type: result.Item.business_type,
            owner_name: result.Item.owner_name,
            contact_phone: result.Item.contact_phone,
            contact_email: result.Item.contact_email,
            verification_status: result.Item.verification_status,
            document_keys: result.Item.document_keys || [],
            created_at: result.Item.created_at,
            updated_at: result.Item.updated_at,
            approved_at: result.Item.approved_at,
        });
    }
    catch (error) {
        // 6. Handle errors with appropriate error codes
        if (error instanceof z.ZodError) {
            return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
        }
        logError("get_seller_profile", error);
        const mcpError = handleAWSError(error);
        return errorResponse(mcpError.code, mcpError.message, mcpError.details);
    }
}
//# sourceMappingURL=get-seller-profile.js.map