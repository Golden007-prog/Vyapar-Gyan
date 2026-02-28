"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDynamoClient = getDynamoClient;
exports.getS3Client = getS3Client;
exports.getLogsClient = getLogsClient;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_cloudwatch_logs_1 = require("@aws-sdk/client-cloudwatch-logs");
let dynamoClient = null;
let s3Client = null;
let logsClient = null;
function getDynamoClient(region) {
    if (!dynamoClient) {
        const client = new client_dynamodb_1.DynamoDBClient({ region });
        dynamoClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client, {
            marshallOptions: {
                removeUndefinedValues: true,
                convertClassInstanceToMap: true,
            },
        });
    }
    return dynamoClient;
}
function getS3Client(region) {
    if (!s3Client) {
        s3Client = new client_s3_1.S3Client({ region });
    }
    return s3Client;
}
function getLogsClient(region) {
    if (!logsClient) {
        logsClient = new client_cloudwatch_logs_1.CloudWatchLogsClient({ region });
    }
    return logsClient;
}
//# sourceMappingURL=aws-clients.js.map