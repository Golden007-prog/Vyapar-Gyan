/**
 * Tool: list_pending_seller_approvals
 * Lists pending seller approval requests for admin review.
 * Queries DynamoDB for Approval_Record items with pending status.
 */
import { z } from "zod";
import type { Env } from "../env.js";
export declare const listPendingSellerApprovalsSchema: z.ZodObject<{
    limit: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    limit?: number | undefined;
}, {
    limit?: number | undefined;
}>;
export declare function listPendingSellerApprovals(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    sellers: {
        seller_id: any;
        business_name: any;
        owner_name: any;
        contact_phone: any;
        contact_email: any;
        verification_status: any;
        created_at: any;
        review_state: any;
    }[];
    count: number;
    hasMore: boolean;
}>>;
//# sourceMappingURL=list-pending-seller-approvals.d.ts.map