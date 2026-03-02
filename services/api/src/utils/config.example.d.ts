/**
 * Example: Using the configuration loader in a Lambda handler
 *
 * This example demonstrates how to load and use configuration
 * in a Lambda function handler.
 */
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
/**
 * Example Lambda handler that uses configuration
 */
export declare const handler: (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyResultV2>;
/**
 * Example: Using configuration with external service clients
 */
export declare const handlerWithClients: (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyResultV2>;
/**
 * Example: Environment-specific behavior
 */
export declare const handlerWithEnvironmentLogic: (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyResultV2>;
/**
 * Example: Configuration validation in tests
 */
export declare function validateConfiguration(): Promise<void>;
//# sourceMappingURL=config.example.d.ts.map