'use client';

import { useEffect, useRef } from 'react';
import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import type { ChatMessage, DeliveryStatus } from '@/lib/api-chat';
import TypingIndicator from './TypingIndicator';
import ChannelIndicator from '@/components/ui/ChannelIndicator';

// --- Sub-components ---

function DeliveryStatusIcon({ status }: { status: DeliveryStatus }) {
  switch (status) {
    case 'queued':
      return <Clock className="h-3 w-3 text-gray-400" aria-label="Queued" />;
    case 'sent':
      return <Check className="h-3 w-3 text-gray-400" aria-label="Sent" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3 text-gray-400" aria-label="Delivered" />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-blue-500" aria-label="Read" />;
    case 'failed':
      return <AlertCircle className="h-3 w-3 text-red-500" aria-label="Failed" />;
    default:
      return null;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isOutbound = message.direction === 'outbound';
  const isSystem = message.senderRole === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center px-4 py-1">
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
          {message.content?.body || ''}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex px-4 py-0.5 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`relative max-w-[75%] rounded-2xl px-3.5 py-2 shadow-sm ${
          isOutbound
            ? 'rounded-br-md bg-indigo-600 text-white'
            : 'rounded-bl-md bg-white text-gray-800'
        }`}
      >
        {/* Message body */}
        {message.messageType === 'image' && message.content?.mediaUrl && (
          <img
            src={message.content.mediaUrl}
            alt="Shared image"
            className="mb-1 max-h-48 rounded-lg object-cover"
          />
        )}
        {message.content?.body && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content.body}</p>
        )}

        {/* Footer: time + channel + delivery status */}
        <div
          className={`mt-1 flex items-center gap-1.5 ${
            isOutbound ? 'justify-end' : 'justify-start'
          }`}
        >
          <span className={`text-[10px] ${isOutbound ? 'text-indigo-200' : 'text-gray-400'}`}>
            {formatTime(message.createdAt)}
          </span>
          <ChannelIndicator channel={message.channel} />
          {isOutbound && <DeliveryStatusIcon status={message.deliveryStatus} />}
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

interface MessageListProps {
  messages: ChatMessage[];
  isTyping?: boolean;
}

export default function MessageList({ messages, isTyping }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isTyping]);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 py-3">
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-gray-400">No messages yet. Say hello!</p>
        </div>
      )}

      {messages.map((msg) => (
        <MessageBubble key={msg.messageId} message={msg} />
      ))}

      {isTyping && <TypingIndicator />}

      <div ref={bottomRef} />
    </div>
  );
}
