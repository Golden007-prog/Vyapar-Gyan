/**
 * Chat API Client
 *
 * Functions for customer chat endpoints (JWT-protected).
 * Uses the same auth pattern as api-client.ts.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.vyapargyan.com';

// --- Types ---

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export type MessageChannel = 'whatsapp' | 'web';
export type SenderRole = 'customer' | 'seller' | 'system';
export type MessageType = 'text' | 'image' | 'audio' | 'interactive' | 'product_card' | 'order_status' | 'ai_suggestion' | 'quick_reply' | 'system';

export interface ChatMessage {
  messageId: string;
  direction: 'inbound' | 'outbound';
  channel: MessageChannel;
  senderRole: SenderRole;
  messageType: MessageType;
  content: { body?: string; mediaUrl?: string; [key: string]: unknown };
  deliveryStatus: DeliveryStatus;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  errorCode?: string;
  createdAt: string;
}

export interface TypingEvent {
  userId: string;
  role: SenderRole;
  isTyping: boolean;
  timestamp: string;
}

export interface PresenceUpdate {
  userId: string;
  online: boolean;
  lastSeen?: string;
}

export interface SyncResponse {
  messages: ChatMessage[];
  cartState: unknown | null;
  typingIndicators: TypingEvent[];
  presenceUpdates: PresenceUpdate[];
  lastSyncTimestamp: string;
  cartVersion: number;
}

export interface SendMessagePayload {
  content: string;
  messageType?: 'text' | 'image' | 'product_card';
  sellerId?: string;
  productContext?: { productId: string; name: string; price: number };
}

export interface SendMessageResponse {
  messageId: string;
  createdAt: string;
}

export interface HistoryResponse {
  messages: ChatMessage[];
  nextCursor: string | null;
}

// --- Helpers ---

async function getAuthToken(): Promise<string | null> {
  try {
    const { fetchAuthSession } = await import('aws-amplify/auth');
    const session = await fetchAuthSession();
    return session.tokens?.accessToken?.toString() ?? null;
  } catch {
    return null;
  }
}

async function chatFetch<T>(
  endpoint: string,
  options?: RequestInit & { etag?: string },
): Promise<{ data: T; etag?: string; notModified: boolean }> {
  const token = await getAuthToken();
  const url = `${API_BASE_URL}${endpoint}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options?.etag) headers['If-None-Match'] = options.etag;

  const res = await fetch(url, { ...options, headers: { ...headers, ...options?.headers } });

  if (res.status === 304) {
    return { data: null as unknown as T, etag: options?.etag, notModified: true };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Chat request failed: ${res.status}`);
  }

  const data: T = await res.json();
  const responseEtag = res.headers.get('etag') ?? undefined;
  return { data, etag: responseEtag, notModified: false };
}

// --- API Functions ---

/** Poll for new messages, cart state, and typing indicators */
export async function syncMessages(
  lastSyncTimestamp?: string,
  cartVersion?: number,
  etag?: string,
): Promise<{ data: SyncResponse; etag?: string; notModified: boolean }> {
  const qs = new URLSearchParams();
  if (lastSyncTimestamp) qs.set('lastSyncTimestamp', lastSyncTimestamp);
  if (cartVersion !== undefined) qs.set('cartVersion', String(cartVersion));
  const query = qs.toString();
  return chatFetch<SyncResponse>(`/api/v1/chat/sync${query ? `?${query}` : ''}`, { etag });
}

/** Send a message from web chat */
export async function sendMessage(payload: SendMessagePayload): Promise<SendMessageResponse> {
  const { data } = await chatFetch<SendMessageResponse>('/api/v1/chat/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data;
}

/** Send typing indicator */
export async function sendTyping(): Promise<void> {
  await chatFetch<void>('/api/v1/chat/typing', { method: 'POST' });
}

/** Load paginated message history */
export async function getHistory(
  cursor?: string,
  limit = 50,
): Promise<HistoryResponse> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set('cursor', cursor);
  const { data } = await chatFetch<HistoryResponse>(`/api/v1/chat/history?${qs.toString()}`);
  return data;
}
