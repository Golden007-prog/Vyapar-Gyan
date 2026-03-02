import { z } from "zod";
import type { Env } from "../env.js";
export declare const getInventorySchema: z.ZodObject<{
    productId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    productId: string;
}, {
    productId: string;
}>;
export declare function getInventory(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    productId: string;
    currentStock: any;
    reservedStock: any;
    availableStock: number;
    recentLogs: {
        timestamp: any;
        type: any;
        quantity: any;
        reason: any;
        reference: any;
    }[];
    truncated: boolean;
}>>;
//# sourceMappingURL=get-inventory.d.ts.map