"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionRepository = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const crypto_1 = require("crypto");
const logger_1 = require("../utils/logger");
const config_1 = require("../utils/config");
const dynamoDBClient = new client_dynamodb_1.DynamoDBClient({});
const config = (0, config_1.getConfig)();
/**
 * SessionRepository
 *
 * Manages WhatsApp session data in DynamoDB.
 * Uses PK: SESSION#{customerId}, SK: WHATSAPP#{phoneNumber} pattern.
 */
class SessionRepository {
    tableName;
    constructor(tableName) {
        this.tableName = tableName || config.tableName;
    }
    /**
     * Resolve existing session or create new one
     */
    async resolveOrCreate(input) {
        const { customerId, phoneNumber, channelType } = input;
        // Try to get existing session
        const existing = await this.getByCustomer(customerId, phoneNumber);
        if (existing) {
            // Update last activity timestamp
            await this.updateLastActivity(existing.id, customerId, phoneNumber);
            logger_1.logger.info('Existing session found', { sessionId: existing.id, customerId });
            return { ...existing, lastActivityAt: new Date().toISOString() };
        }
        // Create new session
        const session = {
            id: (0, crypto_1.randomUUID)(),
            customerId,
            phoneNumber,
            channelType,
            state: 'greeting',
            context: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
        };
        await this.create(session);
        logger_1.logger.info('New session created', { sessionId: session.id, customerId });
        return session;
    }
    /**
     * Get session by customer ID and phone number
     */
    async getByCustomer(customerId, phoneNumber) {
        const command = new client_dynamodb_1.GetItemCommand({
            TableName: this.tableName,
            Key: (0, util_dynamodb_1.marshall)({
                PK: `SESSION#${customerId}`,
                SK: `WHATSAPP#${phoneNumber}`,
            }),
        });
        const response = await dynamoDBClient.send(command);
        if (!response.Item) {
            return null;
        }
        return (0, util_dynamodb_1.unmarshall)(response.Item);
    }
    /**
     * Create new session
     */
    async create(session) {
        const item = {
            PK: `SESSION#${session.customerId}`,
            SK: `WHATSAPP#${session.phoneNumber}`,
            ...session,
        };
        const command = new client_dynamodb_1.PutItemCommand({
            TableName: this.tableName,
            Item: (0, util_dynamodb_1.marshall)(item),
        });
        await dynamoDBClient.send(command);
    }
    /**
     * Update session state
     */
    async updateState(sessionId, customerId, phoneNumber, state) {
        const command = new client_dynamodb_1.UpdateItemCommand({
            TableName: this.tableName,
            Key: (0, util_dynamodb_1.marshall)({
                PK: `SESSION#${customerId}`,
                SK: `WHATSAPP#${phoneNumber}`,
            }),
            UpdateExpression: 'SET #state = :state, updatedAt = :updatedAt, lastActivityAt = :lastActivityAt',
            ExpressionAttributeNames: {
                '#state': 'state',
            },
            ExpressionAttributeValues: (0, util_dynamodb_1.marshall)({
                ':state': state,
                ':updatedAt': new Date().toISOString(),
                ':lastActivityAt': new Date().toISOString(),
            }),
        });
        await dynamoDBClient.send(command);
        logger_1.logger.info('Session state updated', { sessionId, state });
    }
    /**
     * Update session context (conversation state)
     */
    async updateContext(sessionId, customerId, phoneNumber, context) {
        const command = new client_dynamodb_1.UpdateItemCommand({
            TableName: this.tableName,
            Key: (0, util_dynamodb_1.marshall)({
                PK: `SESSION#${customerId}`,
                SK: `WHATSAPP#${phoneNumber}`,
            }),
            UpdateExpression: 'SET #context = :context, updatedAt = :updatedAt, lastActivityAt = :lastActivityAt',
            ExpressionAttributeNames: {
                '#context': 'context',
            },
            ExpressionAttributeValues: (0, util_dynamodb_1.marshall)({
                ':context': context,
                ':updatedAt': new Date().toISOString(),
                ':lastActivityAt': new Date().toISOString(),
            }),
        });
        await dynamoDBClient.send(command);
        logger_1.logger.info('Session context updated', { sessionId });
    }
    /**
     * Update last activity timestamp
     */
    async updateLastActivity(sessionId, customerId, phoneNumber) {
        const command = new client_dynamodb_1.UpdateItemCommand({
            TableName: this.tableName,
            Key: (0, util_dynamodb_1.marshall)({
                PK: `SESSION#${customerId}`,
                SK: `WHATSAPP#${phoneNumber}`,
            }),
            UpdateExpression: 'SET lastActivityAt = :lastActivityAt',
            ExpressionAttributeValues: (0, util_dynamodb_1.marshall)({
                ':lastActivityAt': new Date().toISOString(),
            }),
        });
        await dynamoDBClient.send(command);
    }
}
exports.SessionRepository = SessionRepository;
//# sourceMappingURL=session-repository.js.map