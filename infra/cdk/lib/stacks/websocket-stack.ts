/**
 * WebSocket Stack
 *
 * Creates an API Gateway WebSocket API with Lambda integrations for
 * real-time chat messaging. Includes routes for $connect, $disconnect,
 * $default (heartbeat/typing/markRead/sync), and sendMessage.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  CfnApi,
  CfnRoute,
  CfnIntegration,
  CfnDeployment,
  CfnStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { Function, Runtime, Code, Architecture, Tracing } from 'aws-cdk-lib/aws-lambda';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Duration } from 'aws-cdk-lib';
import { EnvironmentConfig } from '../config';

/**
 * Properties for WebSocketStack
 */
export interface WebSocketStackProps extends cdk.StackProps {
  /** Environment-specific configuration */
  config: EnvironmentConfig;
  /** DynamoDB table from DatabaseStack */
  table: Table;
  /** Cognito User Pool from AuthStack */
  userPool: UserPool;
  /** EventBridge event bus name for cross-channel message delivery (string to avoid cyclic cross-stack refs) */
  eventBusName?: string;
  /** EventBridge event bus ARN for granting putEvents permission */
  eventBusArn?: string;
}

/**
 * WebSocketStack creates the API Gateway WebSocket API and Lambda handlers
 * for real-time chat messaging.
 */
export class WebSocketStack extends cdk.Stack {
  /** The WebSocket API */
  public readonly webSocketApi: CfnApi;

  /** The WebSocket stage */
  public readonly webSocketStage: CfnStage;

  /** WebSocket endpoint URL */
  public readonly webSocketEndpoint: string;

  /** WebSocket callback URL (https://) for API Gateway Management API */
  public readonly webSocketCallbackUrl: string;

  constructor(scope: Construct, id: string, props: WebSocketStackProps) {
    super(scope, id, props);

    const { config, table, userPool } = props;

    // ========================================================================
    // WebSocket API
    // ========================================================================

    this.webSocketApi = new CfnApi(this, 'WebSocketApi', {
      name: `${config.resourcePrefix}-websocket`,
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
      description: 'VyaparGyan real-time chat WebSocket API',
    });

    // ========================================================================
    // Shared environment variables
    // ========================================================================

    const stageName = config.environment === 'prod' ? 'prod' : config.environment;

    // The callback URL for @connections management API
    const webSocketCallbackUrl = `https://${this.webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/${stageName}`;

    const baseEnv: Record<string, string> = {
      ENVIRONMENT: config.environment,
      TABLE_NAME: table.tableName,
      USER_POOL_ID: userPool.userPoolId,
      LOG_LEVEL: 'info',
    };

    const envWithEndpoint: Record<string, string> = {
      ...baseEnv,
      WEBSOCKET_API_ENDPOINT: webSocketCallbackUrl,
    };

    // ========================================================================
    // Lambda Functions
    // ========================================================================

    // $connect handler
    const connectFunction = new Function(this, 'ConnectFunction', {
      functionName: `${config.resourcePrefix}-ws-connect`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/websocket/connect.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: baseEnv,
    });

    // $disconnect handler
    const disconnectFunction = new Function(this, 'DisconnectFunction', {
      functionName: `${config.resourcePrefix}-ws-disconnect`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/websocket/disconnect.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: baseEnv,
    });

    // $default handler (heartbeat, typing, markRead, sync)
    const defaultFunction = new Function(this, 'DefaultFunction', {
      functionName: `${config.resourcePrefix}-ws-default`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/websocket/default.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: envWithEndpoint,
    });

    // sendMessage handler
    const sendMessageFunction = new Function(this, 'SendMessageFunction', {
      functionName: `${config.resourcePrefix}-ws-send-message`,
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'handlers/websocket/send-message.handler',
      code: Code.fromAsset('../../services/api/dist'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      tracing: Tracing.ACTIVE,
      environment: envWithEndpoint,
    });

    // ========================================================================
    // EventBridge — sendMessage publishes message.created for cross-channel fan-out
    // ========================================================================

    if (props.eventBusName && props.eventBusArn) {
      sendMessageFunction.addEnvironment('EVENT_BUS_NAME', props.eventBusName);
      sendMessageFunction.addToRolePolicy(new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [props.eventBusArn],
      }));
    }

