import { z } from "zod";
import type { Env } from "../env.js";
export declare const getOrderSchema: z.ZodObject<{
    orderId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    orderId: string;
}, {
    orderId: string;
}>;
export declare function getOrder(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    orderId: any;
    status: any;
    customerId: any;
    sellerId: any;
    totalAmount: any;
    currency: any;
    createdAt: any;
    updatedAt: any;
    metadata: any;
}>>;
//# sourceMappingURL=get-order.d.ts.map