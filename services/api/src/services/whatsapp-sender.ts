import twilio, { Twilio } from 'twilio';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';
import { MessageRepository } from '../repositories/message-repository';

const messageRepository = new MessageRepository();

export interface TextMessage {
  type: 'text';
  text: string;
}

export interface InteractiveButtonMessage {
  type: 'interactive';
  body: string;
  buttons: Array<{
    id: string;
    title: string;
  }>;
}

export interface InteractiveListMessage {
  type: 'interactive';
  body: string;
  buttonText: string;
  sections: Array<{
    title?: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
}

export type OutboundMessage = TextMessage | InteractiveButtonMessage | InteractiveListMessage;

/**
 * WhatsAppSender
 * 
 * Handles outbound WhatsApp message sending via Twilio's API.
 * Includes retry logic and message persistence.
 * 
 * Note: Twilio's WhatsApp API has limited support for interactive messages.
 * Interactive buttons and lists are converted to text format with numbered options.
 */
export class WhatsAppSender {
  private client?: Twilio;
  private fromNumber?: string;

  private async initialize(): Promise<void> {
    if (this.client) {
      return;
    }
    
    const config = await getConfig();
    this.fromNumber = config.twilioPhoneNumber;
    this.client = twilio(config.twilioAccountSid, config.twilioAuthToken);
    
    logger.info('WhatsAppSender initialized', {
      fromNumber: this.fromNumber,
    });
  }

  /**
   * Send a message to a WhatsApp user
   */
  async sendMessage(
    phoneNumber: string,
    message: OutboundMessage,
    sessionId: string
  ): Promise<string> {
    await this.initialize();
    
    logger.info('Sending WhatsApp message', {
      sessionId,
      phoneNumber,
      messageType: message.type,
    });

    try {
      const response = await this.sendWithRetry(phoneNumber, message);
      const waMessageId = response.sid;

      // Persist outbound message
      await messageRepository.create({
        sessionId,
        waMessageId,
        direction: 'outbound',
        messageType: message.type,
        content: message,
        waStatus: 'sent',
      });

      logger.info('WhatsApp message sent successfully', {
        sessionId,
        waMessageId,
        phoneNumber,
        status: response.status,
      });

      return waMessageId;
    } catch (error) {
      logger.error('Failed to send WhatsApp message', {
        sessionId,
        phoneNumber,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Persist failed message attempt
      await messageRepository.create({
        sessionId,
        waMessageId: `failed-${Date.now()}`,
        direction: 'outbound',
        messageType: message.type,
        content: message,
        waStatus: 'failed',
      });

      throw error;
    }
  }

  /**
   * Send with exponential backoff retry
   */
  private async sendWithRetry(
    phoneNumber: string,
    message: OutboundMessage,
    maxAttempts: number = 3
  ): Promise<any> {
    if (!this.client || !this.fromNumber) {
      throw new Error('WhatsAppSender not initialized');
    }
    
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Format phone numbers for Twilio WhatsApp
        const from = `whatsapp:${this.fromNumber}`;
        const to = `whatsapp:${phoneNumber}`;
        
        // Format message body based on type
        const body = this.formatMessageBody(message);
        
        logger.debug('Sending Twilio message', {
          attempt,
          from,
          to,
          bodyLength: body.length,
        });
        
        const response = await this.client.messages.create({
          from,
          to,
          body,
        });
        
        logger.debug('Twilio message created', {
          sid: response.sid,
          status: response.status,
          dateCreated: response.dateCreated,
        });
        
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        logger.warn('Twilio send attempt failed', {
          attempt,
          maxAttempts,
          error: lastError.message,
          errorCode: (error as any)?.code,
          errorStatus: (error as any)?.status,
        });
        
        if (attempt < maxAttempts) {
          const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          logger.info('Retrying after delay', { delayMs, attempt });
          await this.delay(delayMs);
        }
      }
    }

    throw lastError;
  }

  /**
   * Format message body for Twilio
   * 
   * Twilio's WhatsApp API primarily supports text messages.
   * Interactive messages (buttons/lists) are converted to text format with numbered options.
   * 
   * For production use with interactive messages, consider:
   * 1. Using Twilio's Content API with pre-approved templates
   * 2. Implementing a custom interactive message parser on the client side
   * 3. Using Twilio's Programmable Messaging API with custom webhooks
   */
  private formatMessageBody(message: OutboundMessage): string {
    if (message.type === 'text') {
      return message.text;
    }

    if (message.type === 'interactive') {
      let body = message.body + '\n\n';
      
      if ('buttons' in message) {
        // Convert buttons to numbered list
        body += '📋 Please choose an option:\n\n';
        message.buttons.forEach((btn, idx) => {
          body += `${idx + 1}. ${btn.title}\n`;
        });
        body += '\n💬 Reply with the number of your choice (e.g., "1")';
      } else if ('sections' in message) {
        // Convert list to numbered options
        body += '📋 Please choose an option:\n\n';
        let optionNum = 1;
        
        message.sections.forEach(section => {
          if (section.title) {
            body += `\n*${section.title}*\n`;
          }
          section.rows.forEach(row => {
            body += `${optionNum}. ${row.title}`;
            if (row.description) {
              body += ` - ${row.description}`;
            }
            body += '\n';
            optionNum++;
          });
        });
        
        body += '\n💬 Reply with the number of your choice (e.g., "1")';
      }
      
      return body;
    }

    throw new Error(`Unsupported message type: ${(message as any).type}`);
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const whatsappSender = new WhatsAppSender();
