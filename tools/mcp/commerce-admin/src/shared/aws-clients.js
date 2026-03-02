/**
 * AWS client management with singleton pattern.
 * Provides cached DynamoDB client instances.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
let dynamoClient = null;
/**
 * Gets or creates a DynamoDB DocumentClient instance.
 * Uses singleton pattern to avoid repeated initialization.
 */
export function getDynamoClient(region) {
    if (!dynamoClient) {
        const client = new DynamoDBClient({ region });
        dynamoClient = DynamoDBDocumentClient.from(client, {
            marshallOptions: {
                removeUndefinedValues: true,
                convertClassInstanceToMap: true,
            },
            unmarshallOptions: {
                wrapNumbers: false,
            },
        });
    }
    return dynamoClient;
}
//# sourceMappingURL=aws-clients.js.map