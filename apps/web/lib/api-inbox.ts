/**
 * Seller Inbox API Client
 *
 * Functions for seller inbox endpoints (JWT-protected).
 * Matches backend handlers at /api/v1/seller/inbox/*.
 */

import { api } from './api-client';

// --- Types ---

export type MessageChannel = 'whatsapp' | 'web';
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export type SenderRole = 'customer' | 'seller' | 'system';
export type MessageType = 'text' | 'image' | 'audio' | 'interactive' | 'product_card' | 'system';

export interface ConversationSummary {
  userId: string;
  displayName?: string;
  lastMessage: {
    content: unknown;
    messageType: string;
    direction: string;
    channel: MessageChannel;
    createdAt: string;
  };
  unreadCount: number;
  channel: MessageChannel;
  lastActivityAt: string;
}

export interface InboxMessage {
  messageId: string;
  userId: string;
  direction: 'inbound' | 'outbound';
  channel: MessageChannel;
  senderRole: SenderRole;
  messageType: MessageType;
  content: { text?: string; body?: string; mediaUrl?: string; [key: string]: unknown };
  deliveryStatus: DeliveryStatus;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
}

export interface CustomerProfile {
  userId: string;
  displayName: string;
  phoneNumber: string;
  preferredChannel: MessageChannel | 'both';
  whatsappConnected: boolean;
  createdAt: string;
}

export interface OrderSummary {
  orderId: string;
  status: string;
  subtotal: number;
  itemCount: number;
  createdAt: string;
}

export interface CustomerContext {
  profile: CustomerProfile | null;
  orderHistory: OrderSummary[];
  totalSpend: number;
  orderCount: number;
  preferredChannel: string;
}

export interface ListConversationsResponse {
  conversations: ConversationSummary[];
  total: number;
}

export interface GetMessagesResponse {
  messages: InboxMessage[];
  nextCursor: string | null;
}

export interface SendReplyResponse {
  messageId: string;
  createdAt: string;
}

// --- API Functions ---

/** List seller inbox conversations */
export async function listConversations(limit = 50): Promise<ListConversationsResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  return api.get<ListConversationsResponse>(`/api/v1/seller/inbox?${qs.toString()}`);
}

/** Get messages for a specific customer conversation */
export async function getMessages(
  customerUserId: string,
  opts?: { limit?: number; cursor?: string; since?: string },
): Promise<GetMessagesResponse> {
  const qs = new URLSearchParams();
  if (opts?.limit) qs.set('limit', String(opts.limit));
  if (opts?.cursor) qs.set('cursor', opts.cursor);
  if (opts?.since) qs.set('since', opts.since);
  const query = qs.toString();
  return api.get<GetMessagesResponse>(
    `/api/v1/seller/inbox/${customerUserId}/messages${query ? `?${query}` : ''}`,
  );
}

/** Send a reply to a customer */
export async function sendReply(
  customerUserId: string,
  content: string,
  messageType: 'text' | 'image' | 'product_card' = 'text',
): Promise<SendReplyResponse> {
  return api.post<SendReplyResponse>(`/api/v1/seller/inbox/${customerUserId}/reply`, {
    content,
    messageType,
  });
}

/** Get customer context (profile, orders, spend) */
export async function getCustomerContext(customerUserId: string): Promise<CustomerContext> {
  return api.get<CustomerContext>(`/api/v1/seller/inbox/${customerUserId}/context`);
}

/** Mark all inbound messages in a conversation as read (persists to backend) */
export async function markConversationRead(customerUserId: string): Promise<void> {
  await api.post(`/api/v1/seller/inbox/${customerUserId}/read`);
}
