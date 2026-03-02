/**
 * Environment validation and configuration.
 * Uses Zod for runtime type checking of environment variables.
 */
import { z } from "zod";
/**
 * Environment schema with strict validation.
 */
export const envSchema = z.object({
    AWS_REGION: z.literal("ap-south-1"),
    DYNAMODB_TABLE_NAME: z.literal("CommerceCore-dev"),
    AWS_PROFILE: z.literal("kiro-mcp"),
    S3_MEDIA_BUCKET: z.string().min(1).optional(),
});
/**
 * Loads and validates environment variables.
 * Throws descriptive error if validation fails.
 */
export function loadEnv() {
    try {
        return envSchema.parse(process.env);
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            const issues = error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
            throw new Error(`Environment validation failed:\n${issues.join("\n")}`);
        }
        throw error;
    }
}
//# sourceMappingURL=env.js.map