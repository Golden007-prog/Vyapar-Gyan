/**
 * Environment validation and configuration.
 * Uses Zod for runtime type checking of environment variables.
 */
import { z } from "zod";
/**
 * Environment schema with strict validation.
 * Enforces specific values for AWS_REGION, DYNAMODB_TABLE_NAME, and AWS_PROFILE.
 */
export declare const envSchema: z.ZodObject<{
    AWS_REGION: z.ZodLiteral<"ap-south-1">;
    DYNAMODB_TABLE_NAME: z.ZodLiteral<"CommerceCore-dev">;
    AWS_PROFILE: z.ZodLiteral<"kiro-mcp">;
    S3_DOC_BUCKET: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    AWS_REGION: "ap-south-1";
    DYNAMODB_TABLE_NAME: "CommerceCore-dev";
    AWS_PROFILE: "kiro-mcp";
    S3_DOC_BUCKET?: string | undefined;
}, {
    AWS_REGION: "ap-south-1";
    DYNAMODB_TABLE_NAME: "CommerceCore-dev";
    AWS_PROFILE: "kiro-mcp";
    S3_DOC_BUCKET?: string | undefined;
}>;
export type Env = z.infer<typeof envSchema>;
/**
 * Loads and validates environment variables.
 * Throws descriptive error if validation fails.
 */
export declare function loadEnv(): Env;
//# sourceMappingURL=env.d.ts.map