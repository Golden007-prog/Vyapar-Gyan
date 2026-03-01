/**
 * Staging Environment Configuration
 * 
 * Configuration for the staging environment with production-like settings
 * for testing and validation before production deployment. Balances cost
 * optimization with production readiness.
 */

import { Duration } from 'aws-cdk-lib';
import { BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { EnvironmentConfig } from './environment';

/**
 * Get staging environment configuration
 * 
 * @param account AWS account ID
 * @param region AWS region (defaults to us-east-1)
 * @returns Complete environment configuration for staging
 */
export function getStagingConfig(account: string, region: string = 'us-east-1'): EnvironmentConfig {
  return {
    environment: 'staging',
    account,
    region,
    
    // DynamoDB: On-demand billing, PITR enabled for data protection
    dynamodb: {
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      deletionProtection: true,
    },
    
    // S3: Versioning enabled, moderate lifecycle policies
    s3: {
      versioning: true,
      lifecycleRules: {
        transitionToIADays: 60,
        transitionToGlacierDays: 180,
        expirationDays: 365,
      },
      accessLogging: true,
    },
    
    // Logs: 30-day retention, info level for balanced logging
    logs: {
      retentionDays: RetentionDays.ONE_MONTH,
      logLevel: 'info',
    },
    
    // Lambda: Production-like memory and timeout, tracing enabled
    lambda: {
      memorySize: 1024,
      timeout: Duration.seconds(60),
      reservedConcurrentExecutions: undefined,
      tracing: true,
    },
    
    // API Gateway: Moderate throttle limits
    apiGateway: {
      throttleRateLimit: 500,
      throttleBurstLimit: 1000,
      accessLogging: true,
      detailedMetrics: true,
    },
    
    // SQS: Production-like retention and visibility timeout
    sqs: {
      visibilityTimeout: Duration.minutes(5),
      retentionPeriod: Duration.days(7),
      maxReceiveCount: 3,
      dlqRetentionPeriod: Duration.days(14),
    },
    
    // Cognito: Production-like password policy
    cognito: {
      passwordMinLength: 10,
      passwordRequireLowercase: true,
      passwordRequireUppercase: true,
      passwordRequireNumbers: true,
      passwordRequireSymbols: true,
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      mfaEnabled: false, // Optional MFA for staging
    },
    
    // Alarms: Enabled with moderate thresholds
    alarms: {
      lambdaErrorRateThreshold: 5,
      lambdaThrottleThreshold: 5,
      dynamoDBThrottleThreshold: 5,
      apiGateway5xxThreshold: 5,
      sqsDLQMessageThreshold: 1,
      evaluationPeriods: 2,
      enabled: true,
    },
    
    // CORS: Allow staging domain
    cors: {
      allowedOrigins: [
        'https://staging.vyapargyan.com',
        'https://staging-admin.vyapargyan.com',
        'https://staging-seller.vyapargyan.com',
      ],
      allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['*'],
      maxAge: Duration.days(1),
    },
    
    // Resource naming
    resourcePrefix: 'staging-vyapargyan',
    
    // Common tags
    tags: {
      Project: 'VyaparGyan',
      Environment: 'staging',
      ManagedBy: 'CDK',
      CostCenter: 'Staging',
    },
  };
}
