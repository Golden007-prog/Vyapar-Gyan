import { z } from "zod";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const getOrderTimelineSchema = z.object({
  orderId: z.string().min(1, "orderId is required"),
});

export async function getOrderTimeline(args: unknown, env: Env) {
  try {
    const { orderId } = getOrderTimelineSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    // Query all items with PK = ORDER#orderId
    const result = await dynamo.send(
      new QueryCommand({
        TableName: env.DDB_TABLE_NAME,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `ORDER#${orderId}`,
        },
      })
    );
    
    if (!result.Items || result.Items.length === 0) {
      return errorResponse("NOT_FOUND", `No timeline found for order ${orderId}`);
    }
    
    // Sort by timestamp if available
    const timeline = result.Items.map((item) => ({
      type: item.SK?.split("#")[0] || "UNKNOWN",
      id: item.SK,
      timestamp: item.createdAt || item.timestamp || item.updatedAt,
      data: item,
    })).sort((a, b) => {
      const timeA = new Date(a.timestamp || 0).getTime();
      const timeB = new Date(b.timestamp || 0).getTime();
      return timeA - timeB;
    });
    
    return successResponse({
      orderId,
      timeline,
      count: timeline.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_order_timeline", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
