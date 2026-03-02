/**
 * Tool: get_product
 * Retrieves product details by product ID.
 */
import { z } from "zod";
import { Env } from "../env.js";
export declare const getProductSchema: z.ZodObject<{
    productId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    productId: string;
}, {
    productId: string;
}>;
export declare function getProduct(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    productId: any;
    sellerId: any;
    categoryId: any;
    name: any;
    description: any;
    price: any;
    currency: any;
    stockQuantity: any;
    reservedStock: any;
    availableStock: number;
    status: any;
    createdAt: any;
    updatedAt: any;
}>>;
//# sourceMappingURL=get-product.d.ts.map