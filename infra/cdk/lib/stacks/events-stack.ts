/**
 * Events Stack
 * 
 * Creates EventBridge event bus, SQS queues, and Lambda workers for async processing.
 * Handles WhatsApp message processing, payment webhooks, and other async workflows.
 * 
 * Configuration is environment-specific:
 * - Dev: Short retention, no DLQ alarms
 * - Staging: Moderate retention, DLQ alarms enabled
 * - Prod: Long retention, DLQ alarms enabled, encryption
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EventBus, Rule, RuleTargetInput, Schedule } from 'aws-cdk-lib/aws-events';
import { SqsQueue, LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Function, Runtime, Code, Architecture, StartingPosition, Tracing } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource, DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Duration } from 'aws-cdk-lib';
import { Alarm, ComparisonOperator, Dashboard, GraphWidget, Metric, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EnvironmentConfig } from '../config';

/**
 * Properties for EventsStack
 */
export interface EventsStackProps extends cdk.StackProps {
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** DynamoDB table from DatabaseStack */
  table: Table;
  /** Cognito User Pool from AuthStack */
  userPool: any;
  /** Cognito User Pool Client ID from AuthStack */
  userPoolClientId: string;
  /** Documents S3 bucket from StorageStack */
  documentsBucket: any;
  /** Product images S3 bucket from StorageStack */
  productImagesBucket: any;
}

/**
 * EventsStack creates EventBridge, SQS, and Lambda workers for async processing
 */
export class EventsStack extends cdk.Stack {
  /** The EventBridge event bus */
  public readonly eventBus: EventBus;
  
  /** WhatsApp messages queue */
  public readonly whatsappMessagesQueue: Queue;
  
  /** WhatsApp worker Lambda function */
  public readonly whatsappWorkerFunction: Function;
  
  /** Trend analyzer worker Lambda function */
  public readonly trendAnalyzerFunction: Function;
  
  /** Campaign worker Lambda function */
  public readonly campaignWorkerFunction: Function;

  /** Notification router worker Lambda function */
  public readonly notificationRouterFunction: Function;

  /** Media processing retry queue */
  public readonly mediaProcessingQueue: Queue;

  /** Media processing dead-letter queue */
  public readonly mediaProcessingDLQ: Queue;

  /** Scheduled messages queue */
  public readonly scheduledMessagesQueue: Queue;

  /** WhatsApp messages dead-letter queue */
  public readonly whatsappMessagesDLQ: Queue;

  constructor(scope: Construct, id: string, props: EventsStackProps) {
    super(scope, id, props);

    const { config, table, userPool, userPoolClientId, documentsBucket, productImagesBucket } = props;

    // Get Twilio secrets from Secrets Manager
    const twilioSecret = Secret.fromSecretNameV2(
      this,
      'TwilioSecret',
      `${config.resourcePrefix}-twilio-credentials`
    );

    // Create EventBridge event bus
    this.eventBus = new EventBus(this, 'EventBus', {
      eventBusName: `${config.resourcePrefix}-events`,
    });

    // Create Dead Letter Queue for WhatsApp messages
    this.whatsappMessagesDLQ = new Queue(this, 'WhatsAppMessagesDLQ', {
      queueName: `${config.resourcePrefix}-whatsapp-messages-dlq`,
      encryption: config.environment === 'prod' 
        ? QueueEncryption.KMS_MANAGED 
        : QueueEncryption.UNENCRYPTED,
      retentionPeriod: Duration.days(14),
    });

    // Create SQS queue for WhatsApp messages
    this.whatsappMessagesQueue = new Queue(this, 'WhatsAppMessagesQueue', {
      queueName: `${config.resourcePrefix}-whatsapp-messages`,
      encryption: config.environment === 'prod' 
        ? QueueEncryption.KMS_MANAGED 
        : QueueEncryption.UNENCRYPTED,
      visibilityTimeout: Duration.seconds(360), // 3x Lambda timeout (120s)
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: this.whatsappMessagesDLQ,
        maxReceiveCount: 3,
      },
    });

