/**
 * Example: Using the configuration loader in a Lambda handler
 * 
 * This example demonstrates how to load and use configuration
 * in a Lambda function handler.
 */

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { getConfig } from './config';

/**
 * Example Lambda handler that uses configuration
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  try {
    // Load configuration (cached after first call)
    const config = await getConfig();
    
    // Log environment info (safe to log)
    console.log('Handler started', {
      requestId: context.requestId,
      environment: config.environment,
      region: config.region,
      logLevel: config.logLevel,
    });
    
    // Use configuration values
    const response = {
      environment: config.environment,
      tableName: config.tableName,
      eventBusName: config.eventBusName,
      // Never log secrets!
      // whatsappToken: config.whatsappToken, // ❌ DON'T DO THIS
    };
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('Configuration error', {
      requestId: context.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to load configuration',
      }),
    };
  }
};

/**
 * Example: Using configuration with external service clients
 */
export const handlerWithClients = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  try {
    const config = await getConfig();
    
    // Initialize WhatsApp client with configuration
    const whatsappClient = {
      apiUrl: config.whatsappApiUrl,
      token: config.whatsappToken,
      phoneNumberId: config.whatsappPhoneNumberId,
    };
    
    // Initialize Razorpay client with configuration
    const razorpayClient = {
      keyId: config.razorpayKeyId,
      keySecret: config.razorpayKeySecret,
      webhookSecret: config.razorpayWebhookSecret,
    };
    
    // Use clients to perform operations
    // ... business logic here ...
    
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Handler error', { error });
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

/**
 * Example: Environment-specific behavior
 */
export const handlerWithEnvironmentLogic = async (
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> => {
  const config = await getConfig();
  
  // Different behavior based on environment
  if (config.environment === 'dev') {
    console.log('Running in development mode');
    // Enable verbose logging, mock external services, etc.
  } else if (config.environment === 'staging') {
    console.log('Running in staging mode');
    // Use staging external services
  } else if (config.environment === 'prod') {
    console.log('Running in production mode');
    // Use production external services, enable monitoring
  }
  
  // Use log level from configuration
  const shouldLogDebug = config.logLevel === 'debug';
  if (shouldLogDebug) {
    console.debug('Debug logging enabled', { event });
  }
  
  return {
    statusCode: 200,
    body: JSON.stringify({ environment: config.environment }),
  };
};

/**
 * Example: Configuration validation in tests
 */
export async function validateConfiguration(): Promise<void> {
  try {
    const config = await getConfig();
    
    // Verify all required values are present
    console.log('Configuration validation passed', {
      environment: config.environment,
      region: config.region,
      tableName: config.tableName,
      // ... other non-sensitive values
    });
  } catch (error) {
    console.error('Configuration validation failed', { error });
    throw error;
  }
}
