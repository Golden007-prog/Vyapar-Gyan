'use client';

import { User } from 'lucide-react';
import type { ConversationSummary } from '@/lib/api-inbox';
import ChannelIndicator from '@/components/ui/ChannelIndicator';

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function getPreviewText(lastMessage: ConversationSummary['lastMessage']): string {
  const content = lastMessage.content as Record<string, unknown> | undefined;
  if (!content) return 'Message';
  if (typeof content.text === 'string') return content.text;
  if (typeof content.body === 'string') return content.body;
  if (lastMessage.messageType === 'image') return '📷 Image';
  if (lastMessage.messageType === 'audio') return '🎤 Audio';
  return 'Message';
}

interface ConversationRowProps {
  conversation: ConversationSummary;
  isSelected: boolean;
  onClick: () => void;
}

export default function ConversationRow({ conversation, isSelected, onClick }: ConversationRowProps) {
  const preview = getPreviewText(conversation.lastMessage);
  const isOutbound = conversation.lastMessage.direction === 'outbound';

  return (
    <button
      onClick={onClick}
      className={`w-full border-b px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
        isSelected ? 'bg-indigo-50 border-l-2 border-l-indigo-600' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100">
            <User className="h-5 w-5 text-indigo-600" />
          </div>
          {/* Channel icon badge */}
          <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm">
            <ChannelIndicator channel={conversation.channel} />
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <p className={`text-sm ${conversation.unreadCount > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
              {conversation.displayName || conversation.userId.slice(0, 8)}
            </p>
            <span className="flex-shrink-0 text-xs text-gray-400">
              {formatRelativeTime(conversation.lastActivityAt)}
            </span>
          </div>

          <div className="mt-0.5 flex items-center justify-between">
            <p className={`truncate text-sm ${conversation.unreadCount > 0 ? 'text-gray-800' : 'text-gray-500'}`}>
              {isOutbound && <span className="text-gray-400">You: </span>}
              {preview}
            </p>

            {/* Unread badge */}
            {conversation.unreadCount > 0 && (
              <span className="ml-2 flex h-5 min-w-[20px] flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
