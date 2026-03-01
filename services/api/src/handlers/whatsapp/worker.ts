import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { logger } from '../../utils/logger';
import { idempotencyService } from '../../utils/idempotency';
import { CustomerRepository } from '../../repositories/customer-repository';
import { SessionRepository } from '../../repositories/session-repository';
import { routeMessage } from './states/router';

const customerRepository = new CustomerRepository();
const sessionRepository = new SessionRepository();

/**
 * WhatsApp Worker Lambda
 * 
 * Processes WhatsApp webhook events from SQS queue.
 * Handles idempotency, customer/session resolution, and message routing.
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info('Processing WhatsApp worker batch', {
    recordCount: event.Records.length,
  });

  // Process records in parallel
  const results = await Promise.allSettled(
    event.Records.map(record => processRecord(record))
  );

  // Log any failures
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    logger.error('Some records failed processing', {
      failureCount: failures.length,
      totalCount: results.length,
    });
  }

  logger.info('Worker batch processing complete', {
    successCount: results.filter(r => r.status === 'fulfilled').length,
    failureCount: failures.length,
  });
};

/**
 * Process a single SQS record
 */
async function processRecord(record: SQSRecord): Promise<void> {
  const messageId = record.messageId;
  
  try {
    // Parse EventBridge event from SQS message
    const eventBridgeEvent = JSON.parse(record.body);
    const detail = JSON.parse(eventBridgeEvent.detail);
    
    logger.info('Processing WhatsApp webhook event', {
      messageId,
      requestId: detail.requestId,
    });

    // Extract WhatsApp payload
    const whatsappPayload = detail.payload;
    
    // Process each entry in the webhook payload
    for (const entry of whatsappPayload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'messages') {
          await processMessageChange(change.value, detail.requestId);
        }
      }
    }
  } catch (error) {
    logger.error('Error processing SQS record', {
      messageId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error; // Re-throw to move message to DLQ
  }
}

/**
 * Process a message change from WhatsApp webhook
 */
async function processMessageChange(value: any, requestId: string): Promise<void> {
  const messages = value.messages || [];
  const contacts = value.contacts || [];
  
  for (const message of messages) {
    const messageId = message.id;
    
    // Check for duplicates using idempotency service
    const isFirstTime = await idempotencyService.acquireLock(messageId, {
      requestId,
      from: message.from,
      timestamp: message.timestamp,
    });

    if (!isFirstTime) {
      logger.info('Skipping duplicate message', { messageId });
      continue;
    }

    // Extract contact information
    const contact = contacts.find((c: any) => c.wa_id === message.from);
    const phoneNumber = message.from;
    const profileName = contact?.profile?.name || 'Unknown';

    logger.info('Processing new message', {
      messageId,
      phoneNumber,
      profileName,
      messageType: message.type,
    });

    // Resolve or create customer
    const customer = await customerRepository.resolveOrCreate({
      phoneNumber,
      profileName,
      whatsappId: contact?.wa_id,
    });

    // Resolve or create session
    const session = await sessionRepository.resolveOrCreate({
      customerId: customer.id,
      phoneNumber,
      channelType: 'whatsapp',
    });

    logger.info('Customer and session resolved', {
      customerId: customer.id,
      sessionId: session.id,
      sessionState: session.state,
    });

    // Route message to appropriate state handler
    await routeMessage({
      message,
      customer,
      session,
      requestId,
    });
  }
}
