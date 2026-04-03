/**
 * WebSocket $connect Handler
 *
 * Authenticates the connecting client via Cognito JWT, stores a Connection
 * Registry item in DynamoDB, and updates the user's PRESENCE record.
 *
 * Query param: ?token=<JWT access token>
 * Returns 200 on success, 401 on invalid/missing JWT.
 *
 * Validates: Requirements 2.1, 2.2, 2.4, 2.5
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildConnectionRegistryItem } from '../../shared/websocket-schemas';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Clients (singleton, reused across warm invocations)
// ---------------------------------------------------------------------------

const cognitoClient = new CognitoIdentityProviderClient({});
const rawDdb = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(rawDdb, {
  marshallOptions: { removeUndefinedValues: true },
});

function getTableName(): string {
  return process.env.TABLE_NAME ?? '';
}

// ---------------------------------------------------------------------------
// JWT verification via Cognito GetUser
// ---------------------------------------------------------------------------

interface VerifiedClaims {
  userId: string;
  role: 'customer' | 'seller' | 'admin';
}

/**
 * Verify a Cognito access token by calling GetUser.
 * If the token is invalid or expired, Cognito throws NotAuthorizedException.
 *
 * Extracts userId (sub) and role from user attributes / groups.
 */
async function verifyCognitoToken(accessToken: string): Promise<VerifiedClaims> {
  const result = await cognitoClient.send(
    new GetUserCommand({ AccessToken: accessToken }),
  );

  const sub = result.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
  if (!sub) {
    throw new Error('Missing sub claim in token');
  }

  // Resolve role: prefer custom:role attribute, fallback to 'customer'
  const customRole = result.UserAttributes?.find(
    (a) => a.Name === 'custom:role',
  )?.Value?.toLowerCase();

  const role = (['admin', 'seller', 'customer'] as const).includes(
    customRole as any,
  )
    ? (customRole as 'admin' | 'seller' | 'customer')
    : 'customer';

  return { userId: sub, role };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId;
  const token = event.queryStringParameters?.token;

  // 1. Reject if no token provided
  if (!token || !token.trim()) {
    logger.warn('WebSocket connect rejected: missing or empty token', { connectionId });
    return { statusCode: 401, body: 'Unauthorized' };
  }

  try {
    // 2. Verify JWT against Cognito
    const { userId, role } = await verifyCognitoToken(token);

    const now = new Date().toISOString();
    const table = getTableName();

    // 3. Store Connection Registry item
    const connItem = buildConnectionRegistryItem({
      connectionId: connectionId!,
      userId,
      role,
      connectedAt: now,
    });

    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: connItem,
      }),
    );

    // 4. Update or create PRESENCE record: increment connectionCount, set online
    await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `PRESENCE#${userId}`, SK: 'STATUS' },
        UpdateExpression:
          'SET #online = :true, updatedAt = :now, userId = :uid, expiresAt = :exp ADD connectionCount :one',
        ExpressionAttributeNames: { '#online': 'online' },
        ExpressionAttributeValues: {
          ':true': true,
          ':now': now,
          ':uid': userId,
          ':exp': Math.floor(Date.now() / 1000) + 604800, // 7-day TTL
          ':one': 1,
        },
      }),
    );

    logger.info('WebSocket connected', { connectionId, userId, role });
    return { statusCode: 200, body: 'Connected' };
  } catch (err: unknown) {
    const errorName = (err as any)?.name ?? '';

    // Cognito rejects invalid tokens with NotAuthorizedException
    if (
      errorName === 'NotAuthorizedException' ||
      errorName === 'UserNotFoundException' ||
      errorName === 'InvalidParameterException'
    ) {
      logger.warn('WebSocket connect rejected: invalid token', {
        connectionId,
        error: (err as Error).message,
      });
      return { statusCode: 401, body: 'Unauthorized' };
    }

    logger.error('WebSocket connect failed', err, { connectionId });
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};
