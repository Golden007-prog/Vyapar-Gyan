/**
 * Storage Stack
 * 
 * Creates S3 buckets for storing product images, seller verification documents,
 * and application logs. Each bucket has appropriate lifecycle policies, encryption,
 * and access controls based on the environment configuration.
 * 
 * Configuration is environment-specific:
 * - Dev: No versioning, short lifecycle, no access logging
 * - Staging: Versioning enabled, moderate lifecycle, access logging enabled
 * - Prod: Versioning enabled, long lifecycle, access logging enabled
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
  LifecycleRule,
  StorageClass,
} from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';
import { EnvironmentConfig } from '../config';

/**
 * Properties for StorageStack
 */
export interface StorageStackProps extends cdk.StackProps {
  /** Environment-specific configuration */
  config: EnvironmentConfig;
}

/**
 * StorageStack creates S3 buckets for product images, documents, and logs
 */
export class StorageStack extends cdk.Stack {
  /** Product images bucket */
  public readonly productImagesBucket: Bucket;
  
  /** Seller verification documents bucket */
  public readonly documentsBucket: Bucket;
  
  /** Application logs bucket */
  public readonly logsBucket: Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Create logs bucket first (used for access logging by other buckets)
    this.logsBucket = new Bucket(this, 'LogsBucket', {
      bucketName: `${config.resourcePrefix}-logs`,
      
      // Encryption: AWS managed keys (AES-256)
      encryption: BucketEncryption.S3_MANAGED,
      
      // Block all public access
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      
      // Versioning: disabled for logs bucket to save costs
      versioned: false,
      
      // Lifecycle rules for logs
      lifecycleRules: this.createLogsLifecycleRules(config),
      
      // Removal policy: retain for prod, destroy for dev
      removalPolicy: config.environment === 'prod' 
        ? RemovalPolicy.RETAIN 
        : RemovalPolicy.DESTROY,
      
      // Auto-delete objects on stack deletion (only for dev)
      autoDeleteObjects: config.environment === 'dev',
    });

    // Create product images bucket
    this.productImagesBucket = new Bucket(this, 'ProductImagesBucket', {
      bucketName: `${config.resourcePrefix}-product-images`,
      
      // Encryption: AWS managed keys (AES-256)
      encryption: BucketEncryption.S3_MANAGED,
      
      // Block all public access by default
      // Note: CloudFront will access via OAI (Origin Access Identity)
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      
      // Versioning: environment-specific
      versioned: config.s3.versioning,
      
      // Lifecycle rules for images
      lifecycleRules: this.createImagesLifecycleRules(config),
      
      // Access logging: environment-specific
      ...(config.s3.accessLogging && {
        serverAccessLogsBucket: this.logsBucket,
        serverAccessLogsPrefix: 'product-images/',
      }),
      
      // Removal policy: retain for prod, destroy for dev
      removalPolicy: config.environment === 'prod' 
        ? RemovalPolicy.RETAIN 
        : RemovalPolicy.DESTROY,
      
      // Auto-delete objects on stack deletion (only for dev)
      autoDeleteObjects: config.environment === 'dev',
    });

    // Create documents bucket for seller verification
    this.documentsBucket = new Bucket(this, 'DocumentsBucket', {
      bucketName: `${config.resourcePrefix}-documents`,
      
      // Encryption: AWS managed keys (AES-256)
      encryption: BucketEncryption.S3_MANAGED,
      
      // Block all public access
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      
      // Versioning: always enabled for documents (compliance)
      versioned: true,
      
      // Lifecycle rules for documents
      lifecycleRules: this.createDocumentsLifecycleRules(config),
      
      // Access logging: environment-specific
      ...(config.s3.accessLogging && {
        serverAccessLogsBucket: this.logsBucket,
        serverAccessLogsPrefix: 'documents/',
      }),
      
      // Removal policy: always retain documents
      removalPolicy: RemovalPolicy.RETAIN,
      
      // Never auto-delete documents
      autoDeleteObjects: false,
    });

    // Add environment-specific tags to all buckets
    this.addBucketTags(this.productImagesBucket, 'product-images', config);
    this.addBucketTags(this.documentsBucket, 'documents', config);
    this.addBucketTags(this.logsBucket, 'logs', config);

    // Output bucket names and ARNs for reference by other stacks
    new cdk.CfnOutput(this, 'ProductImagesBucketName', {
      value: this.productImagesBucket.bucketName,
      description: 'Product images S3 bucket name',
      exportName: `${config.resourcePrefix}-product-images-bucket-name`,
    });

    new cdk.CfnOutput(this, 'ProductImagesBucketArn', {
      value: this.productImagesBucket.bucketArn,
      description: 'Product images S3 bucket ARN',
      exportName: `${config.resourcePrefix}-product-images-bucket-arn`,
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: this.documentsBucket.bucketName,
      description: 'Documents S3 bucket name',
      exportName: `${config.resourcePrefix}-documents-bucket-name`,
    });

    new cdk.CfnOutput(this, 'DocumentsBucketArn', {
      value: this.documentsBucket.bucketArn,
      description: 'Documents S3 bucket ARN',
      exportName: `${config.resourcePrefix}-documents-bucket-arn`,
    });

