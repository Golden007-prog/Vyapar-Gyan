import type { SQSEvent } from 'aws-lambda';
/**
 * WhatsApp Worker Lambda
 *
 * Processes WhatsApp webhook events from SQS queue.
 * Handles idempotency, customer/session resolution, and message routing.
 */
export declare const handler: (event: SQSEvent) => Promise<void>;
//# sourceMappingURL=worker.d.ts.map