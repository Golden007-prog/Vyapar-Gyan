import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
export declare function getDynamoClient(region: string): DynamoDBDocumentClient;
export declare function getS3Client(region: string): S3Client;
export declare function getLogsClient(region: string): CloudWatchLogsClient;
//# sourceMappingURL=aws-clients.d.ts.map