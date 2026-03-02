"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageRepository = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const logger_1 = require("../utils/logger");
const config_1 = require("../utils/config");
const dynamoDBClient = new client_dynamodb_1.DynamoDBClient({});
const config = (0, config_1.getConfig)();
/**
 * MessageRepository
 *
 * Manages WhatsApp message history in DynamoDB.
 * Uses PK: SESSION#{sessionId}, SK: MESSAGE#{timestamp}#{waMessageId} pattern.
 */
class MessageRepository {
    tableName;
    constructor(tableName) {
        this.tableName = tableName || config.tableName;
    }
    /**
     * Store a message (inbound or outbound)
     */
    async create(input) {
        const now = new Date();
        const timestamp = now.getTime();
        const ttl = Math.floor(timestamp / 1000) + (30 * 24 * 60 * 60); // 30 days
        const message = {
            sessionId: input.sessionId,
            waMessageId: input.waMessageId,
            direction: input.direction,
            messageType: input.messageType,
            content: input.content,
            waStatus: input.waStatus,
            createdAt: now.toISOString(),
            ttl,
        };
        const item = {
            PK: `SESSION#${input.sessionId}`,
            SK: `MESSAGE#${timestamp}#${input.waMessageId}`,
            ...message,
        };
        const command = new client_dynamodb_1.PutItemCommand({
            TableName: this.tableName,
            Item: (0, util_dynamodb_1.marshall)(item),
        });
        await dynamoDBClient.send(command);
        logger_1.logger.info('Message stored', {
            sessionId: input.sessionId,
            waMessageId: input.waMessageId,
            direction: input.direction,
            messageType: input.messageType,
        });
        return message;
    }
    /**
     * Get recent messages for a session
     */
    async getRecentMessages(sessionId, limit = 20) {
        const command = new client_dynamodb_1.QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: (0, util_dynamodb_1.marshall)({
                ':pk': `SESSION#${sessionId}`,
                ':sk': 'MESSAGE#',
            }),
            ScanIndexForward: false, // Most recent first
            Limit: limit,
        });
        const response = await dynamoDBClient.send(command);
        if (!response.Items || response.Items.length === 0) {
            return [];
        }
        return response.Items.map(item => (0, util_dynamodb_1.unmarshall)(item));
    }
}
exports.MessageRepository = MessageRepository;
//# sourceMappingURL=message-repository.js.map