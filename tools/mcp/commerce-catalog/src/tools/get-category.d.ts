/**
 * Tool: get_category
 * Retrieves category details by category ID.
 */
import { z } from "zod";
import { Env } from "../env.js";
export declare const getCategorySchema: z.ZodObject<{
    categoryId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    categoryId: string;
}, {
    categoryId: string;
}>;
export declare function getCategory(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    categoryId: any;
    name: any;
    slug: any;
    parentCategoryId: any;
    status: any;
    createdAt: any;
    updatedAt: any;
}>>;
//# sourceMappingURL=get-category.d.ts.map