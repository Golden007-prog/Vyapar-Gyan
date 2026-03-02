import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
/**
 * WhatsApp Webhook Handler
 *
 * Handles both GET (verification) and POST (incoming messages) requests from Meta's WhatsApp Cloud API.
 *
 * GET: Responds to Meta's webhook verification challenge
 * POST: Validates signature, drops raw payload to EventBridge, returns 200 OK immediately
 */
export declare const handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;
//# sourceMappingURL=webhook.d.ts.map