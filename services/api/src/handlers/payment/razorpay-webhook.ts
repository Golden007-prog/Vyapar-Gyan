import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { logger } from '../../utils/logger';
import { getConfig } from '../../utils/config';
import { RazorpayAdapter } from '../../adapters/razorpay-adapter';
import { TwilioAdapter } from '../../adapters/twilio-adapter';

const dynamoDBClient = new DynamoDBClient({});
const razorpayAdapter = new RazorpayAdapter();
const twilioAdapter = new TwilioAdapter();

/**
 * Razorpay Webhook Handler
 * 
 * Handles payment events from Razorpay:
 * - payment.captured: Payment successful, update order status
 * - payment.failed: Payment failed, notify customer
 * - payment_link.paid: Payment link completed
 * 
 * Security:
 * - Verifies webhook signature to ensure authenticity
 * - Validates order exists before processing
 * - Idempotent processing to handle duplicate webhooks
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const requestId = event.requestContext.requestId;

  logger.info('Razorpay webhook received', {
    requestId,
    headers: event.headers,
  });

  try {
    // Get webhook signature from headers
    const signature = event.headers['x-razorpay-signature'] || event.headers['X-Razorpay-Signature'];
    
    if (!signature) {
      logger.warn('Missing Razorpay webhook signature', { requestId });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing signature' }),
      };
    }

    // Verify webhook signature
    const payload = event.body || '';
    const isValid = razorpayAdapter.verifyWebhookSignature(payload, signature);

    if (!isValid) {
      logger.error('Invalid Razorpay webhook signature', { requestId });
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    // Parse webhook payload
    const webhookData = JSON.parse(payload);
    const eventType = webhookData.event;

    logger.info('Processing Razorpay webhook event', {
      requestId,
      eventType,
      paymentId: webhookData.payload?.payment?.entity?.id,
    });

    // Handle different event types
    switch (eventType) {
      case 'payment.captured':
        await handlePaymentCaptured(webhookData, requestId);
        break;

      case 'payment.failed':
        await handlePaymentFailed(webhookData, requestId);
        break;

      case 'payment_link.paid':
        await handlePaymentLinkPaid(webhookData, requestId);
        break;

      default:
        logger.info('Unhandled webhook event type', { requestId, eventType });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'success' }),
    };
  } catch (error) {
    logger.error('Error processing Razorpay webhook', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * Handle payment.captured event
 * 
 * Updates order status from PENDING_PAYMENT to PAID
 * Notifies customer and seller
 */
async function handlePaymentCaptured(webhookData: any, requestId: string): Promise<void> {
  const payment = webhookData.payload.payment.entity;
  const orderId = payment.notes?.order_id;

  if (!orderId) {
    logger.error('Order ID not found in payment notes', {
      requestId,
      paymentId: payment.id,
    });
    return;
  }

  logger.info('Processing payment captured', {
    requestId,
    orderId,
    paymentId: payment.id,
    amount: payment.amount,
  });

  const config = await getConfig();

  // Get order details
  const order = await getOrder(config.tableName, orderId);
  
  if (!order) {
    logger.error('Order not found', { requestId, orderId });
    return;
  }

  // Check if already processed (idempotency)
  if (order.status === 'PAID' || order.status === 'CONFIRMED') {
    logger.info('Order already processed', {
      requestId,
      orderId,
      currentStatus: order.status,
    });
    return;
  }

  // Update order status to PAID
  await updateOrderStatus(config.tableName, orderId, 'PAID', {
    paymentId: payment.id,
    paymentMethod: payment.method,
    paymentCapturedAt: new Date().toISOString(),
    razorpayOrderId: payment.order_id,
  });

  logger.info('Order status updated to PAID', {
    requestId,
    orderId,
    paymentId: payment.id,
  });

  // Notify customer
  await notifyCustomerPaymentSuccess(order, requestId);

  // Notify seller
  await notifySellerNewOrder(order, requestId);
}

/**
 * Handle payment.failed event
 */
async function handlePaymentFailed(webhookData: any, requestId: string): Promise<void> {
  const payment = webhookData.payload.payment.entity;
  const orderId = payment.notes?.order_id;

  if (!orderId) {
    logger.error('Order ID not found in payment notes', {
      requestId,
      paymentId: payment.id,
    });
    return;
  }

  logger.info('Processing payment failed', {
    requestId,
    orderId,
    paymentId: payment.id,
    errorCode: payment.error_code,
    errorDescription: payment.error_description,
  });

  const config = await getConfig();

  // Get order details
  const order = await getOrder(config.tableName, orderId);
  
  if (!order) {
    logger.error('Order not found', { requestId, orderId });
    return;
  }

  // Update order with payment failure info
  await updateOrderStatus(config.tableName, orderId, 'PAYMENT_FAILED', {
    paymentId: payment.id,
    paymentFailedAt: new Date().toISOString(),
    paymentErrorCode: payment.error_code,
    paymentErrorDescription: payment.error_description,
  });

  // Notify customer about payment failure
  const message = `❌ Payment failed for order ${orderId}.\n\nReason: ${payment.error_description || 'Payment could not be processed'}\n\nPlease try again or contact support.`;

  await twilioAdapter.sendWhatsAppMessage(order.customerPhone, message);

  logger.info('Customer notified of payment failure', {
    requestId,
    orderId,
    customerPhone: order.customerPhone,
  });
}

