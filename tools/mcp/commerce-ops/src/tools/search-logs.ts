import { z } from "zod";
import { FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { getLogsClient } from "../shared/aws-clients.js";
import { successResponse, errorResponse } from "../shared/response-formatter.js";
import { handleAWSError, logError } from "../shared/error-handler.js";
import type { Env } from "../env.js";

export const searchLogsSchema = z.object({
  query: z.string().min(1, "query is required"),
  logGroupPrefix: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

export async function searchLogs(args: unknown, env: Env) {
  try {
    const { query, logGroupPrefix, startTime, endTime } = searchLogsSchema.parse(args);
    const logs = getLogsClient(env.AWS_REGION);
    
    const prefix = logGroupPrefix || env.LOG_GROUP_PREFIX;
    
    // Parse timestamps
    const startTimeMs = startTime ? new Date(startTime).getTime() : Date.now() - 3600000; // Default: 1 hour ago
    const endTimeMs = endTime ? new Date(endTime).getTime() : Date.now();
    
    const result = await logs.send(
      new FilterLogEventsCommand({
        logGroupName: prefix,
        filterPattern: query,
        startTime: startTimeMs,
        endTime: endTimeMs,
        limit: 100,
      })
    );
    
    const events = result.events?.map((event) => ({
      timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : null,
      message: event.message,
      logStreamName: event.logStreamName,
    })) || [];
    
    return successResponse({
      query,
      logGroupPrefix: prefix,
      timeRange: {
        start: new Date(startTimeMs).toISOString(),
        end: new Date(endTimeMs).toISOString(),
      },
      events,
      count: events.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", "Invalid input", error.errors);
    }
    logError("search_logs", error);
    const mcpError = handleAWSError(error);
    return errorResponse(mcpError.code, mcpError.message, mcpError.details);
  }
}
