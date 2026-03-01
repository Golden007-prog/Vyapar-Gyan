/**
 * Environment Configuration Types
 * 
 * Defines the structure for environment-specific configuration used across
 * all CDK stacks. Each environment (dev, staging, prod) provides its own
 * configuration values for resource settings, billing modes, retention periods,
 * alarm thresholds, and other environment-specific parameters.
 */

import { Duration } from 'aws-cdk-lib';
import { BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

/**
 * Environment type identifier
 */
export type EnvironmentType = 'dev' | 'staging' | 'prod';

/**
 * DynamoDB configuration for an environment
 */
export interface DynamoDBConfig {
  /** Billing mode for DynamoDB tables */
  billingMode: BillingMode;
  
  /** Whether to enable point-in-time recovery */
  pointInTimeRecovery: boolean;
  
  /** Read capacity units (only used for PROVISIONED billing mode) */
  readCapacity?: number;
  
  /** Write capacity units (only used for PROVISIONED billing mode) */
  writeCapacity?: number;
  
  /** Whether to enable deletion protection */
  deletionProtection: boolean;
}

/**
 * S3 configuration for an environment
 */
export interface S3Config {
  /** Whether to enable versioning on buckets */
  versioning: boolean;
  
  /** Lifecycle policy for transitioning objects to cheaper storage */
  lifecycleRules: {
    /** Days until objects transition to Infrequent Access */
    transitionToIADays?: number;
    
    /** Days until objects transition to Glacier */
    transitionToGlacierDays?: number;
    
    /** Days until objects are deleted */
    expirationDays?: number;
  };
  
  /** Whether to enable access logging */
  accessLogging: boolean;
}

/**
 * CloudWatch Logs configuration for an environment
 */
export interface LogsConfig {
  /** Log retention period in days */
  retentionDays: RetentionDays;
  
  /** Log level for application logs */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Lambda configuration for an environment
 */
export interface LambdaConfig {
  /** Memory size in MB */
  memorySize: number;
  
  /** Timeout duration */
  timeout: Duration;
  
  /** Reserved concurrent executions (undefined = no limit) */
  reservedConcurrentExecutions?: number;
  
  /** Whether to enable X-Ray tracing */
  tracing: boolean;
}

/**
 * API Gateway configuration for an environment
 */
export interface ApiGatewayConfig {
  /** Throttle rate limit (requests per second) */
  throttleRateLimit: number;
  
  /** Throttle burst limit */
  throttleBurstLimit: number;
  
  /** Whether to enable access logging */
  accessLogging: boolean;
  
  /** Whether to enable detailed CloudWatch metrics */
  detailedMetrics: boolean;
}

/**
 * SQS configuration for an environment
 */
export interface SQSConfig {
  /** Message visibility timeout */
  visibilityTimeout: Duration;
  
  /** Message retention period */
  retentionPeriod: Duration;
  
  /** Maximum receive count before moving to DLQ */
  maxReceiveCount: number;
  
  /** Dead letter queue retention period */
  dlqRetentionPeriod: Duration;
}

/**
 * Cognito configuration for an environment
 */
export interface CognitoConfig {
  /** Password policy minimum length */
  passwordMinLength: number;
  
  /** Whether to require lowercase characters */
  passwordRequireLowercase: boolean;
  
  /** Whether to require uppercase characters */
  passwordRequireUppercase: boolean;
  
  /** Whether to require numbers */
  passwordRequireNumbers: boolean;
  
  /** Whether to require symbols */
  passwordRequireSymbols: boolean;
  
  /** Access token validity duration */
  accessTokenValidity: Duration;
  
  /** Refresh token validity duration */
  refreshTokenValidity: Duration;
  
  /** Whether to enable MFA */
  mfaEnabled: boolean;
}

/**
 * CloudWatch Alarms configuration for an environment
 */
export interface AlarmsConfig {
  /** Lambda error rate threshold (percentage) */
  lambdaErrorRateThreshold: number;
  
  /** Lambda throttle count threshold */
  lambdaThrottleThreshold: number;
  
  /** DynamoDB throttle count threshold */
  dynamoDBThrottleThreshold: number;
  
  /** API Gateway 5xx error rate threshold (percentage) */
  apiGateway5xxThreshold: number;
  
  /** SQS DLQ message count threshold */
  sqsDLQMessageThreshold: number;
  
  /** Evaluation periods for alarms */
  evaluationPeriods: number;
  
  /** Whether to enable alarms */
  enabled: boolean;
}

/**
 * CORS configuration for an environment
 */
export interface CORSConfig {
  /** Allowed origins for CORS */
  allowedOrigins: string[];
  
  /** Allowed HTTP methods */
  allowedMethods: string[];
  
  /** Allowed headers */
  allowedHeaders: string[];
  
  /** Max age for preflight cache */
  maxAge: Duration;
}

/**
 * Complete environment configuration
 */
export interface EnvironmentConfig {
  /** Environment identifier */
  environment: EnvironmentType;
  
  /** AWS account ID */
  account: string;
  
  /** AWS region */
  region: string;
  
  /** DynamoDB configuration */
  dynamodb: DynamoDBConfig;
  
  /** S3 configuration */
  s3: S3Config;
  
  /** CloudWatch Logs configuration */
  logs: LogsConfig;
  
  /** Lambda configuration */
  lambda: LambdaConfig;
  
  /** API Gateway configuration */
  apiGateway: ApiGatewayConfig;
  
  /** SQS configuration */
  sqs: SQSConfig;
  
  /** Cognito configuration */
  cognito: CognitoConfig;
  
  /** CloudWatch Alarms configuration */
  alarms: AlarmsConfig;
  
  /** CORS configuration */
  cors: CORSConfig;
  
  /** Resource name prefix (e.g., "dev-vyapargyan") */
  resourcePrefix: string;
  
  /** Common tags to apply to all resources */
  tags: Record<string, string>;
}