    new cdk.CfnOutput(this, 'LogsBucketName', {
      value: this.logsBucket.bucketName,
      description: 'Logs S3 bucket name',
      exportName: `${config.resourcePrefix}-logs-bucket-name`,
    });

    new cdk.CfnOutput(this, 'LogsBucketArn', {
      value: this.logsBucket.bucketArn,
      description: 'Logs S3 bucket ARN',
      exportName: `${config.resourcePrefix}-logs-bucket-arn`,
    });
  }

  /**
   * Create lifecycle rules for product images bucket
   */
  private createImagesLifecycleRules(config: EnvironmentConfig): LifecycleRule[] {
    const rules: LifecycleRule[] = [];

    // Transition to Infrequent Access after configured days
    if (config.s3.lifecycleRules.transitionToIADays) {
      rules.push({
        id: 'transition-to-ia',
        enabled: true,
        transitions: [
          {
            storageClass: StorageClass.INFREQUENT_ACCESS,
            transitionAfter: cdk.Duration.days(config.s3.lifecycleRules.transitionToIADays),
          },
        ],
      });
    }

    // Transition to Glacier after configured days
    if (config.s3.lifecycleRules.transitionToGlacierDays) {
      rules.push({
        id: 'transition-to-glacier',
        enabled: true,
        transitions: [
          {
            storageClass: StorageClass.GLACIER,
            transitionAfter: cdk.Duration.days(config.s3.lifecycleRules.transitionToGlacierDays),
          },
        ],
      });
    }

    // Expire objects after configured days (only for dev)
    if (config.environment === 'dev' && config.s3.lifecycleRules.expirationDays) {
      rules.push({
        id: 'expire-old-images',
        enabled: true,
        expiration: cdk.Duration.days(config.s3.lifecycleRules.expirationDays),
      });
    }

    // Clean up incomplete multipart uploads after 7 days
    rules.push({
      id: 'abort-incomplete-multipart-uploads',
      enabled: true,
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
    });

    return rules;
  }

  /**
   * Create lifecycle rules for documents bucket
   */
  private createDocumentsLifecycleRules(config: EnvironmentConfig): LifecycleRule[] {
    const rules: LifecycleRule[] = [];

    // Transition to Infrequent Access after configured days
    if (config.s3.lifecycleRules.transitionToIADays) {
      rules.push({
        id: 'transition-to-ia',
        enabled: true,
        transitions: [
          {
            storageClass: StorageClass.INFREQUENT_ACCESS,
            transitionAfter: cdk.Duration.days(config.s3.lifecycleRules.transitionToIADays),
          },
        ],
      });
    }

    // Transition to Glacier after configured days (for compliance/archival)
    if (config.s3.lifecycleRules.transitionToGlacierDays) {
      rules.push({
        id: 'transition-to-glacier',
        enabled: true,
        transitions: [
          {
            storageClass: StorageClass.GLACIER,
            transitionAfter: cdk.Duration.days(config.s3.lifecycleRules.transitionToGlacierDays),
          },
        ],
      });
    }

    // Clean up incomplete multipart uploads after 7 days
    rules.push({
      id: 'abort-incomplete-multipart-uploads',
      enabled: true,
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
    });

    // Transition non-current versions to IA after 30 days
    if (config.s3.versioning) {
      rules.push({
        id: 'transition-noncurrent-versions',
        enabled: true,
        noncurrentVersionTransitions: [
          {
            storageClass: StorageClass.INFREQUENT_ACCESS,
            transitionAfter: cdk.Duration.days(30),
          },
        ],
      });
    }

    return rules;
  }

  /**
   * Create lifecycle rules for logs bucket
   */
  private createLogsLifecycleRules(config: EnvironmentConfig): LifecycleRule[] {
    const rules: LifecycleRule[] = [];

    // Expire logs based on environment
    const expirationDays = config.environment === 'prod' 
      ? 90  // Keep prod logs for 90 days
      : config.environment === 'staging'
      ? 30  // Keep staging logs for 30 days
      : 7;  // Keep dev logs for 7 days

    rules.push({
      id: 'expire-old-logs',
      enabled: true,
      expiration: cdk.Duration.days(expirationDays),
    });

    // Transition to IA after 7 days (for prod/staging)
    if (config.environment !== 'dev') {
      rules.push({
        id: 'transition-to-ia',
        enabled: true,
        transitions: [
          {
            storageClass: StorageClass.INFREQUENT_ACCESS,
            transitionAfter: cdk.Duration.days(7),
          },
        ],
      });
    }

    // Clean up incomplete multipart uploads after 1 day
    rules.push({
      id: 'abort-incomplete-multipart-uploads',
      enabled: true,
      abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
    });

    return rules;
  }

  /**
   * Add environment-specific tags to a bucket
   */
  private addBucketTags(bucket: Bucket, bucketType: string, config: EnvironmentConfig): void {
    cdk.Tags.of(bucket).add('Name', `${config.resourcePrefix}-${bucketType}`);
    cdk.Tags.of(bucket).add('Service', 'storage');
    cdk.Tags.of(bucket).add('BucketType', bucketType);
  }
}
