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
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { Function, Runtime, Code, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Duration } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
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
  /** Cognito User Pool Client ID for API service */
  userPoolClientId: string;
  /** Cognito User Pool Clients for JWT authorizer */
  userPoolClients: UserPoolClient[];
  /** EventBridge event bus from EventsStack */
  eventBus: EventBus;
  /** Documents bucket from StorageStack */
  documentsBucket: Bucket;
  /** Product images bucket from StorageStack */
  productImagesBucket: Bucket;
  /** Media processing retry queue from EventsStack */
  mediaProcessingQueue?: Queue;
  /** Media processing DLQ from EventsStack */
  mediaProcessingDLQ?: Queue;
  /** Order nudge scheduler role ARN from EventsStack */
  orderSchedulerRoleArn?: string;
  /** Notification router Lambda ARN from EventsStack */
  notificationRouterArn?: string;
}

/**
 * APIStack creates API Gateway and Lambda functions for the platform
 */
export class APIStack extends cdk.Stack {
  /** The HTTP API */
  public readonly httpApi: HttpApi;
  
  /** WhatsApp webhook Lambda function */
  public readonly whatsappWebhookFunction: Function;
  
  /** Get insights Lambda function */
  public readonly getInsightsFunction: Function;
  
  /** Approve insight Lambda function */
  public readonly approveInsightFunction: Function;
  
  /** Reject insight Lambda function */
  public readonly rejectInsightFunction: Function;
  
  /** Razorpay webhook Lambda function */
  public readonly razorpayWebhookFunction: Function;
  
  /** Get orders Lambda function */
  public readonly getOrdersFunction: Function;
  
  /** Get chats Lambda function */
  public readonly getChatsFunction: Function;
  
  /** Get messages Lambda function */
  public readonly getMessagesFunction: Function;
  
  /** Get products Lambda function */
  public readonly getProductsFunction: Function;
  
  /** Get campaigns Lambda function */
  public readonly getCampaignsFunction: Function;
  
  /** Generate upload URL Lambda function */
  public readonly generateUploadUrlFunction: Function;
  
  /** Get sellers Lambda function */
  public readonly getSellersFunction: Function;
  
  /** Update seller status Lambda function */
  public readonly updateSellerStatusFunction: Function;
  
  /** Get analytics Lambda function */
  public readonly getAnalyticsFunction: Function;
  
  /** Get system health Lambda function */
  public readonly getSystemHealthFunction: Function;

  /** WhatsApp status webhook Lambda function */
  public readonly whatsappStatusWebhookFunction: Function;

  /** Cognito JWT authorizer for protected routes */
  public readonly jwtAuthorizer: HttpUserPoolAuthorizer;

