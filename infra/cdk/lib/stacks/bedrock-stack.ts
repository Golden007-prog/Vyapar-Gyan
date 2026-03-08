/**
 * Bedrock Stack
 * 
 * Creates Amazon Bedrock Agent infrastructure for AI-powered inventory management,
 * dynamic pricing, and automated customer communications.
 * 
 * Components:
 * - Bedrock Agent with Claude 3.5 Sonnet foundation model
 * - Action Group Lambda for business logic execution
 * - Knowledge Base connected to S3 document storage
 * - IAM roles and permissions for agent operations
 * 
 * The agent orchestrates:
 * - Dead stock detection and discount recommendations
 * - Market trend analysis integration
 * - Automated WhatsApp campaign generation
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Function, Runtime, Code, Architecture } from 'aws-cdk-lib/aws-lambda';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Duration } from 'aws-cdk-lib';
import {
  Role,
  ServicePrincipal,
  PolicyStatement,
  Effect,
} from 'aws-cdk-lib/aws-iam';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { EnvironmentConfig } from '../config';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Properties for BedrockStack
 */
export interface BedrockStackProps extends cdk.StackProps {
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** DynamoDB table from DatabaseStack */
  table: Table;
  /** EventBridge event bus from EventsStack */
  eventBus: EventBus;
  /** S3 bucket for documents and knowledge base */
  documentsBucket: Bucket;
}

/**
 * BedrockStack creates Amazon Bedrock Agent infrastructure
 */
export class BedrockStack extends cdk.Stack {
  /** The Bedrock Agent */
  public readonly agent: cdk.CfnResource;
  
  /** Action Group Lambda function */
  public readonly actionGroupFunction: Function;
  
  /** Knowledge Base */
  // public readonly knowledgeBase: cdk.CfnResource;
  
  /** OpenSearch Serverless Collection */
  // public readonly aossCollection: cdk.CfnResource;

