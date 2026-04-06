/**
 * Search Stack
 *
 * Provisions OpenSearch Serverless collection, OSIS zero-ETL pipeline,
 * S3 export bucket, IAM roles, and supporting policies for full-text
 * product and seller search.
 *
 * The OSIS pipeline reads DynamoDB Streams (ongoing) and PITR export
 * (initial backfill) and routes product/seller records into separate
 * OpenSearch indexes. All other entity types are discarded.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
} from 'aws-cdk-lib/aws-s3';
import {
  Role,
  ServicePrincipal,
  PolicyStatement,
  Effect,
  ManagedPolicy,
} from 'aws-cdk-lib/aws-iam';
import {
  CfnCollection,
  CfnSecurityPolicy,
  CfnAccessPolicy,
} from 'aws-cdk-lib/aws-opensearchserverless';
import { CfnPipeline } from 'aws-cdk-lib/aws-osis';
import { Function, Runtime, Code, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { EnvironmentConfig } from '../config';

/**
 * Properties for SearchStack
 */
export interface SearchStackProps extends cdk.StackProps {
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** DynamoDB main table from DatabaseStack */
  table: Table;
}

/**
 * SearchStack provisions OpenSearch Serverless infrastructure and the
 * zero-ETL ingestion pipeline for product/seller search.
 */
export class SearchStack extends cdk.Stack {
  /** OpenSearch Serverless collection */
  public readonly collection: CfnCollection;
  /** S3 bucket for PITR export and dead-letter records */
  public readonly exportBucket: Bucket;
  /** OSIS ingestion pipeline */
  public readonly pipeline: CfnPipeline;
  /** IAM role assumed by the OSIS pipeline */
  public readonly pipelineRole: Role;
  /** IAM role for Search Lambda (OpenSearch read) */
  public readonly searchLambdaRole: Role;
  /** Search Lambda function */
  public readonly searchFunction: Function;
  /** Autocomplete Lambda function */
  public readonly autocompleteFunction: Function;

