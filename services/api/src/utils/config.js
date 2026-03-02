"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = getConfig;
exports.clearConfigCache = clearConfigCache;
const zod_1 = require("zod");
const client_ssm_1 = require("@aws-sdk/client-ssm");
const client_secrets_manager_1 = require("@aws-sdk/client-secrets-manager");
/**
 * Configuration schema with Zod validation
 * Defines all required and optional configuration values for the application
 */
const configSchema = zod_1.z.object({
    // Environment
    environment: zod_1.z.enum(['dev', 'staging', 'prod']),
    region: zod_1.z.string().min(1),
    // DynamoDB
    tableName: zod_1.z.string().min(1),
    // EventBridge
    eventBusName: zod_1.z.string().min(1),
    // Cognito
    userPoolId: zod_1.z.string().min(1),
    userPoolClientId: zod_1.z.string().min(1),
    // WhatsApp (from Secrets Manager)
    whatsappApiUrl: zod_1.z.string().url(),
    whatsappToken: zod_1.z.string().min(1),
    whatsappPhoneNumberId: zod_1.z.string().min(1),
    whatsappVerifyToken: zod_1.z.string().min(1),
    whatsappAppSecret: zod_1.z.string().min(1),
    // Razorpay (from Secrets Manager and SSM)
    razorpayKeyId: zod_1.z.string().min(1),
    razorpayKeySecret: zod_1.z.string().min(1),
    razorpayWebhookSecret: zod_1.z.string().min(1),
    // Gemini AI (from Secrets Manager)
    geminiApiKey: zod_1.z.string().min(1),
    // S3 Buckets
    productImagesBucket: zod_1.z.string().min(1),
    documentsBucket: zod_1.z.string().min(1),
    // Logging
    logLevel: zod_1.z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});
/**
 * Cached configuration to avoid repeated AWS API calls
 */
let cachedConfig = null;
/**
 * SSM Client for loading non-sensitive configuration
 */
const ssmClient = new client_ssm_1.SSMClient({});
/**
 * Secrets Manager Client for loading sensitive configuration
 */
const secretsClient = new client_secrets_manager_1.SecretsManagerClient({});
/**
 * Get a parameter from SSM Parameter Store
 * @param name - Parameter name (e.g., '/dev/razorpay/key-id')
 * @returns Parameter value
 */
async function getParameter(name) {
    try {
        const command = new client_ssm_1.GetParameterCommand({
            Name: name,
            WithDecryption: true,
        });
        const response = await ssmClient.send(command);
        if (!response.Parameter?.Value) {
            throw new Error(`Parameter ${name} not found or has no value`);
        }
        return response.Parameter.Value;
    }
    catch (error) {
        throw new Error(`Failed to get parameter ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Get a secret from AWS Secrets Manager
 * @param secretId - Secret ID or ARN
 * @returns Secret value
 */
async function getSecret(secretId) {
    try {
        const command = new client_secrets_manager_1.GetSecretValueCommand({
            SecretId: secretId,
        });
        const response = await secretsClient.send(command);
        if (!response.SecretString) {
            throw new Error(`Secret ${secretId} not found or has no value`);
        }
        return response.SecretString;
    }
    catch (error) {
        throw new Error(`Failed to get secret ${secretId}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Load configuration from environment variables and AWS services
 * Configuration is cached after first load to avoid repeated AWS API calls
 *
 * @returns Validated configuration object
 * @throws Error if required configuration is missing or invalid
 */
async function getConfig() {
    // Return cached config if available
    if (cachedConfig) {
        return cachedConfig;
    }
    // Get environment from environment variable (required)
    const environment = process.env.ENVIRONMENT;
    if (!environment) {
        throw new Error('ENVIRONMENT environment variable is required');
    }
    // Validate environment value
    if (!['dev', 'staging', 'prod'].includes(environment)) {
        throw new Error(`Invalid ENVIRONMENT value: ${environment}. Must be dev, staging, or prod`);
    }
    try {
        // Load configuration from environment variables and AWS services
        const config = {
            // Environment variables (always available)
            environment: environment,
            region: process.env.AWS_REGION || 'us-east-1',
            tableName: process.env.TABLE_NAME,
            eventBusName: process.env.EVENT_BUS_NAME,
            userPoolId: process.env.USER_POOL_ID,
            userPoolClientId: process.env.USER_POOL_CLIENT_ID,
            productImagesBucket: process.env.PRODUCT_IMAGES_BUCKET,
            documentsBucket: process.env.DOCUMENTS_BUCKET,
            logLevel: process.env.LOG_LEVEL || 'info',
            // WhatsApp configuration (from Secrets Manager)
            whatsappApiUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0',
            whatsappToken: await getSecret(`/${environment}/whatsapp/token`),
            whatsappPhoneNumberId: await getParameter(`/${environment}/whatsapp/phone-number-id`),
            whatsappVerifyToken: await getSecret(`/${environment}/whatsapp/verify-token`),
            whatsappAppSecret: await getSecret(`/${environment}/whatsapp/app-secret`),
            // Razorpay configuration (mixed: key ID from SSM, secrets from Secrets Manager)
            razorpayKeyId: await getParameter(`/${environment}/razorpay/key-id`),
            razorpayKeySecret: await getSecret(`/${environment}/razorpay/key-secret`),
            razorpayWebhookSecret: await getSecret(`/${environment}/razorpay/webhook-secret`),
            // Gemini AI configuration (from Secrets Manager)
            geminiApiKey: await getSecret(`/${environment}/gemini/api-key`),
        };
        // Validate configuration against schema
        cachedConfig = configSchema.parse(config);
        return cachedConfig;
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            // Format Zod validation errors
            const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
            throw new Error(`Configuration validation failed: ${errorMessages}`);
        }
        // Re-throw other errors
        throw error;
    }
}
/**
 * Clear the cached configuration (useful for testing)
 */
function clearConfigCache() {
    cachedConfig = null;
}
//# sourceMappingURL=config.js.map