  constructor(scope: Construct, id: string, props: BedrockStackProps) {
    super(scope, id, props);

    const { config, table, eventBus } = props;

    // Get Twilio secrets from Secrets Manager
    const twilioSecret = Secret.fromSecretNameV2(
      this,
      'TwilioSecret',
      `${config.resourcePrefix}-twilio-credentials`
    );
    // Create Action Group Lambda function
    this.actionGroupFunction = new Function(this, 'ActionGroupFunction', {
      functionName: `${config.resourcePrefix}-bedrock-action-group`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/bedrock/index.handler',
      code: Code.fromAsset(path.join(__dirname, '../../../../services/api/dist')),
      timeout: Duration.seconds(60),
      memorySize: 1024,
      environment: {
        ENVIRONMENT: config.environment,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        LOG_LEVEL: 'info',
        TWILIO_ACCOUNT_SID: twilioSecret.secretValueFromJson('accountSid').unsafeUnwrap(),
        TWILIO_AUTH_TOKEN: twilioSecret.secretValueFromJson('authToken').unsafeUnwrap(),
        TWILIO_PHONE_NUMBER: twilioSecret.secretValueFromJson('phoneNumber').unsafeUnwrap(),
      },
    });

    // Grant permissions to Action Group Lambda
    table.grantReadWriteData(this.actionGroupFunction);
    eventBus.grantPutEventsTo(this.actionGroupFunction);
    twilioSecret.grantRead(this.actionGroupFunction);

    // Create IAM role for Bedrock Agent
    const agentRole = new Role(this, 'BedrockAgentRole', {
      roleName: `${config.resourcePrefix}-bedrock-agent-role`,
      assumedBy: new ServicePrincipal('bedrock.amazonaws.com'),
      description: 'IAM role for VyaparGyan Bedrock Agent',
    });

    // Grant agent permission to invoke Action Group Lambda
    this.actionGroupFunction.grantInvoke(agentRole);

    // Grant agent permission to invoke foundation models
    agentRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          // Amazon Nova Lite model (native Amazon model, no Marketplace subscription required)
          `arn:aws:bedrock:${config.region}::foundation-model/amazon.nova-lite-v1:0`,
        ],
      })
    );

    /* KNOWLEDGE BASE TEMPORARILY DISABLED
     * The Knowledge Base requires a vector index to be created in OpenSearch Serverless
     * before the Knowledge Base resource can be created. This is a manual step that needs
     * to be done via the OpenSearch API after the collection is created.
     * 
     * To enable Knowledge Base:
     * 1. Create the AOSS collection (done below)
     * 2. Manually create the vector index via OpenSearch API
     * 3. Uncomment the Knowledge Base resource
     * 4. Re-deploy
     *
    // Create IAM role for Knowledge Base
    const knowledgeBaseRole = new Role(this, 'KnowledgeBaseRole', {
      roleName: `${config.resourcePrefix}-kb-role`,
      assumedBy: new ServicePrincipal('bedrock.amazonaws.com'),
      description: 'IAM role for VyaparGyan Bedrock Knowledge Base',
    });

    // Grant Knowledge Base permission to read from S3
    documentsBucket.grantRead(knowledgeBaseRole);

    // Grant Knowledge Base permission to use embedding models
    knowledgeBaseRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${config.region}::foundation-model/amazon.titan-embed-text-v1`,
        ],
      })
    );

    // Grant Knowledge Base permission to access OpenSearch Serverless
    knowledgeBaseRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: [`arn:aws:aoss:${config.region}:${config.account}:collection/*`],
      })
    );

    // Create OpenSearch Serverless Encryption Policy
    const encryptionPolicy = new cdk.CfnResource(this, 'AOSSEncryptionPolicy', {
      type: 'AWS::OpenSearchServerless::SecurityPolicy',
      properties: {
        Name: `${config.resourcePrefix}-kb-encryption`,
        Type: 'encryption',
        Policy: JSON.stringify({
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${config.resourcePrefix}-kb-collection`],
            },
          ],
          AWSOwnedKey: true,
        }),
      },
    });

    // Create OpenSearch Serverless Network Policy
    const networkPolicy = new cdk.CfnResource(this, 'AOSSNetworkPolicy', {
      type: 'AWS::OpenSearchServerless::SecurityPolicy',
      properties: {
        Name: `${config.resourcePrefix}-kb-network`,
        Type: 'network',
        Policy: JSON.stringify([
          {
            Rules: [
              {
                ResourceType: 'collection',
                Resource: [`collection/${config.resourcePrefix}-kb-collection`],
              },
              {
                ResourceType: 'dashboard',
                Resource: [`collection/${config.resourcePrefix}-kb-collection`],
              },
            ],
            AllowFromPublic: true,
          },
        ]),
      },
    });

    // Create OpenSearch Serverless Collection
    this.aossCollection = new cdk.CfnResource(this, 'AOSSCollection', {
      type: 'AWS::OpenSearchServerless::Collection',
      properties: {
        Name: `${config.resourcePrefix}-kb-collection`,
        Type: 'VECTORSEARCH',
        Description: 'Vector search collection for VyaparGyan Knowledge Base',
      },
    });

    this.aossCollection.addDependency(encryptionPolicy);
    this.aossCollection.addDependency(networkPolicy);

    // CRITICAL FIX: Create OpenSearch Serverless Data Access Policy
    // This policy MUST include both the Knowledge Base role AND the deployment user
    const dataAccessPolicy = new cdk.CfnResource(this, 'AOSSDataAccessPolicy', {
      type: 'AWS::OpenSearchServerless::AccessPolicy',
      properties: {
        Name: `${config.resourcePrefix}-kb-data-access`,
        Type: 'data',
        Policy: JSON.stringify([
          {
            Rules: [
              {
                ResourceType: 'collection',
                Resource: [`collection/${config.resourcePrefix}-kb-collection`],
                Permission: [
                  'aoss:CreateCollectionItems',
                  'aoss:DeleteCollectionItems',
                  'aoss:UpdateCollectionItems',
                  'aoss:DescribeCollectionItems',
                ],
              },
              {
                ResourceType: 'index',
                Resource: [`index/${config.resourcePrefix}-kb-collection/*`],
                Permission: [
                  'aoss:CreateIndex',
                  'aoss:DeleteIndex',
                  'aoss:UpdateIndex',
                  'aoss:DescribeIndex',
                  'aoss:ReadDocument',
                  'aoss:WriteDocument',
                ],
              },
            ],
            Principal: [
              knowledgeBaseRole.roleArn,
              // CRITICAL: Include deployment user ARN to prevent 403 errors
              'arn:aws:iam::856888988795:user/kiro-mcp-agent',
            ],
          },
        ]),
      },
    });

    dataAccessPolicy.addDependency(this.aossCollection);
    */
    // Load OpenAPI schema for Action Group
    const openApiSchemaPath = path.join(
      __dirname,
      '../../../../docs/bedrock-catalog-action-group.json'
    );
    const openApiSchema = fs.readFileSync(openApiSchemaPath, 'utf-8');

    /* KNOWLEDGE BASE TEMPORARILY DISABLED - See comment above
    // Create Bedrock Knowledge Base
    this.knowledgeBase = new cdk.CfnResource(this, 'KnowledgeBase', {
      type: 'AWS::Bedrock::KnowledgeBase',
      properties: {
        Name: `${config.resourcePrefix}-knowledge-base`,
        Description: 'VyaparGyan platform documentation and product knowledge',
        RoleArn: knowledgeBaseRole.roleArn,
        KnowledgeBaseConfiguration: {
          Type: 'VECTOR',
          VectorKnowledgeBaseConfiguration: {
            EmbeddingModelArn: `arn:aws:bedrock:${config.region}::foundation-model/amazon.titan-embed-text-v1`,
          },
        },
        StorageConfiguration: {
          Type: 'OPENSEARCH_SERVERLESS',
          OpensearchServerlessConfiguration: {
            CollectionArn: this.aossCollection.getAtt('Arn').toString(),
            VectorIndexName: 'vyapargyan-index',
            FieldMapping: {
              VectorField: 'embedding',
              TextField: 'text',
              MetadataField: 'metadata',
            },
          },
        },
      },
    });

    // Knowledge Base depends on AOSS collection and data access policy
    this.knowledgeBase.addDependency(this.aossCollection);
    this.knowledgeBase.addDependency(dataAccessPolicy);

    // Create S3 Data Source for Knowledge Base
    const dataSource = new cdk.CfnResource(this, 'KnowledgeBaseDataSource', {
      type: 'AWS::Bedrock::DataSource',
      properties: {
        Name: `${config.resourcePrefix}-s3-docs`,
        Description: 'S3 data source for platform documentation',
        KnowledgeBaseId: this.knowledgeBase.ref,
        DataSourceConfiguration: {
          Type: 'S3',
          S3Configuration: {
            BucketArn: documentsBucket.bucketArn,
            InclusionPrefixes: ['docs/', 'knowledge-base/'],
          },
        },
      },
    });

    dataSource.addDependency(this.knowledgeBase);
    */
    // Create Bedrock Agent
    this.agent = new cdk.CfnResource(this, 'BedrockAgent', {
      type: 'AWS::Bedrock::Agent',
      properties: {
        AgentName: `${config.resourcePrefix}-ai-agent`,
        Description: 'VyaparGyan AI agent for inventory management, dynamic pricing, and customer engagement',
        AgentResourceRoleArn: agentRole.roleArn,
        FoundationModel: 'amazon.nova-lite-v1:0',
        Instruction: `You are an AI business manager for VyaparGyan, a multi-seller marketplace platform for local Indian retailers.

Your responsibilities:
1. Analyze seller inventory to identify dead stock (products older than 30 days with low sales)
2. Research market trends and recommend dynamic pricing (discounts or price increases)
3. Generate promotional WhatsApp messages for discount campaigns
4. Help sellers optimize inventory turnover and maximize revenue

Guidelines:
- Always verify product ownership before making changes
- Recommend discounts between 10-50% for dead stock
- Use market research to justify pricing recommendations
- Keep WhatsApp messages concise, friendly, and in Hindi/English mix (Hinglish)
- Include product details and urgency in promotional messages
- Respect seller preferences and wait for approval before executing changes

Available actions:
- Check inventory levels and stock age
- Apply discounts to products
- Send WhatsApp messages to customers
- Browse product catalog

Always explain your reasoning and provide data-driven recommendations.`,
        IdleSessionTTLInSeconds: 600,
        ActionGroups: [
          {
            ActionGroupName: 'inventory-management',
            Description: 'Manage inventory, pricing, and customer communications',
            ActionGroupExecutor: {
              Lambda: this.actionGroupFunction.functionArn,
            },
            ApiSchema: {
              Payload: openApiSchema,
            },
          },
        ],
        // KNOWLEDGE BASE TEMPORARILY DISABLED - Vector index must be created manually first
        // KnowledgeBases: [
        //   {
        //     KnowledgeBaseId: this.knowledgeBase.ref,
        //     Description: 'Platform documentation and product knowledge',
        //     KnowledgeBaseState: 'ENABLED',
        //   },
        // ],
      },
    });

    // KNOWLEDGE BASE TEMPORARILY DISABLED
    // this.agent.addDependency(this.knowledgeBase);
    // Create Agent Alias for stable endpoint
    const agentAlias = new cdk.CfnResource(this, 'BedrockAgentAlias', {
      type: 'AWS::Bedrock::AgentAlias',
      properties: {
        AgentId: this.agent.ref,
        AgentAliasName: config.environment,
        Description: `${config.environment} environment alias`,
      },
    });

    agentAlias.addDependency(this.agent);

    // Add environment-specific tags
    cdk.Tags.of(this.actionGroupFunction).add('Name', `${config.resourcePrefix}-bedrock-action-group`);
    cdk.Tags.of(this.actionGroupFunction).add('Service', 'bedrock');

    // Output Bedrock details
    new cdk.CfnOutput(this, 'BedrockAgentId', {
      value: this.agent.ref,
      description: 'Bedrock Agent ID',
      exportName: `${config.resourcePrefix}-bedrock-agent-id`,
    });

    new cdk.CfnOutput(this, 'BedrockAgentAliasId', {
      value: agentAlias.ref,
      description: 'Bedrock Agent Alias ID',
      exportName: `${config.resourcePrefix}-bedrock-agent-alias-id`,
    });

    new cdk.CfnOutput(this, 'ActionGroupFunctionArn', {
      value: this.actionGroupFunction.functionArn,
      description: 'Action Group Lambda Function ARN',
      exportName: `${config.resourcePrefix}-action-group-function-arn`,
    });

    /* KNOWLEDGE BASE TEMPORARILY DISABLED
    new cdk.CfnOutput(this, 'KnowledgeBaseId', {
      value: this.knowledgeBase.ref,
      description: 'Bedrock Knowledge Base ID',
      exportName: `${config.resourcePrefix}-knowledge-base-id`,
    });

    new cdk.CfnOutput(this, 'AOSSCollectionEndpoint', {
      value: this.aossCollection.getAtt('CollectionEndpoint').toString(),
      description: 'OpenSearch Serverless Collection Endpoint',
    });
    */
  }
}
