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
  }));
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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const storeName = selectedStore?.businessName || 'Dragon Store';
  const sellerId = selectedStore?.sellerId || 'seller-dragon-001';

  // Fetch Cognito JWT token for WebSocket connection
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchAuthSession } = await import('aws-amplify/auth');
        const session = await fetchAuthSession();
        const token = session.tokens?.accessToken?.toString() ?? null;
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

  // Load initial messages from bridge, seed if empty
  useEffect(() => {
    let bridgeMsgs = getSessionMessages(DEMO_SESSION_ID);
    if (bridgeMsgs.length === 0) {
      bridgeMsgs = seedBridge(storeName);
      setSessionMessages(DEMO_SESSION_ID, bridgeMsgs);
    }
    setLocalMessages(bridgeToCustomer(bridgeMsgs));

    // Load cart — try API, fallback to demo
    getCart()
      .then((res) => setCart(res.cart))
      .catch(() => setCart(getDemoCart(sellerId)));
  }, [storeName, sellerId]);

  // Poll bridge for seller replies every 1.5s (suppressed when WebSocket connected)
  useEffect(() => {
    if (connectionState === 'connected') {
      // Req 15.2: suppress polling when WebSocket is connected
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => {
      const bridgeMsgs = getSessionMessages(DEMO_SESSION_ID);
      const converted = bridgeToCustomer(bridgeMsgs);
      setLocalMessages(prev => {
        if (converted.length !== prev.length || (converted.length > 0 && prev.length > 0 && converted[converted.length - 1].messageId !== prev[prev.length - 1].messageId)) {
          return converted;
        }
        return prev;
      });
    }, 1500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; };
  }, [connectionState]);

  // Merge WebSocket messages with local/bridge messages, dedup by messageId (Req 15.5)
  const messages: ChatMessage[] = deduplicateMessages([...localMessages, ...wsMessages]) as ChatMessage[];

  const handleSend = useCallback(async (text: string) => {
    const msgId = `cust-${Date.now()}`;
    const timestamp = new Date().toISOString();

    // Write to bridge (seller perspective: inbound = from customer)
    appendMessage(DEMO_SESSION_ID, {
      id: msgId,
      direction: 'inbound',
      text,
      timestamp,
      channel: 'web',
    });

    // Update local state immediately
    const bridgeMsgs = getSessionMessages(DEMO_SESSION_ID);
    setLocalMessages(bridgeToCustomer(bridgeMsgs));

    // Also send via WebSocket if connected
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
