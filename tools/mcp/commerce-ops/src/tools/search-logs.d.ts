import { z } from "zod";
import type { Env } from "../env.js";
export declare const searchLogsSchema: z.ZodObject<{
    query: z.ZodString;
    logGroupPrefix: z.ZodOptional<z.ZodString>;
    startTime: z.ZodOptional<z.ZodString>;
    endTime: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    query: string;
    logGroupPrefix?: string | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
}, {
    query: string;
    logGroupPrefix?: string | undefined;
    startTime?: string | undefined;
    endTime?: string | undefined;
}>;
export declare function searchLogs(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    query: string;
    logGroupPrefix: string;
    timeRange: {
        start: string;
        end: string;
    };
    events: {
        timestamp: string | null;
        message: any;
        logStreamName: any;
    }[];
    count: number;
    truncated: boolean;
}>>;
//# sourceMappingURL=search-logs.d.ts.map