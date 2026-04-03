/**
 * Zod validation schemas for WebSocket real-time messaging
 *
 * Covers schemas from design document:
 * - MessageType enum (Req 12.1)
 * - Rich message content schemas (Req 12.2, 9.1, 10.1, 11.1, 11.3)
 * - WebSocket action schemas (Req 3.1, 5.1, 6.3, 4.6)
 * - Connection Registry and Presence record types (Req 2.1, 2.5, 14.1)
 */

import { z } from 'zod';

// ============================================================================
// MessageType Enum
// ============================================================================

/**
 * All supported message types in the chat system.
 *
 * Validates: Requirement 12.1
 */
export const MessageTypeSchema = z.enum([
  'text',
  'image',
  'audio',
  'interactive',
  'product_card',
  'order_status',
  'ai_suggestion',
  'quick_reply',
  'system',
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

// ============================================================================
// Rich Message Content Schemas
// ============================================================================

/**
 * Text message content: simple body string.
 *
 * Validates: Requirement 12.2
 */
export const TextContentSchema = z.object({
  body: z.string().min(1),
});
export type TextContent = z.infer<typeof TextContentSchema>;

/**
 * Product card content for in-chat product browsing.
 *
 * Validates: Requirements 9.1, 12.2
 */
export const ProductCardContentSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  imageUrl: z.string().url(),
  sellerId: z.string().min(1),
  description: z.string(),
});
export type ProductCardContent = z.infer<typeof ProductCardContentSchema>;

/**
 * Order status card content for in-chat order tracking.
 *
 * Validates: Requirements 10.1, 12.2
 */
export const OrderStatusContentSchema = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  status: z.string().min(1),
  items: z.array(
    z.object({
      name: z.string().min(1),
      quantity: z.number().int().positive(),
    })
  ),
  totalAmount: z.number().nonnegative(),
  updatedAt: z.string(),
});
export type OrderStatusContent = z.infer<typeof OrderStatusContentSchema>;

/**
 * AI suggestion card content for seller insights.
 *
 * Validates: Requirements 11.1, 12.2
 */
export const AISuggestionContentSchema = z.object({
  suggestionId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  actionType: z.string().min(1),
  actionPayload: z.record(z.string(), z.unknown()),
});
export type AISuggestionContent = z.infer<typeof AISuggestionContentSchema>;

/**
 * Quick reply content with selectable options.
 *
 * Validates: Requirements 11.3, 12.2
 */
export const QuickReplyContentSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string().min(1),
    })
  ).min(1),
});
export type QuickReplyContent = z.infer<typeof QuickReplyContentSchema>;

/**
 * Discriminated union of all rich message content schemas.
 * Maps each messageType to its corresponding content schema.
 */
export const RichMessageContentSchema = z.union([
  TextContentSchema,
  ProductCardContentSchema,
  OrderStatusContentSchema,
  AISuggestionContentSchema,
  QuickReplyContentSchema,
]);
export type RichMessageContent = z.infer<typeof RichMessageContentSchema>;

/**
 * Map of messageType to its content schema for programmatic validation.
 */
export const contentSchemaByType: Record<string, z.ZodTypeAny> = {
  text: TextContentSchema,
  product_card: ProductCardContentSchema,
  order_status: OrderStatusContentSchema,
  ai_suggestion: AISuggestionContentSchema,
  quick_reply: QuickReplyContentSchema,
};

// ============================================================================
// WebSocket Action Schemas
// ============================================================================

/**
 * Heartbeat action to keep connection alive and refresh TTL.
 *
 * Validates: Requirement 5.1
 */
export const HeartbeatActionSchema = z.object({
  action: z.literal('heartbeat'),
});
export type HeartbeatAction = z.infer<typeof HeartbeatActionSchema>;

/**
 * Typing indicator action.
 *
 * Validates: Requirement 13.1
 */
export const TypingActionSchema = z.object({
  action: z.literal('typing'),
  conversationUserId: z.string().min(1),
  isTyping: z.boolean(),
});
export type TypingAction = z.infer<typeof TypingActionSchema>;

