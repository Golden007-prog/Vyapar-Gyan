'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { MessageCircle, Send, User, Search, Phone, Globe, Clock } from 'lucide-react';

const DEMO_CUSTOMER_PHONE = '+917001124396';

interface InboxMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  timestamp: string;
  channel: 'whatsapp' | 'web';
}

interface InboxSession {
  id: string;
  customerName: string;
  phone: string;
  channel: 'whatsapp' | 'web';
  lastMessage: string;
  lastMessageTime: string;
  unread: number;
  messages: InboxMessage[];
}

function buildSeedSessions(): InboxSession[] {
  const now = Date.now();
  return [
    {
      id: 'sess-demo-001',
      customerName: 'Demo Customer',
      phone: DEMO_CUSTOMER_PHONE,
      channel: 'web',
      lastMessage: 'Hi, do you have Amul Butter in stock?',
      lastMessageTime: new Date(now - 5 * 60000).toISOString(),
      unread: 1,
      messages: [
        { id: 'm1', direction: 'inbound', text: 'Hi, do you have Amul Butter in stock?', timestamp: new Date(now - 5 * 60000).toISOString(), channel: 'web' },
      ],
    },
    {
      id: 'sess-wa-002',
      customerName: 'Priya Sharma',
      phone: '+919876543210',
      channel: 'whatsapp',
      lastMessage: 'Order delivered, thank you!',
      lastMessageTime: new Date(now - 3600000).toISOString(),
      unread: 0,
      messages: [
        { id: 'm2a', direction: 'inbound', text: 'When will my order arrive?', timestamp: new Date(now - 7200000).toISOString(), channel: 'whatsapp' },
        { id: 'm2b', direction: 'outbound', text: 'Hi Priya! Your order is out for delivery. Should reach you by 5 PM today.', timestamp: new Date(now - 5400000).toISOString(), channel: 'whatsapp' },
        { id: 'm2c', direction: 'inbound', text: 'Order delivered, thank you!', timestamp: new Date(now - 3600000).toISOString(), channel: 'whatsapp' },
      ],
    },
    {
      id: 'sess-wa-003',
      customerName: 'Rahul Verma',
      phone: '+918765432100',
      channel: 'whatsapp',
      lastMessage: 'Do you have USB-C cables?',
      lastMessageTime: new Date(now - 86400000).toISOString(),
      unread: 1,
      messages: [
        { id: 'm3a', direction: 'inbound', text: 'Do you have USB-C cables?', timestamp: new Date(now - 86400000).toISOString(), channel: 'whatsapp' },
      ],
    },
  ];
}
const BRIDGE_KEY = 'vyapargyan_inbox_messages';

