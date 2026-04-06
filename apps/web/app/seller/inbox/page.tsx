'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { MessageCircle, Send, User, Search, Phone, Globe, Clock, Cloud, CloudOff } from 'lucide-react';
import {
  getSessionMessages,
  appendMessage,
  DEMO_SESSION_ID,
  DEMO_CUSTOMER_PHONE,
  DEMO_CUSTOMER_NAME,
  type BridgeMessage,
} from '@/lib/chat-bridge';
import { listConversations, getMessages, markConversationRead } from '@/lib/api-inbox';
import { useWebSocket } from '@/hooks/useWebSocket';
import TypingIndicator from '@/components/Chat/TypingIndicator';

interface InboxSession {
  id: string;
  customerName: string;
  phone: string;
  channel: 'whatsapp' | 'web';
  lastMessage: string;
  lastMessageTime: string;
  unread: number;
  messages: BridgeMessage[];
  synced: boolean;
}

function buildSeedSessions(): InboxSession[] {
  const now = Date.now();
  const seedSessionId = DEMO_SESSION_ID;
  const bridgeMsgs = getSessionMessages(seedSessionId);
  const demoSession: InboxSession = {
    id: DEMO_SESSION_ID,
    customerName: DEMO_CUSTOMER_NAME,
    phone: DEMO_CUSTOMER_PHONE,
    channel: 'web',
    lastMessage: bridgeMsgs.length > 0 ? bridgeMsgs[bridgeMsgs.length - 1].text : 'No messages yet',
    lastMessageTime: bridgeMsgs.length > 0 ? bridgeMsgs[bridgeMsgs.length - 1].timestamp : new Date().toISOString(),
    unread: bridgeMsgs.filter(m => m.direction === 'inbound').length,
    messages: bridgeMsgs,
    synced: false,
  };
  return [
    demoSession,
    {
      id: 'sess-wa-002', customerName: 'Priya Sharma', phone: '+919876543210', channel: 'whatsapp',
      lastMessage: 'Order delivered, thank you!', lastMessageTime: new Date(now - 3600000).toISOString(), unread: 0,
      messages: [
        { id: 'm2a', direction: 'inbound', text: 'When will my order arrive?', timestamp: new Date(now - 7200000).toISOString(), channel: 'whatsapp' },
        { id: 'm2b', direction: 'outbound', text: 'Hi Priya! Your order is out for delivery. Should reach you by 5 PM today.', timestamp: new Date(now - 5400000).toISOString(), channel: 'whatsapp' },
        { id: 'm2c', direction: 'inbound', text: 'Order delivered, thank you!', timestamp: new Date(now - 3600000).toISOString(), channel: 'whatsapp' },
      ],
      synced: false,
    },
    {
      id: 'sess-wa-003', customerName: 'Rahul Verma', phone: '+918765432100', channel: 'whatsapp',
      lastMessage: 'Do you have USB-C cables?', lastMessageTime: new Date(now - 86400000).toISOString(), unread: 1,
      messages: [
        { id: 'm3a', direction: 'inbound', text: 'Do you have USB-C cables?', timestamp: new Date(now - 86400000).toISOString(), channel: 'whatsapp' },
      ],
      synced: false,
    },
  ];
}


