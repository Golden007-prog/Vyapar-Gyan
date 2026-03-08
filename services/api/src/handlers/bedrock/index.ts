/**
 * Bedrock Agent Action Group Executor
 * 
 * Lambda handler for Amazon Bedrock Agent Action Group integration.
 * Executes business logic for inventory management, dynamic pricing, and customer communications.
 * 
 * Supported Operations:
 * - GET /inventory - Retrieve stock levels and availability
 * - POST /discount - Apply dynamic pricing discounts
 * - POST /whatsapp - Send WhatsApp messages via Twilio
 * - GET /catalog/* - Browse catalog (delegated to action-group-executor)
 * 
 * Architecture:
 * - Receives events from Amazon Bedrock in specific format
 * - Routes requests to appropriate handlers
 * - Returns responses in Bedrock-compatible format
 * - Integrates with DynamoDB, Twilio, and EventBridge
 */

import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createLogger, withContext } from '../../utils/logger';
import { TwilioAdapter } from '../../adapters/twilio-adapter';
import { getConfig } from '../../utils/config';

const logger = createLogger({ handler: 'bedrock-action-group' });
const dynamoDBClient = new DynamoDBClient({});
const eventBridgeClient = new EventBridgeClient({});
const twilioAdapter = new TwilioAdapter();

/**
 * Bedrock Agent Action Group Event Format
 */
interface BedrockActionGroupEvent {
  messageVersion: string;
  agent: {
    name: string;
    id: string;
    alias: string;
    version: string;
  };
  inputText: string;
  sessionId: string;
  actionGroup: string;
  apiPath: string;
  httpMethod: string;
  parameters?: Array<{
    name: string;
    type: string;
    value: string;
  }>;
  requestBody?: {
    content: {
      [contentType: string]: {
        properties: Array<{
          name: string;
          type: string;
          value: string;
        }>;
      };
    };
  };
}

/**
 * Bedrock Agent Action Group Response Format
 */
interface BedrockActionGroupResponse {
  messageVersion: string;
  response: {
    actionGroup: string;
    apiPath: string;
    httpMethod: string;
    httpStatusCode: number;
    responseBody: {
      [contentType: string]: {
        body: string;
      };
    };
  };
}

/**
 * Standard API response envelope
 */
interface ApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  } | null;
  meta: {
    request_id: string;
  };
}

/**
 * Parse query parameters from Bedrock event
 */
function parseParameters(event: BedrockActionGroupEvent): Record<string, string> {
  const params: Record<string, string> = {};
  
  if (event.parameters) {
    for (const param of event.parameters) {
      params[param.name] = param.value;
    }
  }
  
  return params;
}

/**
 * Parse request body from Bedrock event
 */
function parseRequestBody(event: BedrockActionGroupEvent): Record<string, any> {
  const body: Record<string, any> = {};
  
  if (event.requestBody?.content?.['application/json']?.properties) {
    for (const prop of event.requestBody.content['application/json'].properties) {
      body[prop.name] = prop.value;
    }
  }
  
  return body;
}

/**
 * Create success response in Bedrock format
 */
function createSuccessResponse(
  event: BedrockActionGroupEvent,
  data: any,
  statusCode: number = 200
): BedrockActionGroupResponse {
  const apiResponse: ApiResponse = {
    success: true,
    data,
    error: null,
    meta: {
      request_id: event.sessionId,
    },
  };
  
  return {
    messageVersion: event.messageVersion,
    response: {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode: statusCode,
      responseBody: {
        'application/json': {
          body: JSON.stringify(apiResponse),
        },
      },
    },
  };
}

/**
 * Create error response in Bedrock format
 */
function createErrorResponse(
  event: BedrockActionGroupEvent,
  code: string,
  message: string,
  statusCode: number = 500,
  details?: Record<string, any>
): BedrockActionGroupResponse {
  const errorObj: { code: string; message: string; details?: Record<string, any> } = {
    code,
    message,
  };
  if (details) {
    errorObj.details = details;
  }
  
  const apiResponse: ApiResponse = {
    success: false,
    data: null,
    error: errorObj,
    meta: {
      request_id: event.sessionId,
    },
  };
  
  return {
    messageVersion: event.messageVersion,
    response: {
      actionGroup: event.actionGroup,
      apiPath: event.apiPath,
      httpMethod: event.httpMethod,
      httpStatusCode: statusCode,
      responseBody: {
        'application/json': {
          body: JSON.stringify(apiResponse),
        },
      },
    },
  };
}

/**
 * Handle GET /inventory
 * Retrieves stock levels and availability for a product
 */
