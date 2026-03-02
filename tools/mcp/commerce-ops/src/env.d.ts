import { z } from "zod";
declare const envSchema: z.ZodObject<{
    AWS_REGION: z.ZodDefault<z.ZodString>;
    AWS_PROFILE: z.ZodOptional<z.ZodString>;
    APP_ENV: z.ZodDefault<z.ZodString>;
    DDB_TABLE_NAME: z.ZodDefault<z.ZodString>;
    LOG_GROUP_PREFIX: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    AWS_REGION: string;
    APP_ENV: string;
    DDB_TABLE_NAME: string;
    LOG_GROUP_PREFIX: string;
    AWS_PROFILE?: string | undefined;
}, {
    AWS_REGION?: string | undefined;
    AWS_PROFILE?: string | undefined;
    APP_ENV?: string | undefined;
    DDB_TABLE_NAME?: string | undefined;
    LOG_GROUP_PREFIX?: string | undefined;
}>;
export type Env = z.infer<typeof envSchema>;
export declare function loadEnv(): Env;
export {};
//# sourceMappingURL=env.d.ts.map