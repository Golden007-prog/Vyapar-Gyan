/**
 * Tool: get_seller_profile
 * Retrieves detailed seller profile information for admin review.
 */
import { z } from "zod";
import type { Env } from "../env.js";
export declare const getSellerProfileSchema: z.ZodObject<{
    sellerId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sellerId: string;
}, {
    sellerId: string;
}>;
export declare function getSellerProfile(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    seller_id: any;
    business_name: any;
    business_type: any;
    owner_name: any;
    contact_phone: any;
    contact_email: any;
    verification_status: any;
    document_keys: any;
    created_at: any;
    updated_at: any;
    approved_at: any;
}>>;
//# sourceMappingURL=get-seller-profile.d.ts.map