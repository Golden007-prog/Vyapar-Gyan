import { z } from "zod";
import { DescribeLogGroupsCommand, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
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

    // Parse timestamps - default to last 1 hour if not specified
    const startTimeMs = startTime ? new Date(startTime).getTime() : Date.now() - 3600000;
    const endTimeMs = endTime ? new Date(endTime).getTime() : Date.now();

    // Find matching log groups
    const logGroupsResult = await logs.send(
      new DescribeLogGroupsCommand({
        logGroupNamePrefix: prefix,
        limit: 5, // Search first 5 matching log groups
      })
    );

    const logGroups = logGroupsResult.logGroups || [];
    
    if (logGroups.length === 0) {
      return successResponse({
        query,
        logGroupPrefix: prefix,
        timeRange: {
          start: new Date(startTimeMs).toISOString(),
          end: new Date(endTimeMs).toISOString(),
        },
        events: [],
        count: 0,
        truncated: false,
      });
    }

    // Search logs across all matching log groups
    const allEvents: any[] = [];
    
    for (const logGroup of logGroups) {
      if (allEvents.length >= 100) break; // Stop if we've reached the limit
      
      try {
        const result = await logs.send(
          new FilterLogEventsCommand({
            logGroupName: logGroup.logGroupName,
            filterPattern: query,
            startTime: startTimeMs,
            endTime: endTimeMs,
            limit: 100 - allEvents.length, // Remaining capacity
          })
        );

        if (result.events) {
          allEvents.push(...result.events);
        }
      } catch (err) {
        // Log error but continue with other log groups
        logError(`search_logs:${logGroup.logGroupName}`, err);
      }
    }

    // Sort by timestamp descending (most recent first)
    allEvents.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Limit to 100 entries
    const limitedEvents = allEvents.slice(0, 100);
    const truncated = allEvents.length > 100;

    const events = limitedEvents.map((event) => ({
      timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : null,
      message: event.message,
      logStreamName: event.logStreamName,
    }));

    return successResponse({
      query,
      logGroupPrefix: prefix,
      timeRange: {
        start: new Date(startTimeMs).toISOString(),
        end: new Date(endTimeMs).toISOString(),
      },
      events,
      count: events.length,
      truncated,
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
