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
import { EventBus, Rule, RuleTargetInput } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { Function, Runtime, Code, Architecture } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Duration } from 'aws-cdk-lib';
import { EnvironmentConfig } from '../config';

/**
 * Properties for EventsStack
 */
export interface EventsStackProps extends cdk.StackProps {
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** DynamoDB table from DatabaseStack */
  table: Table;
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

  constructor(scope: Construct, id: string, props: EventsStackProps) {
    super(scope, id, props);

    const { config, table } = props;

    // Create EventBridge event bus
    this.eventBus = new EventBus(this, 'EventBus', {
      eventBusName: `${config.resourcePrefix}-events`,
    });

    // Create Dead Letter Queue for WhatsApp messages
    const whatsappMessagesDLQ = new Queue(this, 'WhatsAppMessagesDLQ', {
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
      visibilityTimeout: Duration.seconds(180), // 3x Lambda timeout
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: whatsappMessagesDLQ,
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
      timeout: Duration.seconds(60),
      memorySize: 1024,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
        LOG_LEVEL: 'info',
      },
      reservedConcurrentExecutions: config.environment === 'prod' ? 10 : undefined,
    });

    // Grant permissions to worker function
    table.grantReadWriteData(this.whatsappWorkerFunction);
    this.eventBus.grantPutEventsTo(this.whatsappWorkerFunction);

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
  }
}
