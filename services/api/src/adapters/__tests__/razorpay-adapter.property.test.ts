/**
 * Property-Based Tests for RazorpayAdapter
 *
 * Property 7: Razorpay Payload Construction
 * Property 8: Webhook Signature Verification Round-Trip
 *
 * Uses fast-check to verify correctness across many random inputs.
 */

import * as fc from 'fast-check';
import { createHmac } from 'crypto';
import { RazorpayAdapter } from '../razorpay-adapter';

// ---------------------------------------------------------------------------
// Property 7: Razorpay Payload Construction
// ---------------------------------------------------------------------------

describe('Property 7: Razorpay Payload Construction', () => {
  const capturedPayloads: any[] = [];
  const originalFetch = global.fetch;

  beforeAll(() => {
    global.fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
      capturedPayloads.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          id: 'plink_test',
          short_url: 'https://rzp.io/test',
          amount: 0,
          currency: 'INR',
          status: 'created',
        }),
      } as Response;
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    capturedPayloads.length = 0;
  });

  /**
   * **Validates: Requirements 7.6, 15.2, 15.3, 15.4**
   *
   * For any order with totalAmount > 0 and commissionRate in (0,1),
   * the payment link payload has:
   *   - amount = totalAmount × 100 (paise)
   *   - currency = INR
   *   - reference_id = orderId
   *   - transfers[0].amount = (totalAmount - commissionAmount) × 100
   *   - notify.sms = false
   *   - notify.whatsapp = false
   */
  it('constructs correct Razorpay payload for any valid order', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';

    await fc.assert(
      fc.asyncProperty(
        // orderId: non-empty alphanumeric string
        fc.stringMatching(/^[A-Za-z0-9-]{1,30}$/),
        // totalAmount in rupees: positive integer (1 to 100000)
        fc.integer({ min: 1, max: 100000 }),
        // commissionRate: float strictly between 0 and 1
        fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        // customerPhone: valid Indian phone
        fc.constant('+919876543210'),
        // sellerAccountId: non-empty string
        fc.stringMatching(/^acc_[a-zA-Z0-9]{5,15}$/),
        async (orderId, totalAmount, commissionRate, customerPhone, sellerAccountId) => {
          const commissionAmount = Math.round(totalAmount * commissionRate);
          const sellerAmount = totalAmount - commissionAmount;

          // Skip edge case where sellerAmount <= 0
          if (sellerAmount <= 0) return;

          capturedPayloads.length = 0;

          const adapter = new RazorpayAdapter();

          await adapter.createPaymentLink({
            orderId,
            amount: totalAmount,
            customerPhone,
            customerName: 'Test Customer',
            description: `Order ${orderId}`,
            sellerAccountId,
            commissionAmount,
          });

          expect(capturedPayloads.length).toBe(1);
          const payload = capturedPayloads[0];

          // Amount in paise
          expect(payload.amount).toBe(Math.round(totalAmount * 100));

          // Currency is INR
          expect(payload.currency).toBe('INR');

          // reference_id = orderId
          expect(payload.reference_id).toBe(orderId);

          // Transfers amount = sellerAmount in paise
          expect(payload.transfers).toBeDefined();
          expect(payload.transfers.length).toBe(1);
          expect(payload.transfers[0].amount).toBe(Math.round(sellerAmount * 100));
          expect(payload.transfers[0].account).toBe(sellerAccountId);

          // Notifications disabled (platform sends its own)
          expect(payload.notify.sms).toBe(false);
          expect(payload.notify.whatsapp).toBe(false);

          // accept_partial is false
          expect(payload.accept_partial).toBe(false);

          // expire_by is set (Unix timestamp in seconds, in the future)
          expect(typeof payload.expire_by).toBe('number');
          expect(payload.expire_by).toBeGreaterThan(Math.floor(Date.now() / 1000));
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 8: Webhook Signature Verification Round-Trip
// ---------------------------------------------------------------------------

describe('Property 8: Webhook Signature Verification Round-Trip', () => {
  /**
   * **Validates: Requirements 15.6**
   *
   * For any payload and secret, computing HMAC-SHA256 of the payload with
   * the secret and verifying with verifyWebhookSignature returns true.
   * Modifying any character in the payload or signature causes failure.
   */
  it('HMAC-SHA256 verification round-trips correctly for any payload and secret', () => {
    fc.assert(
      fc.property(
        // payload: arbitrary non-empty string (simulating JSON body)
        fc.string({ minLength: 1, maxLength: 500 }),
        // secret: arbitrary non-empty string
        fc.string({ minLength: 1, maxLength: 100 }),
        (payload, secret) => {
          // Set the webhook secret
          process.env.RAZORPAY_WEBHOOK_SECRET = secret;
          process.env.RAZORPAY_KEY_ID = 'rzp_test';
          process.env.RAZORPAY_KEY_SECRET = 'test_secret';

          const adapter = new RazorpayAdapter();

          // Compute the correct HMAC-SHA256 signature
          const correctSignature = createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

          // Verification with correct signature should return true
          expect(adapter.verifyWebhookSignature(payload, correctSignature)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('any modification to payload after signing causes verification to fail', () => {
    fc.assert(
      fc.property(
        // payload: non-empty string
        fc.string({ minLength: 2, maxLength: 500 }),
        // secret: non-empty string
        fc.string({ minLength: 1, maxLength: 100 }),
        // index to modify
        fc.nat(),
        // character to insert/replace
        fc.char(),
        (payload, secret, rawIndex, newChar) => {
          process.env.RAZORPAY_WEBHOOK_SECRET = secret;
          process.env.RAZORPAY_KEY_ID = 'rzp_test';
          process.env.RAZORPAY_KEY_SECRET = 'test_secret';

          const adapter = new RazorpayAdapter();

          // Compute signature for original payload
          const signature = createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

          // Modify the payload at a random position
          const index = rawIndex % payload.length;
          const originalChar = payload[index];

          // Only test when the modification actually changes the payload
          if (newChar === originalChar) return;

          const tamperedPayload =
            payload.substring(0, index) + newChar + payload.substring(index + 1);

          // Tampered payload should fail verification
          expect(adapter.verifyWebhookSignature(tamperedPayload, signature)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('any modification to signature causes verification to fail', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.nat(),
        (payload, secret, rawIndex) => {
          process.env.RAZORPAY_WEBHOOK_SECRET = secret;
          process.env.RAZORPAY_KEY_ID = 'rzp_test';
          process.env.RAZORPAY_KEY_SECRET = 'test_secret';

          const adapter = new RazorpayAdapter();

          const signature = createHmac('sha256', secret)
            .update(payload)
            .digest('hex');

          // Flip one hex character in the signature
          const index = rawIndex % signature.length;
          const originalChar = signature[index]!;
          const flippedChar = originalChar === 'a' ? 'b' : 'a';

          const tamperedSignature =
            signature.substring(0, index) + flippedChar + signature.substring(index + 1);

          expect(adapter.verifyWebhookSignature(payload, tamperedSignature)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
