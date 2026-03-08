import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandInput,
  ConverseCommandOutput,
  Tool,
  ToolResultBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import {
  getApprovalsBySeller,
  transitionStatus,
  executeApproval,
} from '../approval-service';
import { logAction } from '../audit-service';
import {
  queryMessages,
  putMessage,
  getUserProfile,
} from '../../adapters/dynamodb-adapter';
import { checkSendPermission } from '../consent-service';
import { twilioAdapter } from '../../adapters/twilio-adapter';

// Import User type inline to avoid module resolution issues
interface User {
  id: string;
  email: string;
  phoneNumber: string;
  role: 'admin' | 'seller' | 'customer';
  cognitoId: string;
  createdAt: string;
  updatedAt: string;
}

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Amazon Nova Lite model ID (native Amazon model, no Marketplace subscription required)
const MODEL_ID = 'amazon.nova-lite-v1:0';

// System prompt for the seller copilot
const SYSTEM_PROMPT = `You are the VyaparGyan Admin Assistant. You help sellers manage their store, review AI recommendations, handle orders, and communicate with customers — all via WhatsApp.

Always be concise and friendly. Use emojis sparingly. When a user asks to perform an action, use the appropriate tool.

## Message Classification
You MUST classify every seller message into one of two categories:
1. **Store management command** — Use tools like updateProductPrice, checkInventory, viewPendingApprovals, approveAction, rejectAction, or viewRecentOrders.
2. **Customer-directed message** — When the seller wants to send a message to a customer, ALWAYS use the replyToCustomer tool. Look for phrases like "reply to", "tell", "message", "send to", or any message clearly intended for a customer.

## Tool Usage Guidelines
- **viewPendingApprovals**: When the seller asks about pending approvals, recommendations, or AI suggestions.
- **approveAction**: When the seller wants to approve a specific recommendation. Requires the approvalId.
- **rejectAction**: When the seller wants to reject a recommendation. Requires approvalId and a reason.
- **viewRecentOrders**: When the seller asks about orders, sales, or recent transactions.
- **replyToCustomer**: When the seller wants to send a message to a customer. Provide the customer name and the message content.
- **updateProductPrice**: When the seller wants to change a product's price.
- **checkInventory**: When the seller asks about stock levels or product details.

## Important Guidelines
- Always confirm destructive actions (price changes, approvals) before executing
- Use Indian Rupee symbol (₹) for prices
- Be conversational and helpful
- If you need more information, ask clarifying questions
- After using a tool, provide a clear summary of what was done
- Never confuse a customer reply with a system command — if in doubt, ask the seller to clarify`;

/**
 * Seller WhatsApp Copilot
 * 
 * Handles WhatsApp messages from registered sellers using Amazon Bedrock Converse API.
 * Provides natural language interface for store management tasks:
 * - Update product prices
 * - Check inventory levels
 * - View product details
 */

export interface SellerCommandContext {
  user: User;
  message: string;
  phoneNumber: string;
  requestId: string;
}

/**
 * Tool definitions for Bedrock Converse API
 */
const SELLER_TOOLS: Tool[] = [
  {
    toolSpec: {
      name: 'updateProductPrice',
      description: 'Update the price of a product in the seller\'s inventory. Use this when the seller wants to change a product price.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            productName: {
              type: 'string',
              description: 'The name of the product to update (e.g., "Amul Butter", "Tata Salt")',
            },
            newPrice: {
              type: 'number',
              description: 'The new price in Indian Rupees (e.g., 290, 45.50)',
            },
          },
          required: ['productName', 'newPrice'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'checkInventory',
      description: 'Check the current stock quantity and price of a product. Use this when the seller asks about inventory levels or product details.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            productName: {
              type: 'string',
              description: 'The name of the product to check (e.g., "Amul Butter", "Tata Salt")',
            },
          },
          required: ['productName'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'viewPendingApprovals',
      description: 'List pending approval records for the seller. Use this when the seller asks about pending approvals, recommendations, or AI suggestions waiting for review.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'approveAction',
      description: 'Approve a pending approval by its ID. Use this when the seller wants to approve a specific recommendation or AI suggestion.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            approvalId: {
              type: 'string',
              description: 'The unique ID of the approval to approve',
            },
          },
          required: ['approvalId'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'rejectAction',
      description: 'Reject a pending approval with a reason. Use this when the seller wants to reject a specific recommendation or AI suggestion.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            approvalId: {
              type: 'string',
              description: 'The unique ID of the approval to reject',
            },
            rejectionReason: {
              type: 'string',
              description: 'The reason for rejecting this approval',
            },
          },
          required: ['approvalId', 'rejectionReason'],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'viewRecentOrders',
      description: 'List recent orders for the seller. Use this when the seller asks about their orders, sales, or recent transactions.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of orders to return (default: 10)',
            },
            status: {
              type: 'string',
              description: 'Filter by order status (e.g., "pending", "confirmed", "shipped", "delivered")',
            },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'replyToCustomer',
      description: 'Send a reply message to a customer on their preferred channel. Use this when the seller wants to send a message to a specific customer. The customer is resolved by name from recent conversations.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            customerName: {
              type: 'string',
              description: 'The name of the customer to reply to (fuzzy matched against recent conversations)',
            },
            message: {
              type: 'string',
              description: 'The message to send to the customer',
            },
          },
          required: ['customerName', 'message'],
        },
      },
    },
  },
];

