import { z } from "zod";
const envSchema = z.object({
    AWS_REGION: z.string().default("ap-south-1"),
    AWS_PROFILE: z.string().optional(),
    APP_ENV: z.string().default("dev"),
    DDB_TABLE_NAME: z.string().default("CommerceCore-dev"),
    LOG_GROUP_PREFIX: z.string().default("/aws/commerce"),
});
export function loadEnv() {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
        console.error("Environment validation failed:", result.error.format());
        throw new Error("Invalid environment configuration");
    }
    return result.data;
}
//# sourceMappingURL=env.js.map