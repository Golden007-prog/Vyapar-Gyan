import { z } from "zod";
import type { Env } from "../env.js";
export declare const getPaymentSchema: z.ZodObject<{
    orderId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    orderId: string;
}, {
    orderId: string;
}>;
export declare function getPayment(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    orderId: string;
    payments: {
        paymentId: any;
        orderId: any;
        amount: any;
        currency: any;
        status: any;
        method: any;
        provider: any;
        transactionId: any;
        createdAt: any;
        updatedAt: any;
    }[];
    count: number;
    truncated: boolean;
}>>;
//# sourceMappingURL=get-payment.d.ts.map