import { MessageSquare, Bot } from 'lucide-react';

export type Channel = 'whatsapp' | 'web' | 'system' | string;

export interface ChannelIndicatorProps {
  channel: Channel;
  /** Additional CSS classes */
  className?: string;
}

export default function ChannelIndicator({ channel, className = '' }: ChannelIndicatorProps) {
  if (channel === 'whatsapp') {
    return (
      <span
        className={`text-[10px] font-semibold text-green-600 ${className}`}
        title="WhatsApp"
        aria-label="via WhatsApp"
      >
        WA
      </span>
    );
  }

  if (channel === 'system') {
    return (
      <Bot
        className={`h-3 w-3 text-gray-400 ${className}`}
        aria-label="system message"
      />
    );
  }

  return (
    <MessageSquare
      className={`h-3 w-3 text-indigo-400 ${className}`}
      aria-label="via Web"
    />
  );
}
