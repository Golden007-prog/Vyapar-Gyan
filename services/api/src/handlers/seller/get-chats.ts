import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';

const dynamoDBClient = new DynamoDBClient({});

/**
 * Chat session from DynamoDB
 */
interface ChatSession {
  id: string;
  customerId: string;
  phoneNumber: string;
  channelType: 'whatsapp' | 'web';
  state: string;
  context: Record<string, any>;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Message from DynamoDB
 */
interface Message {
  sessionId: string;
  waMessageId: string;
  direction: 'inbound' | 'outbound';
  messageType: 'text' | 'interactive' | 'image' | 'audio';
  content: any;
  waStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  createdAt: string;
}

/**
 * Chat session with last message for UI
 */
interface ChatSessionWithLastMessage extends ChatSession {
  lastMessage?: {
    text: string;
    direction: 'inbound' | 'outbound';
  };
}

/**
 * Get Chats Handler
 * 
 * Fetches active customer chat sessions for a seller from DynamoDB.
 * 
 * Since sessions are customer-centric (PK: SESSION#{customerId}), we need to:
 * 1. Find all sessions that have interacted with this seller's products
 * 2. Or scan for recent active sessions (for MVP, we'll return all recent sessions)
 * 
 * Query Parameters:
 * - limit: Number of sessions to return (default: 20, max: 100)
 * 
 * Authorization: Requires valid JWT token with seller role
 */
export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Get chats request received', {
    requestId,
    path: event.path,
    queryParams: event.queryStringParameters,
  });

  try {
    // Extract seller ID from JWT token (set by API Gateway authorizer)
    const sellerId = extractSellerIdFromEvent(event);
    
    if (!sellerId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Seller ID not found in token',
        }),
      };
    }

    // Parse query parameters
    const limit = Math.min(
      parseInt(event.queryStringParameters?.limit || '20', 10),
      100
    );

    logger.info('Querying chat sessions', {
      sellerId,
      limit,
    });

    // Query chat sessions from DynamoDB
    const config = await getConfig();
    const sessions = await queryChatSessions(
      config.tableName,
      sellerId,
      limit
    );

    logger.info('Chat sessions retrieved successfully', {
      sellerId,
      count: sessions.length,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        data: sessions,
        total: sessions.length,
      }),
    };
  } catch (error) {
    logger.error('Failed to get chat sessions', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to retrieve chat sessions',
      }),
    };
  }
};

/**
 * Get Messages for Session Handler
 * 
 * Fetches message history for a specific chat session.
 * 
 * Path Parameters:
 * - sessionId: The session ID to fetch messages for
 * 
 * Authorization: Requires valid JWT token with seller role
 */
export const getMessagesHandler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  
  logger.info('Get messages request received', {
    requestId,
    path: event.path,
    pathParameters: event.pathParameters,
  });

  try {
    // Extract seller ID from JWT token
    const sellerId = extractSellerIdFromEvent(event);
    
    if (!sellerId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'Seller ID not found in token',
        }),
      };
    }

    // Get session ID from path parameters
    const sessionId = event.pathParameters?.sessionId;
    
    if (!sessionId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Session ID is required',
        }),
      };
    }

    logger.info('Querying messages for session', {
      sellerId,
      sessionId,
    });

    // Query messages from DynamoDB
    const config = await getConfig();
    const messages = await queryMessages(config.tableName, sessionId);

    logger.info('Messages retrieved successfully', {
      sellerId,
      sessionId,
      count: messages.length,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        data: messages,
        total: messages.length,
      }),
    };
  } catch (error) {
    logger.error('Failed to get messages', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to retrieve messages',
      }),
    };
  }
};

/**
 * Extract seller ID from API Gateway event
 */
function extractSellerIdFromEvent(event: APIGatewayProxyEvent): string | null {
  const authorizerContext = event.requestContext.authorizer;
  
  if (authorizerContext) {
    const claims = authorizerContext.claims || authorizerContext;
    
    if (claims['custom:userId']) {
      return claims['custom:userId'];
    }
    
    if (claims.sub) {
      return claims.sub;
    }
  }

  const userIdHeader = event.headers['x-user-id'] || event.headers['X-User-Id'];
  if (userIdHeader) {
    return userIdHeader;
  }

  return null;
}

/**
 * Query chat sessions from DynamoDB
 * 
 * For MVP, we scan for all recent sessions. In production, we would:
 * 1. Use a GSI with seller-specific access pattern
 * 2. Or filter sessions based on orders/interactions with seller
 */
async function queryChatSessions(
  tableName: string,
  sellerId: string,
  limit: number
): Promise<ChatSessionWithLastMessage[]> {
  const sessions: ChatSessionWithLastMessage[] = [];

  try {
    // Scan for sessions (MVP approach - in production use GSI)
    // Filter for sessions with PK starting with SESSION# and SK starting with WHATSAPP# or WEB#
    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :pkPrefix) AND (begins_with(SK, :skWhatsapp) OR begins_with(SK, :skWeb))',
      ExpressionAttributeValues: {
        ':pkPrefix': { S: 'SESSION#' },
        ':skWhatsapp': { S: 'WHATSAPP#' },
        ':skWeb': { S: 'WEB#' },
      },
      Limit: limit,
    });

    const response = await dynamoDBClient.send(command);

    if (response.Items) {
      for (const item of response.Items) {
        const session = unmarshall(item) as ChatSession;
        
        // Get last message for this session
        const lastMessage = await getLastMessage(tableName, session.id);
        
        const sessionWithMessage: ChatSessionWithLastMessage = {
          ...session,
        };
        
        if (lastMessage) {
          sessionWithMessage.lastMessage = lastMessage;
        }
        
        sessions.push(sessionWithMessage);
      }
    }

    // Sort by last activity (most recent first)
    sessions.sort((a, b) => 
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );

    return sessions.slice(0, limit);
  } catch (error) {
    logger.error('Failed to query chat sessions from DynamoDB', {
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get last message for a session
 */
async function getLastMessage(
  tableName: string,
  sessionId: string
): Promise<{ text: string; direction: 'inbound' | 'outbound' } | undefined> {
  try {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': { S: `SESSION#${sessionId}` },
        ':sk': { S: 'MESSAGE#' },
      },
      ScanIndexForward: false, // Most recent first
      Limit: 1,
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return undefined;
    }

    const firstItem = response.Items[0];
    if (!firstItem) {
      return undefined;
    }

    const message = unmarshall(firstItem) as Message;
    
    // Extract text from message content
    let text = 'Message';
    if (message.messageType === 'text' && message.content?.text) {
      text = message.content.text;
    } else if (message.messageType === 'interactive' && message.content?.body?.text) {
      text = message.content.body.text;
    } else if (message.messageType === 'image') {
      text = '📷 Image';
    } else if (message.messageType === 'audio') {
      text = '🎤 Audio';
    }

    return {
      text,
      direction: message.direction,
    };
  } catch (error) {
    logger.error('Failed to get last message', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Query messages for a session
 */
async function queryMessages(
  tableName: string,
  sessionId: string
): Promise<Message[]> {
  try {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': { S: `SESSION#${sessionId}` },
        ':sk': { S: 'MESSAGE#' },
      },
      ScanIndexForward: true, // Oldest first for chat display
      Limit: 100, // Limit to last 100 messages
    });

    const response = await dynamoDBClient.send(command);

    if (!response.Items || response.Items.length === 0) {
      return [];
    }

    return response.Items.map(item => unmarshall(item) as Message);
  } catch (error) {
    logger.error('Failed to query messages from DynamoDB', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