function readBridgeMessages(): { sessionId: string; text: string; direction: 'inbound' | 'outbound'; timestamp: string }[] {
  try {
    const raw = sessionStorage.getItem(BRIDGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeBridgeMessages(msgs: { sessionId: string; text: string; direction: 'inbound' | 'outbound'; timestamp: string }[]) {
  sessionStorage.setItem(BRIDGE_KEY, JSON.stringify(msgs));
}

export default function InboxPage() {
  const [sessions, setSessions] = useState<InboxSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setSessions(buildSeedSessions()); }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const bridged = readBridgeMessages();
      if (bridged.length === 0) return;
      setSessions(prev => {
        const updated = [...prev];
        for (const bm of bridged) {
          const idx = updated.findIndex(s => s.id === bm.sessionId);
          if (idx >= 0) {
            const sess = { ...updated[idx] };
            const exists = sess.messages.some(m => m.timestamp === bm.timestamp && m.text === bm.text);
            if (!exists) {
              sess.messages = [...sess.messages, { id: 'bm-' + Date.now() + '-' + Math.random(), direction: bm.direction, text: bm.text, timestamp: bm.timestamp, channel: sess.channel }];
              sess.lastMessage = bm.text;
              sess.lastMessageTime = bm.timestamp;
              if (bm.direction === 'inbound') sess.unread += 1;
              updated[idx] = sess;
            }
          }
        }
        return updated;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [selectedId, sessions]);

  const selectedSession = sessions.find(s => s.id === selectedId) || null;

  const handleSelectSession = useCallback((id: string) => {
    setSelectedId(id);
    setSessions(prev => prev.map(s => s.id === id ? { ...s, unread: 0 } : s));
  }, []);

  const handleSend = useCallback(() => {
    if (!messageInput.trim() || !selectedId || sending) return;
    setSending(true);
    const text = messageInput.trim();
    const timestamp = new Date().toISOString();
    setSessions(prev => prev.map(s => {
      if (s.id !== selectedId) return s;
      const newMsg: InboxMessage = { id: 'out-' + Date.now(), direction: 'outbound', text, timestamp, channel: s.channel };
      return { ...s, messages: [...s.messages, newMsg], lastMessage: text, lastMessageTime: timestamp };
    }));
    const bridged = readBridgeMessages();
    bridged.push({ sessionId: selectedId, text, direction: 'outbound', timestamp });
    writeBridgeMessages(bridged);
    setMessageInput('');
    setSending(false);
  }, [messageInput, selectedId, sending]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const diffHr = Math.floor(diffMs / 3600000);
    if (diffHr < 24) return diffHr + 'h ago';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const filteredSessions = sessions.filter(s =>
    s.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.phone.includes(searchQuery) ||
    s.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );
  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      <div className="w-80 flex flex-col rounded-lg border bg-white shadow">
        <div className="border-b p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Customer Inbox</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search conversations..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredSessions.length === 0 && (
            <div className="p-8 text-center">
              <MessageCircle className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">{searchQuery ? 'No matches' : 'No conversations'}</p>
            </div>
          )}
          {filteredSessions.map(sess => (
            <button key={sess.id} onClick={() => handleSelectSession(sess.id)} className={'w-full border-b p-4 text-left transition-colors hover:bg-gray-50 ' + (selectedId === sess.id ? 'bg-indigo-50' : '')}>
              <div className="flex items-start gap-3">
                <div className="relative flex-shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100">
                    <User className="h-5 w-5 text-indigo-600" />
                  </div>
                  {sess.unread > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">{sess.unread}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900 truncate">{sess.customerName}</p>
                    <span className="text-xs text-gray-400 whitespace-nowrap ml-2">{formatTime(sess.lastMessageTime)}</span>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{sess.phone}</p>
                  <p className="text-sm text-gray-500 truncate mt-1">{sess.lastMessage}</p>
                  <div className="mt-1 flex items-center gap-1">
                    {sess.channel === 'whatsapp' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700"><Phone className="h-3 w-3" />WhatsApp</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700"><Globe className="h-3 w-3" />Web Chat</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col rounded-lg border bg-white shadow">
        {!selectedSession ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageCircle className="mx-auto h-16 w-16 text-gray-300" />
              <p className="mt-4 text-lg font-medium text-gray-900">Select a conversation</p>
              <p className="mt-1 text-sm text-gray-500">Choose a chat from the left to view messages</p>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100">
                  <User className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{selectedSession.customerName}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{selectedSession.phone}</span>
                    <span>&#8226;</span>
                    {selectedSession.channel === 'whatsapp' ? <span className="text-green-600">WhatsApp</span> : <span className="text-blue-600">Web Chat</span>}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {selectedSession.messages.map(msg => {
                const isCustomer = msg.direction === 'inbound';
                return (
                  <div key={msg.id} className={'flex ' + (isCustomer ? 'justify-start' : 'justify-end')}>
                    <div className={'max-w-[70%] rounded-lg px-4 py-2 ' + (isCustomer ? 'bg-gray-100 text-gray-900' : 'bg-indigo-600 text-white')}>
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                      <div className={'mt-1 flex items-center gap-1 text-[10px] ' + (isCustomer ? 'text-gray-400' : 'text-indigo-200')}>
                        <Clock className="h-3 w-3" />
                        <span>{new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t p-4">
              <div className="flex gap-2">
                <input type="text" placeholder="Type a reply..." value={messageInput} onChange={e => setMessageInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} disabled={sending} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50" />
                <button onClick={handleSend} disabled={!messageInput.trim() || sending} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                  <Send className="h-4 w-4" />
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}