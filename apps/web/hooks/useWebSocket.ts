'use client';

/**
 * useWebSocket React Hook — Real-time messaging with polling fallback
 *
 * Manages WebSocket connection lifecycle, message deduplication across
 * WebSocket and polling sources, typing indicator debounce, and
 * seller presence tracking.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 13.3, 13.4
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  WebSocketClient,
  deduplicateMessages,
  type ConnectionState,
  type WebSocketEvent,
} from '../lib/websocket-client';
import { createSyncClient, type SyncClient } from '../lib/sync-client';
import type { ChatMessage, PresenceUpdate } from '../lib/api-chat';

// --- Constants ---

/** Typing debounce: at most one typing event per 3 seconds. Exported for Property 12 testing. */
export const TYPING_DEBOUNCE_MS = 3_000;

/** Auto-hide typing indicator after 5 seconds without new typing event. */
const TYPING_TIMEOUT_MS = 5_000;

// --- Types ---

export interface PresenceInfo {
  online: boolean;
  lastSeen?: string;
}

export interface UseWebSocketReturn {
  connectionState: ConnectionState;
  sendMessage: (recipientId: string, content: Record<string, unknown>, messageType?: string) => void;
  sendTyping: (recipientId: string) => void;
  markRead: (messageId: string) => void;
  messages: ChatMessage[];
  typingUsers: Map<string, boolean>;
  presenceMap: Map<string, PresenceInfo>;
}

// --- Hook ---

