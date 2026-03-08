'use client';

import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api-client';
import { MessageCircle, Send, User, Bot, Search } from 'lucide-react';

interface Message {
  sessionId: string;
  waMessageId: string;
  direction: 'inbound' | 'outbound';
  messageType: 'text' | 'interactive' | 'image' | 'audio';
  content: any;
  waStatus?: 'sent' | 'delivered' | 'read' | 'failed';
  createdAt: string;
}

interface ChatSession {
  id: string;
  customerId: string;
  phoneNumber: string;
  channelType: 'whatsapp' | 'web';
  state: string;
  lastActivityAt: string;
  lastMessage?: {
    text: string;
    direction: 'inbound' | 'outbound';
  };
}

export default function InboxPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (selectedSession) {
      fetchMessages(selectedSession.id);
    }
  }, [selectedSession]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchSessions = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get<{ data: ChatSession[] }>('/api/seller/chats');
      setSessions(response.data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load chat sessions');
      console.error('Error fetching sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (sessionId: string) => {
    try {
      setMessagesLoading(true);
      const response = await api.get<{ data: Message[] }>(`/seller/chats/${sessionId}/messages`);
      setMessages(response.data || []);
    } catch (err: any) {
      console.error('Error fetching messages:', err);
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedSession || sending) return;

    try {
      setSending(true);
      await api.post(`/seller/chats/${selectedSession.id}/messages`, {
        content: { text: messageInput.trim() },
        messageType: 'text',
      });
      
      setMessageInput('');
      // Refresh messages after sending
      await fetchMessages(selectedSession.id);
    } catch (err: any) {
      console.error('Error sending message:', err);
      alert('Failed to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const formatPhone = (phone: string) => {
    if (phone.startsWith('91') && phone.length === 12) {
      return `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`;
    }
    return phone;
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const formatMessageTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  const getMessageText = (message: Message): string => {
    if (message.messageType === 'text' && message.content?.text) {
      return message.content.text;
    }
    if (message.messageType === 'interactive' && message.content?.body?.text) {
      return message.content.body.text;
    }
    if (message.messageType === 'image') {
      return '📷 Image';
    }
    if (message.messageType === 'audio') {
      return '🎤 Audio';
    }
    return 'Message';
  };

  const filteredSessions = sessions.filter(session =>
    session.phoneNumber.includes(searchQuery) ||
    session.lastMessage?.text?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Left Pane - Session List */}
      <div className="w-80 flex flex-col rounded-lg border bg-white shadow">
        {/* Search Header */}
        <div className="border-b p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-solid border-indigo-600 border-r-transparent"></div>
                <p className="mt-2 text-xs text-gray-500">Loading chats...</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="p-4">
              <div className="rounded-lg bg-red-50 p-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && filteredSessions.length === 0 && (
            <div className="p-8 text-center">
              <MessageCircle className="mx-auto h-12 w-12 text-gray-400" />
              <p className="mt-2 text-sm text-gray-500">
                {searchQuery ? 'No conversations found' : 'No active conversations'}
              </p>
            </div>
          )}

          {!loading && !error && filteredSessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setSelectedSession(session)}
              className={`w-full border-b p-4 text-left transition-colors hover:bg-gray-50 ${
                selectedSession?.id === session.id ? 'bg-indigo-50' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100">
                    <User className="h-5 w-5 text-indigo-600" />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-900">
                      {formatPhone(session.phoneNumber)}
                    </p>
                    <span className="text-xs text-gray-500">
                      {formatTime(session.lastActivityAt)}
                    </span>
                  </div>
                  {session.lastMessage && (
                    <p className="mt-1 truncate text-sm text-gray-500">
                      {session.lastMessage.direction === 'outbound' && '✓ '}
                      {session.lastMessage.text}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-gray-400 capitalize">
                      {session.channelType}
                    </span>
                    <span className="text-xs text-gray-400">•</span>
                    <span className="text-xs text-gray-400 capitalize">
                      {session.state.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right Pane - Chat Messages */}
      <div className="flex flex-1 flex-col rounded-lg border bg-white shadow">
        {!selectedSession ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageCircle className="mx-auto h-16 w-16 text-gray-300" />
              <p className="mt-4 text-lg font-medium text-gray-900">
                Select a conversation
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Choose a chat from the left to view messages
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="border-b p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100">
                  <User className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {formatPhone(selectedSession.phoneNumber)}
                  </p>
                  <p className="text-xs text-gray-500 capitalize">
                    {selectedSession.state.replace('_', ' ')} • {selectedSession.channelType}
                  </p>
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messagesLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-solid border-indigo-600 border-r-transparent"></div>
                </div>
              )}

              {!messagesLoading && messages.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500">No messages yet</p>
                </div>
              )}

              {!messagesLoading && messages.map((message) => {
                const isCustomer = message.direction === 'inbound';
                const messageText = getMessageText(message);

                return (
                  <div
                    key={message.waMessageId}
                    className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}
                  >
                    <div className={`flex max-w-[70%] gap-2 ${isCustomer ? 'flex-row' : 'flex-row-reverse'}`}>
                      {/* Avatar */}
                      <div className="flex-shrink-0">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                          isCustomer ? 'bg-gray-200' : 'bg-blue-500'
                        }`}>
                          {isCustomer ? (
                            <User className="h-4 w-4 text-gray-600" />
                          ) : (
                            <Bot className="h-4 w-4 text-white" />
                          )}
                        </div>
                      </div>

                      {/* Message Bubble */}
                      <div>
                        <div className={`rounded-lg px-4 py-2 ${
                          isCustomer 
                            ? 'bg-gray-100 text-gray-900' 
                            : 'bg-blue-500 text-white'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {messageText}
                          </p>
                        </div>
                        <div className={`mt-1 flex items-center gap-1 text-xs text-gray-500 ${
                          isCustomer ? 'justify-start' : 'justify-end'
                        }`}>
                          <span>{formatMessageTime(message.createdAt)}</span>
                          {!isCustomer && message.waStatus && (
                            <span className="capitalize">• {message.waStatus}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="border-t p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Type a message to override the bot..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  disabled={sending}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!messageInput.trim() || sending}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <Send className="h-4 w-4" />
                  {sending ? 'Sending...' : 'Send'}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Manual messages will override the AI bot for this conversation
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
