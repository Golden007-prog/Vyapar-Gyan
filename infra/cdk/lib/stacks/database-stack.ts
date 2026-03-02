/**
 * Database Stack
 * 
 * Creates the core DynamoDB table using single-table design pattern.
 * The table stores all entities (users, products, orders, sessions, payments)
 * with access patterns supported by Global Secondary Indexes (GSIs).
 * 
 * Configuration is environment-specific:
 * - Dev: On-demand billing, no PITR, no deletion protection
 * - Staging: On-demand billing, PITR enabled, deletion protection enabled
 * - Prod: Provisioned billing (if configured), PITR enabled, deletion protection enabled
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
  StreamViewType,
} from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';
import { EnvironmentConfig } from '../config';

/**
 * Properties for DatabaseStack
 */
export interface DatabaseStackProps extends cdk.StackProps {
  /** Environment-specific configuration */
  config: EnvironmentConfig;
}

/**
 * DatabaseStack creates the core DynamoDB table with single-table design
 */
export class DatabaseStack extends cdk.Stack {
  /** The main DynamoDB table */
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Create the main table with single-table design
    this.table = new Table(this, 'MainTable', {
      tableName: `${config.resourcePrefix}-main`,
      
      // Primary key: PK (Partition Key) and SK (Sort Key)
      partitionKey: {
        name: 'PK',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: AttributeType.STRING,
      },
      
      // Billing mode: on-demand for dev/staging, can be provisioned for prod
      billingMode: config.dynamodb.billingMode,
      
      // Read/write capacity (only used if billing mode is PROVISIONED)
      ...(config.dynamodb.billingMode === BillingMode.PROVISIONED && {
        readCapacity: config.dynamodb.readCapacity,
        writeCapacity: config.dynamodb.writeCapacity,
      }),
      
      // Point-in-time recovery: disabled for dev, enabled for staging/prod
      pointInTimeRecovery: config.dynamodb.pointInTimeRecovery,
      
      // Deletion protection: disabled for dev, enabled for staging/prod
      deletionProtection: config.dynamodb.deletionProtection,
      
      // Encryption: AWS managed keys (default)
      // CDK automatically enables encryption with AWS managed keys
      
      // DynamoDB Streams: enable for event-driven patterns
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      
      // Time to Live: enable for automatic expiration of items
      timeToLiveAttribute: 'expiresAt',
      
      // Removal policy: retain for prod, destroy for dev
      removalPolicy: config.environment === 'prod' 
        ? RemovalPolicy.RETAIN 
        : RemovalPolicy.DESTROY,
    });

    // GSI1: For role-based queries, seller queries, customer queries
    // Access patterns:
    // - List users by role (GSI1PK = ROLE#{role}, GSI1SK = USER#{userId})
    // - List products by seller (GSI1PK = SELLER#{sellerId}, GSI1SK = PRODUCT#{productId})
    // - List orders by customer (GSI1PK = CUSTOMER#{customerId}, GSI1SK = ORDER#{orderId}#{timestamp})
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'GSI1PK',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI1SK',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
      
