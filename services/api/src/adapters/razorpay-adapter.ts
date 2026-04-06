import { createHmac } from 'crypto';
import { logger } from '../utils/logger';

export interface PaymentLinkOptions {
  orderId: string;
  amount: number;
  customerPhone: string;
  customerName?: string;
  description?: string;
  sellerAccountId: string;
  commissionAmount: number;
}

export interface PaymentLinkResponse {
  id: string;
  short_url: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * RazorpayAdapter
 * 
 * Handles Razorpay Route (Transfers) integration for payment links with commission splitting.
 * 
 * Features:
 * - Create payment links with automatic commission deduction
 * - Transfer seller amount directly to seller account
 * - Verify webhook signatures for security
 */
export class RazorpayAdapter {
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;
  private baseUrl: string;

  constructor() {
    this.keyId = process.env.RAZORPAY_KEY_ID || '';
    this.keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    this.baseUrl = 'https://api.razorpay.com/v1';

    if (!this.keyId || !this.keySecret) {
      logger.warn('Razorpay credentials not configured');
    }
  }

  /**
   * Create payment link with commission splitting via Razorpay Route
   * 
   * The platform receives the full amount, and automatically transfers
   * (amount - commission) to the seller's linked account.
   */
  async createPaymentLink(options: PaymentLinkOptions): Promise<PaymentLinkResponse> {
    const {
      orderId,
      amount,
      customerPhone,
      customerName,
      description,
      sellerAccountId,
      commissionAmount,
    } = options;

    // Calculate seller amount (total - commission)
    const sellerAmount = amount - commissionAmount;

    if (sellerAmount <= 0) {
      throw new Error('Seller amount must be positive after commission deduction');
    }

    // Convert to paise (Razorpay uses smallest currency unit)
    const amountInPaise = Math.round(amount * 100);
    const sellerAmountInPaise = Math.round(sellerAmount * 100);

    // Payment link expires 30 minutes from now (Unix timestamp in seconds)
    const expireBy = Math.floor(Date.now() / 1000) + 30 * 60;

    const payload = {
      amount: amountInPaise,
      currency: 'INR',
      accept_partial: false,
      description: description || `Order ${orderId}`,
      customer: {
        contact: customerPhone,
        name: customerName || 'Customer',
      },
      notify: {
        sms: false,
        whatsapp: false,
      },
      reminder_enable: false,
      expire_by: expireBy,
      callback_url: `${process.env.API_BASE_URL}/api/webhooks/razorpay/callback`,
      callback_method: 'get',
      reference_id: orderId,
      notes: {
        order_id: orderId,
        commission_amount: commissionAmount.toString(),
        seller_amount: sellerAmount.toString(),
      },
      // Razorpay Route: Transfer to seller account
      transfers: [
        {
          account: sellerAccountId,
          amount: sellerAmountInPaise,
          currency: 'INR',
          notes: {
            order_id: orderId,
            type: 'seller_payout',
          },
          linked_account_notes: [orderId],
          on_hold: false, // Transfer immediately on payment capture
        },
      ],
    };

    logger.info('Creating Razorpay payment link', {
      orderId,
      amount,
      sellerAmount,
      commissionAmount,
      sellerAccountId,
    });

    try {
      const response = await fetch(`${this.baseUrl}/payment_links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Razorpay payment link creation failed', {
          status: response.status,
          error: errorText,
          orderId,
        });
        throw new Error(`Razorpay API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;

      logger.info('Payment link created successfully', {
        orderId,
        paymentLinkId: data.id,
        shortUrl: data.short_url,
      });

      return {
        id: data.id,
        short_url: data.short_url,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
      };
    } catch (error) {
      logger.error('Error creating payment link', {
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Verify Razorpay webhook signature
   * 
   * Ensures webhook requests are authentic and from Razorpay.
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      logger.error('Razorpay webhook secret not configured');
      return false;
    }

    try {
      const expectedSignature = createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');

      const isValid = expectedSignature === signature;

      if (!isValid) {
        logger.warn('Invalid Razorpay webhook signature', {
          expected: expectedSignature.substring(0, 10) + '...',
          received: signature.substring(0, 10) + '...',
        });
      }

      return isValid;
    } catch (error) {
      logger.error('Error verifying webhook signature', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get payment details by payment ID
   */
  async getPayment(paymentId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/payments/${paymentId}`, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to fetch payment details', {
          paymentId,
          status: response.status,
          error: errorText,
        });
        throw new Error(`Razorpay API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Error fetching payment details', {
        paymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a refund for a payment via Razorpay Refunds API
   * Used by dispute resolution to issue full or partial refunds.
   */
  async createRefund(paymentId: string, amount: number): Promise<any> {
    const amountInPaise = Math.round(amount * 100);

    logger.info('Creating Razorpay refund', { paymentId, amount, amountInPaise });

    try {
      const response = await fetch(`${this.baseUrl}/payments/${paymentId}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
        },
        body: JSON.stringify({ amount: amountInPaise }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Razorpay refund creation failed', {
          paymentId,
          status: response.status,
          error: errorText,
        });
        throw new Error(`Razorpay refund API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      logger.info('Refund created successfully', { paymentId, refundId: (data as any).id });
      return data;
    } catch (error) {
      logger.error('Error creating refund', {
        paymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get payment link details
   */
  async getPaymentLink(paymentLinkId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/payment_links/${paymentLinkId}`, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Failed to fetch payment link details', {
          paymentLinkId,
          status: response.status,
          error: errorText,
        });
        throw new Error(`Razorpay API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      logger.error('Error fetching payment link details', {
        paymentLinkId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
