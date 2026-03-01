#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

/**
 * VyaparGyan CDK Application Entry Point
 * 
 * This is the main entry point for the AWS CDK infrastructure.
 * It initializes the CDK app and will instantiate stacks based on
 * environment configuration.
 * 
 * Environment-specific configuration is loaded from context variables
 * or environment variables to support dev, staging, and prod deployments.
 */

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev';

// Get AWS account and region from context or environment variables
const account = app.node.tryGetContext('account') || process.env.CDK_DEFAULT_ACCOUNT;
const region = app.node.tryGetContext('region') || process.env.CDK_DEFAULT_REGION || 'us-east-1';

// Validate required configuration
if (!account) {
  throw new Error('AWS account must be specified via context or CDK_DEFAULT_ACCOUNT environment variable');
}

// Log deployment configuration
console.log(`Deploying VyaparGyan infrastructure:`);
console.log(`  Environment: ${environment}`);
console.log(`  Account: ${account}`);
console.log(`  Region: ${region}`);

// Load environment-specific configuration
import { getEnvironmentConfig, validateConfig } from '../lib/config';

const config = getEnvironmentConfig(environment, account, region);

// Validate configuration
try {
  validateConfig(config);
} catch (error) {
  console.error('Configuration validation failed:', error);
  throw error;
}

console.log(`Configuration loaded successfully for ${environment} environment`);

// Import stacks
import { DatabaseStack } from '../lib/stacks/database-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { EventsStack } from '../lib/stacks/events-stack';
import { APIStack } from '../lib/stacks/api-stack';

// Instantiate stacks in dependency order

// 1. Database Stack
const databaseStack = new DatabaseStack(app, `${config.resourcePrefix}-database`, {
  config,
  env: {
    account,
    region,
  },
  description: `Database infrastructure for VyaparGyan ${environment} environment`,
});

console.log(`DatabaseStack instantiated: ${databaseStack.stackName}`);

// 2. Storage Stack
const storageStack = new StorageStack(app, `${config.resourcePrefix}-storage`, {
  config,
  env: {
    account,
    region,
  },
  description: `Storage infrastructure for VyaparGyan ${environment} environment`,
});

console.log(`StorageStack instantiated: ${storageStack.stackName}`);

// 3. Auth Stack
const authStack = new AuthStack(app, `${config.resourcePrefix}-auth`, {
  config,
  env: {
    account,
    region,
  },
  description: `Authentication infrastructure for VyaparGyan ${environment} environment`,
});

console.log(`AuthStack instantiated: ${authStack.stackName}`);

// 4. Events Stack (depends on Database)
const eventsStack = new EventsStack(app, `${config.resourcePrefix}-events`, {
  config,
  table: databaseStack.table,
  env: {
    account,
    region,
  },
  description: `Event processing infrastructure for VyaparGyan ${environment} environment`,
});

eventsStack.addDependency(databaseStack);
console.log(`EventsStack instantiated: ${eventsStack.stackName}`);

// 5. API Stack (depends on Database, Auth, and Events)
const apiStack = new APIStack(app, `${config.resourcePrefix}-api`, {
  config,
  table: databaseStack.table,
  userPool: authStack.userPool,
  eventBus: eventsStack.eventBus,
  env: {
    account,
    region,
  },
  description: `API infrastructure for VyaparGyan ${environment} environment`,
});

apiStack.addDependency(databaseStack);
apiStack.addDependency(authStack);
apiStack.addDependency(eventsStack);
console.log(`APIStack instantiated: ${apiStack.stackName}`);

// Add tags to all resources from configuration
Object.entries(config.tags).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});

app.synth();
