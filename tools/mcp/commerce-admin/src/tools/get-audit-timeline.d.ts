/**
 * Tool: get_audit_timeline
 * Retrieves audit trail entries for a specific resource.
 * Queries DynamoDB for Audit_Record items sorted by timestamp descending.
 */
import { z } from "zod";
import type { Env } from "../env.js";
export declare const getAuditTimelineSchema: z.ZodObject<{
    resourceType: z.ZodString;
    resourceId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    resourceType: string;
    resourceId: string;
}, {
    resourceType: string;
    resourceId: string;
}>;
export declare function getAuditTimeline(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    resource_type: string;
    resource_id: string;
    audit_records: {
        audit_id: any;
        resource_type: any;
        resource_id: any;
        action: any;
        actor_id: any;
        actor_type: any;
        changes: any;
        timestamp: any;
        metadata: any;
    }[];
    count: number;
    truncated: boolean;
}>>;
//# sourceMappingURL=get-audit-timeline.d.ts.map