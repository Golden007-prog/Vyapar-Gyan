/**
 * API Stack
 * 
 * Creates API Gateway HTTP API with Lambda integrations for the VyaparGyan platform.
 * Includes routes for WhatsApp webhooks, admin operations, seller operations, and catalog.
 * 
 * Configuration is environment-specific:
 * - Dev: No throttling, detailed logging
 * - Staging: Moderate throttling, standard logging
 * - Prod: Strict throttling, minimal logging
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  HttpApi,
  HttpMethod,
  CorsHttpMethod,
  PayloadFormatVersion,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Function, Runtime, Code, Architecture } from 'aws-cdk-lib/aws-lambda';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Duration } from 'aws-cdk-lib';
import { EnvironmentConfig } from '../config';

/**
 * Properties for APIStack
 */
export interface APIStackProps extends cdk.StackProps {
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** DynamoDB table from DatabaseStack */
  table: Table;
  /** Cognito User Pool from AuthStack */
  userPool: UserPool;
  /** EventBridge event bus from EventsStack */
  eventBus: EventBus;
}

/**
 * APIStack creates API Gateway and Lambda functions for the platform
 */
export class APIStack extends cdk.Stack {
  /** The HTTP API */
  public readonly httpApi: HttpApi;
  
  /** WhatsApp webhook Lambda function */
  public readonly whatsappWebhookFunction: Function;

  constructor(scope: Construct, id: string, props: APIStackProps) {
    super(scope, id, props);

    const { config, table, userPool, eventBus } = props;

    // Create HTTP API
    this.httpApi = new HttpApi(this, 'HttpApi', {
      apiName: `${config.resourcePrefix}-api`,
      description: 'VyaparGyan Platform API',
      
      // CORS configuration
      corsPreflight: {
        allowOrigins: this.getAllowedOrigins(config),
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
        maxAge: Duration.hours(1),
      },
      
      // HttpApi automatically creates a $default stage with auto-deploy enabled
      // No need to explicitly create HttpStage - it causes 409 ConflictException
    });

    // Create WhatsApp webhook Lambda function
    this.whatsappWebhookFunction = new Function(this, 'WhatsAppWebhookFunction', {
      functionName: `${config.resourcePrefix}-whatsapp-webhook`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/whatsapp/webhook.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        USER_POOL_ID: userPool.userPoolId,
        LOG_LEVEL: 'info',
      },
    });

    // Grant permissions to WhatsApp webhook function
    table.grantReadWriteData(this.whatsappWebhookFunction);
    eventBus.grantPutEventsTo(this.whatsappWebhookFunction);

    // Create Lambda integration for WhatsApp webhook
    // IMPORTANT: Configure to pass raw body for Twilio signature validation
    const whatsappWebhookIntegration = new HttpLambdaIntegration(
      'WhatsAppWebhookIntegration',
      this.whatsappWebhookFunction,
      {
        // Pass raw request body (not base64 encoded) for signature validation
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    // Add routes for WhatsApp webhook (GET for verification, POST for messages)
    this.httpApi.addRoutes({
      path: '/api/v1/whatsapp/webhook',
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: whatsappWebhookIntegration,
    });

    // Add environment-specific tags
    cdk.Tags.of(this.httpApi).add('Name', `${config.resourcePrefix}-api`);
    cdk.Tags.of(this.httpApi).add('Service', 'api');

    // Output API details
    new cdk.CfnOutput(this, 'HttpApiUrl', {
      value: this.httpApi.apiEndpoint,
      description: 'HTTP API endpoint URL',
      exportName: `${config.resourcePrefix}-api-url`,
    });

    new cdk.CfnOutput(this, 'HttpApiId', {
      value: this.httpApi.apiId,
      description: 'HTTP API ID',
      exportName: `${config.resourcePrefix}-api-id`,
    });

    new cdk.CfnOutput(this, 'WhatsAppWebhookUrl', {
      value: `${this.httpApi.apiEndpoint}/api/v1/whatsapp/webhook`,
      description: 'WhatsApp webhook URL',
      exportName: `${config.resourcePrefix}-whatsapp-webhook-url`,
    });
  }

  /**
   * Get allowed CORS origins based on environment
   */
  private getAllowedOrigins(config: EnvironmentConfig): string[] {
    const origins: string[] = [];

    if (config.environment === 'dev') {
      origins.push('http://localhost:3000');
      origins.push('http://localhost:3001');
    } else if (config.environment === 'staging') {
      origins.push('https://staging-admin.vyapargyan.com');
      origins.push('https://staging-seller.vyapargyan.com');
    } else {
      origins.push('https://admin.vyapargyan.com');
      origins.push('https://seller.vyapargyan.com');
    }

    return origins;
  }
}
