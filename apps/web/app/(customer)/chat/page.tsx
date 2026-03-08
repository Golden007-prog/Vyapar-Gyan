'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShoppingCart, Store } from 'lucide-react';
import MessageList from '@/components/Chat/MessageList';
import ChatComposer from '@/components/Chat/ChatComposer';
import CartSidePanel from '@/components/Chat/CartSidePanel';
import { createSyncClient, type SyncClient } from '@/lib/sync-client';
import { sendMessage, sendTyping, getHistory, type ChatMessage } from '@/lib/api-chat';
import {
  getCart,
  updateItem as apiUpdateItem,
  removeItem as apiRemoveItem,
  checkout as apiCheckout,
  optimisticUpdateItem,
  optimisticRemoveItem,
  type Cart,
} from '@/lib/api-cart';
import { useStore } from '@/lib/store-context';

// ── Demo identity ──
const DEMO_SESSION_ID = 'session-demo-customer';
const INBOX_STORE_KEY = 'vyapargyan_inbox_messages';

// Demo welcome messages
function getDemoMessages(storeName: string): ChatMessage[] {
  const now = Date.now();
  return [
    {
      messageId: 'demo-1',
      direction: 'inbound',
      channel: 'web',
      senderRole: 'system',
      messageType: 'system',
      content: { body: `Welcome to ${storeName}! How can we help you today?` },
      deliveryStatus: 'delivered',
      createdAt: new Date(now - 300000).toISOString(),
    },
    {
      messageId: 'demo-2',
      direction: 'inbound',
      channel: 'web',
      senderRole: 'seller',
      messageType: 'text',
      content: { body: `Namaste! 🙏 Welcome to ${storeName}. We have fresh stock available today. Browse our catalog or ask me anything!` },
      deliveryStatus: 'delivered',
      createdAt: new Date(now - 240000).toISOString(),
    },
  ];
}

/** Read seller replies from shared sessionStorage (written by seller inbox) */
function readInboxMessages(): ChatMessage[] {
  try {
    const store = JSON.parse(sessionStorage.getItem(INBOX_STORE_KEY) || '{}');
    const raw = store[DEMO_SESSION_ID];
    if (!Array.isArray(raw)) return [];
    // Convert inbox Message format → ChatMessage format
    return raw.map((m: any) => ({
      messageId: m.id,
      direction: m.direction === 'inbound' ? 'outbound' : 'inbound', // flip: customer's outbound = seller's inbound
      channel: 'web' as const,
      senderRole: m.direction === 'inbound' ? 'customer' : 'seller',
      messageType: m.messageType || 'text',
      content: { body: m.content?.text || '' },
      deliveryStatus: (m.status || 'delivered') as any,
      createdAt: m.createdAt,
    }));
  } catch { return []; }
}

/** Write customer messages to shared sessionStorage so seller inbox can see them */
function writeToInbox(msgs: ChatMessage[]) {
  try {
    const store = JSON.parse(sessionStorage.getItem(INBOX_STORE_KEY) || '{}');
    // Convert ChatMessage → inbox Message format
    store[DEMO_SESSION_ID] = msgs.map(m => ({
      id: m.messageId,
      direction: m.direction === 'outbound' ? 'inbound' : 'outbound', // flip for seller perspective
      messageType: m.messageType === 'system' ? 'text' : m.messageType,
      content: { text: m.content?.body || '' },
      status: m.deliveryStatus,
      createdAt: m.createdAt,
    }));
    sessionStorage.setItem(INBOX_STORE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
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
  const _productId = searchParams.get('product');
  const { selectedStore } = useStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cart, setCart] = useState<Cart | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState('');

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const storeName = selectedStore?.businessName || 'Dragon Store';

  // Load initial messages — try inbox shared store first, then demo seed
  useEffect(() => {
    const inboxMsgs = readInboxMessages();
    if (inboxMsgs.length > 0) {
      setMessages(inboxMsgs);
    } else {
      const seed = getDemoMessages(storeName);
      setMessages(seed);
      writeToInbox(seed);
    }

    getCart()
      .then((res) => setCart(res.cart))
      .catch(() => {});
  }, [storeName]);

  // Poll for seller replies from sessionStorage every 2s
  useEffect(() => {
    pollRef.current = setInterval(() => {
      const inboxMsgs = readInboxMessages();
      if (inboxMsgs.length > messages.length) {
        setMessages(inboxMsgs);
      }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [messages.length]);

  const handleSend = useCallback(async (text: string) => {
    const optimistic: ChatMessage = {
      messageId: `cust-${Date.now()}`,
      direction: 'outbound',
      channel: 'web',
      senderRole: 'customer',
      messageType: 'text',
      content: { body: text },
      deliveryStatus: 'queued',
      createdAt: new Date().toISOString(),
    };
    const updated = [...messages, optimistic];
    setMessages(updated);
    writeToInbox(updated);

    // Simulate delivery
    setTimeout(() => {
      setMessages((prev) => {
        const next = prev.map((m) =>
          m.messageId === optimistic.messageId ? { ...m, deliveryStatus: 'delivered' as const } : m
        );
        writeToInbox(next);
        return next;
      });
    }, 500);
  }, [messages]);

  const handleTyping = useCallback(() => {
    // no-op in demo mode
  }, []);

  const handleUpdateQuantity = useCallback(async (pid: string, quantity: number) => {
    if (!cart) return;
    setCart(optimisticUpdateItem(cart, pid, quantity));
    try {
      const res = await apiUpdateItem(pid, quantity);
      setCart(res.cart);
    } catch {
      getCart().then((r) => setCart(r.cart)).catch(() => {});
    }
  }, [cart]);

  const handleRemoveItem = useCallback(async (pid: string) => {
    if (!cart) return;
    setCart(optimisticRemoveItem(cart, pid));
    try {
      const res = await apiRemoveItem(pid);
      setCart(res.cart);
    } catch {
      getCart().then((r) => setCart(r.cart)).catch(() => {});
    }
  }, [cart]);

  const handleCheckout = useCallback(async () => {
    setCheckingOut(true);
    setError('');
    try {
      const res = await apiCheckout();
      setCart(null);
      setCartOpen(false);
      const sysMsg: ChatMessage = {
        messageId: `sys-${Date.now()}`,
        direction: 'inbound',
        channel: 'web',
        senderRole: 'system',
        messageType: 'system',
        content: { body: `✅ Order placed! Order ID: ${res.orderId}. Total: ₹${res.total.toLocaleString('en-IN')}` },
        deliveryStatus: 'delivered',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, sysMsg]);
    } catch (err: any) {
      setError(err.message || 'Checkout failed. Please try again.');
    } finally {
      setCheckingOut(false);
    }
  }, []);

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
