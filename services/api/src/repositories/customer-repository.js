"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerRepository = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const crypto_1 = require("crypto");
const logger_1 = require("../utils/logger");
const config_1 = require("../utils/config");
const dynamoDBClient = new client_dynamodb_1.DynamoDBClient({});
const config = (0, config_1.getConfig)();
/**
 * CustomerRepository
 *
 * Manages customer data in DynamoDB.
 * Uses PK: CUSTOMER#{phoneNumber}, SK: PROFILE pattern.
 */
class CustomerRepository {
    tableName;
    constructor(tableName) {
        this.tableName = tableName || config.tableName;
    }
    /**
     * Resolve existing customer or create new one
     */
    async resolveOrCreate(input) {
        const { phoneNumber, profileName, whatsappId } = input;
        // Try to get existing customer
        const existing = await this.getByPhoneNumber(phoneNumber);
        if (existing) {
            logger_1.logger.info('Existing customer found', { customerId: existing.id, phoneNumber });
            return existing;
        }
        // Create new customer
        const customer = {
            id: (0, crypto_1.randomUUID)(),
            phoneNumber,
            profileName,
            whatsappId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await this.create(customer);
        logger_1.logger.info('New customer created', { customerId: customer.id, phoneNumber });
        return customer;
    }
    /**
     * Get customer by phone number
     */
    async getByPhoneNumber(phoneNumber) {
        const command = new client_dynamodb_1.GetItemCommand({
            TableName: this.tableName,
            Key: (0, util_dynamodb_1.marshall)({
                PK: `CUSTOMER#${phoneNumber}`,
                SK: 'PROFILE',
            }),
        });
        const response = await dynamoDBClient.send(command);
        if (!response.Item) {
            return null;
        }
        return (0, util_dynamodb_1.unmarshall)(response.Item);
    }
    /**
     * Create new customer
     */
    async create(customer) {
        const item = {
            PK: `CUSTOMER#${customer.phoneNumber}`,
            SK: 'PROFILE',
            ...customer,
        };
        const command = new client_dynamodb_1.PutItemCommand({
            TableName: this.tableName,
            Item: (0, util_dynamodb_1.marshall)(item),
        });
        await dynamoDBClient.send(command);
    }
}
exports.CustomerRepository = CustomerRepository;
//# sourceMappingURL=customer-repository.js.map