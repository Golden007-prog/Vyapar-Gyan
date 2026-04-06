/**
 * Chat Bridge — shared sessionStorage contract for demo two-way messaging
 *
 * Both customer chat and seller inbox read/write through this module
 * to ensure a single consistent format.
 *
 * Storage format: { [sessionId]: BridgeMessage[] }
 */

const BRIDGE_KEY = 'vyapargyan_chat_bridge';

export const DEMO_SESSION_ID = 'sess-demo-001';
export const DEMO_CUSTOMER_PHONE = '+917001124396';
export const DEMO_CUSTOMER_NAME = 'Demo Customer';

export interface BridgeMessage {
  id: string;
  /** From the seller's perspective: inbound = customer sent, outbound = seller sent */
  direction: 'inbound' | 'outbound';
  text: string;
  timestamp: string;
  channel: 'web' | 'whatsapp';
  /** Optional correlation ID for bridge↔backend message deduplication */
  correlationId?: string;
}

function readStore(): Record<string, BridgeMessage[]> {
  try {
    const raw = sessionStorage.getItem(BRIDGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeStore(store: Record<string, BridgeMessage[]>): void {
  try {
    sessionStorage.setItem(BRIDGE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
}

/** Get all messages for a session (seller perspective: inbound = from customer) */
export function getSessionMessages(sessionId: string): BridgeMessage[] {
  return readStore()[sessionId] ?? [];
}

/** Append a message to a session */
export function appendMessage(sessionId: string, msg: BridgeMessage): void {
  const store = readStore();
  const msgs = store[sessionId] ?? [];
  // Deduplicate by id
  if (msgs.some(m => m.id === msg.id)) return;
  msgs.push(msg);
  store[sessionId] = msgs;
  writeStore(store);
}

/** Replace all messages for a session (used for initial seed) */
export function setSessionMessages(sessionId: string, msgs: BridgeMessage[]): void {
  const store = readStore();
  store[sessionId] = msgs;
  writeStore(store);
}

/** Get all session IDs that have messages */
export function getAllSessionIds(): string[] {
  return Object.keys(readStore());
}
