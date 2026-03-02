"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogRepository = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const util_dynamodb_1 = require("@aws-sdk/util-dynamodb");
const logger_1 = require("../utils/logger");
const config_1 = require("../utils/config");
const dynamoDBClient = new client_dynamodb_1.DynamoDBClient({});
const config = (0, config_1.getConfig)();
/**
 * CatalogRepository
 *
 * Manages product catalog data access from DynamoDB.
 * Provides read-only access for browsing and search.
 */
class CatalogRepository {
    tableName;
    constructor(tableName) {
        this.tableName = tableName || config.tableName;
    }
    /**
     * Get all active categories
     */
    async getCategories() {
        const command = new client_dynamodb_1.QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            FilterExpression: 'isActive = :active',
            ExpressionAttributeValues: (0, util_dynamodb_1.marshall)({
                ':pk': 'CATEGORY',
                ':sk': 'CATEGORY#',
                ':active': true,
            }),
        });
        const response = await dynamoDBClient.send(command);
        if (!response.Items || response.Items.length === 0) {
            return [];
        }
        const categories = response.Items.map(item => (0, util_dynamodb_1.unmarshall)(item));
        // Sort by display order
        return categories.sort((a, b) => a.displayOrder - b.displayOrder);
    }
    /**
     * Get category by ID
     */
    async getCategoryById(categoryId) {
        const command = new client_dynamodb_1.GetItemCommand({
            TableName: this.tableName,
            Key: (0, util_dynamodb_1.marshall)({
                PK: 'CATEGORY',
                SK: `CATEGORY#${categoryId}`,
            }),
        });
        const response = await dynamoDBClient.send(command);
        if (!response.Item) {
            return null;
        }
        return (0, util_dynamodb_1.unmarshall)(response.Item);
    }
    /**
     * Get products by category
     */
    async getProductsByCategory(categoryId, limit = 20) {
        const command = new client_dynamodb_1.QueryCommand({
            TableName: this.tableName,
            IndexName: 'CategoryIndex',
            KeyConditionExpression: 'categoryId = :categoryId',
            FilterExpression: 'isActive = :active AND stockQuantity > :zero',
            ExpressionAttributeValues: (0, util_dynamodb_1.marshall)({
                ':categoryId': categoryId,
                ':active': true,
                ':zero': 0,
            }),
            Limit: limit,
        });
        const response = await dynamoDBClient.send(command);
        if (!response.Items || response.Items.length === 0) {
            return [];
        }
        return response.Items.map(item => (0, util_dynamodb_1.unmarshall)(item));
    }
    /**
     * Get product by ID
     */
    async getProductById(productId) {
        const command = new client_dynamodb_1.GetItemCommand({
            TableName: this.tableName,
            Key: (0, util_dynamodb_1.marshall)({
                PK: `PRODUCT#${productId}`,
                SK: 'METADATA',
            }),
        });
        const response = await dynamoDBClient.send(command);
        if (!response.Item) {
            return null;
        }
        return (0, util_dynamodb_1.unmarshall)(response.Item);
    }
    /**
     * Search products by name (simple text match)
     */
    async searchProducts(query, limit = 10) {
        // Note: This is a simple scan-based search. For production, consider:
        // - OpenSearch for full-text search
        // - DynamoDB Streams + Lambda to maintain search index
        // - Pre-computed search results in cache
        const command = new client_dynamodb_1.QueryCommand({
            TableName: this.tableName,
            IndexName: 'ProductSearchIndex',
            KeyConditionExpression: 'begins_with(#name, :query)',
            FilterExpression: 'isActive = :active AND stockQuantity > :zero',
            ExpressionAttributeNames: {
                '#name': 'name',
            },
            ExpressionAttributeValues: (0, util_dynamodb_1.marshall)({
                ':query': query.toLowerCase(),
                ':active': true,
                ':zero': 0,
            }),
            Limit: limit,
        });
        try {
            const response = await dynamoDBClient.send(command);
            if (!response.Items || response.Items.length === 0) {
                return [];
            }
            return response.Items.map(item => (0, util_dynamodb_1.unmarshall)(item));
        }
        catch (error) {
            logger_1.logger.warn('Product search failed, returning empty results', {
                query,
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }
}
exports.CatalogRepository = CatalogRepository;
//# sourceMappingURL=catalog-repository.js.map