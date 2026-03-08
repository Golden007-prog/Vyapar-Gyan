'use client';

import { useState, useRef, useCallback } from 'react';
import { Send, ImagePlus, Loader2 } from 'lucide-react';

const MAX_CHARS = 4096;

interface ChatComposerProps {
  onSend: (text: string) => Promise<void> | void;
  onImageSelect?: (file: File) => void;
  onTyping?: () => void;
  disabled?: boolean;
}

export default function ChatComposer({
  onSend,
  onImageSelect,
  onTyping,
  disabled,
}: ChatComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (value: string) => {
      if (value.length > MAX_CHARS) return;
      setText(value);

      // Debounced typing indicator
      if (onTyping) {
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => onTyping(), 300);
      }
    },
    [onTyping],
  );

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
    } finally {
      setSending(false);
    }
  }, [text, sending, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onImageSelect) {
      onImageSelect(file);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const charCount = text.length;
  const nearLimit = charCount > MAX_CHARS * 0.9;

  return (
    <div className="border-t bg-white px-3 py-2">
      {/* Character counter (shown near limit) */}
      {nearLimit && (
        <div className="mb-1 text-right">
          <span
            className={`text-[10px] ${charCount >= MAX_CHARS ? 'text-red-500' : 'text-gray-400'}`}
          >
            {charCount}/{MAX_CHARS}
          </span>
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Image upload */}
        {onImageSelect && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || sending}
              className="flex-shrink-0 rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
              aria-label="Upload image"
            >
              <ImagePlus className="h-5 w-5" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        )}

        {/* Text input */}
        <textarea
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={disabled || sending}
          rows={1}
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-gray-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim() || disabled || sending}
          className="flex-shrink-0 rounded-full bg-indigo-600 p-2.5 text-white transition hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