export default function InboxPage() {
  const [sessions, setSessions] = useState<InboxSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch Cognito JWT token for WebSocket connection (seller role)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchAuthSession } = await import('aws-amplify/auth');
        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString() ?? null;
        if (!cancelled) setAuthToken(token);
      } catch {
        // No auth session — WebSocket stays disconnected, bridge polling still works
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Initialize WebSocket hook for seller role (Req 15.1, 15.2, 15.3, 15.4)
  const {
    connectionState,
    sendMessage: wsSendMessage,
    sendTyping: wsSendTyping,
    typingUsers,
    presenceMap,
  } = useWebSocket(authToken);

  // API-first conversation loading: fetch from backend FIRST, seed data as fallback only (Req 2.3, 2.7)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listConversations();
        if (!cancelled && data.conversations && data.conversations.length > 0) {
          const apiSessions: InboxSession[] = data.conversations.map((c) => ({
            id: c.userId,
            customerName: c.displayName || 'Customer',
            phone: '',
            channel: c.channel || 'web',
            lastMessage: typeof c.lastMessage?.content === 'string' ? c.lastMessage.content : (c.lastMessage?.content as any)?.text || '',
            lastMessageTime: c.lastActivityAt || new Date().toISOString(),
            unread: c.unreadCount || 0,
            messages: [],
            synced: true,
          }));
          setSessions(apiSessions);
          return;
        }
      } catch {
        // API unavailable — fall through to seed data
      }
      // Fallback: use seed data when API returns empty or fails (Req 3.4)
      if (!cancelled) {
        setSessions(buildSeedSessions());
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll API for selected conversation's messages (suppressed when WebSocket connected) (Req 2.3, 3.2)
  useEffect(() => {
    if (connectionState === 'connected') return; // Req 15.2: suppress polling when WS connected
    if (!selectedId) return;
    let active = true;
    const pollMessages = async () => {
      try {
        const data = await getMessages(selectedId, { limit: 50 });
        if (!active) return;
        if (data.messages && data.messages.length > 0) {
          const apiBridgeMsgs: BridgeMessage[] = data.messages.map((m) => ({
            id: m.messageId,
            direction: m.direction,
            text: m.content?.text || m.content?.body || '',
            timestamp: m.createdAt,
            channel: m.channel || 'web',
          }));
          setSessions(prev => prev.map(s => {
            if (s.id !== selectedId) return s;
            // Merge: keep optimistic local messages not yet in API, add API messages
            const apiIds = new Set(apiBridgeMsgs.map(m => m.id));
            const localOnly = s.messages.filter(m => !apiIds.has(m.id) && m.id.startsWith('seller-'));
            const merged = [...apiBridgeMsgs, ...localOnly].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
            const last = merged[merged.length - 1];
            return {
              ...s,
              messages: merged,
              lastMessage: last?.text || s.lastMessage,
              lastMessageTime: last?.timestamp || s.lastMessageTime,
            };
          }));
        }
      } catch {
        // API polling failed — keep existing messages in state
      }
    };
    pollMessages(); // Initial fetch
    const interval = setInterval(pollMessages, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [selectedId, connectionState]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [selectedId, sessions]);

  const selectedSession = sessions.find(s => s.id === selectedId) || null;

  const handleSelectSession = useCallback((id: string) => {
    setSelectedId(id);
    setSessions(prev => prev.map(s => s.id === id ? { ...s, unread: 0 } : s));
    // Fire-and-forget: persist read receipt to backend (don't block UI)
    markConversationRead(id).catch(() => {});
  }, []);

  const handleSend = useCallback(async () => {
    if (!messageInput.trim() || !selectedId || sending) return;
    setSending(true);
    const text = messageInput.trim();
    const timestamp = new Date().toISOString();
    const newMsg: BridgeMessage = {
      id: `seller-${Date.now()}`,
      direction: 'outbound',
      text,
      timestamp,
      channel: selectedSession?.channel || 'web',
    };
    if (selectedId === DEMO_SESSION_ID) { appendMessage(DEMO_SESSION_ID, newMsg); }
    setSessions(prev => prev.map(s => s.id !== selectedId ? s : {
      ...s,
      messages: [...s.messages, newMsg],
      lastMessage: text,
      lastMessageTime: timestamp,
    }));

    // PRIMARY: Send via HTTP API to backend
    try {
      const { fetchWithAuth } = await import('@/lib/api-client');
      await fetchWithAuth(`/api/v1/seller/inbox/${selectedId}/reply`, {
        method: 'POST',
        body: JSON.stringify({
          content: text,
          channel: selectedSession?.channel || 'web',
        }),
      });
    } catch {
      // API unavailable — message saved in bridge as fallback
    }

    // SECONDARY: Also send via WebSocket if connected
    if (connectionState === 'connected' && selectedSession) {
      wsSendMessage(selectedSession.id, { body: text }, 'text');
    }
    setMessageInput('');
    setSending(false);
  }, [messageInput, selectedId, sending, selectedSession, connectionState, wsSendMessage]);

  /** Notify typing via WebSocket (debounced by the hook) */
  const handleInputChange = useCallback((value: string) => {
    setMessageInput(value);
    if (selectedSession && connectionState === 'connected') {
      wsSendTyping(selectedSession.id);
    }
  }, [selectedSession, connectionState, wsSendTyping]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMs / 3600000);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const filteredSessions = sessions.filter(s =>
    s.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.phone.includes(searchQuery) ||
    s.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );


  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left panel - session list */}
      <div className="w-80 flex-shrink-0 border-r bg-white flex flex-col">
        <div className="border-b px-4 py-3">
          <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-indigo-600" /> Inbox
          </h1>
          <div className="mt-2 relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredSessions.map(s => (
            <button
              key={s.id}
              onClick={() => handleSelectSession(s.id)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 transition hover:bg-gray-50 ${selectedId === s.id ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 flex-shrink-0">
                  <User className="h-4 w-4 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800 truncate">{s.customerName}</span>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{formatTime(s.lastMessageTime)}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {s.channel === 'whatsapp' ? <Phone className="h-3 w-3 text-green-500" /> : <Globe className="h-3 w-3 text-blue-500" />}
                    <span className="text-xs text-gray-500 truncate">{s.lastMessage}</span>
                    {s.synced ? (
                      <span title="Synced with backend" className="flex-shrink-0 ml-auto"><Cloud className="h-3 w-3 text-green-400" /></span>
                    ) : (
                      <span title="Local only" className="flex-shrink-0 ml-auto"><CloudOff className="h-3 w-3 text-amber-400" /></span>
                    )}
                  </div>
                </div>
                {s.unread > 0 && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white flex-shrink-0">
                    {s.unread}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
      {/* Right panel - message thread */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {!selectedSession ? (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageCircle className="mx-auto h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">Select a conversation to start</p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 border-b bg-white px-4 py-3">
              <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gray-100">
                <User className="h-4 w-4 text-gray-500" />
                {/* Customer presence indicator */}
                {(() => {
                  const customerPresence = presenceMap.get(selectedSession.id);
                  if (customerPresence?.online) {
                    return <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-white" />;
                  }
                  return null;
                })()}
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-800">{selectedSession.customerName}</h2>
                <p className="text-[11px] text-gray-400 flex items-center gap-1">
                  {selectedSession.channel === 'whatsapp' ? <Phone className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                  {selectedSession.phone} &middot; {selectedSession.channel}
                  {(() => {
                    const customerPresence = presenceMap.get(selectedSession.id);
                    if (customerPresence?.online) return <span className="text-green-600 ml-1">· Online</span>;
                    if (customerPresence?.lastSeen) {
                      return <span className="ml-1">· Last seen {formatTime(customerPresence.lastSeen)}</span>;
                    }
                    return null;
                  })()}
                </p>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {selectedSession.messages.map(m => (
                <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${
                    m.direction === 'outbound'
                      ? 'bg-indigo-600 text-white rounded-br-md'
                      : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md'
                  }`}>
                    <p>{m.text}</p>
                    <p className={`text-[10px] mt-1 ${m.direction === 'outbound' ? 'text-indigo-200' : 'text-gray-400'} flex items-center gap-1`}>
                      <Clock className="h-2.5 w-2.5" />
                      {formatTime(m.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing indicator from WebSocket */}
            {typingUsers.size > 0 && (
              <TypingIndicator typingUsers={typingUsers} />
            )}

            {/* Composer */}
            <div className="border-t bg-white px-4 py-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Type a reply..."
                  value={messageInput}
                  onChange={e => handleInputChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                />
                <button
                  onClick={handleSend}
                  disabled={!messageInput.trim() || sending}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
