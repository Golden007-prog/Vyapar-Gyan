/**
 * Tool: list_recent_payments
 * Lists recent payment transactions with optional status filtering.
 * Queries DynamoDB for Payment_Record items.
 */
import { z } from "zod";
import type { Env } from "../env.js";
export declare const listRecentPaymentsSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    status?: string | undefined;
    limit?: number | undefined;
}, {
    status?: string | undefined;
    limit?: number | undefined;
}>;
export declare function listRecentPayments(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    payments: never[];
    count: number;
    hasMore: boolean;
    message: string;
}> | import("../shared/response-formatter.js").SuccessResponse<{
    status?: string;
    payments: {
        payment_id: any;
        order_id: any;
        amount: any;
        currency: any;
        status: any;
        provider: any;
        gateway_payment_id: any;
        created_at: any;
        updated_at: any;
    }[];
    count: number;
    hasMore: boolean;
}>>;
//# sourceMappingURL=list-recent-payments.d.ts.map