/**
 * Twilio Adapter
 * 
 * Handles omnichannel messaging via Twilio's API for WhatsApp, SMS, and in-app chat.
 * This adapter provides a clean interface for sending messages across multiple channels.
 * 
 * Architecture:
 * - Initializes Twilio SDK client with credentials from config
 * - Supports WhatsApp, SMS, and future chat channels
 * - Includes retry logic with exponential backoff
 * - Structured logging for observability
 * 
 * Usage:
 * ```typescript
 * const adapter = new TwilioAdapter();
 * await adapter.sendWhatsAppMessage('+919876543210', 'Hello from VyaparGyan!');
 * ```
 */

import twilio, { Twilio } from 'twilio';
import { logger } from '../utils/logger';
import { getConfig } from '../utils/config';

export interface SendMessageOptions {
  to: string; // E.164 format phone number
  body: string;
  mediaUrl?: string; // Optional media attachment
}

export interface SendMessageResult {
  messageId: string; // Twilio message SID
  status: string;
  dateCreated: Date;
}

/**
 * TwilioAdapter
 * 
 * Provides methods for sending messages via Twilio's omnichannel platform.
 * Supports WhatsApp, SMS, and future messaging channels.
 */
export class TwilioAdapter {
  private client?: Twilio;
  private fromNumber?: string;
  private initialized = false;

  /**
   * Initialize the Twilio client with credentials from config
   * Lazy initialization to avoid loading config during module import
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const config = await getConfig();
    
    this.client = twilio(config.twilioAccountSid, config.twilioAuthToken);
    this.fromNumber = config.twilioPhoneNumber;
    this.initialized = true;

    logger.info('TwilioAdapter initialized', {
      fromNumber: this.fromNumber,
    });
  }

  /**
   * Send a WhatsApp message
   * 
   * @param to - Recipient phone number in E.164 format (e.g., "+919876543210")
   * @param body - Message text content
   * @param mediaUrl - Optional media URL for images/videos
   * @returns Message ID and status
   */
  async sendWhatsAppMessage(
    to: string,
    body: string,
    mediaUrl?: string
  ): Promise<SendMessageResult> {
    await this.initialize();

    if (!this.client || !this.fromNumber) {
      throw new Error('TwilioAdapter not properly initialized');
    }

    logger.info('Sending WhatsApp message', {
      to,
      bodyLength: body.length,
      hasMedia: !!mediaUrl,
    });

    try {
      const messageOptions: {
        to: string;
        from: string;
        body: string;
        mediaUrl?: string;
      } = {
        to: `whatsapp:${to}`,
        from: `whatsapp:${this.fromNumber}`,
        body,
      };
      
      if (mediaUrl) {
        messageOptions.mediaUrl = mediaUrl;
      }
      
      const result = await this.sendWithRetry(messageOptions);

      logger.info('WhatsApp message sent successfully', {
        messageId: result.messageId,
        to,
        status: result.status,
      });

      return result;
    } catch (error) {
      logger.error('Failed to send WhatsApp message', {
        to,
        error: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw error;
    }
  }

  /**
   * Send an SMS message
   * 
   * @param to - Recipient phone number in E.164 format
   * @param body - Message text content
   * @returns Message ID and status
   */
  async sendSMS(to: string, body: string): Promise<SendMessageResult> {
    await this.initialize();

    if (!this.client || !this.fromNumber) {
      throw new Error('TwilioAdapter not properly initialized');
    }

    logger.info('Sending SMS message', {
      to,
      bodyLength: body.length,
    });

    try {
      const result = await this.sendWithRetry({
        to,
        from: this.fromNumber,
        body,
      });

      logger.info('SMS sent successfully', {
        messageId: result.messageId,
        to,
        status: result.status,
      });

      return result;
    } catch (error) {
      logger.error('Failed to send SMS', {
        to,
        error: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code,
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw error;
    }
  }

  /**
   * Send message with exponential backoff retry logic
   * 
   * @param options - Message options including to, from, body, mediaUrl
   * @param maxAttempts - Maximum retry attempts (default: 3)
   * @returns Message result
   */
  private async sendWithRetry(
    options: { to: string; from: string; body: string; mediaUrl?: string },
    maxAttempts: number = 3
  ): Promise<SendMessageResult> {
    if (!this.client) {
      throw new Error('Twilio client not initialized');
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug('Attempting to send Twilio message', {
          attempt,
          maxAttempts,
          to: options.to,
          from: options.from,
        });

        const message = await this.client.messages.create({
          to: options.to,
          from: options.from,
          body: options.body,
          ...(options.mediaUrl && { mediaUrl: [options.mediaUrl] }),
        });

        logger.debug('Twilio message created', {
          sid: message.sid,
          status: message.status,
          dateCreated: message.dateCreated,
        });

        return {
          messageId: message.sid,
          status: message.status,
          dateCreated: message.dateCreated,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        logger.warn('Twilio send attempt failed', {
          attempt,
          maxAttempts,
          error: lastError.message,
          errorCode: (error as any)?.code,
          errorStatus: (error as any)?.status,
        });

        // Don't retry on client errors (4xx)
        const errorCode = (error as any)?.status;
        if (errorCode && errorCode >= 400 && errorCode < 500) {
          logger.error('Client error, not retrying', {
            errorCode,
            error: lastError.message,
          });
          throw lastError;
        }

        // Retry with exponential backoff for server errors (5xx) or network issues
        if (attempt < maxAttempts) {
          const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          logger.info('Retrying after delay', {
            delayMs,
            attempt,
            nextAttempt: attempt + 1,
          });
          await this.delay(delayMs);
        }
      }
    }

    throw lastError || new Error('Failed to send message after retries');
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get message status from Twilio
   * 
   * @param messageId - Twilio message SID
   * @returns Message status information
   */
  async getMessageStatus(messageId: string): Promise<{
    status: string;
    errorCode?: number;
    errorMessage?: string;
  }> {
    await this.initialize();

    if (!this.client) {
      throw new Error('Twilio client not initialized');
    }

    try {
      const message = await this.client.messages(messageId).fetch();

      const result: {
        status: string;
        errorCode?: number;
        errorMessage?: string;
      } = {
        status: message.status,
      };
      
      if (message.errorCode) {
        result.errorCode = message.errorCode;
      }
      
      if (message.errorMessage) {
        result.errorMessage = message.errorMessage;
      }
      
      return result;
    } catch (error) {
      logger.error('Failed to fetch message status', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }
}

// Singleton instance for reuse across Lambda invocations
export const twilioAdapter = new TwilioAdapter();