      // Read/write capacity for GSI (only used if billing mode is PROVISIONED)
      ...(config.dynamodb.billingMode === BillingMode.PROVISIONED && {
        readCapacity: config.dynamodb.readCapacity,
        writeCapacity: config.dynamodb.writeCapacity,
      }),
    });

    // GSI2: For email lookups, category queries, seller queries
    // Access patterns:
    // - Find user by email (GSI2PK = EMAIL#{email}, GSI2SK = USER#{userId})
    // - List products by category (GSI2PK = CATEGORY#{categoryId}, GSI2SK = PRODUCT#{productId})
    // - List orders by seller (GSI2PK = SELLER#{sellerId}, GSI2SK = ORDER#{orderId}#{timestamp})
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: {
        name: 'GSI2PK',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI2SK',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
      
      // Read/write capacity for GSI (only used if billing mode is PROVISIONED)
      ...(config.dynamodb.billingMode === BillingMode.PROVISIONED && {
        readCapacity: config.dynamodb.readCapacity,
        writeCapacity: config.dynamodb.writeCapacity,
      }),
    });

    // GSI3: For additional access patterns (future use)
    // Access patterns:
    // - Payment lookups by order (GSI3PK = ORDER#{orderId}, GSI3SK = PAYMENT#{paymentId})
    // - Status-based queries (GSI3PK = STATUS#{status}, GSI3SK = ENTITY#{id})
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: {
        name: 'GSI3PK',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI3SK',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
      
      // Read/write capacity for GSI (only used if billing mode is PROVISIONED)
      ...(config.dynamodb.billingMode === BillingMode.PROVISIONED && {
        readCapacity: config.dynamodb.readCapacity,
        writeCapacity: config.dynamodb.writeCapacity,
      }),
    });

    // PhoneIndex: For WhatsApp session lookup by phone number
    // Access patterns:
    // - Find session by phone number (phoneNumber = 919876543210, channelType = whatsapp)
    this.table.addGlobalSecondaryIndex({
      indexName: 'PhoneIndex',
      partitionKey: {
        name: 'phoneNumber',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'channelType',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
      
      // Read/write capacity for GSI (only used if billing mode is PROVISIONED)
      ...(config.dynamodb.billingMode === BillingMode.PROVISIONED && {
        readCapacity: config.dynamodb.readCapacity,
        writeCapacity: config.dynamodb.writeCapacity,
      }),
    });

    // TODO: Add remaining GSIs one at a time (DynamoDB limitation)
    // Uncomment and deploy incrementally:
    
    // CategoryIndex: For listing products by category
    this.table.addGlobalSecondaryIndex({
      indexName: 'CategoryIndex',
      partitionKey: { name: 'categoryId', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
      ...(config.dynamodb.billingMode === BillingMode.PROVISIONED && {
        readCapacity: config.dynamodb.readCapacity,
        writeCapacity: config.dynamodb.writeCapacity,
      }),
    });

    // SellerStockIndex: For AI dead-stock detection
    this.table.addGlobalSecondaryIndex({
      indexName: 'SellerStockIndex',
      partitionKey: { name: 'sellerId', type: AttributeType.STRING },
      sortKey: { name: 'stockAddedDate', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
      ...(config.dynamodb.billingMode === BillingMode.PROVISIONED && {
        readCapacity: config.dynamodb.readCapacity,
        writeCapacity: config.dynamodb.writeCapacity,
      }),
    });

    // SellerOrdersIndex: For listing orders by seller
    this.table.addGlobalSecondaryIndex({
      indexName: 'SellerOrdersIndex',
      partitionKey: { name: 'sellerId', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
      ...(config.dynamodb.billingMode === BillingMode.PROVISIONED && {
        readCapacity: config.dynamodb.readCapacity,
        writeCapacity: config.dynamodb.writeCapacity,
      }),
    });

    // CustomerOrdersIndex: For listing orders by customer
    this.table.addGlobalSecondaryIndex({
      indexName: 'CustomerOrdersIndex',
      partitionKey: { name: 'customerId', type: AttributeType.STRING },
      sortKey: { name: 'createdAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
      ...(config.dynamodb.billingMode === BillingMode.PROVISIONED && {
        readCapacity: config.dynamodb.readCapacity,
        writeCapacity: config.dynamodb.writeCapacity,
      }),
    });

    // Add environment-specific tags
    cdk.Tags.of(this.table).add('Name', `${config.resourcePrefix}-main-table`);
    cdk.Tags.of(this.table).add('Service', 'database');
    
    // Output the table name and ARN for reference by other stacks
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name',
      exportName: `${config.resourcePrefix}-table-name`,
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: 'DynamoDB table ARN',
      exportName: `${config.resourcePrefix}-table-arn`,
    });

    new cdk.CfnOutput(this, 'TableStreamArn', {
      value: this.table.tableStreamArn || 'N/A',
      description: 'DynamoDB table stream ARN',
      exportName: `${config.resourcePrefix}-table-stream-arn`,
    });
  }
}
