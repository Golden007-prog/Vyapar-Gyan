import { z } from "zod";

const envSchema = z.object({
  AWS_REGION: z.string().default("ap-south-1"),
  AWS_PROFILE: z.string().optional(),
  APP_ENV: z.string().default("dev"),
  DDB_TABLE_NAME: z.string().default("CommerceCore-dev"),
  S3_MEDIA_BUCKET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error("Environment validation failed:", result.error.format());
    throw new Error("Invalid environment configuration");
  }
  
  return result.data;
}
