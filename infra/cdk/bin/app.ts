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
import { BedrockStack } from '../lib/stacks/bedrock-stack';

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

// 2. Storage Stack (depends on Database for inventory upload Lambda)
const storageStack = new StorageStack(app, `${config.resourcePrefix}-storage`, {
  config,
  table: databaseStack.table,
  env: {
    account,
    region,
  },
  description: `Storage infrastructure for VyaparGyan ${environment} environment`,
});

storageStack.addDependency(databaseStack);
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

// 4. Events Stack (depends on Database, Auth, and Storage)
const eventsStack = new EventsStack(app, `${config.resourcePrefix}-events`, {
  config,
  table: databaseStack.table,
  userPool: authStack.userPool,
  userPoolClientId: authStack.apiServiceClient.userPoolClientId,
  documentsBucket: storageStack.documentsBucket,
  productImagesBucket: storageStack.productImagesBucket,
  env: {
    account,
    region,
  },
  description: `Event processing infrastructure for VyaparGyan ${environment} environment`,
});

eventsStack.addDependency(databaseStack);
eventsStack.addDependency(authStack);
eventsStack.addDependency(storageStack);
console.log(`EventsStack instantiated: ${eventsStack.stackName}`);

// 5. API Stack (depends on Database, Auth, Events, and Storage)
const apiStack = new APIStack(app, `${config.resourcePrefix}-api`, {
  config,
  table: databaseStack.table,
  userPool: authStack.userPool,
  userPoolClientId: authStack.apiServiceClient.userPoolClientId,
  userPoolClients: [authStack.webAdminClient, authStack.webSellerClient, authStack.apiServiceClient],
  eventBus: eventsStack.eventBus,
  documentsBucket: storageStack.documentsBucket,
  productImagesBucket: storageStack.productImagesBucket,
  mediaProcessingQueue: eventsStack.mediaProcessingQueue,
  mediaProcessingDLQ: eventsStack.mediaProcessingDLQ,
  env: {
    account,
    region,
  },
  description: `API infrastructure for VyaparGyan ${environment} environment`,
});

apiStack.addDependency(databaseStack);
apiStack.addDependency(authStack);
apiStack.addDependency(eventsStack);
apiStack.addDependency(storageStack);
console.log(`APIStack instantiated: ${apiStack.stackName}`);

// Add API_BASE_URL to events-stack workers that send Twilio messages
// (cross-stack reference — events-stack is created before api-stack)
eventsStack.whatsappWorkerFunction.addEnvironment('API_BASE_URL', apiStack.httpApi.apiEndpoint);
eventsStack.campaignWorkerFunction.addEnvironment('API_BASE_URL', apiStack.httpApi.apiEndpoint);

// 6. Bedrock Stack (depends on Database, Events, and Storage)
const bedrockStack = new BedrockStack(app, `${config.resourcePrefix}-bedrock`, {
  config,
  table: databaseStack.table,
  eventBus: eventsStack.eventBus,
  documentsBucket: storageStack.documentsBucket,
  env: {
    account,
    region,
  },
  description: `Bedrock AI infrastructure for VyaparGyan ${environment} environment`,
});

bedrockStack.addDependency(databaseStack);
bedrockStack.addDependency(eventsStack);
bedrockStack.addDependency(storageStack);
console.log(`BedrockStack instantiated: ${bedrockStack.stackName}`);

// Add API_BASE_URL to Bedrock action group function (sends Twilio messages)
bedrockStack.actionGroupFunction.addEnvironment('API_BASE_URL', apiStack.httpApi.apiEndpoint);

// Add tags to all resources from configuration
Object.entries(config.tags).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});

app.synth();
