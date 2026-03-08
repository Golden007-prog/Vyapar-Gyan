/**
 * Sync Client — Polling-based real-time sync
 *
 * Uses setInterval with exponential backoff on errors.
 * Backoff schedule: 2s → 4s → 8s → 16s → 30s (capped).
 * Resets to 2s on successful poll. Handles ETag/304 for efficiency.
 *
 * No React Query dependency — plain setInterval + callbacks.
 */

import { syncMessages, type SyncResponse, type ChatMessage } from './api-chat';
import type { Cart } from './api-cart';

// --- Constants ---

const BASE_INTERVAL_MS = 2_000;
const MAX_INTERVAL_MS = 30_000;
const BACKOFF_FACTOR = 2;

// --- Types ---

export interface SyncCallbacks {
  onMessages: (messages: ChatMessage[]) => void;
  onCartUpdate: (cart: Cart) => void;
  onTyping: (indicators: SyncResponse['typingIndicators']) => void;
  onError?: (error: Error) => void;
}

export interface SyncClient {
  start: () => void;
  stop: () => void;
  /** Force an immediate poll (e.g. after sending a message) */
  pollNow: () => void;
}

// --- Implementation ---

export function createSyncClient(callbacks: SyncCallbacks): SyncClient {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let currentInterval = BASE_INTERVAL_MS;
  let lastSyncTimestamp: string | undefined;
  let cartVersion: number | undefined;
  let etag: string | undefined;

  async function poll() {
    try {
      const result = await syncMessages(lastSyncTimestamp, cartVersion, etag);

      if (result.notModified) {
        // No changes — keep current interval
        scheduleNext(BASE_INTERVAL_MS);
        return;
      }

      const { data } = result;
      etag = result.etag;

      // Deliver updates to callbacks
      if (data.messages?.length) {
        callbacks.onMessages(data.messages);
      }
      if (data.cartState) {
        callbacks.onCartUpdate(data.cartState as Cart);
      }
      if (data.typingIndicators?.length) {
        callbacks.onTyping(data.typingIndicators);
      }

      // Advance cursors
      if (data.lastSyncTimestamp) {
        lastSyncTimestamp = data.lastSyncTimestamp;
      }
      if (data.cartVersion !== undefined) {
        cartVersion = data.cartVersion;
      }

      // Success — reset to base interval
      currentInterval = BASE_INTERVAL_MS;
      scheduleNext(currentInterval);
    } catch (err) {
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));

      // Exponential backoff
      currentInterval = Math.min(currentInterval * BACKOFF_FACTOR, MAX_INTERVAL_MS);
      scheduleNext(currentInterval);
    }
  }

  function scheduleNext(ms: number) {
    if (!running) return;
    timerId = setTimeout(poll, ms);
  }

  return {
    start() {
      if (running) return;
      running = true;
      currentInterval = BASE_INTERVAL_MS;
      // First poll immediately
      poll();
    },

    stop() {
      running = false;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    },

    pollNow() {
      if (!running) return;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      poll();
    },
  };
}
