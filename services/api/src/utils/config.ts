import { z } from 'zod';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

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
    
    return response.SecretString;
  } catch (error) {
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
    // Load configuration from environment variables and AWS services
    const config = {
      // Environment variables (always available)
      environment: environment as 'dev' | 'staging' | 'prod',
      region: process.env.AWS_REGION || 'us-east-1',
      tableName: process.env.TABLE_NAME!,
      eventBusName: process.env.EVENT_BUS_NAME!,
      userPoolId: process.env.USER_POOL_ID!,
      userPoolClientId: process.env.USER_POOL_CLIENT_ID!,
      productImagesBucket: process.env.PRODUCT_IMAGES_BUCKET!,
      documentsBucket: process.env.DOCUMENTS_BUCKET!,
      logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
      
      // Twilio configuration (from Secrets Manager)
      // Updated for Twilio integration
      twilioAccountSid: await getSecret(`/${environment}/twilio/account-sid`),
      twilioAuthToken: await getSecret(`/${environment}/twilio/auth-token`),
      twilioPhoneNumber: await getParameter(`/${environment}/twilio/phone-number`),
      
      // Razorpay configuration (mixed: key ID from SSM, secrets from Secrets Manager)
      razorpayKeyId: await getParameter(`/${environment}/razorpay/key-id`),
      razorpayKeySecret: await getSecret(`/${environment}/razorpay/key-secret`),
      razorpayWebhookSecret: await getSecret(`/${environment}/razorpay/webhook-secret`),
      
      // Gemini AI configuration (from Secrets Manager)
      geminiApiKey: await getSecret('GEMINI_API_KEY'),
      
      // Grok AI configuration (from Secrets Manager)
      grokApiKey: await getSecret('GROK_API_KEY'),
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
    
    // Re-throw other errors
    throw error;
  }
}

/**
 * Clear the cached configuration (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}
