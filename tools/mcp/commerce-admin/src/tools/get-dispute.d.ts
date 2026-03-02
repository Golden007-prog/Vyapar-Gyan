/**
 * Tool: get_dispute
 * Retrieves detailed dispute information for admin review.
 * Supports lookup by disputeId or orderId.
 */
import { z } from "zod";
import type { Env } from "../env.js";
export declare const getDisputeSchema: z.ZodEffects<z.ZodObject<{
    orderId: z.ZodOptional<z.ZodString>;
    disputeId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    disputeId?: string | undefined;
    orderId?: string | undefined;
}, {
    disputeId?: string | undefined;
    orderId?: string | undefined;
}>, {
    disputeId?: string | undefined;
    orderId?: string | undefined;
}, {
    disputeId?: string | undefined;
    orderId?: string | undefined;
}>;
export declare function getDispute(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    dispute_id: any;
    order_id: any;
    seller_id: any;
    customer_id: any;
    status: any;
    reason: any;
    description: any;
    status_history: any;
    linked_payment_id: any;
    created_at: any;
    updated_at: any;
    resolved_at: any;
}> | import("../shared/response-formatter.js").SuccessResponse<{
    disputes: {
        dispute_id: any;
        order_id: any;
        seller_id: any;
        customer_id: any;
        status: any;
        reason: any;
        description: any;
        status_history: any;
        linked_payment_id: any;
        created_at: any;
        updated_at: any;
        resolved_at: any;
    }[];
    count: number;
}>>;
//# sourceMappingURL=get-dispute.d.ts.map