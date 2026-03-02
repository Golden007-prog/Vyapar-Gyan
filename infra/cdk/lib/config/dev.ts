/**
 * Development Environment Configuration
 * 
 * Configuration for the development environment with cost-optimized settings,
 * shorter retention periods, and relaxed security for faster iteration.
 */

import { Duration } from 'aws-cdk-lib';
import { BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { EnvironmentConfig } from './environment';

/**
 * Get development environment configuration
 * 
 * @param account AWS account ID
 * @param region AWS region (defaults to us-east-1)
 * @returns Complete environment configuration for dev
 */
export function getDevConfig(account: string, region: string = 'us-east-1'): EnvironmentConfig {
  return {
    environment: 'dev',
    account,
    region,
    
    // DynamoDB: On-demand billing for cost optimization, no PITR
    dynamodb: {
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: false,
      deletionProtection: false,
    },
    
    // S3: No versioning, short lifecycle for cost savings
    s3: {
      versioning: false,
      lifecycleRules: {
        expirationDays: 30, // Delete objects after 30 days
      },
      accessLogging: false,
    },
    
    // Logs: 7-day retention, debug level for detailed troubleshooting
    logs: {
      retentionDays: RetentionDays.ONE_WEEK,
      logLevel: 'debug',
    },
    
    // Lambda: Smaller memory, shorter timeout, tracing enabled
    lambda: {
      memorySize: 512,
      timeout: Duration.seconds(30),
      tracing: true,
    },
    
    // API Gateway: Lower throttle limits for dev
    apiGateway: {
      throttleRateLimit: 100,
      throttleBurstLimit: 200,
      accessLogging: true,
      detailedMetrics: false,
    },
    
    // SQS: Shorter retention and visibility timeout
    sqs: {
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4),
      maxReceiveCount: 3,
      dlqRetentionPeriod: Duration.days(7),
    },
    
    // Cognito: Relaxed password policy for easier testing
    cognito: {
      passwordMinLength: 8,
      passwordRequireLowercase: true,
      passwordRequireUppercase: false,
      passwordRequireNumbers: true,
      passwordRequireSymbols: false,
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(7),
      mfaEnabled: false,
    },
    
    // Alarms: Disabled for dev to reduce noise
    alarms: {
      lambdaErrorRateThreshold: 10,
      lambdaThrottleThreshold: 10,
      dynamoDBThrottleThreshold: 10,
      apiGateway5xxThreshold: 10,
      sqsDLQMessageThreshold: 1,
      evaluationPeriods: 2,
      enabled: false,
    },
    
    // CORS: Allow localhost for local development
    cors: {
      allowedOrigins: [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:5173',
      ],
      allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['*'],
      maxAge: Duration.days(1),
    },
    
    // Resource naming
    resourcePrefix: 'dev-vyapargyan',
    
    // Common tags
    tags: {
      Project: 'VyaparGyan',
      Environment: 'dev',
      ManagedBy: 'CDK',
      CostCenter: 'Development',
    },
  };
}