  constructor(scope: Construct, id: string, props: SearchStackProps) {
    super(scope, id, props);

    const { config, table } = props;
    const collectionName = `${config.resourcePrefix}-products`;

    // ========================================================================
    // 1. Enable PITR on the DynamoDB main table via escape hatch
    // ========================================================================
    const cfnTable = table.node.defaultChild as cdk.aws_dynamodb.CfnTable;
    cfnTable.addPropertyOverride('PointInTimeRecoverySpecification', {
      PointInTimeRecoveryEnabled: true,
    });

    // DynamoDB Streams is already configured with NEW_AND_OLD_IMAGES in database-stack.ts

    // ========================================================================
    // 2. S3 export bucket for PITR export data and dead-letter records
    // ========================================================================
    this.exportBucket = new Bucket(this, 'ExportBucket', {
      bucketName: `${config.resourcePrefix}-search-export`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: config.environment === 'prod'
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.DESTROY,
      autoDeleteObjects: config.environment !== 'prod',
      lifecycleRules: [
        {
          id: 'expire-export-data',
          expiration: cdk.Duration.days(30),
          enabled: true,
        },
      ],
    });

    // ========================================================================
    // 3. IAM roles
    // ========================================================================

    // 3a. OSIS pipeline role — DynamoDB read, S3 read/write, OpenSearch write
    this.pipelineRole = new Role(this, 'OsisPipelineRole', {
      roleName: `${config.resourcePrefix}-osis-pipeline`,
      assumedBy: new ServicePrincipal('osis-pipelines.amazonaws.com'),
    });

    // DynamoDB read permissions for streams + table export
    this.pipelineRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:DescribeTable',
          'dynamodb:DescribeContinuousBackups',
          'dynamodb:ExportTableToPointInTime',
          'dynamodb:DescribeExport',
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
        ],
        resources: [
          table.tableArn,
          `${table.tableArn}/stream/*`,
          `${table.tableArn}/export/*`,
        ],
      }),
    );

    // S3 read/write for PITR export and dead-letter
    this.pipelineRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
          's3:GetBucketLocation',
          's3:AbortMultipartUpload',
        ],
        resources: [
          this.exportBucket.bucketArn,
          `${this.exportBucket.bucketArn}/*`,
        ],
      }),
    );

    // OpenSearch Serverless write (API-level permissions)
    this.pipelineRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['aoss:BatchGetCollection'],
        resources: ['*'],
      }),
    );

    // 3b. Search Lambda role — OpenSearch read
    this.searchLambdaRole = new Role(this, 'SearchLambdaRole', {
      roleName: `${config.resourcePrefix}-search-lambda`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // OpenSearch Serverless API-level permissions for Lambda
    this.searchLambdaRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['aoss:APIAccessAll'],
        resources: ['*'],
      }),
    );

    // ========================================================================
    // 4. OpenSearch Serverless encryption policy (must be created BEFORE collection)
    // ========================================================================
    const encryptionPolicy = new CfnSecurityPolicy(this, 'EncryptionPolicy', {
      name: `${config.resourcePrefix}-enc`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${collectionName}`],
          },
        ],
        AWSOwnedKey: true,
      }),
    });

    // ========================================================================
    // 5. OpenSearch Serverless network policy (must be created BEFORE collection)
    // ========================================================================
    const networkPolicy = new CfnSecurityPolicy(this, 'NetworkPolicy', {
      name: `${config.resourcePrefix}-net`,
      type: 'network',
      policy: JSON.stringify([
        {
          Description: 'Allow access from Lambda and OSIS pipeline roles',
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
            },
            {
              ResourceType: 'dashboard',
              Resource: [`collection/${collectionName}`],
            },
          ],
          AllowFromPublic: true,
        },
      ]),
    });

    // ========================================================================
    // 6. OpenSearch Serverless collection (type: SEARCH)
    // ========================================================================
    this.collection = new CfnCollection(this, 'SearchCollection', {
      name: collectionName,
      type: 'SEARCH',
      description: `Product and seller search collection for ${config.environment}`,
    });

    // Collection depends on encryption and network policies
    this.collection.addDependency(encryptionPolicy);
    this.collection.addDependency(networkPolicy);

    // ========================================================================
    // 7. Data access policies
    // ========================================================================

    // 7a. Read access policy — Search Lambda role
    new CfnAccessPolicy(this, 'ReadAccessPolicy', {
      name: `${config.resourcePrefix}-read`,
      type: 'data',
      policy: JSON.stringify([
        {
          Description: 'Search Lambda read access',
          Rules: [
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:ReadDocument',
                'aoss:DescribeIndex',
              ],
            },
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:DescribeCollectionItems',
              ],
            },
          ],
          Principal: [this.searchLambdaRole.roleArn],
        },
      ]),
    });

    // 7b. Write access policy — OSIS pipeline role
    new CfnAccessPolicy(this, 'WriteAccessPolicy', {
      name: `${config.resourcePrefix}-write`,
      type: 'data',
      policy: JSON.stringify([
        {
          Description: 'OSIS pipeline write access',
          Rules: [
            {
              ResourceType: 'index',
              Resource: [`index/${collectionName}/*`],
              Permission: [
                'aoss:WriteDocument',
                'aoss:CreateIndex',
                'aoss:UpdateIndex',
              ],
            },
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
              Permission: [
                'aoss:DescribeCollectionItems',
                'aoss:CreateCollectionItems',
                'aoss:UpdateCollectionItems',
              ],
            },
          ],
          Principal: [this.pipelineRole.roleArn],
        },
      ]),
    });

    // ========================================================================
    // 8. Search and Autocomplete Lambda functions
    // ========================================================================

    this.searchFunction = new Function(this, 'SearchFunction', {
      functionName: `${config.resourcePrefix}-search`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/catalog/search-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      role: this.searchLambdaRole,
      environment: {
        ENVIRONMENT: config.environment,
        OPENSEARCH_ENDPOINT: this.collection.attrCollectionEndpoint,
        TABLE_NAME: table.tableName,
        LOG_LEVEL: 'info',
      },
    });

    this.autocompleteFunction = new Function(this, 'AutocompleteFunction', {
      functionName: `${config.resourcePrefix}-autocomplete`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/catalog/autocomplete-handler.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(10),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      role: this.searchLambdaRole,
      environment: {
        ENVIRONMENT: config.environment,
        OPENSEARCH_ENDPOINT: this.collection.attrCollectionEndpoint,
        LOG_LEVEL: 'info',
      },
    });

    // ========================================================================
    // 8b. API Gateway routes are added in app.ts to avoid circular dependencies
    // ========================================================================

    // ========================================================================
    // 9. OSIS Pipeline — DynamoDB source → OpenSearch sink
    // ========================================================================
    const pipelineName = `${config.resourcePrefix}-search`.replace(/[^a-z0-9-]/g, '-');

    // Use Fn.sub to inject the collection endpoint at deploy time
    const collectionEndpointRef = this.collection.attrCollectionEndpoint;

    const pipelineConfig = cdk.Fn.sub([
      'version: "2"\n',
      'dynamodb-pipeline:\n',
      '  source:\n',
      '    dynamodb:\n',
      '      acknowledgments: true\n',
      '      tables:\n',
      '        - table_arn: "${TableArn}"\n',
      '          stream:\n',
      '            start_position: "LATEST"\n',
      '          export:\n',
      '            s3_bucket: "${ExportBucket}"\n',
      '            s3_region: "${Region}"\n',
      '            s3_prefix: "ddb-export/"\n',
      '      aws:\n',
      '        sts_role_arn: "${PipelineRoleArn}"\n',
      '        region: "${Region}"\n',
      '  route:\n',
      '    - products: \'/PK startsWith "SELLER#" and SK startsWith "PRODUCT#"\'\n',
      '    - sellers: \'/PK startsWith "SELLER#" and SK == "PROFILE"\'\n',
      '  sink:\n',
      '    - opensearch:\n',
      '        hosts:\n',
      '          - "https://${CollectionEndpoint}"\n',
      '        index: "products"\n',
      '        routes:\n',
      '          - products\n',
      '        aws:\n',
      '          sts_role_arn: "${PipelineRoleArn}"\n',
      '          region: "${Region}"\n',
      '          serverless: true\n',
      '    - opensearch:\n',
      '        hosts:\n',
      '          - "https://${CollectionEndpoint}"\n',
      '        index: "sellers"\n',
      '        routes:\n',
      '          - sellers\n',
      '        aws:\n',
      '          sts_role_arn: "${PipelineRoleArn}"\n',
      '          region: "${Region}"\n',
      '          serverless: true\n',
      '    - s3:\n',
      '        bucket: "${ExportBucket}"\n',
      '        region: "${Region}"\n',
      '        sts_role_arn: "${PipelineRoleArn}"\n',
      '        threshold:\n',
      '          event_collect_timeout: "60s"\n',
      '        codec:\n',
      '          json: null\n',
      '        key_path_prefix: "dlq/"\n',
      '        aws:\n',
      '          sts_role_arn: "${PipelineRoleArn}"\n',
      '          region: "${Region}"\n',
    ].join(''), {
      TableArn: table.tableArn,
      ExportBucket: this.exportBucket.bucketName,
      Region: config.region,
      PipelineRoleArn: this.pipelineRole.roleArn,
      CollectionEndpoint: collectionEndpointRef,
    });

    this.pipeline = new CfnPipeline(this, 'SearchPipeline', {
      pipelineName,
      minUnits: 1,
      maxUnits: 4,
      pipelineConfigurationBody: pipelineConfig,
      logPublishingOptions: {
        isLoggingEnabled: true,
        cloudWatchLogDestination: {
          logGroup: `/aws/vendedlogs/osis/${pipelineName}`,
        },
      },
    });

    // Pipeline depends on collection, access policies, and roles
    this.pipeline.addDependency(this.collection);
    this.pipeline.node.addDependency(this.pipelineRole);
    this.pipeline.node.addDependency(this.exportBucket);

    // ========================================================================
    // 10. CloudFormation outputs
    // ========================================================================
    new cdk.CfnOutput(this, 'CollectionEndpoint', {
      value: this.collection.attrCollectionEndpoint,
      description: 'OpenSearch Serverless collection endpoint',
      exportName: `${config.resourcePrefix}-search-endpoint`,
    });

    new cdk.CfnOutput(this, 'CollectionArn', {
      value: this.collection.attrArn,
      description: 'OpenSearch Serverless collection ARN',
      exportName: `${config.resourcePrefix}-search-collection-arn`,
    });

    new cdk.CfnOutput(this, 'ExportBucketName', {
      value: this.exportBucket.bucketName,
      description: 'S3 bucket for PITR export and DLQ',
      exportName: `${config.resourcePrefix}-search-export-bucket`,
    });

    new cdk.CfnOutput(this, 'PipelineName', {
      value: this.pipeline.pipelineName!,
      description: 'OSIS pipeline name',
      exportName: `${config.resourcePrefix}-search-pipeline-name`,
    });

    new cdk.CfnOutput(this, 'SearchLambdaRoleArn', {
      value: this.searchLambdaRole.roleArn,
      description: 'IAM role ARN for Search Lambda functions',
      exportName: `${config.resourcePrefix}-search-lambda-role-arn`,
    });

    // Add environment-specific tags
    cdk.Tags.of(this).add('Service', 'search');
    cdk.Tags.of(this).add('Name', `${config.resourcePrefix}-search`);
  }
}
