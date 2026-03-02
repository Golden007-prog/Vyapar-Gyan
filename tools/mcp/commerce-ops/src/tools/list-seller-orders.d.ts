import { z } from "zod";
import type { Env } from "../env.js";
export declare const listSellerOrdersSchema: z.ZodObject<{
    sellerId: z.ZodString;
    status: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    sellerId: string;
    status?: string | undefined;
}, {
    sellerId: string;
    status?: string | undefined;
    limit?: number | undefined;
}>;
export declare function listSellerOrders(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    sellerId: string;
    status: string;
    orders: {
        orderId: any;
        status: any;
        customerId: any;
        totalAmount: any;
        currency: any;
        createdAt: any;
        updatedAt: any;
    }[];
    count: number;
    hasMore: boolean;
}>>;
//# sourceMappingURL=list-seller-orders.d.ts.map