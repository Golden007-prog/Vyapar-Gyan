/**
 * Environment Configuration Module
 * 
 * Central export point for environment configuration. Provides a factory
 * function to load the appropriate configuration based on environment type.
 */

export * from './environment';
export { getDevConfig } from './dev';
export { getStagingConfig } from './staging';
export { getProdConfig } from './prod';

import { EnvironmentConfig, EnvironmentType } from './environment';
import { getDevConfig } from './dev';
import { getStagingConfig } from './staging';
import { getProdConfig } from './prod';

/**
 * Get environment configuration based on environment type
 * 
 * @param environment Environment type (dev, staging, or prod)
 * @param account AWS account ID
 * @param region AWS region (optional, uses environment-specific defaults)
 * @returns Complete environment configuration
 * @throws Error if environment type is invalid
 */
export function getEnvironmentConfig(
  environment: string,
  account: string,
  region?: string
): EnvironmentConfig {
  switch (environment) {
    case 'dev':
      return getDevConfig(account, region);
    case 'staging':
      return getStagingConfig(account, region);
    case 'prod':
      return getProdConfig(account, region);
    default:
      throw new Error(
        `Invalid environment: ${environment}. Must be one of: dev, staging, prod`
      );
  }
}

/**
 * Validate that all required configuration values are present
 * 
 * @param config Environment configuration to validate
 * @throws Error if any required values are missing or invalid
 */
export function validateConfig(config: EnvironmentConfig): void {
  if (!config.account) {
    throw new Error('AWS account ID is required');
  }
  
  if (!config.region) {
    throw new Error('AWS region is required');
  }
  
  if (!['dev', 'staging', 'prod'].includes(config.environment)) {
    throw new Error(`Invalid environment: ${config.environment}`);
  }
  
  if (!config.resourcePrefix) {
    throw new Error('Resource prefix is required');
  }
  
  // Validate DynamoDB config
  if (config.dynamodb.billingMode === 'PROVISIONED') {
    if (!config.dynamodb.readCapacity || !config.dynamodb.writeCapacity) {
      throw new Error('Read and write capacity are required for provisioned billing mode');
    }
  }
  
  // Validate Lambda config
  if (config.lambda.memorySize < 128 || config.lambda.memorySize > 10240) {
    throw new Error('Lambda memory size must be between 128 and 10240 MB');
  }
  
  // Validate API Gateway config
  if (config.apiGateway.throttleRateLimit < 1) {
    throw new Error('API Gateway throttle rate limit must be at least 1');
  }
  
  // Validate CORS config
  if (config.cors.allowedOrigins.length === 0) {
    throw new Error('At least one allowed origin is required for CORS');
  }
}
