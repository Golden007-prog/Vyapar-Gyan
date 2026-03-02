import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
export declare function getDynamoClient(region: string): DynamoDBDocumentClient;
export declare function getLogsClient(region: string): CloudWatchLogsClient;
//# sourceMappingURL=aws-clients.d.ts.map