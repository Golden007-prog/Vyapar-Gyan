/**
 * Tool: list_products_by_category
 * Lists all products in a specific category.
 */
import { z } from "zod";
import { Env } from "../env.js";
export declare const listProductsByCategorySchema: z.ZodObject<{
    categoryId: z.ZodString;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    categoryId: string;
    limit: number;
}, {
    categoryId: string;
    limit?: number | undefined;
}>;
export declare function listProductsByCategory(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    categoryId: string;
    products: {
        productId: any;
        sellerId: any;
        name: any;
        price: any;
        stockQuantity: any;
        status: any;
        createdAt: any;
    }[];
    count: number;
    hasMore: boolean;
    message: string | undefined;
}>>;
//# sourceMappingURL=list-products-by-category.d.ts.map