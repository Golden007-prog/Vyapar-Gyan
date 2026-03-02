import { z } from 'zod';
/**
 * Configuration schema with Zod validation
 * Defines all required and optional configuration values for the application
 */
declare const configSchema: z.ZodObject<{
    environment: z.ZodEnum<["dev", "staging", "prod"]>;
    region: z.ZodString;
    tableName: z.ZodString;
    eventBusName: z.ZodString;
    userPoolId: z.ZodString;
    userPoolClientId: z.ZodString;
    whatsappApiUrl: z.ZodString;
    whatsappToken: z.ZodString;
    whatsappPhoneNumberId: z.ZodString;
    whatsappVerifyToken: z.ZodString;
    whatsappAppSecret: z.ZodString;
    razorpayKeyId: z.ZodString;
    razorpayKeySecret: z.ZodString;
    razorpayWebhookSecret: z.ZodString;
    geminiApiKey: z.ZodString;
    productImagesBucket: z.ZodString;
    documentsBucket: z.ZodString;
    logLevel: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
}, "strip", z.ZodTypeAny, {
    eventBusName: string;
    environment: "dev" | "staging" | "prod";
    region: string;
    tableName: string;
    userPoolId: string;
    userPoolClientId: string;
    whatsappApiUrl: string;
    whatsappToken: string;
    whatsappPhoneNumberId: string;
    whatsappVerifyToken: string;
    whatsappAppSecret: string;
    razorpayKeyId: string;
    razorpayKeySecret: string;
    razorpayWebhookSecret: string;
    geminiApiKey: string;
    productImagesBucket: string;
    documentsBucket: string;
    logLevel: "debug" | "info" | "warn" | "error";
}, {
    eventBusName: string;
    environment: "dev" | "staging" | "prod";
    region: string;
    tableName: string;
    userPoolId: string;
    userPoolClientId: string;
    whatsappApiUrl: string;
    whatsappToken: string;
    whatsappPhoneNumberId: string;
    whatsappVerifyToken: string;
    whatsappAppSecret: string;
    razorpayKeyId: string;
    razorpayKeySecret: string;
    razorpayWebhookSecret: string;
    geminiApiKey: string;
    productImagesBucket: string;
    documentsBucket: string;
    logLevel?: "debug" | "info" | "warn" | "error" | undefined;
}>;
export type Config = z.infer<typeof configSchema>;
/**
 * Load configuration from environment variables and AWS services
 * Configuration is cached after first load to avoid repeated AWS API calls
 *
 * @returns Validated configuration object
 * @throws Error if required configuration is missing or invalid
 */
export declare function getConfig(): Promise<Config>;
/**
 * Clear the cached configuration (useful for testing)
 */
export declare function clearConfigCache(): void;
export {};
//# sourceMappingURL=config.d.ts.map