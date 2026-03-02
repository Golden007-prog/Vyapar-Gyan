/**
 * Tool: list_open_disputes
 * Lists open disputes for admin monitoring and prioritization.
 * Queries DynamoDB for Dispute_Record items with open status.
 */
import { z } from "zod";
import type { Env } from "../env.js";
export declare const listOpenDisputesSchema: z.ZodObject<{
    limit: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    limit?: number | undefined;
}, {
    limit?: number | undefined;
}>;
export declare function listOpenDisputes(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    disputes: {
        dispute_id: any;
        order_id: any;
        seller_id: any;
        customer_id: any;
        status: any;
        reason: any;
        created_at: any;
        last_updated_at: any;
    }[];
    count: number;
    hasMore: boolean;
}>>;
//# sourceMappingURL=list-open-disputes.d.ts.map