/**
 * Mark message as read action.
 *
 * Validates: Requirement 6.3
 */
export const MarkReadActionSchema = z.object({
  action: z.literal('markRead'),
  messageId: z.string().min(1),
});
export type MarkReadAction = z.infer<typeof MarkReadActionSchema>;

/**
 * Sync action to request missed messages after reconnection.
 *
 * Validates: Requirement 4.6
 */
export const SyncActionSchema = z.object({
  action: z.literal('sync'),
  lastMessageTimestamp: z.string(),
});
export type SyncAction = z.infer<typeof SyncActionSchema>;

/**
 * Discriminated union of all WebSocket actions handled by the $default route.
 */
export const WebSocketActionSchema = z.discriminatedUnion('action', [
  HeartbeatActionSchema,
  TypingActionSchema,
  MarkReadActionSchema,
  SyncActionSchema,
]);
export type WebSocketAction = z.infer<typeof WebSocketActionSchema>;

/**
 * SendMessage payload for the sendMessage WebSocket route.
 *
 * Validates: Requirements 3.1, 12.1, 12.2
 */
export const SendMessagePayloadSchema = z.object({
  action: z.literal('sendMessage'),
  recipientId: z.string().min(1),
  messageType: MessageTypeSchema,
  content: z.unknown(),
  clientMessageId: z.string().optional(),
});
export type SendMessagePayload = z.infer<typeof SendMessagePayloadSchema>;

// ============================================================================
// Delivery Status
// ============================================================================

/**
 * Message delivery status lifecycle values.
 *
 * Validates: Requirement 6.1
 */
export const DeliveryStatusSchema = z.enum([
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

// ============================================================================
// DynamoDB Record Types
// ============================================================================

/**
 * Connection Registry item stored in DynamoDB.
 * PK: CONN#{connectionId}, SK: META
 * GSI1PK: USER_CONN#{userId}, GSI1SK: CONN#{connectionId}
 *
 * Validates: Requirements 2.1, 2.5
 */
export const ConnectionRegistryItemSchema = z.object({
  PK: z.string().startsWith('CONN#'),
  SK: z.literal('META'),
  GSI1PK: z.string().startsWith('USER_CONN#'),
  GSI1SK: z.string().startsWith('CONN#'),
  connectionId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(['customer', 'seller', 'admin']),
  connectedAt: z.string(),
  expiresAt: z.number(),
});
export type ConnectionRegistryItem = z.infer<typeof ConnectionRegistryItemSchema>;

/**
 * Presence record stored in DynamoDB.
 * PK: PRESENCE#{userId}, SK: STATUS
 *
 * Validates: Requirements 14.1, 14.2
 */
export const PresenceRecordSchema = z.object({
  PK: z.string().startsWith('PRESENCE#'),
  SK: z.literal('STATUS'),
  userId: z.string().min(1),
  online: z.boolean(),
  lastSeen: z.string(),
  connectionCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
  expiresAt: z.number(),
});
export type PresenceRecord = z.infer<typeof PresenceRecordSchema>;

// ============================================================================
// Helper: Build Connection Registry Item
// ============================================================================

/**
 * Constructs a Connection Registry item with correct key patterns and TTL.
 */
export function buildConnectionRegistryItem(params: {
  connectionId: string;
  userId: string;
  role: 'customer' | 'seller' | 'admin';
  connectedAt: string;
}): ConnectionRegistryItem {
  const connectedEpoch = Math.floor(new Date(params.connectedAt).getTime() / 1000);
  return {
    PK: `CONN#${params.connectionId}`,
    SK: 'META',
    GSI1PK: `USER_CONN#${params.userId}`,
    GSI1SK: `CONN#${params.connectionId}`,
    connectionId: params.connectionId,
    userId: params.userId,
    role: params.role,
    connectedAt: params.connectedAt,
    expiresAt: connectedEpoch + 86400, // 24 hours
  };
}