async function handleGetInventory(
  event: BedrockActionGroupEvent
): Promise<BedrockActionGroupResponse> {
  const params = parseParameters(event);
  const { productId, sellerId } = params;
  
  if (!productId || !sellerId) {
    return createErrorResponse(
      event,
      'MISSING_PARAMETERS',
      'productId and sellerId are required',
      400
    );
  }
  
  logger.info('Getting inventory', { productId, sellerId });
  
  const config = await getConfig();
  
  try {
    // Query DynamoDB for product
    const getItemCommand = new GetItemCommand({
      TableName: config.tableName,
      Key: marshall({
        PK: `PRODUCT#${productId}`,
        SK: 'METADATA',
      }),
    });
    
    const result = await dynamoDBClient.send(getItemCommand);
    
    if (!result.Item) {
      return createErrorResponse(
        event,
        'PRODUCT_NOT_FOUND',
        `Product ${productId} not found`,
        404
      );
    }
    
    const product = unmarshall(result.Item);
    
    // Verify seller ownership
    if (product.sellerId !== sellerId) {
      return createErrorResponse(
        event,
        'UNAUTHORIZED',
        'Product does not belong to specified seller',
        403
      );
    }
    
    // Calculate stock age
    const createdAt = new Date(product.createdAt);
    const now = new Date();
    const stockAgeInDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    
    const inventoryData = {
      productId: product.id,
      sellerId: product.sellerId,
      productName: product.name,
      stockQuantity: product.stockQuantity || 0,
      stockAgeInDays,
      isAvailable: product.isActive && product.stockQuantity > 0,
      currentPrice: product.price,
      lastUpdated: product.updatedAt || product.createdAt,
    };
    
    logger.info('Inventory retrieved', { productId, stockQuantity: inventoryData.stockQuantity });
    
    return createSuccessResponse(event, inventoryData);
  } catch (error) {
    logger.error('Failed to get inventory', error, { productId, sellerId });
    return createErrorResponse(
      event,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to retrieve inventory',
      500
    );
  }
}

/**
 * Handle POST /discount
 * Applies dynamic pricing discount to a product
 */
async function handleApplyDiscount(
  event: BedrockActionGroupEvent
): Promise<BedrockActionGroupResponse> {
  const body = parseRequestBody(event);
  const { productId, sellerId, discountPercent, reason } = body;
  
  if (!productId || !sellerId || discountPercent === undefined) {
    return createErrorResponse(
      event,
      'MISSING_PARAMETERS',
      'productId, sellerId, and discountPercent are required',
      400
    );
  }
  
  const discount = parseFloat(discountPercent);
  
  if (discount < 0 || discount > 100) {
    return createErrorResponse(
      event,
      'INVALID_DISCOUNT',
      'discountPercent must be between 0 and 100',
      400
    );
  }
  
  logger.info('Applying discount', { productId, sellerId, discountPercent: discount, reason });
  
  const config = await getConfig();
  
  try {
    // Get current product
    const getItemCommand = new GetItemCommand({
      TableName: config.tableName,
      Key: marshall({
        PK: `PRODUCT#${productId}`,
        SK: 'METADATA',
      }),
    });
    
    const result = await dynamoDBClient.send(getItemCommand);
    
    if (!result.Item) {
      return createErrorResponse(
        event,
        'PRODUCT_NOT_FOUND',
        `Product ${productId} not found`,
        404
      );
    }
    
    const product = unmarshall(result.Item);
    
    // Verify seller ownership
    if (product.sellerId !== sellerId) {
      return createErrorResponse(
        event,
        'UNAUTHORIZED',
        'Product does not belong to specified seller',
        403
      );
    }
    
    const originalPrice = product.price;
    const newPrice = originalPrice * (1 - discount / 100);
    const appliedAt = new Date().toISOString();
    
    // Update product price in DynamoDB
    const updateItemCommand = new UpdateItemCommand({
      TableName: config.tableName,
      Key: marshall({
        PK: `PRODUCT#${productId}`,
        SK: 'METADATA',
      }),
      UpdateExpression: 'SET price = :newPrice, originalPrice = :originalPrice, discountPercent = :discount, discountReason = :reason, discountAppliedAt = :appliedAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: marshall({
        ':newPrice': newPrice,
        ':originalPrice': originalPrice,
        ':discount': discount,
        ':reason': reason || 'AI-recommended discount',
        ':appliedAt': appliedAt,
        ':updatedAt': appliedAt,
      }),
    });
    
    await dynamoDBClient.send(updateItemCommand);
    
    // Publish event to EventBridge for audit trail
    const putEventsCommand = new PutEventsCommand({
      Entries: [
        {
          Source: 'vyapargyan.bedrock',
          DetailType: 'DiscountApplied',
          Detail: JSON.stringify({
            productId,
            sellerId,
            originalPrice,
            newPrice,
            discountPercent: discount,
            reason: reason || 'AI-recommended discount',
            appliedAt,
            agentId: event.agent.id,
            sessionId: event.sessionId,
          }),
          EventBusName: config.eventBusName,
        },
      ],
    });
    
    await eventBridgeClient.send(putEventsCommand);
    
    const discountResponse = {
      productId,
      productName: product.name,
      originalPrice,
      newPrice,
      discountPercent: discount,
      appliedAt,
    };
    
    logger.info('Discount applied successfully', discountResponse);
    
    return createSuccessResponse(event, discountResponse);
  } catch (error) {
    logger.error('Failed to apply discount', error, { productId, sellerId, discountPercent: discount });
    return createErrorResponse(
      event,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Failed to apply discount',
      500
    );
  }
}