  constructor(scope: Construct, id: string, props: APIStackProps) {
    super(scope, id, props);

    const { config, table, userPool, userPoolClientId, userPoolClients, eventBus, documentsBucket, productImagesBucket, mediaProcessingQueue, mediaProcessingDLQ } = props;

    // Create Cognito JWT authorizer for protected API routes
    // New routes use this from day one; existing routes get dual-auth support
    // (Lambda checks JWT claims first, falls back to x-user-id header)
    this.jwtAuthorizer = new HttpUserPoolAuthorizer('CognitoAuthorizer', userPool, {
      userPoolClients,
    });

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
        allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-User-Id', 'X-User-Role', 'X-Amz-Date', 'X-Api-Key', 'X-Amz-Security-Token'],
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
      tracing: Tracing.ACTIVE,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClientId,
        PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        LOG_LEVEL: 'info',
        FORCE_DEPLOY_TIME: new Date().toISOString(),
      },
    });

    // Grant permissions to WhatsApp webhook function
    table.grantReadWriteData(this.whatsappWebhookFunction);
    eventBus.grantPutEventsTo(this.whatsappWebhookFunction);
    
    // Grant Secrets Manager permissions for Twilio credentials and AI API keys
    // Note: Secrets Manager ARNs require wildcard suffix for the random 6-character suffix
    // getConfig() loads ALL secrets in parallel — missing any causes full config failure
    this.whatsappWebhookFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/gemini/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/grok/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      })
    );
    
    // Grant SSM Parameter Store permissions for configuration
    this.whatsappWebhookFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`,
        ],
      })
    );

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

    // ========================================================================
    // WhatsApp Status Webhook Lambda — Unauthenticated (Twilio signature verification)
    // Receives delivery status callbacks (queued, sent, delivered, read, failed)
    // ========================================================================

    this.whatsappStatusWebhookFunction = new Function(this, 'WhatsAppStatusWebhookFunction', {
      functionName: `${config.resourcePrefix}-whatsapp-status-webhook`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/whatsapp/status-webhook-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read/write (read THREAD messages, write idempotency + status updates)
    table.grantReadWriteData(this.whatsappStatusWebhookFunction);

    // Grant Secrets Manager access for Twilio auth token (signature verification)
    this.whatsappStatusWebhookFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    this.whatsappStatusWebhookFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    const whatsappStatusIntegration = new HttpLambdaIntegration(
      'WhatsAppStatusWebhookIntegration',
      this.whatsappStatusWebhookFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      },
    );

    this.httpApi.addRoutes({
      path: '/api/v1/whatsapp/status',
      methods: [HttpMethod.POST],
      integration: whatsappStatusIntegration,
    });

    // Create Lambda functions for Insights API
    
    // Get Insights Lambda
    this.getInsightsFunction = new Function(this, 'GetInsightsFunction', {
      functionName: `${config.resourcePrefix}-get-insights`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/get-insights.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read permissions
    table.grantReadData(this.getInsightsFunction);

    // Approve Insight Lambda
    this.approveInsightFunction = new Function(this, 'ApproveInsightFunction', {
      functionName: `${config.resourcePrefix}-approve-insight`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/approve-insight.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read/write permissions (UpdateItem)
    table.grantReadWriteData(this.approveInsightFunction);

    // Reject Insight Lambda
    this.rejectInsightFunction = new Function(this, 'RejectInsightFunction', {
      functionName: `${config.resourcePrefix}-reject-insight`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/reject-insight.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read/write permissions
    table.grantReadWriteData(this.rejectInsightFunction);

    // Create Get Orders Lambda
    this.getOrdersFunction = new Function(this, 'GetOrdersFunction', {
      functionName: `${config.resourcePrefix}-get-orders`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/get-orders.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read permissions
    table.grantReadData(this.getOrdersFunction);

    // Create Get Chats Lambda
    this.getChatsFunction = new Function(this, 'GetChatsFunction', {
      functionName: `${config.resourcePrefix}-get-chats`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/get-chats.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read permissions (uses Scan for MVP)
    table.grantReadData(this.getChatsFunction);

    // Create Get Messages Lambda
    this.getMessagesFunction = new Function(this, 'GetMessagesFunction', {
      functionName: `${config.resourcePrefix}-get-messages`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/get-chats.getMessagesHandler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read permissions
    table.grantReadData(this.getMessagesFunction);

    // Create Get Products Lambda
    this.getProductsFunction = new Function(this, 'GetProductsFunction', {
      functionName: `${config.resourcePrefix}-get-products`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/get-products.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read permissions
    table.grantReadData(this.getProductsFunction);

    // Create Get Campaigns Lambda
    this.getCampaignsFunction = new Function(this, 'GetCampaignsFunction', {
      functionName: `${config.resourcePrefix}-get-campaigns`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/get-campaigns.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read permissions
    table.grantReadData(this.getCampaignsFunction);

    // Create Generate Upload URL Lambda
    this.generateUploadUrlFunction = new Function(this, 'GenerateUploadUrlFunction', {
      functionName: `${config.resourcePrefix}-generate-upload-url`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/generate-upload-url.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant S3 PutObject permissions for presigned URL generation
    documentsBucket.grantPut(this.generateUploadUrlFunction);

    // Create Admin Lambda functions
    
    // Get Sellers Lambda
    this.getSellersFunction = new Function(this, 'GetSellersFunction', {
      functionName: `${config.resourcePrefix}-get-sellers`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/get-sellers.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read permissions (uses Scan)
    table.grantReadData(this.getSellersFunction);

    // Update Seller Status Lambda
    this.updateSellerStatusFunction = new Function(this, 'UpdateSellerStatusFunction', {
      functionName: `${config.resourcePrefix}-update-seller-status`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/update-seller-status.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read/write permissions
    table.grantReadWriteData(this.updateSellerStatusFunction);

    // Get Analytics Lambda
    this.getAnalyticsFunction = new Function(this, 'GetAnalyticsFunction', {
      functionName: `${config.resourcePrefix}-get-analytics`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/get-analytics.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(20),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read permissions (uses Scan for aggregation)
    table.grantReadData(this.getAnalyticsFunction);

    // Get System Health Lambda
    this.getSystemHealthFunction = new Function(this, 'GetSystemHealthFunction', {
      functionName: `${config.resourcePrefix}-get-system-health`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/get-system-health.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        LOG_LEVEL: 'info',
      },
    });

    // Create Razorpay webhook Lambda function
    this.razorpayWebhookFunction = new Function(this, 'RazorpayWebhookFunction', {
      functionName: `${config.resourcePrefix}-razorpay-webhook`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/payment/razorpay-webhook.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant permissions to Razorpay webhook function
    table.grantReadWriteData(this.razorpayWebhookFunction);

    // Create Lambda integration for Razorpay webhook
    const razorpayWebhookIntegration = new HttpLambdaIntegration(
      'RazorpayWebhookIntegration',
      this.razorpayWebhookFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    // Add route for Razorpay webhook (POST only, no auth required)
    this.httpApi.addRoutes({
      path: '/api/webhooks/razorpay',
      methods: [HttpMethod.POST],
      integration: razorpayWebhookIntegration,
    });

    // ========================================================================
    // Auth Lambda Functions (OTP Send, OTP Verify, Register) — Unauthenticated
    // ========================================================================

    const otpSendFunction = new Function(this, 'OTPSendFunction', {
      functionName: `${config.resourcePrefix}-otp-send`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/auth/otp-send-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClientId,
        PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(otpSendFunction);
    otpSendFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    otpSendFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    const otpVerifyFunction = new Function(this, 'OTPVerifyFunction', {
      functionName: `${config.resourcePrefix}-otp-verify`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/auth/otp-verify-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClientId,
        PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(otpVerifyFunction);
    otpVerifyFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    otpVerifyFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    const registerFunction = new Function(this, 'RegisterFunction', {
      functionName: `${config.resourcePrefix}-register`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/auth/register-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClientId,
        PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(registerFunction);
    registerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminAddUserToGroup',
        ],
        resources: [userPool.userPoolArn],
      }),
    );
    registerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    registerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    // Auth route integrations (unauthenticated)
    const otpSendIntegration = new HttpLambdaIntegration('OTPSendIntegration', otpSendFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const otpVerifyIntegration = new HttpLambdaIntegration('OTPVerifyIntegration', otpVerifyFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const registerIntegration = new HttpLambdaIntegration('RegisterIntegration', registerFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    this.httpApi.addRoutes({
      path: '/api/v1/auth/otp/send',
      methods: [HttpMethod.POST],
      integration: otpSendIntegration,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/auth/otp/verify',
      methods: [HttpMethod.POST],
      integration: otpVerifyIntegration,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/auth/register',
      methods: [HttpMethod.POST],
      integration: registerIntegration,
    });

    // Create Lambda integrations for Insights API
    const getInsightsIntegration = new HttpLambdaIntegration(
      'GetInsightsIntegration',
      this.getInsightsFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    const approveInsightIntegration = new HttpLambdaIntegration(
      'ApproveInsightIntegration',
      this.approveInsightFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    const rejectInsightIntegration = new HttpLambdaIntegration(
      'RejectInsightIntegration',
      this.rejectInsightFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    // Add Insights API routes
    // Note: In production, these should be protected by Cognito JWT Authorizer
    // For MVP, we're using header-based auth (x-user-id)
    
    this.httpApi.addRoutes({
      path: '/api/insights',
      methods: [HttpMethod.GET],
      integration: getInsightsIntegration,
    });

    this.httpApi.addRoutes({
      path: '/api/insights/{insightId}/approve',
      methods: [HttpMethod.PUT],
      integration: approveInsightIntegration,
    });

    this.httpApi.addRoutes({
      path: '/api/insights/{insightId}/reject',
      methods: [HttpMethod.PUT],
      integration: rejectInsightIntegration,
    });

    // Create Lambda integrations for Orders and Chats API
    const getOrdersIntegration = new HttpLambdaIntegration(
      'GetOrdersIntegration',
      this.getOrdersFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    const getChatsIntegration = new HttpLambdaIntegration(
      'GetChatsIntegration',
      this.getChatsFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    const getMessagesIntegration = new HttpLambdaIntegration(
      'GetMessagesIntegration',
      this.getMessagesFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    // Add Orders and Chats API routes
    // Note: In production, these should be protected by Cognito JWT Authorizer
    // For MVP, we're using header-based auth (x-user-id)
    
    this.httpApi.addRoutes({
      path: '/api/seller/orders',
      methods: [HttpMethod.GET],
      integration: getOrdersIntegration,
    });

    this.httpApi.addRoutes({
      path: '/api/seller/chats',
      methods: [HttpMethod.GET],
      integration: getChatsIntegration,
    });

    this.httpApi.addRoutes({
      path: '/api/seller/chats/{sessionId}/messages',
      methods: [HttpMethod.GET],
      integration: getMessagesIntegration,
    });

    // Create Lambda integrations for Products, Campaigns, and Upload URL
    const getProductsIntegration = new HttpLambdaIntegration(
      'GetProductsIntegration',
      this.getProductsFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    const getCampaignsIntegration = new HttpLambdaIntegration(
      'GetCampaignsIntegration',
      this.getCampaignsFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    const generateUploadUrlIntegration = new HttpLambdaIntegration(
      'GenerateUploadUrlIntegration',
      this.generateUploadUrlFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    // Add Products, Campaigns, and Upload URL routes
    // Note: In production, these should be protected by Cognito JWT Authorizer
    // For MVP, we're using header-based auth (x-user-id)
    
    this.httpApi.addRoutes({
      path: '/api/seller/products',
      methods: [HttpMethod.GET],
      integration: getProductsIntegration,
    });

    this.httpApi.addRoutes({
      path: '/api/seller/campaigns',
      methods: [HttpMethod.GET],
      integration: getCampaignsIntegration,
    });

    this.httpApi.addRoutes({
      path: '/api/seller/upload-url',
      methods: [HttpMethod.POST],
      integration: generateUploadUrlIntegration,
    });

    // Create Lambda integrations for Admin API
    const getSellersIntegration = new HttpLambdaIntegration(
      'GetSellersIntegration',
      this.getSellersFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    const updateSellerStatusIntegration = new HttpLambdaIntegration(
      'UpdateSellerStatusIntegration',
      this.updateSellerStatusFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    const getAnalyticsIntegration = new HttpLambdaIntegration(
      'GetAnalyticsIntegration',
      this.getAnalyticsFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    const getSystemHealthIntegration = new HttpLambdaIntegration(
      'GetSystemHealthIntegration',
      this.getSystemHealthFunction,
      {
        payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
      }
    );

    // Add Admin API routes
    // Note: In production, these should be protected by Cognito JWT Authorizer
    // with admin role validation. For MVP, we're using header-based auth (x-user-role: admin)
    
    this.httpApi.addRoutes({
      path: '/api/admin/sellers',
      methods: [HttpMethod.GET],
      integration: getSellersIntegration,
    });

    this.httpApi.addRoutes({
      path: '/api/admin/sellers/{sellerId}/status',
      methods: [HttpMethod.PUT],
      integration: updateSellerStatusIntegration,
    });

    this.httpApi.addRoutes({
      path: '/api/admin/analytics',
      methods: [HttpMethod.GET],
      integration: getAnalyticsIntegration,
    });

    this.httpApi.addRoutes({
      path: '/api/admin/system',
      methods: [HttpMethod.GET],
      integration: getSystemHealthIntegration,
    });

    // ========================================================================
    // New Admin Lambda Functions — JWT-protected (admin role)
    // Audit logs, media DLQ reprocess, messaging config
    // ========================================================================

    const adminAuditFunction = new Function(this, 'AdminAuditFunction', {
      functionName: `${config.resourcePrefix}-admin-audit`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/admin-audit-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(adminAuditFunction);

    const adminMediaReprocessFunction = new Function(this, 'AdminMediaReprocessFunction', {
      functionName: `${config.resourcePrefix}-admin-media-reprocess`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/admin-media-reprocess-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
        ...(mediaProcessingDLQ && { MEDIA_DLQ_URL: mediaProcessingDLQ.queueUrl }),
        ...(mediaProcessingQueue && { MEDIA_QUEUE_URL: mediaProcessingQueue.queueUrl }),
      },
    });
    table.grantReadWriteData(adminMediaReprocessFunction);
    if (mediaProcessingDLQ) {
      mediaProcessingDLQ.grantConsumeMessages(adminMediaReprocessFunction);
    }
    if (mediaProcessingQueue) {
      mediaProcessingQueue.grantSendMessages(adminMediaReprocessFunction);
    }

    const adminMessagingConfigFunction = new Function(this, 'AdminMessagingConfigFunction', {
      functionName: `${config.resourcePrefix}-admin-messaging-config`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/admin-messaging-config-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(adminMessagingConfigFunction);

    // New admin route integrations
    const adminAuditIntegration = new HttpLambdaIntegration(
      'AdminAuditIntegration', adminAuditFunction,
      { payloadFormatVersion: PayloadFormatVersion.VERSION_2_0 },
    );
    const adminMediaReprocessIntegration = new HttpLambdaIntegration(
      'AdminMediaReprocessIntegration', adminMediaReprocessFunction,
      { payloadFormatVersion: PayloadFormatVersion.VERSION_2_0 },
    );
    const adminMessagingConfigIntegration = new HttpLambdaIntegration(
      'AdminMessagingConfigIntegration', adminMessagingConfigFunction,
      { payloadFormatVersion: PayloadFormatVersion.VERSION_2_0 },
    );

    // New admin API routes — JWT-protected
    this.httpApi.addRoutes({
      path: '/api/v1/admin/audit',
      methods: [HttpMethod.GET],
      integration: adminAuditIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/media/reprocess',
      methods: [HttpMethod.POST],
      integration: adminMediaReprocessIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/messaging/config',
      methods: [HttpMethod.GET, HttpMethod.PUT],
      integration: adminMessagingConfigIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Chat Lambda Functions — JWT-protected
    // ========================================================================

    const chatSyncFunction = new Function(this, 'ChatSyncFunction', {
      functionName: `${config.resourcePrefix}-chat-sync`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/chat/chat-sync-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(chatSyncFunction);

    const chatSendFunction = new Function(this, 'ChatSendFunction', {
      functionName: `${config.resourcePrefix}-chat-send`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/chat/chat-send-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(chatSendFunction);
    eventBus.grantPutEventsTo(chatSendFunction);

    const chatTypingFunction = new Function(this, 'ChatTypingFunction', {
      functionName: `${config.resourcePrefix}-chat-typing`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/chat/chat-typing-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(chatTypingFunction);

    const chatHistoryFunction = new Function(this, 'ChatHistoryFunction', {
      functionName: `${config.resourcePrefix}-chat-history`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/chat/chat-history-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(chatHistoryFunction);

    // Chat route integrations — all JWT-protected
    const chatSyncIntegration = new HttpLambdaIntegration('ChatSyncIntegration', chatSyncFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const chatSendIntegration = new HttpLambdaIntegration('ChatSendIntegration', chatSendFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const chatTypingIntegration = new HttpLambdaIntegration('ChatTypingIntegration', chatTypingFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const chatHistoryIntegration = new HttpLambdaIntegration('ChatHistoryIntegration', chatHistoryFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    this.httpApi.addRoutes({
      path: '/api/v1/chat/sync',
      methods: [HttpMethod.GET],
      integration: chatSyncIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/chat/messages',
      methods: [HttpMethod.POST],
      integration: chatSendIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/chat/typing',
      methods: [HttpMethod.POST],
      integration: chatTypingIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/chat/history',
      methods: [HttpMethod.GET],
      integration: chatHistoryIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Cart Lambda Functions — JWT-protected
    // ========================================================================

    const cartGetFunction = new Function(this, 'CartGetFunction', {
      functionName: `${config.resourcePrefix}-cart-get`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/cart/cart-get-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(cartGetFunction);

    const cartAddFunction = new Function(this, 'CartAddFunction', {
      functionName: `${config.resourcePrefix}-cart-add`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/cart/cart-add-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(cartAddFunction);
    eventBus.grantPutEventsTo(cartAddFunction);

    const cartUpdateFunction = new Function(this, 'CartUpdateFunction', {
      functionName: `${config.resourcePrefix}-cart-update`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/cart/cart-update-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(cartUpdateFunction);
    eventBus.grantPutEventsTo(cartUpdateFunction);

    const cartRemoveFunction = new Function(this, 'CartRemoveFunction', {
      functionName: `${config.resourcePrefix}-cart-remove`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/cart/cart-remove-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(cartRemoveFunction);
    eventBus.grantPutEventsTo(cartRemoveFunction);

    const cartCheckoutFunction = new Function(this, 'CartCheckoutFunction', {
      functionName: `${config.resourcePrefix}-cart-checkout`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/cart/cart-checkout-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(cartCheckoutFunction);
    eventBus.grantPutEventsTo(cartCheckoutFunction);

    // Cart route integrations — all JWT-protected
    const cartGetIntegration = new HttpLambdaIntegration('CartGetIntegration', cartGetFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const cartAddIntegration = new HttpLambdaIntegration('CartAddIntegration', cartAddFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const cartUpdateIntegration = new HttpLambdaIntegration('CartUpdateIntegration', cartUpdateFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const cartRemoveIntegration = new HttpLambdaIntegration('CartRemoveIntegration', cartRemoveFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const cartCheckoutIntegration = new HttpLambdaIntegration('CartCheckoutIntegration', cartCheckoutFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    this.httpApi.addRoutes({
      path: '/api/v1/cart',
      methods: [HttpMethod.GET],
      integration: cartGetIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/cart/items',
      methods: [HttpMethod.POST],
      integration: cartAddIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/cart/items/{productId}',
      methods: [HttpMethod.PUT],
      integration: cartUpdateIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/cart/items/{productId}',
      methods: [HttpMethod.DELETE],
      integration: cartRemoveIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/cart/checkout',
      methods: [HttpMethod.POST],
      integration: cartCheckoutIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Approval Engine Lambda Functions — JWT-protected (seller role)
    // ========================================================================

    const commonApprovalEnv = {
      ENVIRONMENT: config.environment,
      TABLE_NAME: table.tableName,
      EVENT_BUS_NAME: eventBus.eventBusName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClientId,
      PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      LOG_LEVEL: 'info',
    };

    const approvalsListFunction = new Function(this, 'ApprovalsListFunction', {
      functionName: `${config.resourcePrefix}-approvals-list`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/approvals-list-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonApprovalEnv,
    });
    table.grantReadData(approvalsListFunction);

    const approvalDetailFunction = new Function(this, 'ApprovalDetailFunction', {
      functionName: `${config.resourcePrefix}-approval-detail`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/approval-detail-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonApprovalEnv,
    });
    table.grantReadData(approvalDetailFunction);

    const approvalApproveFunction = new Function(this, 'ApprovalApproveFunction', {
      functionName: `${config.resourcePrefix}-approval-approve`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/approval-approve-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonApprovalEnv,
    });
    table.grantReadWriteData(approvalApproveFunction);
    eventBus.grantPutEventsTo(approvalApproveFunction);

    const approvalRejectFunction = new Function(this, 'ApprovalRejectFunction', {
      functionName: `${config.resourcePrefix}-approval-reject`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/approval-reject-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonApprovalEnv,
    });
    table.grantReadWriteData(approvalRejectFunction);
    eventBus.grantPutEventsTo(approvalRejectFunction);

    const approvalEditFunction = new Function(this, 'ApprovalEditFunction', {
      functionName: `${config.resourcePrefix}-approval-edit-approve`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/approval-edit-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonApprovalEnv,
    });
    table.grantReadWriteData(approvalEditFunction);
    eventBus.grantPutEventsTo(approvalEditFunction);

    const approvalScheduleFunction = new Function(this, 'ApprovalScheduleFunction', {
      functionName: `${config.resourcePrefix}-approval-schedule`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/approval-schedule-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonApprovalEnv,
    });
    table.grantReadWriteData(approvalScheduleFunction);

    // Grant Secrets Manager + SSM to approval handlers that need config
    for (const fn of [approvalApproveFunction, approvalRejectFunction, approvalEditFunction]) {
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
          ],
        }),
      );
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParameter', 'ssm:GetParameters'],
          resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
        }),
      );
    }

    // Approval route integrations — all JWT-protected
    const approvalsListIntegration = new HttpLambdaIntegration('ApprovalsListIntegration', approvalsListFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const approvalDetailIntegration = new HttpLambdaIntegration('ApprovalDetailIntegration', approvalDetailFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const approvalApproveIntegration = new HttpLambdaIntegration('ApprovalApproveIntegration', approvalApproveFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const approvalRejectIntegration = new HttpLambdaIntegration('ApprovalRejectIntegration', approvalRejectFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const approvalEditIntegration = new HttpLambdaIntegration('ApprovalEditIntegration', approvalEditFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const approvalScheduleIntegration = new HttpLambdaIntegration('ApprovalScheduleIntegration', approvalScheduleFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    this.httpApi.addRoutes({
      path: '/api/v1/seller/approvals',
      methods: [HttpMethod.GET],
      integration: approvalsListIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/approvals/{id}',
      methods: [HttpMethod.GET],
      integration: approvalDetailIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/approvals/{id}/approve',
      methods: [HttpMethod.PUT],
      integration: approvalApproveIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/approvals/{id}/reject',
      methods: [HttpMethod.PUT],
      integration: approvalRejectIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/approvals/{id}/edit-approve',
      methods: [HttpMethod.PUT],
      integration: approvalEditIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/approvals/{id}/schedule',
      methods: [HttpMethod.PUT],
      integration: approvalScheduleIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Campaign Lambda Functions — JWT-protected (seller role)
    // ========================================================================

    const commonCampaignEnv = {
      ENVIRONMENT: config.environment,
      TABLE_NAME: table.tableName,
      EVENT_BUS_NAME: eventBus.eventBusName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClientId,
      PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      LOG_LEVEL: 'info',
    };

    const campaignCreateFunction = new Function(this, 'CampaignCreateFunction', {
      functionName: `${config.resourcePrefix}-campaign-create`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/campaign-create-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonCampaignEnv,
    });
    table.grantReadWriteData(campaignCreateFunction);

    const campaignScheduleFunction = new Function(this, 'CampaignScheduleFunction', {
      functionName: `${config.resourcePrefix}-campaign-schedule`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/campaign-schedule-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonCampaignEnv,
    });
    table.grantReadWriteData(campaignScheduleFunction);
    eventBus.grantPutEventsTo(campaignScheduleFunction);

    const campaignAnalyticsFunction = new Function(this, 'CampaignAnalyticsFunction', {
      functionName: `${config.resourcePrefix}-campaign-analytics`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/campaign-analytics-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonCampaignEnv,
    });
    table.grantReadData(campaignAnalyticsFunction);

    const campaignReachFunction = new Function(this, 'CampaignReachFunction', {
      functionName: `${config.resourcePrefix}-campaign-reach`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/campaign-reach-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonCampaignEnv,
    });
    table.grantReadData(campaignReachFunction);

    // Grant Secrets Manager + SSM to campaign handlers that need config
    for (const fn of [campaignCreateFunction, campaignScheduleFunction, campaignAnalyticsFunction, campaignReachFunction]) {
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
          ],
        }),
      );
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParameter', 'ssm:GetParameters'],
          resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
        }),
      );
    }

    // Campaign route integrations — all JWT-protected
    const campaignCreateIntegration = new HttpLambdaIntegration('CampaignCreateIntegration', campaignCreateFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const campaignScheduleIntegration = new HttpLambdaIntegration('CampaignScheduleIntegration', campaignScheduleFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const campaignAnalyticsIntegration = new HttpLambdaIntegration('CampaignAnalyticsIntegration', campaignAnalyticsFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const campaignReachIntegration = new HttpLambdaIntegration('CampaignReachIntegration', campaignReachFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    this.httpApi.addRoutes({
      path: '/api/v1/seller/campaigns',
      methods: [HttpMethod.POST],
      integration: campaignCreateIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/campaigns/{id}/schedule',
      methods: [HttpMethod.POST],
      integration: campaignScheduleIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/campaigns/{id}/analytics',
      methods: [HttpMethod.GET],
      integration: campaignAnalyticsIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/campaigns/estimate-reach',
      methods: [HttpMethod.POST],
      integration: campaignReachIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Seller Dashboard Lambda Function — JWT-protected (seller role)
    // ========================================================================

    const sellerDashboardFunction = new Function(this, 'SellerDashboardFunction', {
      functionName: `${config.resourcePrefix}-seller-dashboard`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/seller-dashboard-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(sellerDashboardFunction);

    // Grant Secrets Manager + SSM for getConfig() fallback
    sellerDashboardFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    sellerDashboardFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    const sellerDashboardIntegration = new HttpLambdaIntegration('SellerDashboardIntegration', sellerDashboardFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    this.httpApi.addRoutes({
      path: '/api/v1/seller/dashboard',
      methods: [HttpMethod.GET],
      integration: sellerDashboardIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Seller Inbox Lambda Functions — JWT-protected (seller role)
    // ========================================================================

    const commonSellerInboxEnv = {
      ENVIRONMENT: config.environment,
      TABLE_NAME: table.tableName,
      EVENT_BUS_NAME: eventBus.eventBusName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClientId,
      PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      LOG_LEVEL: 'info',
    };

    const sellerInboxFunction = new Function(this, 'SellerInboxFunction', {
      functionName: `${config.resourcePrefix}-seller-inbox`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/seller-inbox-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonSellerInboxEnv,
    });
    table.grantReadData(sellerInboxFunction);

    const sellerMessagesFunction = new Function(this, 'SellerMessagesFunction', {
      functionName: `${config.resourcePrefix}-seller-messages`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/seller-messages-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonSellerInboxEnv,
    });
    table.grantReadData(sellerMessagesFunction);

    const sellerReplyFunction = new Function(this, 'SellerReplyFunction', {
      functionName: `${config.resourcePrefix}-seller-reply`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/seller-reply-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonSellerInboxEnv,
    });
    table.grantReadWriteData(sellerReplyFunction);
    eventBus.grantPutEventsTo(sellerReplyFunction);

    const sellerContextFunction = new Function(this, 'SellerContextFunction', {
      functionName: `${config.resourcePrefix}-seller-context`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/seller-context-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonSellerInboxEnv,
    });
    table.grantReadData(sellerContextFunction);

    const sellerReadReceiptFunction = new Function(this, 'SellerReadReceiptFunction', {
      functionName: `${config.resourcePrefix}-seller-read-receipt`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/seller-read-receipt-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonSellerInboxEnv,
    });
    table.grantReadWriteData(sellerReadReceiptFunction);

    // Grant Secrets Manager + SSM to seller reply handler (needs config for EventBridge)
    for (const fn of [sellerReplyFunction]) {
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
          ],
        }),
      );
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParameter', 'ssm:GetParameters'],
          resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
        }),
      );
    }

    // Seller inbox route integrations — all JWT-protected
    const sellerInboxIntegration = new HttpLambdaIntegration('SellerInboxIntegration', sellerInboxFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const sellerMessagesIntegration = new HttpLambdaIntegration('SellerMessagesIntegration', sellerMessagesFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const sellerReplyIntegration = new HttpLambdaIntegration('SellerReplyIntegration', sellerReplyFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const sellerContextIntegration = new HttpLambdaIntegration('SellerContextIntegration', sellerContextFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const sellerReadReceiptIntegration = new HttpLambdaIntegration('SellerReadReceiptIntegration', sellerReadReceiptFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    this.httpApi.addRoutes({
      path: '/api/v1/seller/inbox',
      methods: [HttpMethod.GET],
      integration: sellerInboxIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/inbox/{userId}/messages',
      methods: [HttpMethod.GET],
      integration: sellerMessagesIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/inbox/{userId}/reply',
      methods: [HttpMethod.POST],
      integration: sellerReplyIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/inbox/{userId}/context',
      methods: [HttpMethod.GET],
      integration: sellerContextIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/seller/inbox/{userId}/read',
      methods: [HttpMethod.POST],
      integration: sellerReadReceiptIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Catalog Lambda Functions — Optional JWT (public browsing)
    // ========================================================================

    const catalogProductsFunction = new Function(this, 'CatalogProductsFunction', {
      functionName: `${config.resourcePrefix}-catalog-products`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/catalog/catalog-products-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(catalogProductsFunction);

    const catalogProductDetailFunction = new Function(this, 'CatalogProductDetailFunction', {
      functionName: `${config.resourcePrefix}-catalog-product-detail`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/catalog/catalog-product-detail-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(catalogProductDetailFunction);

    const catalogCategoriesFunction = new Function(this, 'CatalogCategoriesFunction', {
      functionName: `${config.resourcePrefix}-catalog-categories`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/catalog/catalog-categories-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(catalogCategoriesFunction);

    const catalogSearchFunction = new Function(this, 'CatalogSearchFunction', {
      functionName: `${config.resourcePrefix}-catalog-search`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/catalog/catalog-search-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(catalogSearchFunction);

    // Catalog route integrations
    const catalogProductsIntegration = new HttpLambdaIntegration('CatalogProductsIntegration', catalogProductsFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const catalogProductDetailIntegration = new HttpLambdaIntegration('CatalogProductDetailIntegration', catalogProductDetailFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const catalogCategoriesIntegration = new HttpLambdaIntegration('CatalogCategoriesIntegration', catalogCategoriesFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const catalogSearchIntegration = new HttpLambdaIntegration('CatalogSearchIntegration', catalogSearchFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    // Catalog routes — products and search use optional JWT, categories is fully public
    this.httpApi.addRoutes({
      path: '/api/v1/catalog/products',
      methods: [HttpMethod.GET],
      integration: catalogProductsIntegration,
      // No authorizer — optional JWT is handled in the handler via extractOptionalUserId
    });
    this.httpApi.addRoutes({
      path: '/api/v1/catalog/products/{id}',
      methods: [HttpMethod.GET],
      integration: catalogProductDetailIntegration,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/catalog/categories',
      methods: [HttpMethod.GET],
      integration: catalogCategoriesIntegration,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/catalog/search',
      methods: [HttpMethod.GET],
      integration: catalogSearchIntegration,
    });

    // ========================================================================
    // Account Management Lambda Functions — JWT-protected
    // ========================================================================

    const accountProfileFunction = new Function(this, 'AccountProfileFunction', {
      functionName: `${config.resourcePrefix}-account-profile`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/account/account-profile-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(5),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(accountProfileFunction);

    const accountPreferencesFunction = new Function(this, 'AccountPreferencesFunction', {
      functionName: `${config.resourcePrefix}-account-preferences`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/account/account-preferences-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(accountPreferencesFunction);

    const phoneChangeFunction = new Function(this, 'PhoneChangeFunction', {
      functionName: `${config.resourcePrefix}-phone-change`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/account/phone-change-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClientId,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(phoneChangeFunction);
    phoneChangeFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:AdminUpdateUserAttributes'],
        resources: [userPool.userPoolArn],
      }),
    );
    phoneChangeFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
        ],
      }),
    );
    phoneChangeFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`,
        ],
      }),
    );

    const whatsappDisconnectFunction = new Function(this, 'WhatsAppDisconnectFunction', {
      functionName: `${config.resourcePrefix}-whatsapp-disconnect`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/account/whatsapp-disconnect-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(whatsappDisconnectFunction);

    const accountDeleteFunction = new Function(this, 'AccountDeleteFunction', {
      functionName: `${config.resourcePrefix}-account-delete`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/account/account-delete-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClientId,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(accountDeleteFunction);
    accountDeleteFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:AdminDisableUser'],
        resources: [userPool.userPoolArn],
      }),
    );
    accountDeleteFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    accountDeleteFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          `arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`,
        ],
      }),
    );

    // Account Management route integrations — all JWT-protected
    const accountProfileIntegration = new HttpLambdaIntegration('AccountProfileIntegration', accountProfileFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const accountPreferencesIntegration = new HttpLambdaIntegration('AccountPreferencesIntegration', accountPreferencesFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const phoneChangeIntegration = new HttpLambdaIntegration('PhoneChangeIntegration', phoneChangeFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const whatsappDisconnectIntegration = new HttpLambdaIntegration('WhatsAppDisconnectIntegration', whatsappDisconnectFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const accountDeleteIntegration = new HttpLambdaIntegration('AccountDeleteIntegration', accountDeleteFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    this.httpApi.addRoutes({
      path: '/api/v1/account/profile',
      methods: [HttpMethod.GET],
      integration: accountProfileIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/account/preferences',
      methods: [HttpMethod.PUT],
      integration: accountPreferencesIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/account/phone/change',
      methods: [HttpMethod.POST],
      integration: phoneChangeIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/account/whatsapp/disconnect',
      methods: [HttpMethod.POST],
      integration: whatsappDisconnectIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/account',
      methods: [HttpMethod.DELETE],
      integration: accountDeleteIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Admin Customers Lambda — JWT-protected (admin role)
    // Customer directory, LTV analytics, cross-pollination metrics
    // ========================================================================

    const adminCustomersFunction = new Function(this, 'AdminCustomersFunction', {
      functionName: `${config.resourcePrefix}-admin-customers`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/customers.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(20),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadData(adminCustomersFunction);

    // Grant Secrets Manager + SSM for getConfig() fallback
    adminCustomersFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    adminCustomersFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    const adminCustomersIntegration = new HttpLambdaIntegration(
      'AdminCustomersIntegration', adminCustomersFunction,
      { payloadFormatVersion: PayloadFormatVersion.VERSION_2_0 },
    );

    this.httpApi.addRoutes({
      path: '/api/v1/admin/customers',
      methods: [HttpMethod.GET],
      integration: adminCustomersIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/customers/{id}',
      methods: [HttpMethod.GET],
      integration: adminCustomersIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Admin Disputes Lambda — JWT-protected (admin role)
    // Dispute resolution, support hub, refund actions via Razorpay
    // ========================================================================

    const adminDisputesFunction = new Function(this, 'AdminDisputesFunction', {
      functionName: `${config.resourcePrefix}-admin-disputes`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/disputes.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(20),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(adminDisputesFunction);

    // Grant Secrets Manager + SSM for Razorpay refund API and getConfig()
    adminDisputesFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    adminDisputesFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    const adminDisputesIntegration = new HttpLambdaIntegration(
      'AdminDisputesIntegration', adminDisputesFunction,
      { payloadFormatVersion: PayloadFormatVersion.VERSION_2_0 },
    );

    this.httpApi.addRoutes({
      path: '/api/v1/admin/disputes',
      methods: [HttpMethod.GET],
      integration: adminDisputesIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/disputes/{id}',
      methods: [HttpMethod.GET],
      integration: adminDisputesIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/disputes/{id}/resolve',
      methods: [HttpMethod.POST],
      integration: adminDisputesIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/disputes/{id}/notes',
      methods: [HttpMethod.PUT],
      integration: adminDisputesIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Admin Financials Lambda — JWT-protected (admin role)
    // Commission tracking, Razorpay Route transactions, CSV export
    // ========================================================================

    const adminFinancialsFunction = new Function(this, 'AdminFinancialsFunction', {
      functionName: `${config.resourcePrefix}-admin-financials`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/financials.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(20),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(adminFinancialsFunction);

    // Grant Secrets Manager + SSM for Razorpay transfer retry and getConfig()
    adminFinancialsFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    adminFinancialsFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    const adminFinancialsIntegration = new HttpLambdaIntegration(
      'AdminFinancialsIntegration', adminFinancialsFunction,
      { payloadFormatVersion: PayloadFormatVersion.VERSION_2_0 },
    );

    this.httpApi.addRoutes({
      path: '/api/v1/admin/financials/summary',
      methods: [HttpMethod.GET],
      integration: adminFinancialsIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/financials/transactions',
      methods: [HttpMethod.GET],
      integration: adminFinancialsIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/financials/transactions/{id}/retry',
      methods: [HttpMethod.POST],
      integration: adminFinancialsIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/financials/export',
      methods: [HttpMethod.GET],
      integration: adminFinancialsIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Admin Campaigns Lambda — Campaign oversight across all sellers
    // ========================================================================

    const adminCampaignsFunction = new Function(this, 'AdminCampaignsFunction', {
      functionName: `${config.resourcePrefix}-admin-campaigns`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/campaigns.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(20),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(adminCampaignsFunction);

    // Grant Secrets Manager + SSM for getConfig() fallback
    adminCampaignsFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    adminCampaignsFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    const adminCampaignsIntegration = new HttpLambdaIntegration(
      'AdminCampaignsIntegration', adminCampaignsFunction,
      { payloadFormatVersion: PayloadFormatVersion.VERSION_2_0 },
    );

    this.httpApi.addRoutes({
      path: '/api/v1/admin/campaigns',
      methods: [HttpMethod.GET],
      integration: adminCampaignsIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/campaigns/{id}',
      methods: [HttpMethod.GET],
      integration: adminCampaignsIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/campaigns/{id}/flag',
      methods: [HttpMethod.POST],
      integration: adminCampaignsIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/campaigns/{id}/block',
      methods: [HttpMethod.POST],
      integration: adminCampaignsIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Admin Catalog Manager Lambda — JWT-protected (admin role)
    // Global category CRUD, alias management, merge operations
    // ========================================================================

    const adminCatalogManagerFunction = new Function(this, 'AdminCatalogManagerFunction', {
      functionName: `${config.resourcePrefix}-admin-catalog-manager`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/admin/catalog-manager.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(20),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });
    table.grantReadWriteData(adminCatalogManagerFunction);

    // Grant Secrets Manager + SSM for getConfig() fallback
    adminCatalogManagerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
        ],
      }),
    );
    adminCatalogManagerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    const adminCatalogManagerIntegration = new HttpLambdaIntegration(
      'AdminCatalogManagerIntegration', adminCatalogManagerFunction,
      { payloadFormatVersion: PayloadFormatVersion.VERSION_2_0 },
    );

    this.httpApi.addRoutes({
      path: '/api/v1/admin/catalog/categories',
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: adminCatalogManagerIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/catalog/categories/merge',
      methods: [HttpMethod.POST],
      integration: adminCatalogManagerIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/catalog/categories/merge-preview',
      methods: [HttpMethod.GET],
      integration: adminCatalogManagerIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/catalog/categories/{id}',
      methods: [HttpMethod.PUT, HttpMethod.DELETE],
      integration: adminCatalogManagerIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/catalog/categories/{id}/aliases',
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: adminCatalogManagerIntegration,
      authorizer: this.jwtAuthorizer,
    });
    this.httpApi.addRoutes({
      path: '/api/v1/admin/catalog/categories/{id}/aliases/{alias}',
      methods: [HttpMethod.DELETE],
      integration: adminCatalogManagerIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Seller Order Management Lambda Functions — JWT-protected (seller role)
    // Accept, reject, status update, and list seller orders
    // ========================================================================

    const commonOrderEnv = {
      ENVIRONMENT: config.environment,
      TABLE_NAME: table.tableName,
      EVENT_BUS_NAME: eventBus.eventBusName,
      LOG_LEVEL: 'info',
      ...(props.orderSchedulerRoleArn ? { SCHEDULER_ROLE_ARN: props.orderSchedulerRoleArn } : {}),
      ...(props.notificationRouterArn ? { NOTIFICATION_ROUTER_ARN: props.notificationRouterArn } : {}),
    };

    const sellerOrdersListFunction = new Function(this, 'SellerOrdersListFunction', {
      functionName: `${config.resourcePrefix}-seller-orders-list`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/seller-orders-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonOrderEnv,
    });
    table.grantReadData(sellerOrdersListFunction);

    const orderAcceptFunction = new Function(this, 'OrderAcceptFunction', {
      functionName: `${config.resourcePrefix}-order-accept`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/order-accept-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonOrderEnv,
    });
    table.grantReadWriteData(orderAcceptFunction);
    eventBus.grantPutEventsTo(orderAcceptFunction);

    const orderRejectFunction = new Function(this, 'OrderRejectFunction', {
      functionName: `${config.resourcePrefix}-order-reject`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/order-reject-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonOrderEnv,
    });
    table.grantReadWriteData(orderRejectFunction);
    eventBus.grantPutEventsTo(orderRejectFunction);

    const orderStatusUpdateFunction = new Function(this, 'OrderStatusUpdateFunction', {
      functionName: `${config.resourcePrefix}-order-status-update`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/seller/order-status-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonOrderEnv,
    });
    table.grantReadWriteData(orderStatusUpdateFunction);
    eventBus.grantPutEventsTo(orderStatusUpdateFunction);

    // Grant Secrets Manager + SSM to order handlers that need config
    for (const fn of [orderAcceptFunction, orderRejectFunction, orderStatusUpdateFunction]) {
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
          ],
        }),
      );
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParameter', 'ssm:GetParameters'],
          resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
        }),
      );
    }

    // Seller order route integrations — all JWT-protected
    const sellerOrdersListIntegration = new HttpLambdaIntegration('SellerOrdersListIntegration', sellerOrdersListFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const orderAcceptIntegration = new HttpLambdaIntegration('OrderAcceptIntegration', orderAcceptFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const orderRejectIntegration = new HttpLambdaIntegration('OrderRejectIntegration', orderRejectFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const orderStatusUpdateIntegration = new HttpLambdaIntegration('OrderStatusUpdateIntegration', orderStatusUpdateFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    // GET /api/v1/seller/orders — list seller orders
    this.httpApi.addRoutes({
      path: '/api/v1/seller/orders',
      methods: [HttpMethod.GET],
      integration: sellerOrdersListIntegration,
      authorizer: this.jwtAuthorizer,
    });
    // POST /api/v1/seller/orders — create order from seller side (uses same list handler for POST)
    this.httpApi.addRoutes({
      path: '/api/v1/seller/orders',
      methods: [HttpMethod.POST],
      integration: sellerOrdersListIntegration,
      authorizer: this.jwtAuthorizer,
    });
    // POST /api/v1/seller/orders/{orderId}/accept
    this.httpApi.addRoutes({
      path: '/api/v1/seller/orders/{orderId}/accept',
      methods: [HttpMethod.POST],
      integration: orderAcceptIntegration,
      authorizer: this.jwtAuthorizer,
    });
    // POST /api/v1/seller/orders/{orderId}/reject
    this.httpApi.addRoutes({
      path: '/api/v1/seller/orders/{orderId}/reject',
      methods: [HttpMethod.POST],
      integration: orderRejectIntegration,
      authorizer: this.jwtAuthorizer,
    });
    // POST /api/v1/seller/orders/{orderId}/status
    this.httpApi.addRoutes({
      path: '/api/v1/seller/orders/{orderId}/status',
      methods: [HttpMethod.POST],
      integration: orderStatusUpdateIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // Customer Order Lambda Functions — JWT-protected (customer role)
    // Create, list, get detail, and cancel orders
    // ========================================================================

    const createOrderFunction = new Function(this, 'CreateOrderFunction', {
      functionName: `${config.resourcePrefix}-create-order`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/orders/create-order-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonOrderEnv,
    });
    table.grantReadWriteData(createOrderFunction);
    eventBus.grantPutEventsTo(createOrderFunction);

    const listCustomerOrdersFunction = new Function(this, 'ListCustomerOrdersFunction', {
      functionName: `${config.resourcePrefix}-list-customer-orders`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/orders/list-orders-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonOrderEnv,
    });
    table.grantReadData(listCustomerOrdersFunction);

    const getOrderDetailFunction = new Function(this, 'GetOrderDetailFunction', {
      functionName: `${config.resourcePrefix}-get-order-detail`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/orders/get-order-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      environment: commonOrderEnv,
    });
    table.grantReadData(getOrderDetailFunction);

    const cancelOrderFunction = new Function(this, 'CancelOrderFunction', {
      functionName: `${config.resourcePrefix}-cancel-order`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/orders/cancel-order-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: commonOrderEnv,
    });
    table.grantReadWriteData(cancelOrderFunction);
    eventBus.grantPutEventsTo(cancelOrderFunction);

    // Grant Secrets Manager + SSM to customer order handlers that need config
    for (const fn of [createOrderFunction, cancelOrderFunction]) {
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
            `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY-*`,
          ],
        }),
      );
      fn.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParameter', 'ssm:GetParameters'],
          resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
        }),
      );
    }

    // Grant EventBridge Scheduler permissions to all order handlers that create/cancel schedules
    // createOrderFunction: scheduleSellerReminders after order creation
    // orderAcceptFunction: schedulePaymentNudges after payment link generation
    // orderRejectFunction, cancelOrderFunction: cancelOrderSchedules on rejection/cancellation
    if (props.orderSchedulerRoleArn) {
      for (const fn of [orderAcceptFunction, orderRejectFunction, createOrderFunction, cancelOrderFunction]) {
        fn.addToRolePolicy(
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              'scheduler:CreateSchedule',
              'scheduler:DeleteSchedule',
              'scheduler:GetSchedule',
            ],
            resources: [
              `arn:aws:scheduler:${config.region}:${config.account}:schedule/default/order-*`,
            ],
          }),
        );
        fn.addToRolePolicy(
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['iam:PassRole'],
            resources: [props.orderSchedulerRoleArn],
            conditions: {
              StringEquals: {
                'iam:PassedToService': 'scheduler.amazonaws.com',
              },
            },
          }),
        );
      }
    }

    // Customer order route integrations — all JWT-protected
    const createOrderIntegration = new HttpLambdaIntegration('CreateOrderIntegration', createOrderFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const listCustomerOrdersIntegration = new HttpLambdaIntegration('ListCustomerOrdersIntegration', listCustomerOrdersFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const getOrderDetailIntegration = new HttpLambdaIntegration('GetOrderDetailIntegration', getOrderDetailFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });
    const cancelOrderIntegration = new HttpLambdaIntegration('CancelOrderIntegration', cancelOrderFunction, {
      payloadFormatVersion: PayloadFormatVersion.VERSION_2_0,
    });

    // POST /api/v1/orders — create order
    this.httpApi.addRoutes({
      path: '/api/v1/orders',
      methods: [HttpMethod.POST],
      integration: createOrderIntegration,
      authorizer: this.jwtAuthorizer,
    });
    // GET /api/v1/orders — list customer orders
    this.httpApi.addRoutes({
      path: '/api/v1/orders',
      methods: [HttpMethod.GET],
      integration: listCustomerOrdersIntegration,
      authorizer: this.jwtAuthorizer,
    });
    // GET /api/v1/orders/{orderId} — get order detail
    this.httpApi.addRoutes({
      path: '/api/v1/orders/{orderId}',
      methods: [HttpMethod.GET],
      integration: getOrderDetailIntegration,
      authorizer: this.jwtAuthorizer,
    });
    // POST /api/v1/orders/{orderId}/cancel — cancel order
    this.httpApi.addRoutes({
      path: '/api/v1/orders/{orderId}/cancel',
      methods: [HttpMethod.POST],
      integration: cancelOrderIntegration,
      authorizer: this.jwtAuthorizer,
    });

    // ========================================================================
    // API_BASE_URL — Add to all Lambda functions that send Twilio messages
    // Enables statusCallback URL construction for delivery tracking
    // ========================================================================
    this.whatsappWebhookFunction.addEnvironment('API_BASE_URL', this.httpApi.apiEndpoint);
    this.razorpayWebhookFunction.addEnvironment('API_BASE_URL', this.httpApi.apiEndpoint);
    otpSendFunction.addEnvironment('API_BASE_URL', this.httpApi.apiEndpoint);
    registerFunction.addEnvironment('API_BASE_URL', this.httpApi.apiEndpoint);
    phoneChangeFunction.addEnvironment('API_BASE_URL', this.httpApi.apiEndpoint);

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

    new cdk.CfnOutput(this, 'RazorpayWebhookUrl', {
      value: `${this.httpApi.apiEndpoint}/api/webhooks/razorpay`,
      description: 'Razorpay webhook URL',
      exportName: `${config.resourcePrefix}-razorpay-webhook-url`,
    });

    new cdk.CfnOutput(this, 'WhatsAppStatusWebhookUrl', {
      value: `${this.httpApi.apiEndpoint}/api/v1/whatsapp/status`,
      description: 'WhatsApp status callback URL for Twilio delivery tracking',
      exportName: `${config.resourcePrefix}-whatsapp-status-webhook-url`,
    });
  }

  /**
   * Get allowed CORS origins based on environment
   */
  private getAllowedOrigins(config: EnvironmentConfig): string[] {
    // Use origins from environment config (single source of truth)
    // This ensures dev.ts / staging.ts / prod.ts control the allowed origins
    return [...config.cors.allowedOrigins];
  }
}
