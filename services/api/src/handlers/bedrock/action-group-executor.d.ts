/**
 * Bedrock Agent Action Group Event Format
 *
 * Amazon Bedrock sends events in this specific format when invoking
 * Lambda functions as action group executors.
 */
interface BedrockActionGroupEvent {
    messageVersion: string;
    agent: {
        name: string;
        id: string;
        alias: string;
        version: string;
    };
    inputText: string;
    sessionId: string;
    actionGroup: string;
    apiPath: string;
    httpMethod: string;
    parameters?: Array<{
        name: string;
        type: string;
        value: string;
    }>;
    requestBody?: {
        content: {
            [contentType: string]: {
                properties: Array<{
                    name: string;
                    type: string;
                    value: string;
                }>;
            };
        };
    };
}
/**
 * Bedrock Agent Action Group Response Format
 *
 * Lambda must return responses in this exact format for Bedrock to process them.
 */
interface BedrockActionGroupResponse {
    messageVersion: string;
    response: {
        actionGroup: string;
        apiPath: string;
        httpMethod: string;
        httpStatusCode: number;
        responseBody: {
            [contentType: string]: {
                body: string;
            };
        };
    };
}
/**
 * Lambda handler for Bedrock Agent Action Group
 *
 * This handler receives events from Amazon Bedrock when an agent invokes
 * catalog-related actions. It routes requests to the appropriate catalog
 * repository methods and returns responses in the format Bedrock expects.
 *
 * Supported operations:
 * - GET /catalog/categories - List all categories
 * - GET /catalog/categories/{categoryId}/products - List products by category
 * - GET /catalog/products/search - Search products
 */
export declare function handler(event: BedrockActionGroupEvent): Promise<BedrockActionGroupResponse>;
export {};
//# sourceMappingURL=action-group-executor.d.ts.map