import { z } from "zod";
import type { Env } from "../env.js";
export declare const getOrderTimelineSchema: z.ZodObject<{
    orderId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    orderId: string;
}, {
    orderId: string;
}>;
export declare function getOrderTimeline(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    order: Record<string, any>;
    items: {
        itemId: any;
        productId: any;
        quantity: any;
        price: any;
        createdAt: any;
    }[];
    payments: {
        paymentId: any;
        amount: any;
        status: any;
        method: any;
        createdAt: any;
    }[];
    auditLogs: {
        timestamp: any;
        action: any;
        details: any;
    }[];
    truncated: boolean;
}>>;
//# sourceMappingURL=get-order-timeline.d.ts.map