/**
 * Handle incoming WhatsApp message from a seller using Bedrock Converse API
 */
export async function handleSellerWhatsAppCommand(
  context: SellerCommandContext
): Promise<string> {
  const { user, message, phoneNumber, requestId } = context;

  logger.info('Processing seller WhatsApp command with Bedrock', {
    requestId,
    sellerId: user.id,
    phoneNumber,
    messagePreview: message.substring(0, 50),
  });

  try {
    // Initial conversation with tools
    const response = await converseWithTools(user.id, message, requestId);
    
    logger.info('Seller command processed successfully', {
      requestId,
      sellerId: user.id,
      responseLength: response.length,
    });

    return response;
  } catch (error) {
    // Print full error object for debugging
    console.error('FULL AI ERROR:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    console.error('Error in handleSellerWhatsAppCommand - requestId:', requestId, 'sellerId:', user.id);
    
    logger.error('Error processing seller command with Bedrock', {
      requestId,
      sellerId: user.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Fallback to friendly error message
    return `Sorry, I encountered an error processing your request. Please try again or contact support if the issue persists.`;
  }
}

/**
 * Converse with Bedrock using tools (function calling)
 */
async function converseWithTools(
  sellerId: string,
  userMessage: string,
  requestId: string
): Promise<string> {
  // Build conversation as alternating user/assistant messages
  const messages: any[] = [
    {
      role: 'user',
      content: [{ text: userMessage }],
    },
  ];

  let continueLoop = true;
  let loopCount = 0;
  const maxLoops = 5; // Prevent infinite loops

  while (continueLoop && loopCount < maxLoops) {
    loopCount++;

    logger.info('Bedrock converse iteration', {
      requestId,
      sellerId,
      loopCount,
      messageCount: messages.length,
    });

    // Prepare converse input
    const input: ConverseCommandInput = {
      modelId: MODEL_ID,
      messages,
      system: [
        {
          text: SYSTEM_PROMPT,
        },
      ],
      toolConfig: {
        tools: SELLER_TOOLS,
      },
    };

    // Call Bedrock Converse API
    const command = new ConverseCommand(input);
    const response: ConverseCommandOutput = await bedrockClient.send(command);

    logger.info('Bedrock response received', {
      requestId,
      stopReason: response.stopReason,
      usage: response.usage,
    });

    // Check stop reason
    if (response.stopReason === 'end_turn') {
      // AI finished without tool use - extract text response
      const textContent = response.output?.message?.content?.find(
        (block: any) => 'text' in block
      );
      
      if (textContent && 'text' in textContent) {
        // Strip <thinking> tags from Amazon Nova responses
        const cleanedText = textContent.text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
        
        logger.info('Bedrock returned final text response', {
          requestId,
          responseLength: cleanedText.length,
          hadThinkingTags: cleanedText.length !== textContent.text.length,
        });
        return cleanedText;
      }
      
      logger.warn('Bedrock end_turn but no text content found', { requestId });
      return 'I understand, but I need more information to help you.';
    }

    if (response.stopReason === 'tool_use') {
      // AI wants to use a tool
      const toolUseBlock = response.output?.message?.content?.find(
        (block: any) => 'toolUse' in block
      );

      if (!toolUseBlock || !('toolUse' in toolUseBlock)) {
        logger.warn('Tool use requested but no toolUse block found', { requestId });
        return 'I tried to help but encountered an issue. Please try rephrasing your request.';
      }

      const toolUse = toolUseBlock.toolUse!;
      const toolName = toolUse.name;
      const toolInput = toolUse.input as Record<string, any>;
      const toolUseId = toolUse.toolUseId;

      logger.info('Executing tool', {
        requestId,
        toolName,
        toolInput,
        toolUseId,
      });

      // Log classification decision to audit trail
      const classification = toolName === 'replyToCustomer'
        ? 'seller_to_customer'
        : 'seller_to_system';

      // Fire-and-forget audit log for classification
      logAction({
        actorId: sellerId,
        actorRole: 'seller',
        actionType: 'copilot_classification',
        resourceType: 'copilot_tool',
        resourceId: toolUseId ?? toolName ?? 'unknown',
        newValues: { toolName, classification, toolInput },
        metadata: { channel: 'whatsapp_copilot' },
      }).catch((err) => {
        logger.warn('Failed to log classification decision', {
          requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Execute the tool
      let toolResult: any;
      try {
        if (toolName === 'updateProductPrice') {
          toolResult = await handleUpdatePrice(
            sellerId,
            toolInput.productName,
            toolInput.newPrice
          );
        } else if (toolName === 'checkInventory') {
          toolResult = await handleCheckInventory(
            sellerId,
            toolInput.productName
          );
        } else if (toolName === 'viewPendingApprovals') {
          toolResult = await handleViewPendingApprovals(sellerId);
        } else if (toolName === 'approveAction') {
          toolResult = await handleApproveAction(sellerId, toolInput.approvalId);
        } else if (toolName === 'rejectAction') {
          toolResult = await handleRejectAction(
            sellerId,
            toolInput.approvalId,
            toolInput.rejectionReason
          );
        } else if (toolName === 'viewRecentOrders') {
          toolResult = await handleViewRecentOrders(
            sellerId,
            toolInput.limit,
            toolInput.status
          );
        } else if (toolName === 'replyToCustomer') {
          toolResult = await handleReplyToCustomer(
            sellerId,
            toolInput.customerName,
            toolInput.message
          );
        } else {
          toolResult = { error: `Unknown tool: ${toolName}` };
        }
      } catch (error) {
        logger.error('Tool execution failed', {
          requestId,
          toolName,
          error: error instanceof Error ? error.message : String(error),
        });
        toolResult = {
          error: error instanceof Error ? error.message : 'Tool execution failed',
        };
      }

      logger.info('Tool executed', {
        requestId,
        toolName,
        toolResult,
      });

      // Add assistant's message with tool use to conversation
      messages.push({
        role: 'assistant',
        content: response.output?.message?.content || [],
      });

      // Add user's message with tool result to conversation
      const toolResultBlock: ToolResultBlock = {
        toolUseId: toolUseId!,
        content: [
          {
            json: toolResult,
          },
        ],
      };

      messages.push({
        role: 'user',
        content: [
          {
            toolResult: toolResultBlock,
          },
        ],
      });

      // Continue loop to get AI's final response
      continue;
    }

    // Other stop reasons (max_tokens, stop_sequence, etc.)
    logger.warn('Unexpected stop reason', {
      requestId,
      stopReason: response.stopReason,
    });
    
    continueLoop = false;
  }

  if (loopCount >= maxLoops) {
    logger.warn('Max conversation loops reached', { requestId, loopCount });
    return 'I tried to help but the conversation got too complex. Please try asking in a simpler way.';
  }

  return 'I understand your request. How else can I help you?';
}

/**
 * Handle updateProductPrice tool invocation
 */
async function handleUpdatePrice(
  sellerId: string,
  productName: string,
  newPrice: number
): Promise<any> {
  const config = await getConfig();
  const tableName = config.tableName;

  logger.info('Updating product price', {
    sellerId,
    productName,
    newPrice,
  });

  try {
    // Query products by seller using GSI1
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        FilterExpression: 'contains(#name, :productName) AND isActive = :active',
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        ExpressionAttributeValues: {
          ':pk': `SELLER#${sellerId}`,
          ':productName': productName,
          ':active': true,
        },
        Limit: 1,
      })
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return {
        success: false,
        message: `Product "${productName}" not found in your inventory. Please check the product name and try again.`,
      };
    }

    const product = queryResult.Items[0];
    if (!product) {
      return {
        success: false,
        message: `Product "${productName}" not found in your inventory.`,
      };
    }

    const productId = product.id;
    const oldPrice = product.price;

    // Update the product price
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: `PRODUCT#${productId}`,
          SK: 'METADATA',
        },
        UpdateExpression: 'SET price = :newPrice, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':newPrice': newPrice,
          ':updatedAt': new Date().toISOString(),
        },
      })
    );

    logger.info('Product price updated successfully', {
      sellerId,
      productId,
      productName: product.name,
      oldPrice,
      newPrice,
    });

    return {
      success: true,
      productName: product.name,
      oldPrice,
      newPrice,
      message: `Successfully updated ${product.name} price from ₹${oldPrice} to ₹${newPrice}`,
    };
  } catch (error) {
    logger.error('Failed to update product price', {
      sellerId,
      productName,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: 'Failed to update product price. Please try again.',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Handle checkInventory tool invocation
 */
async function handleCheckInventory(
  sellerId: string,
  productName: string
): Promise<any> {
  const config = await getConfig();
  const tableName = config.tableName;

  logger.info('Checking inventory', {
    sellerId,
    productName,
  });

  try {
    // Query products by seller using GSI1
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        FilterExpression: 'contains(#name, :productName) AND isActive = :active',
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        ExpressionAttributeValues: {
          ':pk': `SELLER#${sellerId}`,
          ':productName': productName,
          ':active': true,
        },
        Limit: 1,
      })
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return {
        success: false,
        message: `Product "${productName}" not found in your inventory.`,
      };
    }

    const product = queryResult.Items[0];
    if (!product) {
      return {
        success: false,
        message: `Product "${productName}" not found in your inventory.`,
      };
    }

    logger.info('Inventory checked successfully', {
      sellerId,
      productId: product.id,
      productName: product.name,
      stockQuantity: product.stockQuantity,
      price: product.price,
    });

    return {
      success: true,
      productName: product.name,
      stockQuantity: product.stockQuantity,
      price: product.price,
      message: `${product.name}: ${product.stockQuantity} units in stock at ₹${product.price} each`,
    };
  } catch (error) {
    logger.error('Failed to check inventory', {
      sellerId,
      productName,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: 'Failed to check inventory. Please try again.',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}


/**
 * Handle viewPendingApprovals tool invocation
 * Queries the approval service for pending approvals for this seller.
 */
async function handleViewPendingApprovals(sellerId: string): Promise<any> {
  logger.info('Viewing pending approvals', { sellerId });

  try {
    const result = await getApprovalsBySeller({
      sellerId,
      status: 'pending_review',
      limit: 10,
    });

    if (result.approvals.length === 0) {
      return {
        success: true,
        approvals: [],
        message: 'No pending approvals at the moment. You\'re all caught up! 👍',
      };
    }

    const summaries = result.approvals.map((a) => ({
      approvalId: a.approvalId,
      type: a.type,
      estimatedImpact: a.estimatedImpact,
      rationale: a.aiRationale?.substring(0, 120) ?? '',
      productCount: a.affectedProductIds?.length ?? 0,
      createdAt: a.createdAt,
    }));

    return {
      success: true,
      count: summaries.length,
      approvals: summaries,
      message: `You have ${summaries.length} pending approval(s). Use approveAction or rejectAction with the approvalId to take action.`,
    };
  } catch (error) {
    logger.error('Failed to fetch pending approvals', {
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: 'Failed to fetch pending approvals. Please try again.',
    };
  }
}

/**
 * Handle approveAction tool invocation
 * Approves a pending approval and triggers execution via EventBridge.
 */
async function handleApproveAction(
  sellerId: string,
  approvalId: string,
): Promise<any> {
  logger.info('Approving action', { sellerId, approvalId });

  try {
    const updated = await transitionStatus({
      approvalId,
      sellerId,
      newStatus: 'approved',
      approvedBy: sellerId,
    });

    // Publish execution event
    await executeApproval(approvalId, 'ApprovalApproved', {
      approvalId,
      sellerId,
      type: updated.type,
      payload: updated.payload,
    });

    // Log to audit trail
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'approval_approved',
      resourceType: 'approval',
      resourceId: approvalId,
      newValues: { status: 'approved' },
      metadata: { channel: 'whatsapp_copilot' },
    });

    return {
      success: true,
      approvalId,
      status: 'approved',
      message: `Approval ${approvalId} has been approved and execution has been triggered. ✅`,
    };
  } catch (error) {
    logger.error('Failed to approve action', {
      sellerId,
      approvalId,
      error: error instanceof Error ? error.message : String(error),
    });

    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Failed to approve: ${errMsg}`,
    };
  }
}

/**
 * Handle rejectAction tool invocation
 * Rejects a pending approval with a reason and logs to audit.
 */
async function handleRejectAction(
  sellerId: string,
  approvalId: string,
  rejectionReason: string,
): Promise<any> {
  logger.info('Rejecting action', { sellerId, approvalId, rejectionReason });

  try {
    await transitionStatus({
      approvalId,
      sellerId,
      newStatus: 'rejected',
      rejectionReason,
    });

    // Publish rejection event
    await executeApproval(approvalId, 'ApprovalRejected', {
      approvalId,
      sellerId,
      rejectionReason,
    });

    // Log to audit trail
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'approval_rejected',
      resourceType: 'approval',
      resourceId: approvalId,
      newValues: { status: 'rejected', rejectionReason },
      metadata: { channel: 'whatsapp_copilot' },
    });

    return {
      success: true,
      approvalId,
      status: 'rejected',
      message: `Approval ${approvalId} has been rejected. ❌`,
    };
  } catch (error) {
    logger.error('Failed to reject action', {
      sellerId,
      approvalId,
      error: error instanceof Error ? error.message : String(error),
    });

    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Failed to reject: ${errMsg}`,
    };
  }
}

/**
 * Handle viewRecentOrders tool invocation
 * Queries seller orders using the SellerOrdersIndex GSI.
 */
async function handleViewRecentOrders(
  sellerId: string,
  limit?: number,
  status?: string,
): Promise<any> {
  const config = await getConfig();

  logger.info('Viewing recent orders', { sellerId, limit, status });

  try {
    const queryLimit = Math.min(limit ?? 10, 20);

    const expressionValues: Record<string, any> = {
      ':sellerId': sellerId,
    };

    let filterExpression: string | undefined;
    let expressionNames: Record<string, string> | undefined;

    if (status) {
      filterExpression = '#orderStatus = :status';
      expressionNames = { '#orderStatus': 'status' };
      expressionValues[':status'] = status;
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: config.tableName,
        IndexName: 'SellerOrdersIndex',
        KeyConditionExpression: 'sellerId = :sellerId',
        ...(filterExpression && { FilterExpression: filterExpression }),
        ...(expressionNames && { ExpressionAttributeNames: expressionNames }),
        ExpressionAttributeValues: expressionValues,
        ScanIndexForward: false,
        Limit: queryLimit,
      }),
    );

    const orders = (result.Items ?? []).map((item: any) => ({
      orderId: item.orderId ?? item.id,
      status: item.status,
      customerId: item.customerId,
      totalAmount: item.totalAmount,
      createdAt: item.createdAt,
    }));

    if (orders.length === 0) {
      const statusMsg = status ? ` with status "${status}"` : '';
      return {
        success: true,
        orders: [],
        message: `No orders found${statusMsg}.`,
      };
    }

    return {
      success: true,
      count: orders.length,
      orders,
      message: `Found ${orders.length} recent order(s).`,
    };
  } catch (error) {
    logger.error('Failed to fetch recent orders', {
      sellerId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: 'Failed to fetch recent orders. Please try again.',
    };
  }
}