    // Create EventBridge rule to route WhatsApp webhooks to SQS
    new Rule(this, 'WhatsAppWebhookRule', {
      ruleName: `${config.resourcePrefix}-whatsapp-webhook`,
      description: 'Route incoming WhatsApp webhooks to SQS for processing',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['vyapargyan.whatsapp'],
        detailType: ['IncomingWhatsAppWebhook'],
      },
      targets: [
        new SqsQueue(this.whatsappMessagesQueue, {
          message: RuleTargetInput.fromEventPath('$'),
        }),
      ],
    });

    // Create WhatsApp worker Lambda function
    this.whatsappWorkerFunction = new Function(this, 'WhatsAppWorkerFunction', {
      functionName: `${config.resourcePrefix}-whatsapp-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/whatsapp/worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(120),
      memorySize: 1024,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClientId,
        PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        LOG_LEVEL: 'info',
        // Twilio credentials for sending WhatsApp responses
        TWILIO_ACCOUNT_SID: twilioSecret.secretValueFromJson('accountSid').unsafeUnwrap(),
        TWILIO_AUTH_TOKEN: twilioSecret.secretValueFromJson('authToken').unsafeUnwrap(),
        TWILIO_PHONE_NUMBER: twilioSecret.secretValueFromJson('phoneNumber').unsafeUnwrap(),
        FORCE_DEPLOY_TIME: '2026-03-10T00:30:00.000Z',
      },
      ...(config.environment === 'prod' && { reservedConcurrentExecutions: 10 }),
    });

    // Grant permissions to worker function
    table.grantReadWriteData(this.whatsappWorkerFunction);
    this.eventBus.grantPutEventsTo(this.whatsappWorkerFunction);
    // S3: voice pipeline stores inbound/outbound audio, image handler stores uploads
    productImagesBucket.grantReadWrite(this.whatsappWorkerFunction);
    documentsBucket.grantRead(this.whatsappWorkerFunction);
    
    // Grant Secrets Manager permissions for Twilio, Razorpay, and AI API keys
    // Note: Using wildcard suffix because Secrets Manager appends random 6-character suffix to ARNs
    this.whatsappWorkerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/razorpay/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/gemini/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/grok/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GROK_API_KEY*`,
        ],
      })
    );
    
    // Grant SSM Parameter Store permissions for Twilio and Razorpay configuration
    this.whatsappWorkerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
        resources: [
          `arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/twilio/*`,
          `arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/razorpay/*`,
          `arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/gemini/*`,
          `arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/grok/*`,
        ],
      })
    );

    // Grant Bedrock permissions for seller copilot AI
    this.whatsappWorkerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          // Amazon Nova Lite model for seller copilot (native Amazon model)
          'arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0',
        ],
      })
    );

    // Add SQS event source to worker function
    this.whatsappWorkerFunction.addEventSource(
      new SqsEventSource(this.whatsappMessagesQueue, {
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(5),
        reportBatchItemFailures: true,
      })
    );

    // Add environment-specific tags
    cdk.Tags.of(this.eventBus).add('Name', `${config.resourcePrefix}-event-bus`);
    cdk.Tags.of(this.eventBus).add('Service', 'events');
    cdk.Tags.of(this.whatsappMessagesQueue).add('Name', `${config.resourcePrefix}-whatsapp-queue`);
    cdk.Tags.of(this.whatsappMessagesQueue).add('Service', 'events');

    // Create Trend Analyzer Lambda function for scheduled AI insights
    this.trendAnalyzerFunction = new Function(this, 'TrendAnalyzerFunction', {
      functionName: `${config.resourcePrefix}-trend-analyzer`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/ai/trend-analyzer-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.minutes(5), // Longer timeout for batch processing
      memorySize: 1024,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant permissions to trend analyzer function
    table.grantReadWriteData(this.trendAnalyzerFunction);

    // Create EventBridge scheduled rule for daily trend analysis
    // Runs at 2:00 AM IST (20:30 UTC previous day)
    const trendAnalyzerRule = new Rule(this, 'TrendAnalyzerSchedule', {
      ruleName: `${config.resourcePrefix}-trend-analyzer-schedule`,
      description: 'Daily scheduled trigger for market trend analysis and dead stock detection',
      schedule: Schedule.cron({
        minute: '30',
        hour: '20', // 2:00 AM IST
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    // Add Lambda as target for the scheduled rule
    trendAnalyzerRule.addTarget(new LambdaFunction(this.trendAnalyzerFunction));

    // Add tags to trend analyzer
    cdk.Tags.of(this.trendAnalyzerFunction).add('Name', `${config.resourcePrefix}-trend-analyzer`);
    cdk.Tags.of(this.trendAnalyzerFunction).add('Service', 'ai-insights');

    // Create Campaign Worker Lambda function for automated WhatsApp campaigns
    this.campaignWorkerFunction = new Function(this, 'CampaignWorkerFunction', {
      functionName: `${config.resourcePrefix}-campaign-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/ai/campaign-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.minutes(5), // Longer timeout for batch WhatsApp sending
      memorySize: 1024,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant permissions to campaign worker function
    table.grantReadWriteData(this.campaignWorkerFunction);

    // Add DynamoDB Stream as event source for campaign worker
    // Triggers when INSIGHT items are modified (status changed to 'approved')
    // Note: Table has streams enabled (StreamViewType.NEW_AND_OLD_IMAGES)
    this.campaignWorkerFunction.addEventSource(
      new DynamoEventSource(table as any, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(5),
        retryAttempts: 2,
        filters: [
          // Only process INSIGHT items
          {
            pattern: JSON.stringify({
              dynamodb: {
                NewImage: {
                  SK: {
                    S: [{ prefix: 'INSIGHT#' }],
                  },
                },
              },
            }),
          },
        ],
      })
    );

    // Add tags to campaign worker
    cdk.Tags.of(this.campaignWorkerFunction).add('Name', `${config.resourcePrefix}-campaign-worker`);
    cdk.Tags.of(this.campaignWorkerFunction).add('Service', 'ai-campaigns');

    // -----------------------------------------------------------------------
    // Notification Router Worker — cross-channel message bridging
    // -----------------------------------------------------------------------

    this.notificationRouterFunction = new Function(this, 'NotificationRouterFunction', {
      functionName: `${config.resourcePrefix}-notification-router`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/notification-router-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        LOG_LEVEL: 'info',
        TWILIO_ACCOUNT_SID: twilioSecret.secretValueFromJson('accountSid').unsafeUnwrap(),
        TWILIO_AUTH_TOKEN: twilioSecret.secretValueFromJson('authToken').unsafeUnwrap(),
        TWILIO_PHONE_NUMBER: twilioSecret.secretValueFromJson('phoneNumber').unsafeUnwrap(),
      },
    });

    // Grant DynamoDB read/write for user profiles and message threads
    table.grantReadWriteData(this.notificationRouterFunction);

    // Grant Secrets Manager permissions for Twilio credentials
    this.notificationRouterFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/dev/twilio/*`,
        ],
      })
    );

    // Grant SSM Parameter Store permissions for Twilio configuration
    this.notificationRouterFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
        resources: [
          `arn:aws:ssm:${config.region}:${config.account}:parameter/dev/twilio/*`,
        ],
      })
    );

    // EventBridge rule: route CustomerMessageSent events to notification router
    new Rule(this, 'CustomerMessageRouteRule', {
      ruleName: `${config.resourcePrefix}-customer-message-route`,
      description: 'Route customer messages to seller preferred channel via notification router',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['vyapargyan.chat'],
        detailType: ['CustomerMessageSent'],
      },
      targets: [new LambdaFunction(this.notificationRouterFunction)],
    });

    // Add tags to notification router
    cdk.Tags.of(this.notificationRouterFunction).add('Name', `${config.resourcePrefix}-notification-router`);
    cdk.Tags.of(this.notificationRouterFunction).add('Service', 'messaging');

    // -----------------------------------------------------------------------
    // Approval Execution Worker — executes approved seller actions
    // Triggered by EventBridge: ApprovalApproved | ApprovalEditedApproved
    // -----------------------------------------------------------------------

    const approvalExecutionWorkerFunction = new Function(this, 'ApprovalExecutionWorkerFunction', {
      functionName: `${config.resourcePrefix}-approval-execution-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/approval-execution-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClientId,
        PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read/write for approval status updates and product price writes
    table.grantReadWriteData(approvalExecutionWorkerFunction);
    // Grant EventBridge for publishing CampaignScheduled events
    this.eventBus.grantPutEventsTo(approvalExecutionWorkerFunction);

    // Grant Secrets Manager + SSM for config loading
    approvalExecutionWorkerFunction.addToRolePolicy(
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
    approvalExecutionWorkerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    // EventBridge rule: route ApprovalApproved and ApprovalEditedApproved events
    new Rule(this, 'ApprovalExecutionRule', {
      ruleName: `${config.resourcePrefix}-approval-execution`,
      description: 'Route approved approval events to execution worker',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['vyapargyan.approval'],
        detailType: ['ApprovalApproved', 'ApprovalEditedApproved'],
      },
      targets: [new LambdaFunction(approvalExecutionWorkerFunction)],
    });

    // Add tags to approval execution worker
    cdk.Tags.of(approvalExecutionWorkerFunction).add('Name', `${config.resourcePrefix}-approval-execution-worker`);
    cdk.Tags.of(approvalExecutionWorkerFunction).add('Service', 'approval-engine');

    // -----------------------------------------------------------------------
    // Campaign Execution Worker — sends campaign messages with consent checks
    // Triggered by EventBridge: CampaignScheduled
    // Coexists with existing campaign-worker.ts (DynamoDB Streams on INSIGHT#)
    // -----------------------------------------------------------------------

    const campaignExecutionWorkerFunction = new Function(this, 'CampaignExecutionWorkerFunction', {
      functionName: `${config.resourcePrefix}-campaign-execution-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/campaign-execution-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(300),
      memorySize: 1024,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read/write for campaign status, audience queries, idempotency keys
    table.grantReadWriteData(campaignExecutionWorkerFunction);

    // Grant Secrets Manager for Twilio credentials (needed by TwilioAdapter)
    campaignExecutionWorkerFunction.addToRolePolicy(
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
    campaignExecutionWorkerFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    // EventBridge rule: route CampaignScheduled events to campaign execution worker
    new Rule(this, 'CampaignExecutionRule', {
      ruleName: `${config.resourcePrefix}-campaign-execution`,
      description: 'Route CampaignScheduled events to campaign execution worker',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['vyapargyan.campaign'],
        detailType: ['CampaignScheduled'],
      },
      targets: [new LambdaFunction(campaignExecutionWorkerFunction)],
    });

    // Add tags to campaign execution worker
    cdk.Tags.of(campaignExecutionWorkerFunction).add('Name', `${config.resourcePrefix}-campaign-execution-worker`);
    cdk.Tags.of(campaignExecutionWorkerFunction).add('Service', 'campaigns');

    // -----------------------------------------------------------------------
    // Media Processing SQS Queue + DLQ
    // Dedicated retry queue for voice transcription and image analysis via Gemini
    // Separate from main WhatsApp DLQ for independent retry policies
    // -----------------------------------------------------------------------

    this.mediaProcessingDLQ = new Queue(this, 'MediaProcessingDLQ', {
      queueName: `${config.resourcePrefix}-media-processing-dlq`,
      encryption: config.environment === 'prod'
        ? QueueEncryption.KMS_MANAGED
        : QueueEncryption.UNENCRYPTED,
      retentionPeriod: Duration.days(14),
    });

    this.mediaProcessingQueue = new Queue(this, 'MediaProcessingQueue', {
      queueName: `${config.resourcePrefix}-media-processing-retry`,
      encryption: config.environment === 'prod'
        ? QueueEncryption.KMS_MANAGED
        : QueueEncryption.UNENCRYPTED,
      visibilityTimeout: Duration.seconds(300),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: this.mediaProcessingDLQ,
        maxReceiveCount: 3,
      },
    });

    cdk.Tags.of(this.mediaProcessingDLQ).add('Name', `${config.resourcePrefix}-media-processing-dlq`);
    cdk.Tags.of(this.mediaProcessingDLQ).add('Service', 'media-processing');
    cdk.Tags.of(this.mediaProcessingQueue).add('Name', `${config.resourcePrefix}-media-processing-retry`);
    cdk.Tags.of(this.mediaProcessingQueue).add('Service', 'media-processing');

    // Wire media processing queue URL into WhatsApp worker (queue created after worker)
    this.whatsappWorkerFunction.addEnvironment('MEDIA_PROCESSING_QUEUE_URL', this.mediaProcessingQueue.queueUrl);
    this.mediaProcessingQueue.grantSendMessages(this.whatsappWorkerFunction);

    // -----------------------------------------------------------------------
    // Media Processing Worker — voice transcription + image analysis via Gemini
    // Consumes from media-processing-retry SQS queue
    // -----------------------------------------------------------------------

    const mediaProcessingWorker = new Function(this, 'MediaProcessingWorkerFunction', {
      functionName: `${config.resourcePrefix}-media-processing-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/media-processing-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(120),
      memorySize: 1024,
      tracing: Tracing.ACTIVE,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        PRODUCT_IMAGES_BUCKET: productImagesBucket.bucketName,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        LOG_LEVEL: 'info',
      },
    });

    // Grant DynamoDB read/write for catalog search, cart updates, thread messages
    table.grantReadWriteData(mediaProcessingWorker);
    // Grant EventBridge for publishing processing results
    this.eventBus.grantPutEventsTo(mediaProcessingWorker);
    // Grant S3 read for downloading voice notes and images
    documentsBucket.grantRead(mediaProcessingWorker);
    productImagesBucket.grantRead(mediaProcessingWorker);

    // Grant Secrets Manager for Gemini API key and Twilio (for sending responses)
    mediaProcessingWorker.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:/${config.environment}/twilio/*`,
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:GEMINI_API_KEY-*`,
        ],
      }),
    );
    mediaProcessingWorker.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${config.region}:${config.account}:parameter/${config.environment}/*`],
      }),
    );

    // Wire SQS event source — consume from media processing retry queue
    mediaProcessingWorker.addEventSource(
      new SqsEventSource(this.mediaProcessingQueue, {
        batchSize: 1, // Process one media item at a time (Gemini API calls are heavy)
        maxBatchingWindow: Duration.seconds(0),
        reportBatchItemFailures: true,
      }),
    );

    cdk.Tags.of(mediaProcessingWorker).add('Name', `${config.resourcePrefix}-media-processing-worker`);
    cdk.Tags.of(mediaProcessingWorker).add('Service', 'media-processing');

    // -----------------------------------------------------------------------
    // Scheduled Messages SQS Queue + DLQ
    // Holds quiet-hours deferred messages for delivery at 09:01 IST
    // -----------------------------------------------------------------------

    const scheduledMessagesDLQ = new Queue(this, 'ScheduledMessagesDLQ', {
      queueName: `${config.resourcePrefix}-scheduled-messages-dlq`,
      encryption: config.environment === 'prod'
        ? QueueEncryption.KMS_MANAGED
        : QueueEncryption.UNENCRYPTED,
      retentionPeriod: Duration.days(14),
    });

    this.scheduledMessagesQueue = new Queue(this, 'ScheduledMessagesQueue', {
      queueName: `${config.resourcePrefix}-scheduled-messages`,
      encryption: config.environment === 'prod'
        ? QueueEncryption.KMS_MANAGED
        : QueueEncryption.UNENCRYPTED,
      visibilityTimeout: Duration.seconds(60),
      retentionPeriod: Duration.days(7),
      deadLetterQueue: {
        queue: scheduledMessagesDLQ,
        maxReceiveCount: 3,
      },
    });

    cdk.Tags.of(scheduledMessagesDLQ).add('Name', `${config.resourcePrefix}-scheduled-messages-dlq`);
    cdk.Tags.of(scheduledMessagesDLQ).add('Service', 'scheduled-messages');
    cdk.Tags.of(this.scheduledMessagesQueue).add('Name', `${config.resourcePrefix}-scheduled-messages`);
    cdk.Tags.of(this.scheduledMessagesQueue).add('Service', 'scheduled-messages');

    // -----------------------------------------------------------------------
    // EventBridge Rule: Media Processing
    // Routes vyapargyan.media events (VoiceNoteReceived, ImageSearchRequested)
    // to the media processing retry queue
    // -----------------------------------------------------------------------

    new Rule(this, 'MediaProcessingRule', {
      ruleName: `${config.resourcePrefix}-media-processing`,
      description: 'Route media events (voice notes, image search) to media processing retry queue',
      eventBus: this.eventBus,
      eventPattern: {
        source: ['vyapargyan.media'],
      },
      targets: [
        new SqsQueue(this.mediaProcessingQueue, {
          message: RuleTargetInput.fromEventPath('$.detail'),
        }),
      ],
    });

    // -----------------------------------------------------------------------
    // Scheduled Worker Placeholder Lambdas + EventBridge Rules
    // These are minimal placeholder functions implemented in Task 21.
    // -----------------------------------------------------------------------

    // Common environment variables for all scheduled workers
    const scheduledWorkerEnv = {
      ENVIRONMENT: config.environment,
      TABLE_NAME: table.tableName,
      EVENT_BUS_NAME: this.eventBus.eventBusName,
      LOG_LEVEL: 'info',
    };

    // --- Payment Reminder Worker (rate: every 15 minutes) ---
    const paymentReminderWorker = new Function(this, 'PaymentReminderWorkerFunction', {
      functionName: `${config.resourcePrefix}-payment-reminder-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/payment-reminder-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: scheduledWorkerEnv,
    });
    table.grantReadWriteData(paymentReminderWorker);
    this.eventBus.grantPutEventsTo(paymentReminderWorker);
    cdk.Tags.of(paymentReminderWorker).add('Name', `${config.resourcePrefix}-payment-reminder-worker`);
    cdk.Tags.of(paymentReminderWorker).add('Service', 'scheduled-workers');

    new Rule(this, 'PaymentReminderRule', {
      ruleName: `${config.resourcePrefix}-payment-reminder`,
      description: 'Send payment reminders for pending orders every 15 minutes',
      schedule: Schedule.rate(Duration.minutes(15)),
      targets: [new LambdaFunction(paymentReminderWorker)],
    });

    // --- Cart Abandonment Worker (cron: 8:30 PM IST = 15:00 UTC) ---
    const cartAbandonmentWorker = new Function(this, 'CartAbandonmentWorkerFunction', {
      functionName: `${config.resourcePrefix}-cart-abandonment-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/cart-abandonment-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: scheduledWorkerEnv,
    });
    table.grantReadWriteData(cartAbandonmentWorker);
    this.eventBus.grantPutEventsTo(cartAbandonmentWorker);
    cdk.Tags.of(cartAbandonmentWorker).add('Name', `${config.resourcePrefix}-cart-abandonment-worker`);
    cdk.Tags.of(cartAbandonmentWorker).add('Service', 'scheduled-workers');

    new Rule(this, 'CartAbandonmentRule', {
      ruleName: `${config.resourcePrefix}-cart-abandonment`,
      description: 'Send cart abandonment reminders daily at 8:30 PM IST (15:00 UTC)',
      schedule: Schedule.cron({
        minute: '0',
        hour: '15',
        day: '*',
        month: '*',
        year: '*',
      }),
      targets: [new LambdaFunction(cartAbandonmentWorker)],
    });

    // --- Session Cleanup Worker (cron: 11:30 PM IST = 18:00 UTC) ---
    const sessionCleanupWorker = new Function(this, 'SessionCleanupWorkerFunction', {
      functionName: `${config.resourcePrefix}-session-cleanup-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/session-cleanup-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(120),
      memorySize: 256,
      environment: scheduledWorkerEnv,
    });
    table.grantReadWriteData(sessionCleanupWorker);
    cdk.Tags.of(sessionCleanupWorker).add('Name', `${config.resourcePrefix}-session-cleanup-worker`);
    cdk.Tags.of(sessionCleanupWorker).add('Service', 'scheduled-workers');

    new Rule(this, 'SessionCleanupRule', {
      ruleName: `${config.resourcePrefix}-session-cleanup`,
      description: 'Clean up expired sessions daily at 11:30 PM IST (18:00 UTC)',
      schedule: Schedule.cron({
        minute: '0',
        hour: '18',
        day: '*',
        month: '*',
        year: '*',
      }),
      targets: [new LambdaFunction(sessionCleanupWorker)],
    });

    // --- Health Check Worker (cron: 11:30 AM IST = 06:00 UTC) ---
    const healthCheckWorker = new Function(this, 'HealthCheckWorkerFunction', {
      functionName: `${config.resourcePrefix}-health-check-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/health-check-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: scheduledWorkerEnv,
    });
    table.grantReadData(healthCheckWorker);
    cdk.Tags.of(healthCheckWorker).add('Name', `${config.resourcePrefix}-health-check-worker`);
    cdk.Tags.of(healthCheckWorker).add('Service', 'scheduled-workers');

    new Rule(this, 'HealthCheckRule', {
      ruleName: `${config.resourcePrefix}-health-check`,
      description: 'Verify external service connectivity daily at 11:30 AM IST (06:00 UTC)',
      schedule: Schedule.cron({
        minute: '0',
        hour: '6',
        day: '*',
        month: '*',
        year: '*',
      }),
      targets: [new LambdaFunction(healthCheckWorker)],
    });

    // --- Scheduled Messages Trigger Worker (cron: 09:01 IST = 03:31 UTC) ---
    const scheduledMessageWorker = new Function(this, 'ScheduledMessageWorkerFunction', {
      functionName: `${config.resourcePrefix}-scheduled-message-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/scheduled-message-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: scheduledWorkerEnv,
    });
    table.grantReadWriteData(scheduledMessageWorker);
    this.scheduledMessagesQueue.grantConsumeMessages(scheduledMessageWorker);
    cdk.Tags.of(scheduledMessageWorker).add('Name', `${config.resourcePrefix}-scheduled-message-worker`);
    cdk.Tags.of(scheduledMessageWorker).add('Service', 'scheduled-workers');

    new Rule(this, 'ScheduledMessagesTriggerRule', {
      ruleName: `${config.resourcePrefix}-scheduled-messages-trigger`,
      description: 'Process deferred quiet-hours messages daily at 09:01 IST (03:31 UTC)',
      schedule: Schedule.cron({
        minute: '31',
        hour: '3',
        day: '*',
        month: '*',
        year: '*',
      }),
      targets: [new LambdaFunction(scheduledMessageWorker)],
    });

    // --- Audit Export Worker (cron: 1st of month at midnight UTC) ---
    const auditExportWorker = new Function(this, 'AuditExportWorkerFunction', {
      functionName: `${config.resourcePrefix}-audit-export-worker`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/workers/audit-export-worker.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(300),
      memorySize: 512,
      environment: {
        ...scheduledWorkerEnv,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
      },
    });
    table.grantReadWriteData(auditExportWorker);
    documentsBucket.grantWrite(auditExportWorker);
    cdk.Tags.of(auditExportWorker).add('Name', `${config.resourcePrefix}-audit-export-worker`);
    cdk.Tags.of(auditExportWorker).add('Service', 'scheduled-workers');

    new Rule(this, 'AuditExportRule', {
      ruleName: `${config.resourcePrefix}-audit-export`,
      description: 'Monthly export of audit logs older than 90 days to S3 (1st of month)',
      schedule: Schedule.cron({
        minute: '0',
        hour: '0',
        day: '1',
        month: '*',
        year: '*',
      }),
      targets: [new LambdaFunction(auditExportWorker)],
    });

    // -----------------------------------------------------------------------
    // CloudWatch Alarms — Observability (Section 10.2)
    // SNS topic for alarm notifications + alarms for DLQ depth and error rates
    // -----------------------------------------------------------------------

    const alarmTopic = new Topic(this, 'OmnichannelAlarmTopic', {
      topicName: `${config.resourcePrefix}-omnichannel-alarms`,
      displayName: 'VyaparGyan Omnichannel Alarms',
    });
    const snsAction = new SnsAction(alarmTopic);

    const metricsNamespace = `VyaparGyan/${config.environment}`;

    // WhatsAppDLQHigh — >5 messages in DLQ over 5 minutes
    const whatsAppDLQAlarm = new Alarm(this, 'WhatsAppDLQHighAlarm', {
      alarmName: `${config.resourcePrefix}-whatsapp-dlq-high`,
      alarmDescription: 'WhatsApp DLQ depth exceeds 5 messages in 5 minutes',
      metric: this.whatsappMessagesDLQ.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    whatsAppDLQAlarm.addAlarmAction(snsAction);

    // MediaDLQHigh — >10 messages in DLQ over 5 minutes
    const mediaDLQAlarm = new Alarm(this, 'MediaDLQHighAlarm', {
      alarmName: `${config.resourcePrefix}-media-dlq-high`,
      alarmDescription: 'Media processing DLQ depth exceeds 10 messages in 5 minutes',
      metric: this.mediaProcessingDLQ.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    mediaDLQAlarm.addAlarmAction(snsAction);

    // MessageProcessingErrors — >5% error rate on WhatsApp worker
    const msgErrorAlarm = new Alarm(this, 'MessageProcessingErrorsAlarm', {
      alarmName: `${config.resourcePrefix}-message-processing-errors`,
      alarmDescription: 'WhatsApp worker Lambda error rate exceeds 5%',
      metric: this.whatsappWorkerFunction.metricErrors({
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    msgErrorAlarm.addAlarmAction(snsAction);

    // TwilioSendFailures — custom metric >3% failure rate
    const twilioFailAlarm = new Alarm(this, 'TwilioSendFailuresAlarm', {
      alarmName: `${config.resourcePrefix}-twilio-send-failures`,
      alarmDescription: 'Twilio send failure rate exceeds 3%',
      metric: new Metric({
        namespace: metricsNamespace,
        metricName: 'AIFailureRate',
        dimensionsMap: { Service: 'twilio' },
        period: Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    twilioFailAlarm.addAlarmAction(snsAction);

    // AIFailureHigh — >5% failure rate per AI service (gemini, bedrock, grok)
    for (const service of ['gemini', 'bedrock', 'grok']) {
      const aiAlarm = new Alarm(this, `AIFailureHigh${service}Alarm`, {
        alarmName: `${config.resourcePrefix}-ai-failure-high-${service}`,
        alarmDescription: `AI failure rate for ${service} exceeds 5%`,
        metric: new Metric({
          namespace: metricsNamespace,
          metricName: 'AIFailureRate',
          dimensionsMap: { Service: service },
          period: Duration.minutes(5),
          statistic: 'Average',
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      });
      aiAlarm.addAlarmAction(snsAction);
    }

    cdk.Tags.of(alarmTopic).add('Name', `${config.resourcePrefix}-omnichannel-alarms`);
    cdk.Tags.of(alarmTopic).add('Service', 'observability');

    // -----------------------------------------------------------------------
    // CloudWatch Dashboard — OmnichannelHealth
    // Provides at-a-glance view of messaging, errors, queues, AI, and sync
    // -----------------------------------------------------------------------

    const dashboard = new Dashboard(this, 'OmnichannelHealthDashboard', {
      dashboardName: `${config.resourcePrefix}-OmnichannelHealth`,
    });

    const p50 = 'p50';
    const p95 = 'p95';
    const p99 = 'p99';

    // 1. Message Volume by Channel
    dashboard.addWidgets(
      new GraphWidget({
        title: 'Message Volume by Channel',
        width: 12,
        height: 6,
        left: [
          new Metric({ namespace: metricsNamespace, metricName: 'MessagesReceived', dimensionsMap: { Channel: 'whatsapp' }, statistic: 'Sum', label: 'WhatsApp Received' }),
          new Metric({ namespace: metricsNamespace, metricName: 'MessagesReceived', dimensionsMap: { Channel: 'web' }, statistic: 'Sum', label: 'Web Received' }),
          new Metric({ namespace: metricsNamespace, metricName: 'MessagesSent', dimensionsMap: { Channel: 'whatsapp' }, statistic: 'Sum', label: 'WhatsApp Sent' }),
          new Metric({ namespace: metricsNamespace, metricName: 'MessagesSent', dimensionsMap: { Channel: 'web' }, statistic: 'Sum', label: 'Web Sent' }),
        ],
        period: Duration.minutes(5),
      }) as unknown as cdk.aws_cloudwatch.IWidget,
    );

    // 2. Error Rates
    dashboard.addWidgets(
      new GraphWidget({
        title: 'Lambda Error Rates',
        width: 12,
        height: 6,
        left: [
          this.whatsappWorkerFunction.metricErrors({ statistic: 'Sum', label: 'WhatsApp Worker' }),
          this.notificationRouterFunction.metricErrors({ statistic: 'Sum', label: 'Notification Router' }),
          this.campaignWorkerFunction.metricErrors({ statistic: 'Sum', label: 'Campaign Worker' }),
        ],
        period: Duration.minutes(5),
      }) as unknown as cdk.aws_cloudwatch.IWidget,
    );

    // 3. DLQ Depths
    dashboard.addWidgets(
      new GraphWidget({
        title: 'DLQ Depths',
        width: 12,
        height: 6,
        left: [
          this.whatsappMessagesDLQ.metricApproximateNumberOfMessagesVisible({ statistic: 'Maximum', label: 'WhatsApp DLQ' }),
          this.mediaProcessingDLQ.metricApproximateNumberOfMessagesVisible({ statistic: 'Maximum', label: 'Media DLQ' }),
        ],
        period: Duration.minutes(5),
      }) as unknown as cdk.aws_cloudwatch.IWidget,
    );

    // 4. AI Latency (p50 / p95 / p99)
    dashboard.addWidgets(
      new GraphWidget({
        title: 'AI Processing Latency',
        width: 12,
        height: 6,
        left: [
          new Metric({ namespace: metricsNamespace, metricName: 'AIProcessingLatency', statistic: p50, label: 'p50' }),
          new Metric({ namespace: metricsNamespace, metricName: 'AIProcessingLatency', statistic: p95, label: 'p95' }),
          new Metric({ namespace: metricsNamespace, metricName: 'AIProcessingLatency', statistic: p99, label: 'p99' }),
        ],
        period: Duration.minutes(5),
      }) as unknown as cdk.aws_cloudwatch.IWidget,
    );

    // 5. Cart Sync Latency
    dashboard.addWidgets(
      new GraphWidget({
        title: 'Cart Sync Latency',
        width: 12,
        height: 6,
        left: [
          new Metric({ namespace: metricsNamespace, metricName: 'CartSyncLatency', statistic: p50, label: 'p50' }),
          new Metric({ namespace: metricsNamespace, metricName: 'CartSyncLatency', statistic: p95, label: 'p95' }),
          new Metric({ namespace: metricsNamespace, metricName: 'CartSyncLatency', statistic: p99, label: 'p99' }),
        ],
        period: Duration.minutes(5),
      }) as unknown as cdk.aws_cloudwatch.IWidget,
    );

    // 6. System Health Score
    dashboard.addWidgets(
      new GraphWidget({
        title: 'System Health Score',
        width: 12,
        height: 6,
        left: [
          new Metric({ namespace: metricsNamespace, metricName: 'SystemHealthScore', statistic: 'Average', label: 'Health Score' }),
        ],
        period: Duration.minutes(5),
      }) as unknown as cdk.aws_cloudwatch.IWidget,
    );

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic ARN for omnichannel alarm notifications',
      exportName: `${config.resourcePrefix}-alarm-topic-arn`,
    });

    // Output event bus and queue details
    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'EventBridge event bus name',
      exportName: `${config.resourcePrefix}-event-bus-name`,
    });

    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      description: 'EventBridge event bus ARN',
      exportName: `${config.resourcePrefix}-event-bus-arn`,
    });

    new cdk.CfnOutput(this, 'WhatsAppMessagesQueueUrl', {
      value: this.whatsappMessagesQueue.queueUrl,
      description: 'WhatsApp messages SQS queue URL',
      exportName: `${config.resourcePrefix}-whatsapp-queue-url`,
    });

    new cdk.CfnOutput(this, 'WhatsAppMessagesQueueArn', {
      value: this.whatsappMessagesQueue.queueArn,
      description: 'WhatsApp messages SQS queue ARN',
      exportName: `${config.resourcePrefix}-whatsapp-queue-arn`,
    });

    new cdk.CfnOutput(this, 'TrendAnalyzerFunctionArn', {
      value: this.trendAnalyzerFunction.functionArn,
      description: 'Trend analyzer Lambda function ARN',
      exportName: `${config.resourcePrefix}-trend-analyzer-arn`,
    });

    new cdk.CfnOutput(this, 'CampaignWorkerFunctionArn', {
      value: this.campaignWorkerFunction.functionArn,
      description: 'Campaign worker Lambda function ARN',
      exportName: `${config.resourcePrefix}-campaign-worker-arn`,
    });

    new cdk.CfnOutput(this, 'NotificationRouterFunctionArn', {
      value: this.notificationRouterFunction.functionArn,
      description: 'Notification router Lambda function ARN',
      exportName: `${config.resourcePrefix}-notification-router-arn`,
    });

    new cdk.CfnOutput(this, 'MediaProcessingQueueUrl', {
      value: this.mediaProcessingQueue.queueUrl,
      description: 'Media processing retry SQS queue URL',
      exportName: `${config.resourcePrefix}-media-processing-queue-url`,
    });

    new cdk.CfnOutput(this, 'MediaProcessingQueueArn', {
      value: this.mediaProcessingQueue.queueArn,
      description: 'Media processing retry SQS queue ARN',
      exportName: `${config.resourcePrefix}-media-processing-queue-arn`,
    });

    new cdk.CfnOutput(this, 'ScheduledMessagesQueueUrl', {
      value: this.scheduledMessagesQueue.queueUrl,
      description: 'Scheduled messages SQS queue URL',
      exportName: `${config.resourcePrefix}-scheduled-messages-queue-url`,
    });

    new cdk.CfnOutput(this, 'ScheduledMessagesQueueArn', {
      value: this.scheduledMessagesQueue.queueArn,
      description: 'Scheduled messages SQS queue ARN',
      exportName: `${config.resourcePrefix}-scheduled-messages-queue-arn`,
    });
  }
}
