/**
 * Production Environment Configuration
 * 
 * Configuration for the production environment with maximum reliability,
 * security, and data protection. Optimized for performance and availability
 * with comprehensive monitoring and alarms.
 */

import { Duration } from 'aws-cdk-lib';
import { BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { EnvironmentConfig } from './environment';

/**
 * Get production environment configuration
 * 
 * @param account AWS account ID
 * @param region AWS region (defaults to ap-south-1 for India)
 * @returns Complete environment configuration for production
 */
export function getProdConfig(account: string, region: string = 'ap-south-1'): EnvironmentConfig {
  return {
    environment: 'prod',
    account,
    region,
    
    // DynamoDB: Provisioned billing for predictable costs, PITR enabled
    dynamodb: {
      billingMode: BillingMode.PROVISIONED,
      pointInTimeRecovery: true,
      readCapacity: 5,
      writeCapacity: 5,
      deletionProtection: true,
    },
    
    // S3: Versioning enabled, comprehensive lifecycle policies
    s3: {
      versioning: true,
      lifecycleRules: {
        transitionToIADays: 90,
        transitionToGlacierDays: 365,
      },
      accessLogging: true,
    },
    
    // Logs: 90-day retention, info level for production
    logs: {
      retentionDays: RetentionDays.THREE_MONTHS,
      logLevel: 'info',
    },
    
    // Lambda: Higher memory and timeout for production workloads
    lambda: {
      memorySize: 1024,
      timeout: Duration.seconds(60),
      reservedConcurrentExecutions: 100, // Reserve capacity
      tracing: true,
    },
    
    // API Gateway: Higher throttle limits for production traffic
    apiGateway: {
      throttleRateLimit: 2000,
      throttleBurstLimit: 5000,
      accessLogging: true,
      detailedMetrics: true,
    },
    
    // SQS: Longer retention and visibility timeout
    sqs: {
      visibilityTimeout: Duration.minutes(10),
      retentionPeriod: Duration.days(14),
      maxReceiveCount: 3,
      dlqRetentionPeriod: Duration.days(14),
    },
    
    // Cognito: Strict password policy and MFA enabled
    cognito: {
      passwordMinLength: 12,
      passwordRequireLowercase: true,
      passwordRequireUppercase: true,
      passwordRequireNumbers: true,
      passwordRequireSymbols: true,
      accessTokenValidity: Duration.minutes(30),
      refreshTokenValidity: Duration.days(30),
      mfaEnabled: true,
    },
    
    // Alarms: Enabled with strict thresholds
    alarms: {
      lambdaErrorRateThreshold: 2,
      lambdaThrottleThreshold: 5,
      dynamoDBThrottleThreshold: 5,
      apiGateway5xxThreshold: 2,
      sqsDLQMessageThreshold: 1,
      evaluationPeriods: 3,
      enabled: true,
    },
    
    // CORS: Allow production domains only
    cors: {
      allowedOrigins: [
        'https://vyapargyan.com',
        'https://www.vyapargyan.com',
        'https://admin.vyapargyan.com',
        'https://seller.vyapargyan.com',
      ],
      allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      maxAge: Duration.days(1),
    },
    
    // Resource naming
    resourcePrefix: 'prod-vyapargyan',
    
    // Common tags
    tags: {
      Project: 'VyaparGyan',
      Environment: 'prod',
      ManagedBy: 'CDK',
      CostCenter: 'Production',
      Compliance: 'Required',
    },
  };
}
