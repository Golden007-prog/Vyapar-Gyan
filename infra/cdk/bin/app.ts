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
// import { SearchStack } from '../lib/stacks/search-stack'; // TEMPORARILY DISABLED
import { WebSocketStack } from '../lib/stacks/websocket-stack';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';

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
  orderSchedulerRoleArn: eventsStack.orderSchedulerRole.roleArn,
  notificationRouterArn: eventsStack.notificationRouterFunction.functionArn,
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

// -----------------------------------------------------------------------
// Wire Order Nudge Scheduler — cross-stack env vars and IAM permissions
// The order scheduler service (in API Lambda handlers) needs:
//   SCHEDULER_ROLE_ARN — the role EventBridge Scheduler assumes to invoke notification router
//   NOTIFICATION_ROUTER_ARN — the target Lambda for scheduled nudges
//   scheduler:CreateSchedule, scheduler:DeleteSchedule, scheduler:GetSchedule — to manage schedules
//   iam:PassRole — to pass the scheduler role to EventBridge Scheduler
// Requirements: 11.3
// -----------------------------------------------------------------------

// Razorpay webhook also calls cancelOrderSchedules
const orderSchedulerFunctions = [
  apiStack.razorpayWebhookFunction,
];

// Add SCHEDULER_ROLE_ARN and NOTIFICATION_ROUTER_ARN env vars
for (const fn of orderSchedulerFunctions) {
  fn.addEnvironment('SCHEDULER_ROLE_ARN', eventsStack.orderSchedulerRole.roleArn);
  fn.addEnvironment('NOTIFICATION_ROUTER_ARN', eventsStack.notificationRouterFunction.functionArn);

  // Grant scheduler:CreateSchedule, scheduler:DeleteSchedule, scheduler:GetSchedule
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'scheduler:CreateSchedule',
        'scheduler:DeleteSchedule',
        'scheduler:GetSchedule',
      ],
      resources: [
        `arn:aws:scheduler:${region}:${account}:schedule/default/order-*`,
      ],
    }),
  );

  // Grant iam:PassRole for the order scheduler role
  fn.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iam:PassRole'],
      resources: [eventsStack.orderSchedulerRole.roleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'scheduler.amazonaws.com',
        },
      },
    }),
  );
}

// Also wire env vars to the WhatsApp worker (handles order creation → scheduleSellerReminders)
// and the notification router (may need to create schedules for payment nudges after acceptance)
eventsStack.whatsappWorkerFunction.addEnvironment('SCHEDULER_ROLE_ARN', eventsStack.orderSchedulerRole.roleArn);
eventsStack.whatsappWorkerFunction.addEnvironment('NOTIFICATION_ROUTER_ARN', eventsStack.notificationRouterFunction.functionArn);

// Grant WhatsApp worker scheduler permissions for order nudges
eventsStack.whatsappWorkerFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      'scheduler:CreateSchedule',
      'scheduler:DeleteSchedule',
      'scheduler:GetSchedule',
    ],
    resources: [
      `arn:aws:scheduler:${region}:${account}:schedule/default/order-*`,
    ],
  }),
);
eventsStack.whatsappWorkerFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['iam:PassRole'],
    resources: [eventsStack.orderSchedulerRole.roleArn],
    conditions: {
      StringEquals: {
        'iam:PassedToService': 'scheduler.amazonaws.com',
      },
    },
  }),
);

// API_BASE_URL is now injected via APIStack props (eventsWorkerFunctions)
// to avoid cyclic cross-stack references

// 5b. WebSocket Stack (depends on Database, Auth, and Events for EventBridge)
// Pass event bus name/ARN as strings to avoid cyclic cross-stack references
// (events-stack reads webSocketCallbackUrl from websocket-stack, so websocket-stack cannot also import from events-stack)
const eventBusName = `${config.resourcePrefix}-events`;
const eventBusArn = `arn:aws:events:${region}:${account}:event-bus/${eventBusName}`;
const webSocketStack = new WebSocketStack(app, `${config.resourcePrefix}-websocket`, {
  config,
  table: databaseStack.table,
  userPool: authStack.userPool,
  eventBusName,
  eventBusArn,
  env: {
    account,
    region,
  },
  description: `WebSocket infrastructure for VyaparGyan ${environment} environment`,
});

webSocketStack.addDependency(databaseStack);
webSocketStack.addDependency(authStack);
console.log(`WebSocketStack instantiated: ${webSocketStack.stackName}`);

// Wire WebSocket callback URL (https://) to fan-out Lambda for API Gateway Management API push
eventsStack.messageFanoutFunction.addEnvironment(
  'WEBSOCKET_API_ENDPOINT',
  webSocketStack.webSocketCallbackUrl,
);

// Wire WebSocket endpoint to status webhook Lambda for real-time delivery status push
apiStack.whatsappStatusWebhookFunction.addEnvironment(
  'WEBSOCKET_API_ENDPOINT',
  webSocketStack.webSocketEndpoint,
);
apiStack.whatsappStatusWebhookFunction.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ['execute-api:ManageConnections'],
    resources: [
      `arn:aws:execute-api:${region}:${account}:${webSocketStack.webSocketApi.ref}/*/POST/@connections/*`,
    ],
  }),
);

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

// 7. Search Stack — TEMPORARILY DISABLED due to OSIS pipeline config issues
// const searchStack = new SearchStack(app, `${config.resourcePrefix}-search`, {
//   config,
//   table: databaseStack.table,
//   env: {
//     account,
//     region,
//   },
//   description: `OpenSearch search infrastructure for VyaparGyan ${environment} environment`,
// });

// searchStack.addDependency(databaseStack);
console.log(`SearchStack: SKIPPED (OSIS pipeline fix pending)`);

// 7b. Wire Search Lambda routes into API Gateway
// TEMPORARILY DISABLED — search stack has OSIS pipeline config issues
// Will re-enable once OpenSearch pipeline syntax is fixed
// import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
// import { HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';

// apiStack.httpApi.addRoutes({
//   path: '/api/v1/search',
//   methods: [HttpMethod.GET],
//   integration: new HttpLambdaIntegration('SearchIntegration', searchStack.searchFunction),
//   authorizer: apiStack.jwtAuthorizer,
// });

// apiStack.httpApi.addRoutes({
//   path: '/api/v1/autocomplete',
//   methods: [HttpMethod.GET],
//   integration: new HttpLambdaIntegration('AutocompleteIntegration', searchStack.autocompleteFunction),
//   authorizer: apiStack.jwtAuthorizer,
// });

// API_BASE_URL for Bedrock action group — optional, used for status callbacks
// Removed cross-stack reference to avoid potential cyclic dependencies
// Workers will function without it (status callbacks are optional)

// Add tags to all resources from configuration
Object.entries(config.tags).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});

app.synth();
