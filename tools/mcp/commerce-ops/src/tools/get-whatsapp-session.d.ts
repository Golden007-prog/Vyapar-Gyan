import { z } from "zod";
import type { Env } from "../env.js";
export declare const getWhatsappSessionSchema: z.ZodEffects<z.ZodObject<{
    phone: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    sessionId?: string | undefined;
    phone?: string | undefined;
}, {
    sessionId?: string | undefined;
    phone?: string | undefined;
}>, {
    sessionId?: string | undefined;
    phone?: string | undefined;
}, {
    sessionId?: string | undefined;
    phone?: string | undefined;
}>;
export declare function getWhatsappSession(args: unknown, env: Env): Promise<import("../shared/response-formatter.js").ErrorResponse | import("../shared/response-formatter.js").SuccessResponse<{
    session: {
        sessionId: any;
        phone: any;
        status: any;
        currentStep: any;
        context: any;
        createdAt: any;
        updatedAt: any;
    };
    recentMessages: {
        messageId: any;
        direction: any;
        content: any;
        timestamp: any;
    }[];
    truncated: boolean;
}>>;
//# sourceMappingURL=get-whatsapp-session.d.ts.map