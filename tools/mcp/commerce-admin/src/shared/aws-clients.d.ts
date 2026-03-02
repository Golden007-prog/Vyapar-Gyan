/**
 * AWS client management with singleton pattern.
 * Provides cached DynamoDB client instances.
 */
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
/**
 * Gets or creates a DynamoDB DocumentClient instance.
 * Uses singleton pattern to avoid repeated initialization.
 */
export declare function getDynamoClient(region: string): DynamoDBDocumentClient;
//# sourceMappingURL=aws-clients.d.ts.map