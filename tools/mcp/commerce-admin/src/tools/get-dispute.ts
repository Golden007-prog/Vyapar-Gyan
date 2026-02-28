import { z } from "zod";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../../../shared/aws-clients.js";
import { successResponse, errorResponse } from "../../../shared/response-formatter.js";
import { handleAWSError, logError } from "../../../shared/error-handler.js";
import type { Env } from "../env.js";

export const getDisputeSchema = z.object({
  orderId: z.string().optional(),
  disputeId: z.string().optional(),
}).refine((data) => data.orderId || data.disputeId, {
  message: "Either orderId or disputeId must be provided",
});

export async function getDispute(args: unknown, env: Env) {
  try {
    const { orderId, disputeId } = getDisputeSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    let dispute = null;
    let order = null;
    
    if (disputeId) {
      // Direct lookup by dispute ID
      const result = await dynamo.send(
        new GetCommand({
          TableName: env.DDB_TABLE_NAME,
          Key: {
            PK: `DISPUTE#${disputeId}`,
            SK: `DISPUTE#${disputeId}`,
          },
        })
      );
      dispute = result.Item;
      
      // Fetch related order if available
      if (dispute?.orderId) {
        const orderResult = await dynamo.send(
          new GetCommand({
            TableName: env.DDB_TABLE_NAME,
            Key: {
              PK: `ORDER#${dispute.orderId}`,
              SK: `ORDER#${dispute.orderId}`,
            },
          })
        );
        order = orderResult.Item;
      }
    } else if (orderId) {
      // Query disputes for this order
      const result = await dynamo.send(
        new QueryCommand({
          TableName: env.DDB_TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: {
            ":pk": `ORDER#${orderId}`,
            ":sk": "DISPUTE#",
          },
          Limit: 1,
        })
      );
      dispute = result.Items?.[0];
      
      // Fetch order
      const orderResult = await dynamo.send(
        new GetCommand({
          TableName: env.DDB_TABLE_NAME,
          Key: {
            PK: `ORDER#${orderId}`,
            SK: `ORDER#${orderId}`,
          },
        })
      );
      order = orderResult.Item;
    }
    
    if (!dispute) {
      return errorResponse("NOT_FOUND", `No dispute found for ${disputeId || orderId}`);
    }
    
    return successResponse({
      dispute: {
        disputeId: dispute.disputeId,
        orderId: dispute.orderId,
        customerId: dispute.customerId,
        sellerId: dispute.sellerId,
        reason: dispute.reason,
        description: dispute.description,
        status: dispute.status,
        amount: dispute.amount,
        resolution: dispute.resolution,
        createdAt: dispute.createdAt,
        updatedAt: dispute.updatedAt,
      },
      order: order ? {
        orderId: order.orderId,
        status: order.status,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
      } : null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_dispute", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
