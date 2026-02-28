import { z } from "zod";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse, partialSuccessResponse, Warning } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const getOrderTimelineSchema = z.object({
  orderId: z.string().min(1, "orderId is required"),
});

export async function getOrderTimeline(args: unknown, env: Env) {
  try {
    const { orderId } = getOrderTimelineSchema.parse(args);
    const dynamo = getDynamoClient(env.AWS_REGION);
    
    const warnings: Warning[] = [];
    
    // Get the order first
    const orderResult = await dynamo.send(
      new GetCommand({
        TableName: env.DDB_TABLE_NAME,
        Key: {
          PK: `ORDER#${orderId}`,
          SK: `ORDER`,
        },
      })
    );
    
    if (!orderResult.Item) {
      return errorResponse("NOT_FOUND", `Order ${orderId} not found`);
    }
    
    // Query all related items (items, payments, audit logs)
    const relatedResult = await dynamo.send(
      new QueryCommand({
        TableName: env.DDB_TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND SK <> :sk",
        ExpressionAttributeValues: {
          ":pk": `ORDER#${orderId}`,
          ":sk": `ORDER`,
        },
        Limit: 200,
      })
    );
    
    const items = relatedResult.Items?.filter(item => item.SK?.startsWith("ITEM#")) || [];
    const payments = relatedResult.Items?.filter(item => item.SK?.startsWith("PAYMENT#")) || [];
    const auditLogs = relatedResult.Items?.filter(item => item.SK?.startsWith("AUDIT#")) || [];
    
    const totalRelated = (relatedResult.Items?.length || 0);
    const truncated = totalRelated >= 200;
    
    if (truncated) {
      warnings.push({
        code: "TRUNCATED",
        message: "Timeline data was truncated due to limit",
        details: { limit: 200, returned: totalRelated }
      });
    }
    
    const data = {
      order: orderResult.Item,
      items: items.map(item => ({
        itemId: item.itemId,
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        createdAt: item.createdAt,
      })),
      payments: payments.map(payment => ({
        paymentId: payment.paymentId,
        amount: payment.amount,
        status: payment.status,
        method: payment.method,
        createdAt: payment.createdAt,
      })),
      auditLogs: auditLogs.map(log => ({
        timestamp: log.timestamp || log.createdAt,
        action: log.action,
        details: log.details,
      })),
      truncated,
    };
    
    if (warnings.length > 0) {
      return partialSuccessResponse(data, warnings);
    }
    
    return successResponse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("get_order_timeline", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