/**
 * Handle POST /whatsapp
 * Sends WhatsApp message via Twilio
 */
async function handleSendWhatsApp(
  event: BedrockActionGroupEvent
): Promise<BedrockActionGroupResponse> {
  const body = parseRequestBody(event);
  const { customerPhone, message, mediaUrl } = body;
  
  if (!customerPhone || !message) {
    return createErrorResponse(
      event,
      'MISSING_PARAMETERS',
      'customerPhone and message are required',
      400
    );
  }
  
  logger.info('Sending WhatsApp message', { customerPhone, messageLength: message.length });
  
  try {
    const result = await twilioAdapter.sendWhatsAppMessage(
      customerPhone,
      message,
      mediaUrl
    );
    
    const whatsappResponse = {
      messageId: result.messageId,
      status: result.status,
      sentAt: result.dateCreated.toISOString(),
      customerPhone,
    };
    
    logger.info('WhatsApp message sent successfully', whatsappResponse);
    
    return createSuccessResponse(event, whatsappResponse);
  } catch (error) {
    logger.error('Failed to send WhatsApp message', error, { customerPhone });
    return createErrorResponse(
      event,
      'WHATSAPP_ERROR',
      error instanceof Error ? error.message : 'Failed to send WhatsApp message',
      500
    );
  }
}

/**
 * Route API path to appropriate handler
 */
async function routeRequest(
  event: BedrockActionGroupEvent
): Promise<BedrockActionGroupResponse> {
  const { apiPath, httpMethod } = event;
  
  logger.info('Routing request', { apiPath, httpMethod });
  
  // Route based on API path and method
  if (apiPath === '/inventory' && httpMethod === 'GET') {
    return handleGetInventory(event);
  }
  
  if (apiPath === '/discount' && httpMethod === 'POST') {
    return handleApplyDiscount(event);
  }
  
  if (apiPath === '/whatsapp' && httpMethod === 'POST') {
    return handleSendWhatsApp(event);
  }
  
  // For catalog operations, delegate to action-group-executor
  if (apiPath.startsWith('/catalog/')) {
    // Import and delegate to catalog handler
    const { handler: catalogHandler } = await import('./action-group-executor.js');
    return catalogHandler(event);
  }
  
  // Unknown path
  return createErrorResponse(
    event,
    'NOT_FOUND',
    `API path ${apiPath} not found`,
    404
  );
}

/**
 * Lambda handler for Bedrock Agent Action Group
 * 
 * Main entry point for Amazon Bedrock Agent invocations.
 * Routes requests to appropriate business logic handlers.
 */
export async function handler(event: BedrockActionGroupEvent): Promise<BedrockActionGroupResponse> {
  return withContext(
    {
      requestId: event.sessionId,
      agentId: event.agent.id,
      actionGroup: event.actionGroup,
    },
    async () => {
      logger.info('Bedrock action group invoked', {
        apiPath: event.apiPath,
        httpMethod: event.httpMethod,
        inputText: event.inputText,
      });
      
      try {
        const response = await routeRequest(event);
        
        logger.info('Request completed successfully', {
          statusCode: response.response.httpStatusCode,
        });
        
        return response;
      } catch (error) {
        logger.error('Request failed', error, {
          apiPath: event.apiPath,
          httpMethod: event.httpMethod,
        });
        
        return createErrorResponse(
          event,
          'INTERNAL_ERROR',
          error instanceof Error ? error.message : 'An unexpected error occurred',
          500
        );
      }
    }
  );
}
