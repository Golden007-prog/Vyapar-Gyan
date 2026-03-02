import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
let dynamoClient = null;
let logsClient = null;
export function getDynamoClient(region) {
    if (!dynamoClient) {
        const client = new DynamoDBClient({ region });
        dynamoClient = DynamoDBDocumentClient.from(client, {
            marshallOptions: {
                removeUndefinedValues: true,
                convertClassInstanceToMap: true,
            },
        });
    }
    return dynamoClient;
}
export function getLogsClient(region) {
    if (!logsClient) {
        logsClient = new CloudWatchLogsClient({ region });
    }
    return logsClient;
}
//# sourceMappingURL=aws-clients.js.map