import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

let dynamoClient: DynamoDBDocumentClient | null = null;
let logsClient: CloudWatchLogsClient | null = null;

export function getDynamoClient(region: string): DynamoDBDocumentClient {
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

export function getLogsClient(region: string): CloudWatchLogsClient {
  if (!logsClient) {
    logsClient = new CloudWatchLogsClient({ region });
  }
  return logsClient;
}
