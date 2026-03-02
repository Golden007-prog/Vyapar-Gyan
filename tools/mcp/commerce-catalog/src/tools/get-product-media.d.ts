/**
 * Tool: get_product_media
 * Retrieves product media metadata by product ID.
 */
import { z } from "zod";
import { Env } from "../env.js";
export declare const getProductMediaSchema: z.ZodObject<{
    productId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    productId: string;
}, {
    productId: string;
}>;
export declare function getProductMedia(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    productId: string;
    media: {
        mediaId: any;
        mediaType: any;
        s3Key: any;
        sortOrder: any;
        createdAt: any;
        updatedAt: any;
    }[];
    count: number;
    message: string | undefined;
}>>;
//# sourceMappingURL=get-product-media.d.ts.map