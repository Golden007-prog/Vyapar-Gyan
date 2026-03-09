import { z } from 'zod';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { logger } from './logger';

/**
 * Configuration schema with Zod validation
 * Defines all required and optional configuration values for the application
 */
const configSchema = z.object({
  // Environment
  environment: z.enum(['dev', 'staging', 'prod']),
  region: z.string().min(1),
  
  // DynamoDB
  tableName: z.string().min(1),
  
  // EventBridge
  eventBusName: z.string().min(1),
  
  // Cognito
  userPoolId: z.string().min(1),
  userPoolClientId: z.string().min(1),
  
  // Twilio (from Secrets Manager)
  twilioAccountSid: z.string().min(1),
  twilioAuthToken: z.string().min(1),
  twilioPhoneNumber: z.string().min(1),
  
  // Razorpay (from Secrets Manager and SSM)
  razorpayKeyId: z.string().min(1),
  razorpayKeySecret: z.string().min(1),
  razorpayWebhookSecret: z.string().min(1),
  
  // Gemini AI (from Secrets Manager)
  geminiApiKey: z.string().min(1),
  
  // Grok AI (from Secrets Manager)
  grokApiKey: z.string().min(1),
  
  // S3 Buckets
  productImagesBucket: z.string().min(1),
  documentsBucket: z.string().min(1),
  
  // Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Lightweight config for the WhatsApp webhook handler.
 * Only loads Twilio credentials needed for signature verification.
 * Does NOT load gemini/grok/razorpay — those are irrelevant to the webhook.
 */
export interface WebhookConfig {
  environment: 'dev' | 'staging' | 'prod';
  region: string;
  tableName: string;
  eventBusName: string;
  userPoolId: string;
  userPoolClientId: string;
  productImagesBucket: string;
  documentsBucket: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  logLevel: string;
}

/**
 * Lightweight config subset for the voice pipeline.
 * Only the keys needed to download media, transcribe, generate TTS, and reply.
 */
export interface VoicePipelineConfig {
  geminiApiKey: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  productImagesBucket: string;
  region: string;
}

/**
 * Cached configuration to avoid repeated AWS API calls
 */
let cachedConfig: Config | null = null;

/**
 * SSM Client for loading non-sensitive configuration
 */
const ssmClient = new SSMClient({});

/**
 * Secrets Manager Client for loading sensitive configuration
 */
const secretsClient = new SecretsManagerClient({});

/**
 * Get a parameter from SSM Parameter Store
 * @param name - Parameter name (e.g., '/dev/razorpay/key-id')
 * @returns Parameter value
 */
async function getParameter(name: string): Promise<string> {
  try {
    const command = new GetParameterCommand({
      Name: name,
      WithDecryption: true,
    });
    
    const response = await ssmClient.send(command);
    
    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${name} not found or has no value`);
    }
    
    return response.Parameter.Value;
  } catch (error) {
    throw new Error(`Failed to get parameter ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get a secret from AWS Secrets Manager
 * @param secretId - Secret ID or ARN
 * @returns Secret value
 */
async function getSecret(secretId: string): Promise<string> {
  try {
    const command = new GetSecretValueCommand({
      SecretId: secretId,
    });
    
    const response = await secretsClient.send(command);
    
    if (!response.SecretString) {
      throw new Error(`Secret ${secretId} not found or has no value`);
    }

    // AWS Secrets Manager returns JSON when created via Key/value UI
    // Try to parse as JSON first, if it fails, treat as plain string
    try {
      const parsed = JSON.parse(response.SecretString);
      // If it's a JSON object with a single key matching the secretId, extract the value
      if (typeof parsed === 'object' && parsed !== null) {
        // Get the first value from the object (handles {"/dev/twilio/account-sid": "AC123..."})
        const values = Object.values(parsed);
        if (values.length > 0 && typeof values[0] === 'string') {
          return (values[0] as string).trim();
        }
      }
      // If parsed but not in expected format, return the stringified version
      return String(parsed).trim();
    } catch {
      // Not JSON, return as-is (trimmed)
      return response.SecretString.trim();
    }
  } catch (error) {
    throw new Error(`Failed to get secret ${secretId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Resolve a config value: prefer local env var, fall back to AWS secret/parameter.
 * Logs which source was used for debugging config issues.
 */
async function resolveSecret(envVar: string, awsFetcher: () => Promise<string>, label: string): Promise<string> {
  const envValue = process.env[envVar];
  if (envValue) {
    logger.debug(`Config: ${label} resolved from env var ${envVar}`);
    return envValue.trim();
  }
  try {
    const value = await awsFetcher();
    logger.debug(`Config: ${label} resolved from AWS`);
    return value.trim();
  } catch (error) {
    throw new Error(`Failed to resolve ${label} (env: ${envVar}, AWS fallback failed): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Load configuration from environment variables and AWS services.
 * Configuration is cached after first load to avoid repeated AWS API calls.
 * 
 * Resolution order for secrets:
 *   1. process.env.<KEY> (local dev / Lambda env)
 *   2. AWS Secrets Manager or SSM Parameter Store (deployed environments)
 * 
 * All secret fetches run in parallel via Promise.all so one failing key
 * does not prevent other keys from resolving.
 * 
 * @returns Validated configuration object
 * @throws Error if required configuration is missing or invalid
 */
export async function getConfig(): Promise<Config> {
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
    // Resolve all secrets/parameters in parallel — env var first, AWS fallback second.
    const [
      twilioAccountSid,
      twilioAuthToken,
      twilioPhoneNumber,
      razorpayKeyId,
      razorpayKeySecret,
      razorpayWebhookSecret,
      geminiApiKey,
      grokApiKey,
    ] = await Promise.all([
      resolveSecret('TWILIO_ACCOUNT_SID', () => getSecret(`/${environment}/twilio/account-sid`), 'twilioAccountSid'),
      resolveSecret('TWILIO_AUTH_TOKEN', () => getSecret(`/${environment}/twilio/auth-token`), 'twilioAuthToken'),
      resolveSecret('TWILIO_PHONE_NUMBER', () => getParameter(`/${environment}/twilio/phone-number`), 'twilioPhoneNumber'),
      resolveSecret('RAZORPAY_KEY_ID', () => getParameter(`/${environment}/razorpay/key-id`), 'razorpayKeyId'),
      resolveSecret('RAZORPAY_KEY_SECRET', () => getSecret(`/${environment}/razorpay/key-secret`), 'razorpayKeySecret'),
      resolveSecret('RAZORPAY_WEBHOOK_SECRET', () => getSecret(`/${environment}/razorpay/webhook-secret`), 'razorpayWebhookSecret'),
      resolveSecret('GEMINI_API_KEY', () => getSecret(`/${environment}/gemini/api-key`), 'geminiApiKey'),
      resolveSecret('GROK_API_KEY', () => getSecret(`/${environment}/grok/api-key`), 'grokApiKey'),
    ]);

    // Build config object from pre-resolved values (no inline awaits)
    const config = {
      environment: environment as 'dev' | 'staging' | 'prod',
      region: process.env.AWS_REGION || 'us-east-1',
      tableName: process.env.TABLE_NAME!,
      eventBusName: process.env.EVENT_BUS_NAME!,
      userPoolId: process.env.USER_POOL_ID!,
      userPoolClientId: process.env.USER_POOL_CLIENT_ID!,
      productImagesBucket: process.env.PRODUCT_IMAGES_BUCKET!,
      documentsBucket: process.env.DOCUMENTS_BUCKET!,
      logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
      twilioAccountSid,
      twilioAuthToken,
      twilioPhoneNumber,
      razorpayKeyId,
      razorpayKeySecret,
      razorpayWebhookSecret,
      geminiApiKey,
      grokApiKey,
    };
    
    // Validate configuration against schema
    cachedConfig = configSchema.parse(config);
    
    return cachedConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Format Zod validation errors
      const errorMessages = error.errors.map(err => 
        `${err.path.join('.')}: ${err.message}`
      ).join(', ');
      throw new Error(`Configuration validation failed: ${errorMessages}`);
    }
    
    // Re-throw other errors (includes resolveSecret failures with clear key names)
    throw error;
  }
}

/**
 * Cached webhook config to avoid repeated AWS API calls
 */
let cachedWebhookConfig: WebhookConfig | null = null;

/**
 * Load only the config keys needed by the WhatsApp webhook handler.
 * 
 * This avoids loading gemini/grok/razorpay secrets which the webhook
 * does not need, preventing config load failures when those secrets
 * are missing or inaccessible.
 * 
 * @returns Validated webhook configuration object
 */
export async function getWebhookConfig(): Promise<WebhookConfig> {
  if (cachedWebhookConfig) {
    return cachedWebhookConfig;
  }

  const environment = process.env.ENVIRONMENT;
  if (!environment) {
    throw new Error('ENVIRONMENT environment variable is required');
  }
  if (!['dev', 'staging', 'prod'].includes(environment)) {
    throw new Error(`Invalid ENVIRONMENT value: ${environment}. Must be dev, staging, or prod`);
  }

  // Only resolve Twilio secrets — the only secrets the webhook needs
  const [twilioAccountSid, twilioAuthToken, twilioPhoneNumber] = await Promise.all([
    resolveSecret('TWILIO_ACCOUNT_SID', () => getSecret(`/${environment}/twilio/account-sid`), 'twilioAccountSid'),
    resolveSecret('TWILIO_AUTH_TOKEN', () => getSecret(`/${environment}/twilio/auth-token`), 'twilioAuthToken'),
    resolveSecret('TWILIO_PHONE_NUMBER', () => getParameter(`/${environment}/twilio/phone-number`), 'twilioPhoneNumber'),
  ]);

  cachedWebhookConfig = {
    environment: environment as 'dev' | 'staging' | 'prod',
    region: process.env.AWS_REGION || 'us-east-1',
    tableName: process.env.TABLE_NAME!,
    eventBusName: process.env.EVENT_BUS_NAME!,
    userPoolId: process.env.USER_POOL_ID!,
    userPoolClientId: process.env.USER_POOL_CLIENT_ID!,
    productImagesBucket: process.env.PRODUCT_IMAGES_BUCKET || '',
    documentsBucket: process.env.DOCUMENTS_BUCKET || '',
    twilioAccountSid,
    twilioAuthToken,
    twilioPhoneNumber,
    logLevel: process.env.LOG_LEVEL || 'info',
  };

  return cachedWebhookConfig;
}

/**
 * Load only the config keys needed by the voice pipeline.
 * 
 * If the full config is already cached, extracts from it.
 * Otherwise resolves only Gemini + Twilio keys independently,
 * so an unrelated Razorpay/Grok failure cannot block voice processing.
 */
export async function getVoicePipelineConfig(): Promise<VoicePipelineConfig> {
  // Fast path: full config already cached
  if (cachedConfig) {
    return {
      geminiApiKey: cachedConfig.geminiApiKey,
      twilioAccountSid: cachedConfig.twilioAccountSid,
      twilioAuthToken: cachedConfig.twilioAuthToken,
      twilioPhoneNumber: cachedConfig.twilioPhoneNumber,
      productImagesBucket: cachedConfig.productImagesBucket,
      region: cachedConfig.region,
    };
  }

  const environment = process.env.ENVIRONMENT;
  if (!environment) {
    throw new Error('ENVIRONMENT environment variable is required');
  }

  // Resolve only voice-relevant keys in parallel
  const [geminiApiKey, twilioAccountSid, twilioAuthToken, twilioPhoneNumber] = await Promise.all([
    resolveSecret('GEMINI_API_KEY', () => getSecret(`/${environment}/gemini/api-key`), 'geminiApiKey'),
    resolveSecret('TWILIO_ACCOUNT_SID', () => getSecret(`/${environment}/twilio/account-sid`), 'twilioAccountSid'),
    resolveSecret('TWILIO_AUTH_TOKEN', () => getSecret(`/${environment}/twilio/auth-token`), 'twilioAuthToken'),
    resolveSecret('TWILIO_PHONE_NUMBER', () => getParameter(`/${environment}/twilio/phone-number`), 'twilioPhoneNumber'),
  ]);

  return {
    geminiApiKey,
    twilioAccountSid,
    twilioAuthToken,
    twilioPhoneNumber,
    productImagesBucket: process.env.PRODUCT_IMAGES_BUCKET || '',
    region: process.env.AWS_REGION || 'us-east-1',
  };
}

/**
 * Clear the cached configuration (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  cachedWebhookConfig = null;
}
