import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

let dynamoClient: DynamoDBDocumentClient | null = null;
let s3Client: S3Client | null = null;

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

export function getS3Client(region: string): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region });
  }
  return s3Client;
}