/**
 * Handle replyToCustomer tool invocation
 * Resolves customer by name from recent conversations, determines their
 * preferred channel, and routes the message accordingly.
 */
async function handleReplyToCustomer(
  sellerId: string,
  customerName: string,
  message: string,
): Promise<any> {
  logger.info('Replying to customer', { sellerId, customerName });

  try {
    // 1. Query recent messages in seller's thread to find customer by name (fuzzy match)
    const recentMessages = await queryMessages({
      userId: sellerId,
      limit: 100,
      scanForward: false,
    });

    // Collect unique customer userIds from inbound messages
    const customerUserIds = new Set<string>();
    for (const msg of recentMessages.messages) {
      if (msg.senderRole === 'customer' && msg.userId !== sellerId) {
        // Messages in THREAD#{sellerId} from customers — the userId on the message
        // may be the seller's thread, but we look for metadata about the sender
        if ((msg as any).senderUserId) {
          customerUserIds.add((msg as any).senderUserId);
        }
      }
    }

    // Also try to find customers by querying the seller's thread for distinct senders
    // Fall back to searching by name across user profiles
    const config = await getConfig();
    const nameSearch = customerName.toLowerCase();

    // Search for customer by name using a scan with filter (limited scope)
    const searchResult = await docClient.send(
      new QueryCommand({
        TableName: config.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :role',
        FilterExpression: 'contains(#displayName, :name)',
        ExpressionAttributeNames: { '#displayName': 'displayName' },
        ExpressionAttributeValues: {
          ':role': 'ROLE#customer',
          ':name': nameSearch,
        },
        Limit: 5,
      }),
    );

    const matchedCustomers = searchResult.Items ?? [];

    if (matchedCustomers.length === 0) {
      return {
        success: false,
        message: `Could not find a customer matching "${customerName}". Please check the name and try again.`,
      };
    }

    // Use the first match (best fuzzy match)
    const customer = matchedCustomers[0]!;
    const customerId = (customer.userId as string) ?? '';
    const customerPhone = (customer.phoneNumber as string) ?? '';
    const preferredChannel = (customer.preferredChannel as string) ?? 'whatsapp';
    const customerDisplayName = (customer.displayName as string) ?? customerName;

    // 2. Determine channel and send
    let deliveryChannel = 'web';
    let sentViaWhatsApp = false;

    if (preferredChannel === 'whatsapp' || preferredChannel === 'both') {
      if (customerPhone) {
        // Check service window for free-form WhatsApp message
        const permission = await checkSendPermission(customerId, 'transactional');

        if (permission.allowed) {
          // Get seller profile for business name prefix
          const sellerProfile = await getUserProfile(sellerId);
          const businessName = sellerProfile?.businessName ?? 'Your seller';
          const prefixedMessage = `[${businessName}] ${message}`;

          await twilioAdapter.sendWhatsAppMessage(customerPhone, prefixedMessage);
          deliveryChannel = 'whatsapp';
          sentViaWhatsApp = true;
        }
      }
    }

    // 3. Store the reply in THREAD#{sellerId} with senderRole: seller
    const now = new Date();
    const messageId = `reply-${now.getTime()}-${Math.random().toString(36).substring(2, 8)}`;

    await putMessage({
      userId: sellerId,
      messageId,
      direction: 'outbound',
      channel: sentViaWhatsApp ? 'whatsapp' : 'web',
      senderRole: 'seller',
      messageType: 'text',
      content: { body: message },
      deliveryStatus: sentViaWhatsApp ? 'sent' : 'queued',
      createdAt: now.toISOString(),
      expiresAt: Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60,
    });

    // Also store in THREAD#{customerId} for the customer's view
    await putMessage({
      userId: customerId,
      messageId: `${messageId}-customer`,
      direction: 'inbound',
      channel: sentViaWhatsApp ? 'whatsapp' : 'web',
      senderRole: 'seller',
      messageType: 'text',
      content: { body: message },
      deliveryStatus: sentViaWhatsApp ? 'sent' : 'queued',
      createdAt: now.toISOString(),
      expiresAt: Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60,
    });

    // 4. Log classification decision to audit trail
    await logAction({
      actorId: sellerId,
      actorRole: 'seller',
      actionType: 'copilot_customer_reply',
      resourceType: 'message',
      resourceId: messageId,
      newValues: {
        customerId,
        customerName: customerDisplayName,
        channel: deliveryChannel,
        sentViaWhatsApp,
      },
      metadata: { channel: 'whatsapp_copilot', classification: 'seller_to_customer' },
    });

    return {
      success: true,
      customerId,
      customerName: customerDisplayName,
      channel: deliveryChannel,
      message: `Message sent to ${customerDisplayName} via ${deliveryChannel}. ${sentViaWhatsApp ? '📱' : '💻'}`,
    };
  } catch (error) {
    logger.error('Failed to reply to customer', {
      sellerId,
      customerName,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      message: `Failed to send reply to "${customerName}". Please try again.`,
    };
  }
}
