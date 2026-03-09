'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShoppingCart, Store } from 'lucide-react';
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

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="flex h-[calc(100vh-56px)] items-center justify-center"><div className="animate-pulse text-gray-400">Loading chat...</div></div>}>
      <ChatContent />
    </Suspense>
  );
}

function ChatContent() {
  const searchParams = useSearchParams();
  const { selectedStore } = useStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [isTyping] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const storeName = selectedStore?.businessName || 'Dragon Store';
  const sellerId = selectedStore?.sellerId || 'seller-dragon-001';

  // Load initial messages from bridge, seed if empty
  useEffect(() => {
    let bridgeMsgs = getSessionMessages(DEMO_SESSION_ID);
    if (bridgeMsgs.length === 0) {
      bridgeMsgs = seedBridge(storeName);
      setSessionMessages(DEMO_SESSION_ID, bridgeMsgs);
    }
    setMessages(bridgeToCustomer(bridgeMsgs));

    // Load cart — try API, fallback to demo
    getCart()
      .then((res) => setCart(res.cart))
      .catch(() => setCart(getDemoCart(sellerId)));
  }, [storeName, sellerId]);

  // Poll bridge for seller replies every 1.5s
  useEffect(() => {
    pollRef.current = setInterval(() => {
      const bridgeMsgs = getSessionMessages(DEMO_SESSION_ID);
      const converted = bridgeToCustomer(bridgeMsgs);
      // Compare by last message id to detect new messages reliably
      setMessages(prev => {
        if (converted.length !== prev.length || (converted.length > 0 && prev.length > 0 && converted[converted.length - 1].messageId !== prev[prev.length - 1].messageId)) {
          return converted;
        }
        return prev;
      });
    }, 1500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

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
    setMessages(bridgeToCustomer(bridgeMsgs));
  }, []);

  const handleTyping = useCallback(() => {}, []);

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
      setMessages(bridgeToCustomer(getSessionMessages(DEMO_SESSION_ID)));
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
      setMessages(bridgeToCustomer(getSessionMessages(DEMO_SESSION_ID)));
    } finally {
      setCheckingOut(false);
    }
  }, [sellerId]);

  const itemCount = cart?.itemCount ?? 0;

  return (
    <div className="flex h-[calc(100vh-56px)]">
      <div className="flex flex-1 flex-col">
        {/* Chat header */}
        <div className="flex items-center justify-between border-b bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
              <Store className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-gray-800">{storeName}</h1>
              <p className="text-[11px] text-gray-400">Online · Web + WhatsApp</p>
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

        <MessageList messages={messages} isTyping={isTyping} />
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
