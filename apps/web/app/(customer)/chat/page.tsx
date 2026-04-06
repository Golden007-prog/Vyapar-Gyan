'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ArrowLeft, ShoppingCart, Store } from 'lucide-react';
import MessageList from '@/components/Chat/MessageList';
import ChatComposer from '@/components/Chat/ChatComposer';
import CartSidePanel from '@/components/Chat/CartSidePanel';
import {
  getCart,
  updateItem as apiUpdateItem,
  removeItem as apiRemoveItem,
  checkout as apiCheckout,
  optimisticUpdateItem,
  optimisticRemoveItem,
  type Cart,
} from '@/lib/api-cart';
import type { ChatMessage } from '@/lib/api-chat';
import { deduplicateMessages } from '@/lib/websocket-client';
import { createSyncClient, type SyncClient } from '@/lib/sync-client';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useStore } from '@/lib/store-context';
import { getDemoCart, updateDemoItem, removeDemoItem, clearDemoCart } from '@/lib/demo-cart';
import {
  getSessionMessages,
  appendMessage,
  setSessionMessages,
  DEMO_SESSION_ID,
  type BridgeMessage,
} from '@/lib/chat-bridge';

// Demo welcome messages (in bridge format — seller perspective)
function seedBridge(storeName: string): BridgeMessage[] {
  const now = Date.now();
  return [
    {
      id: 'demo-1',
      direction: 'outbound', // seller sent (system welcome)
      text: `Welcome to ${storeName}! How can we help you today?`,
      timestamp: new Date(now - 300000).toISOString(),
      channel: 'web',
    },
    {
      id: 'demo-2',
      direction: 'outbound', // seller sent
      text: `Namaste! 🙏 Welcome to ${storeName}. We have fresh stock available today. Browse our catalog or ask me anything!`,
      timestamp: new Date(now - 240000).toISOString(),
      channel: 'web',
    },
  ];
}

/** Convert bridge messages (seller perspective) → customer ChatMessage[] */
function bridgeToCustomer(msgs: BridgeMessage[]): ChatMessage[] {
  return msgs.map(m => ({
    messageId: m.id,
    // Flip direction: bridge inbound (customer→seller) = customer outbound
    direction: m.direction === 'inbound' ? 'outbound' : 'inbound',
    channel: m.channel as any,
    senderRole: m.direction === 'inbound' ? 'customer' : 'seller',
    messageType: 'text',
    content: { body: m.text },
    deliveryStatus: 'delivered' as const,
    createdAt: m.timestamp,
    ...(m.correlationId ? { correlationId: m.correlationId } : {}),
  }));
}

/**
 * Merge messages using content+timestamp dedup for legacy messages (bridge vs backend).
 * Two messages are considered duplicates if they have the same body content and
 * timestamps within 5 seconds of each other.
 */
function mergeWithContentDedup(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    // First: standard messageId dedup
    if (seen.has(msg.messageId)) continue;

    // Content+timestamp dedup key: body + rounded timestamp (5s window)
    const body = msg.content?.body ?? '';
    const ts = Math.floor(new Date(msg.createdAt).getTime() / 5000);
    const contentKey = `${body}::${ts}::${msg.direction}`;

    if (body && seen.has(contentKey)) continue;

    seen.add(msg.messageId);
    if (body) seen.add(contentKey);
    result.push(msg);
  }
  return result;
}

/** Format ISO timestamp as relative time (e.g. "5 min ago", "2h ago") */
function formatRelativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMs / 3600000);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return 'recently';
  }
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex h-[100dvh] md:h-[calc(100vh-56px)] items-center justify-center"><div className="animate-pulse text-gray-400">Loading chat...</div></div>}>
      <ChatContent />
    </Suspense>
  );
}

function ChatContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { selectedStore } = useStore();

  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState('');

  const syncClientRef = useRef<SyncClient | null>(null);
  const storeName = selectedStore?.businessName || 'Dragon Store';
  const sellerId = selectedStore?.sellerId || 'seller-dragon-001';

  // Fetch Cognito JWT token for WebSocket connection
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchAuthSession } = await import('aws-amplify/auth');
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString() ?? null;
        if (!cancelled) setAuthToken(token);
      } catch {
        // No auth session — WebSocket will stay disconnected, bridge/polling still works
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Initialize WebSocket hook (Req 15.1, 15.2, 15.3, 15.4)
  const {
    connectionState,
    messages: wsMessages,
    sendMessage: wsSendMessage,
    sendTyping: wsSendTyping,
    markRead: wsMarkRead,
    typingUsers,
    presenceMap,
  } = useWebSocket(authToken);

  // Load initial messages: API-first with bridge fallback (Req 2.1, 2.2, 2.3, 3.1)
  useEffect(() => {
    let cancelled = false;

    // Seed bridge if empty (for fallback)
    let bridgeMsgs = getSessionMessages(DEMO_SESSION_ID);
    if (bridgeMsgs.length === 0) {
      bridgeMsgs = seedBridge(storeName);
      setSessionMessages(DEMO_SESSION_ID, bridgeMsgs);
    }
    const bridgeConverted = bridgeToCustomer(bridgeMsgs);

    (async () => {
      let apiAvailable = false;

      // PRIMARY: Load history from backend API
      try {
        const { getHistory } = await import('@/lib/api-chat');
        const history = await getHistory();
        if (!cancelled && history.messages.length > 0) {
          // Merge API messages with bridge messages using content+timestamp dedup
          const merged = mergeWithContentDedup([...history.messages, ...bridgeConverted]);
          setLocalMessages(merged);
          apiAvailable = true;
        }
      } catch {
        // API unavailable — will fall back to bridge
      }

      // If API returned nothing or failed, use bridge messages as fallback
      if (!cancelled && !apiAvailable) {
        setLocalMessages(bridgeConverted);
      }

      // Start sync client as primary continuous polling source
      if (!cancelled) {
        const syncClient = createSyncClient({
          onMessages: (msgs) => {
            if (!cancelled) {
              setLocalMessages(prev => {
                const merged = deduplicateMessages([...prev, ...msgs]) as ChatMessage[];
                return merged;
              });
            }
          },
          onCartUpdate: (cartUpdate) => {
            if (!cancelled) setCart(cartUpdate);
          },
          onTyping: () => {},
          onError: (err) => {
            // Sync client error — bridge messages remain as fallback
            console.warn('Sync client error, bridge fallback active', err);
          },
        });
        syncClientRef.current = syncClient;
        syncClient.start();
      }
    })();

    // Load cart — try API, fallback to demo
    getCart()
      .then((res) => { if (!cancelled) setCart(res.cart); })
      .catch(() => { if (!cancelled) setCart(getDemoCart(sellerId)); });

    return () => {
      cancelled = true;
      if (syncClientRef.current) {
        syncClientRef.current.stop();
        syncClientRef.current = null;
      }
    };
  }, [storeName, sellerId]);

  // Suppress sync polling when WebSocket is connected (Req 3.2 / 15.2)
  useEffect(() => {
    if (connectionState === 'connected') {
      if (syncClientRef.current) {
        syncClientRef.current.stop();
        syncClientRef.current = null;
      }
    }
  }, [connectionState]);

  // Merge WebSocket messages with local/bridge messages, dedup by messageId (Req 15.5)
  const messages: ChatMessage[] = deduplicateMessages([...localMessages, ...wsMessages]) as ChatMessage[];

  const handleSend = useCallback(async (text: string) => {
    const correlationId = crypto.randomUUID();
    const msgId = `cust-${Date.now()}`;
    const timestamp = new Date().toISOString();

    // Optimistic UI update via bridge (include correlationId for dedup matching)
    appendMessage(DEMO_SESSION_ID, {
      id: msgId,
      direction: 'inbound',
      text,
      timestamp,
      channel: 'web',
      correlationId,
    });

    // Update local state immediately with correlationId on the ChatMessage
    const bridgeMsgs = getSessionMessages(DEMO_SESSION_ID);
    const converted = bridgeToCustomer(bridgeMsgs);
    // Attach correlationId to the optimistic message so dedup can match it
    const withCorrelation = converted.map(m =>
      m.messageId === msgId ? { ...m, correlationId } : m,
    );
    setLocalMessages(withCorrelation);

    // PRIMARY: Send via HTTP API to backend (include correlationId for dedup)
    try {
      const { sendMessage } = await import('@/lib/api-chat');
      await sendMessage({ content: text, messageType: 'text', sellerId, correlationId });
      // Trigger immediate sync poll to pick up any bot response
      syncClientRef.current?.pollNow();
    } catch (err) {
      console.warn('API send failed, message saved locally', err);
    }

    // SECONDARY: Also send via WebSocket for real-time delivery
    if (connectionState === 'connected') {
      wsSendMessage(sellerId, { body: text }, 'text');
    }
  }, [connectionState, wsSendMessage, sellerId]);

  const handleTyping = useCallback(() => {
    wsSendTyping(sellerId);
  }, [wsSendTyping, sellerId]);

  const handleUpdateQuantity = useCallback(async (pid: string, quantity: number) => {
    if (!cart) return;
    setCart(optimisticUpdateItem(cart, pid, quantity));
    try {
      const res = await apiUpdateItem(pid, quantity);
      setCart(res.cart);
    } catch {
      setCart(updateDemoItem(sellerId, pid, quantity));
    }
  }, [cart, sellerId]);

  const handleRemoveItem = useCallback(async (pid: string) => {
    if (!cart) return;
    setCart(optimisticRemoveItem(cart, pid));
    try {
      const res = await apiRemoveItem(pid);
      setCart(res.cart);
    } catch {
      setCart(removeDemoItem(sellerId, pid));
    }
  }, [cart, sellerId]);

  const handleCheckout = useCallback(async () => {
    setCheckingOut(true);
    setError('');
    try {
      const res = await apiCheckout();
      setCart(null);
      setCartOpen(false);
      appendMessage(DEMO_SESSION_ID, {
        id: `sys-${Date.now()}`,
        direction: 'outbound',
        text: `✅ Order placed! Order ID: ${res.orderId}. Total: ₹${res.total.toLocaleString('en-IN')}`,
        timestamp: new Date().toISOString(),
        channel: 'web',
      });
      setLocalMessages(bridgeToCustomer(getSessionMessages(DEMO_SESSION_ID)));
    } catch {
      // Demo fallback checkout
      clearDemoCart(sellerId);
      setCart(getDemoCart(sellerId));
      setCartOpen(false);
      const orderId = `VG-${Date.now().toString(36).toUpperCase()}`;
      appendMessage(DEMO_SESSION_ID, {
        id: `sys-${Date.now()}`,
        direction: 'outbound',
        text: `✅ Order placed! Order ID: ${orderId}`,
        timestamp: new Date().toISOString(),
        channel: 'web',
      });
      setLocalMessages(bridgeToCustomer(getSessionMessages(DEMO_SESSION_ID)));
    } finally {
      setCheckingOut(false);
    }
  }, [sellerId]);

  const itemCount = cart?.itemCount ?? 0;

  return (
    <div className="flex h-[100dvh] md:h-[calc(100vh-56px)]">
      <div className="flex flex-1 flex-col">
        {/* Chat header */}
        <div className="flex items-center justify-between border-b bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Mobile back arrow */}
            <button
              onClick={() => router.back()}
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100 md:hidden"
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            {/* Store icon — desktop only */}
            <div className="hidden h-9 w-9 items-center justify-center rounded-full bg-emerald-100 md:flex">
              <Store className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-gray-800">{storeName}</h1>
              {(() => {
                const sellerPresence = presenceMap.get(sellerId);
                const isOnline = sellerPresence?.online ?? false;
                if (isOnline) {
                  return (
                    <p className="text-[11px] text-gray-400 flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                      <span className="md:hidden">Online</span>
                      <span className="hidden md:inline">Online · Web + WhatsApp</span>
                    </p>
                  );
                }
                const lastSeen = sellerPresence?.lastSeen;
                const lastSeenText = lastSeen
                  ? `Last seen ${formatRelativeTime(lastSeen)}`
                  : 'Offline';
                return (
                  <p className="text-[11px] text-gray-400">
                    <span className="md:hidden">{lastSeenText}</span>
                    <span className="hidden md:inline">{lastSeenText} · Web + WhatsApp</span>
                  </p>
                );
              })()}
            </div>
          </div>
          <button
            onClick={() => setCartOpen(!cartOpen)}
            className="relative flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50"
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">Cart</span>
            {itemCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">
                {itemCount}
              </span>
            )}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
            <button onClick={() => setError('')} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        <MessageList
          messages={messages}
          isTyping={false}
          typingUsers={typingUsers}
          onMarkRead={wsMarkRead}
        />
        <ChatComposer onSend={handleSend} onTyping={handleTyping} />
      </div>

      <CartSidePanel
        cart={cart}
        open={cartOpen}
        onToggle={() => setCartOpen(!cartOpen)}
        onUpdateQuantity={handleUpdateQuantity}
        onRemove={handleRemoveItem}
        onCheckout={handleCheckout}
        checkingOut={checkingOut}
      />
    </div>
  );
}
