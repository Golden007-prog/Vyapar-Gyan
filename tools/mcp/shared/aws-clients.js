import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
let dynamoClient = null;
let s3Client = null;
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
export function getS3Client(region) {
    if (!s3Client) {
        s3Client = new S3Client({ region });
    }
    return s3Client;
}
export function getLogsClient(region) {
    if (!logsClient) {
        logsClient = new CloudWatchLogsClient({ region });
    }
    return logsClient;
}
//# sourceMappingURL=aws-clients.js.map