import { z } from "zod";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../../../shared/aws-clients.js";
import { successResponse, errorResponse } from "../../../shared/response-formatter.js";
import { handleAWSError, logError } from "../../../shared/error-handler.js";
import type { Env } from "../env.js";

export const getSellerProfileSchema = z.object({
  sellerId: z.string().min(1, "sellerId is required"),
});

export async function getSellerProfile(args: unknown, env: Env) {
  try {
    const { sellerId } = getSellerProfileSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    const result = await dynamo.send(
      new GetCommand({
        TableName: env.DDB_TABLE_NAME,
        Key: {
          PK: `SELLER#${sellerId}`,
          SK: `SELLER#${sellerId}`,
        },
      })
    );
    
    if (!result.Item) {
      return errorResponse("NOT_FOUND", `Seller ${sellerId} not found`);
    }
    
    return successResponse({
      sellerId: result.Item.sellerId || sellerId,
      businessName: result.Item.businessName,
      email: result.Item.email,
      phone: result.Item.phone,
      status: result.Item.status,
      verificationStatus: result.Item.verificationStatus,
      documents: result.Item.documents || [],
      address: result.Item.address || {},
      bankDetails: result.Item.bankDetails ? {
        accountHolderName: result.Item.bankDetails.accountHolderName,
        ifsc: result.Item.bankDetails.ifsc,
        verified: result.Item.bankDetails.verified || false,
      } : null,
      metadata: result.Item.metadata || {},
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_seller_profile", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