export function useWebSocket(token: string | null): UseWebSocketReturn {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<Map<string, boolean>>(new Map());
  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceInfo>>(new Map());

  const wsClientRef = useRef<WebSocketClient | null>(null);
  const syncClientRef = useRef<SyncClient | null>(null);
  const lastTypingSentRef = useRef<Map<string, number>>(new Map());
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevStateRef = useRef<ConnectionState>('disconnected');

  // --- Helpers ---

  /** Add messages with deduplication by messageId */
  const addMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const combined = [...prev, ...incoming];
      return deduplicateMessages(combined) as ChatMessage[];
    });
  }, []);

  /** Clear typing indicator for a user after timeout */
  const clearTypingTimer = useCallback((userId: string) => {
    const existing = typingTimersRef.current.get(userId);
    if (existing) clearTimeout(existing);
    typingTimersRef.current.delete(userId);
  }, []);

  /** Set typing indicator with auto-hide after TYPING_TIMEOUT_MS */
  const setTypingWithTimeout = useCallback(
    (userId: string, isTyping: boolean) => {
      clearTypingTimer(userId);

      if (isTyping) {
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.set(userId, true);
          return next;
        });

        // Requirement 13.4: auto-hide after 5 seconds
        const timer = setTimeout(() => {
          setTypingUsers((prev) => {
            const next = new Map(prev);
            next.delete(userId);
            return next;
          });
          typingTimersRef.current.delete(userId);
        }, TYPING_TIMEOUT_MS);
        typingTimersRef.current.set(userId, timer);
      } else {
        setTypingUsers((prev) => {
          const next = new Map(prev);
          next.delete(userId);
          return next;
        });
      }
    },
    [clearTypingTimer],
  );

  // --- WebSocket event handler ---

  const handleWsEvent = useCallback(
    (event: WebSocketEvent) => {
      switch (event.action) {
        case 'message':
        case 'newMessage': {
          const msg = event.message as ChatMessage | undefined;
          if (msg) addMessages([msg]);
          break;
        }
        case 'sync_response': {
          const msgs = event.messages as ChatMessage[] | undefined;
          if (msgs?.length) addMessages(msgs);
          break;
        }
        case 'typing': {
          const userId = event.userId as string | undefined;
          const isTyping = event.isTyping as boolean | undefined;
          if (userId) setTypingWithTimeout(userId, isTyping ?? true);
          break;
        }
        case 'presence': {
          const update = event as unknown as PresenceUpdate;
          if (update.userId) {
            setPresenceMap((prev) => {
              const next = new Map(prev);
              next.set(update.userId, {
                online: update.online,
                lastSeen: update.lastSeen,
              });
              return next;
            });
          }
          break;
        }
        case 'status_update': {
          const messageId = event.messageId as string | undefined;
          const deliveryStatus = event.deliveryStatus as string | undefined;
          if (messageId && deliveryStatus) {
            setMessages((prev) =>
              prev.map((m) =>
                m.messageId === messageId
                  ? { ...m, deliveryStatus: deliveryStatus as ChatMessage['deliveryStatus'] }
                  : m,
              ),
            );
          }
          break;
        }
        default:
          break;
      }
    },
    [addMessages, setTypingWithTimeout],
  );

  // --- Polling fallback setup ---

  const startPolling = useCallback(() => {
    if (syncClientRef.current) return; // already running
    syncClientRef.current = createSyncClient({
      onMessages: (msgs) => addMessages(msgs),
      onCartUpdate: () => {}, // cart handled elsewhere
      onTyping: (indicators) => {
        for (const ind of indicators) {
          setTypingWithTimeout(ind.userId, ind.isTyping);
        }
      },
      onError: () => {}, // silent fallback errors
    });
    syncClientRef.current.start();
  }, [addMessages, setTypingWithTimeout]);

  const stopPolling = useCallback(() => {
    if (syncClientRef.current) {
      syncClientRef.current.stop();
      syncClientRef.current = null;
    }
  }, []);

  // --- Connection state change handler ---

  const handleStateChange = useCallback(
    (newState: ConnectionState) => {
      const prevState = prevStateRef.current;
      setConnectionState(newState);

      // Requirement 15.2 / 3.2: suppress polling only when WS is confirmed connected and healthy
      if (newState === 'connected') {
        stopPolling();

        // Requirement 15.4: reconnected from disconnected → sync missed messages
        if (prevState === 'disconnected') {
          // sync is handled by WebSocketClient internally on reconnect
        }
      }

      // Requirement 2.4: ensure polling runs for all non-connected states
      // (connecting, reconnecting, disconnected) so messages flow during
      // WS setup, reconnection, and any transient failure states
      if (newState !== 'connected') {
        startPolling();
      }

      prevStateRef.current = newState;
    },
    [startPolling, stopPolling],
  );

  // --- Initialize WebSocket client ---

  useEffect(() => {
    if (!token) return;

    const client = new WebSocketClient();
    wsClientRef.current = client;

    // Requirement 2.4: start polling immediately on mount so messages flow
    // during WebSocket connection setup. Polling will be suppressed once
    // WS transitions to 'connected' state (confirmed healthy).
    startPolling();

    client.onStateChange(handleStateChange);
    client.onMessage(handleWsEvent);
    client.connect(token);

    return () => {
      client.disconnect();
      wsClientRef.current = null;
      stopPolling();

      // Clear all typing timers
      for (const timer of typingTimersRef.current.values()) {
        clearTimeout(timer);
      }
      typingTimersRef.current.clear();
    };
  }, [token, handleStateChange, handleWsEvent, startPolling, stopPolling]);

  // --- Public API ---

  /** Send a chat message via WebSocket */
  const sendMessage = useCallback(
    (recipientId: string, content: Record<string, unknown>, messageType = 'text') => {
      wsClientRef.current?.send('sendMessage', {
        recipientId,
        messageType,
        content,
      });
    },
    [],
  );

  /**
   * Send typing indicator with debounce.
   * Requirement 13.3: at most one typing event per 3 seconds.
   */
  const sendTyping = useCallback((recipientId: string) => {
    const now = Date.now();
    const lastSent = lastTypingSentRef.current.get(recipientId) ?? 0;

    if (now - lastSent < TYPING_DEBOUNCE_MS) return;

    lastTypingSentRef.current.set(recipientId, now);
    wsClientRef.current?.send('typing', {
      conversationUserId: recipientId,
      isTyping: true,
    });
  }, []);

  /** Mark a message as read via WebSocket */
  const markRead = useCallback((messageId: string) => {
    wsClientRef.current?.send('markRead', { messageId });
  }, []);

  return {
    connectionState,
    sendMessage,
    sendTyping,
    markRead,
    messages,
    typingUsers,
    presenceMap,
  };
}
