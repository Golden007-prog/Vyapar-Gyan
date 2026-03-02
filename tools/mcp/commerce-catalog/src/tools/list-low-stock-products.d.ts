/**
 * Tool: list_low_stock_products
 * Lists products with low stock for a specific seller.
 */
import { z } from "zod";
import { Env } from "../env.js";
export declare const listLowStockProductsSchema: z.ZodObject<{
    sellerId: z.ZodString;
    threshold: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    sellerId: string;
    threshold: number;
}, {
    sellerId: string;
    limit?: number | undefined;
    threshold?: number | undefined;
}>;
export declare function listLowStockProducts(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    sellerId: string;
    threshold: number;
    products: {
        productId: any;
        name: any;
        stockQuantity: any;
        reservedStock: any;
        availableStock: number;
        status: any;
    }[];
    count: number;
    message: string | undefined;
}>>;
//# sourceMappingURL=list-low-stock-products.d.ts.map