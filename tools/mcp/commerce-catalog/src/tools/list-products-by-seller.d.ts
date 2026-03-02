/**
 * Tool: list_products_by_seller
 * Lists all products for a specific seller.
 */
import { z } from "zod";
import { Env } from "../env.js";
export declare const listProductsBySellerSchema: z.ZodObject<{
    sellerId: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    sellerId: string;
}, {
    sellerId: string;
    limit?: number | undefined;
}>;
export declare function listProductsBySeller(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    sellerId: string;
    products: {
        productId: any;
        name: any;
        price: any;
        stockQuantity: any;
        reservedStock: any;
        availableStock: number;
        status: any;
        createdAt: any;
    }[];
    count: number;
    hasMore: boolean;
    message: string | undefined;
}>>;
//# sourceMappingURL=list-products-by-seller.d.ts.map