    // ========================================================================
    // DynamoDB Permissions — all 4 Lambdas get read/write
    // ========================================================================

    table.grantReadWriteData(connectFunction);
    table.grantReadWriteData(disconnectFunction);
    table.grantReadWriteData(defaultFunction);
    table.grantReadWriteData(sendMessageFunction);

    // ========================================================================
    // execute-api:ManageConnections — sendMessage and default handlers
    // ========================================================================

    const manageConnectionsPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/${stageName}/POST/@connections/*`,
      ],
    });

    sendMessageFunction.addToRolePolicy(manageConnectionsPolicy);
    defaultFunction.addToRolePolicy(manageConnectionsPolicy);

    // ========================================================================
    // WebSocket Integrations
    // ========================================================================

    const connectIntegration = new CfnIntegration(this, 'ConnectIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${connectFunction.functionArn}/invocations`,
    });

    const disconnectIntegration = new CfnIntegration(this, 'DisconnectIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${disconnectFunction.functionArn}/invocations`,
    });

    const defaultIntegration = new CfnIntegration(this, 'DefaultIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${defaultFunction.functionArn}/invocations`,
    });

    const sendMessageIntegration = new CfnIntegration(this, 'SendMessageIntegration', {
      apiId: this.webSocketApi.ref,
      integrationType: 'AWS_PROXY',
      integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${sendMessageFunction.functionArn}/invocations`,
    });

    // ========================================================================
    // WebSocket Routes
    // ========================================================================

    const connectRoute = new CfnRoute(this, 'ConnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$connect',
      authorizationType: 'NONE',
      target: `integrations/${connectIntegration.ref}`,
    });

    const disconnectRoute = new CfnRoute(this, 'DisconnectRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$disconnect',
      authorizationType: 'NONE',
      target: `integrations/${disconnectIntegration.ref}`,
    });

    const defaultRoute = new CfnRoute(this, 'DefaultRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: '$default',
      authorizationType: 'NONE',
      target: `integrations/${defaultIntegration.ref}`,
    });

    const sendMessageRoute = new CfnRoute(this, 'SendMessageRoute', {
      apiId: this.webSocketApi.ref,
      routeKey: 'sendMessage',
      authorizationType: 'NONE',
      target: `integrations/${sendMessageIntegration.ref}`,
    });

    // ========================================================================
    // Lambda Invoke Permissions for API Gateway
    // ========================================================================

    connectFunction.addPermission('WebSocketConnectPermission', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/*/$connect`,
    });

    disconnectFunction.addPermission('WebSocketDisconnectPermission', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/*/$disconnect`,
    });

    defaultFunction.addPermission('WebSocketDefaultPermission', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/*/$default`,
    });

    sendMessageFunction.addPermission('WebSocketSendMessagePermission', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.ref}/*/sendMessage`,
    });

    // ========================================================================
    // Deployment and Stage
    // ========================================================================

    const deployment = new CfnDeployment(this, 'WebSocketDeployment', {
      apiId: this.webSocketApi.ref,
    });

    // Ensure routes are created before deployment
    deployment.addDependency(connectRoute);
    deployment.addDependency(disconnectRoute);
    deployment.addDependency(defaultRoute);
    deployment.addDependency(sendMessageRoute);

    this.webSocketStage = new CfnStage(this, 'WebSocketStage', {
      apiId: this.webSocketApi.ref,
      stageName,
      deploymentId: deployment.ref,
      description: `WebSocket API stage for ${config.environment}`,
    });

    // ========================================================================
    // Outputs
    // ========================================================================

    this.webSocketEndpoint = `wss://${this.webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/${stageName}`;

    this.webSocketCallbackUrl = webSocketCallbackUrl;

    new cdk.CfnOutput(this, 'WebSocketEndpoint', {
      value: this.webSocketEndpoint,
      description: 'WebSocket API endpoint URL',
      exportName: `${config.resourcePrefix}-websocket-endpoint`,
    });

    new cdk.CfnOutput(this, 'WebSocketApiId', {
      value: this.webSocketApi.ref,
      description: 'WebSocket API ID',
      exportName: `${config.resourcePrefix}-websocket-api-id`,
    });
  }
}
