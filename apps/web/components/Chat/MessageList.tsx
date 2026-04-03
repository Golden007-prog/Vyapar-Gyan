'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { ChatMessage } from '@/lib/api-chat';
import TypingIndicator from './TypingIndicator';
import ChannelIndicator from '@/components/ui/ChannelIndicator';
import MessageStatus from './MessageStatus';
import ProductCard from './ProductCard';
import OrderStatusCard from './OrderStatusCard';
import AISuggestionCard from './AISuggestionCard';
import QuickReplyButtons from './QuickReplyButtons';

// --- Helpers ---

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Renders rich content based on messageType.
 * Falls back to standard text/image rendering for unknown types.
 */
function renderRichContent(message: ChatMessage): React.ReactNode {
  const content = message.content ?? {};

  switch (message.messageType) {
    case 'product_card':
      return (
        <ProductCard
          productId={content.productId as string}
          name={content.name as string}
          price={content.price as number}
          imageUrl={content.imageUrl as string}
          description={content.description as string}
        />
      );

    case 'order_status':
      return (
        <OrderStatusCard
          orderNumber={content.orderNumber as string}
          status={content.status as string}
          items={(content.items as Array<{ name: string; quantity: number }>) ?? []}
          totalAmount={content.totalAmount as number}
          updatedAt={content.updatedAt as string}
        />
      );

    case 'ai_suggestion':
      return (
        <AISuggestionCard
          title={content.title as string}
          body={content.body as string}
        />
      );

    case 'quick_reply':
      return (
        <QuickReplyButtons
          prompt={content.prompt as string}
          options={(content.options as Array<{ label: string; value: string }>) ?? []}
        />
      );

    default:
      // Standard text / image rendering
      return (
        <>
          {message.messageType === 'image' && content.mediaUrl && (
            <img
              src={content.mediaUrl as string}
              alt="Shared image"
              className="mb-1 max-h-48 rounded-lg object-cover"
            />
          )}
          {content.body && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {content.body as string}
            </p>
          )}
        </>
      );
  }
}

// --- Rich message types render as standalone cards, not inside bubbles ---

const RICH_MESSAGE_TYPES = new Set(['product_card', 'order_status', 'ai_suggestion', 'quick_reply']);

function MessageBubble({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry?: (messageId: string) => void;
}) {
  const isOutbound = message.direction === 'outbound';
  const isSystem = message.senderRole === 'system';
  const isRich = RICH_MESSAGE_TYPES.has(message.messageType);

  if (isSystem) {
    return (
      <div className="flex justify-center px-4 py-1">
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
          {message.content?.body || ''}
        </span>
      </div>
    );
  }

  // Rich cards render outside the standard bubble chrome
  if (isRich) {
    return (
      <div className={`px-4 py-0.5 ${isOutbound ? 'flex justify-end' : 'flex justify-start'}`}>
        <div className="max-w-[75%]">
          {renderRichContent(message)}
          {/* Footer: time + delivery status */}
          <div className={`mt-1 flex items-center gap-1.5 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] text-gray-400">{formatTime(message.createdAt)}</span>
            <ChannelIndicator channel={message.channel} />
            {isOutbound && (
              <MessageStatus
                status={message.deliveryStatus}
                onRetry={onRetry ? () => onRetry(message.messageId) : undefined}
              />
            )}
          </div>
        </div>
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
        {renderRichContent(message)}

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
          {isOutbound && (
            <MessageStatus
              status={message.deliveryStatus}
              onRetry={onRetry ? () => onRetry(message.messageId) : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

interface MessageListProps {
  messages: ChatMessage[];
  /** Legacy simple typing flag */
  isTyping?: boolean;
  /** Multi-user typing map from useWebSocket */
  typingUsers?: Map<string, boolean>;
  /** Map of userId → display name for typing indicator */
  userNames?: Map<string, string>;
  /** Called when an inbound message enters the visible viewport */
  onMarkRead?: (messageId: string) => void;
  /** Called when user retries a failed outbound message */
  onRetry?: (messageId: string) => void;
}

export default function MessageList({
  messages,
  isTyping,
  typingUsers,
  userNames,
  onMarkRead,
  onRetry,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observedIdsRef = useRef<Set<string>>(new Set());

  // IntersectionObserver callback — fires markRead for inbound messages entering viewport
  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (!onMarkRead) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const messageId = (entry.target as HTMLElement).dataset.messageId;
          if (messageId && !observedIdsRef.current.has(messageId)) {
            observedIdsRef.current.add(messageId);
            onMarkRead(messageId);
          }
          // Stop observing once read
          observerRef.current?.unobserve(entry.target);
        }
      }
    },
    [onMarkRead],
  );

  // Set up IntersectionObserver
  useEffect(() => {
    if (!onMarkRead || !containerRef.current) return;

    observerRef.current = new IntersectionObserver(handleIntersection, {
      root: containerRef.current,
      threshold: 0.5,
    });

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [handleIntersection, onMarkRead]);

  // Observe inbound message elements
  useEffect(() => {
    if (!observerRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const elements = container.querySelectorAll<HTMLElement>('[data-inbound-msg]');
    elements.forEach((el) => {
      const id = el.dataset.messageId;
      if (id && !observedIdsRef.current.has(id)) {
        observerRef.current?.observe(el);
      }
    });
  }, [messages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isTyping, typingUsers]);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto bg-gray-50 py-3">
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-gray-400">No messages yet. Say hello!</p>
        </div>
      )}

      {messages.map((msg) => {
        const isInbound = msg.direction === 'inbound';
        return (
          <div
            key={msg.messageId}
            {...(isInbound ? { 'data-inbound-msg': true, 'data-message-id': msg.messageId } : {})}
          >
            <MessageBubble message={msg} onRetry={onRetry} />
          </div>
        );
      })}

      {/* Typing indicator — supports both legacy isTyping and multi-user typingUsers */}
      {(isTyping || (typingUsers && typingUsers.size > 0)) && (
        <TypingIndicator
          label={isTyping && !typingUsers ? undefined : undefined}
          typingUsers={typingUsers}
          userNames={userNames}
        />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