/**
 * Handle payment_link.paid event
 */
async function handlePaymentLinkPaid(webhookData: any, requestId: string): Promise<void> {
  const paymentLink = webhookData.payload.payment_link.entity;
  const orderId = paymentLink.reference_id;

  logger.info('Processing payment link paid', {
    requestId,
    orderId,
    paymentLinkId: paymentLink.id,
  });

  // The actual payment capture will be handled by payment.captured event
  // This is just for logging/tracking
}

/**
 * Get order from DynamoDB
 */
async function getOrder(tableName: string, orderId: string): Promise<any> {
  const command = new GetItemCommand({
    TableName: tableName,
    Key: marshall({
      PK: `ORDER#${orderId}`,
      SK: 'METADATA',
    }),
  });

  const response = await dynamoDBClient.send(command);
  
  if (!response.Item) {
    return null;
  }

  return unmarshall(response.Item);
}

/**
 * Update order status in DynamoDB
 */
async function updateOrderStatus(
  tableName: string,
  orderId: string,
  status: string,
  additionalFields: Record<string, any> = {}
): Promise<void> {
  // Build update expression dynamically
  const updateExpressions: string[] = ['#status = :status', 'updatedAt = :updatedAt'];
  const expressionAttributeNames: Record<string, string> = { '#status': 'status' };
  const expressionAttributeValues: Record<string, any> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  // Add additional fields to update
  Object.entries(additionalFields).forEach(([key, value], index) => {
    const placeholder = `:field${index}`;
    const namePlaceholder = `#field${index}`;
    updateExpressions.push(`${namePlaceholder} = ${placeholder}`);
    expressionAttributeNames[namePlaceholder] = key;
    expressionAttributeValues[placeholder] = value;
  });

  const command = new UpdateItemCommand({
    TableName: tableName,
    Key: marshall({
      PK: `ORDER#${orderId}`,
      SK: 'METADATA',
    }),
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: marshall(expressionAttributeValues),
  });

  await dynamoDBClient.send(command);
}

/**
 * Notify customer of successful payment
 */
async function notifyCustomerPaymentSuccess(order: any, requestId: string): Promise<void> {
  const message = [
    '✅ *Payment Received!*',
    '',
    `📦 Order ID: *${order.orderId}*`,
    `💰 Amount Paid: *₹${order.totalAmount}*`,
    '',
    'Your order is confirmed! The seller will pack and ship your order soon.',
    '',
    'Thank you for shopping with VyaparGyan! 🎉',
  ].join('\n');

  try {
    await twilioAdapter.sendWhatsAppMessage(order.customerPhone, message);
    
    logger.info('Customer notified of payment success', {
      requestId,
      orderId: order.orderId,
      customerPhone: order.customerPhone,
    });
  } catch (error) {
    logger.error('Failed to notify customer', {
      requestId,
      orderId: order.orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Notify seller of new paid order
 */
async function notifySellerNewOrder(order: any, requestId: string): Promise<void> {
  // Get seller phone from order items
  // Note: In multi-seller orders, we'd need to notify each seller separately
  const sellerPhone = order.sellerPhone || order.items?.[0]?.sellerPhone;

  if (!sellerPhone) {
    logger.warn('Seller phone not found in order', {
      requestId,
      orderId: order.orderId,
    });
    return;
  }

  const message = [
    '🔔 *New Paid Order!*',
    '',
    `📦 Order ID: *${order.orderId}*`,
    `💰 Amount: *₹${order.totalAmount}*`,
    `👤 Customer: ${order.customerPhone}`,
    '',
    'Please pack and prepare this order for delivery.',
    '',
    'Login to your dashboard to view order details and update status.',
  ].join('\n');

  try {
    await twilioAdapter.sendWhatsAppMessage(sellerPhone, message);
    
    logger.info('Seller notified of new order', {
      requestId,
      orderId: order.orderId,
      sellerPhone,
    });
  } catch (error) {
    logger.error('Failed to notify seller', {
      requestId,
      orderId: order.orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
