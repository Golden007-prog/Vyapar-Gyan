/**
 * WebSocket Client — Real-time messaging over API Gateway WebSocket API
 *
 * Manages connection lifecycle, heartbeats, exponential backoff reconnection,
 * and message dispatch. Falls back to polling after 5 consecutive failures.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3
 */

// --- Types ---

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface WebSocketEvent {
  action: string;
  [key: string]: unknown;
}

type MessageHandler = (event: WebSocketEvent) => void;
type StateChangeHandler = (state: ConnectionState) => void;

// --- Constants ---

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_ACK_TIMEOUT_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_CAP_MS = 30_000;

// --- Exported Utilities ---

/**
 * Calculate exponential backoff delay for a given attempt number.
 * Formula: min(2^(attempt-1) * 1000, 30000) ms
 *
 * Property 7: Exponential backoff calculation
 * Validates: Requirements 4.3
 */
export function calculateBackoff(attempt: number): number {
  return Math.min(Math.pow(2, attempt - 1) * 1000, BACKOFF_CAP_MS);
}

/**
 * Deduplicate messages by messageId, preserving first occurrence order.
 *
 * Property 16: Message deduplication
 * Validates: Requirements 15.5
 */
export function deduplicateMessages(
  messages: Array<{ messageId: string }>,
): Array<{ messageId: string }> {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (seen.has(m.messageId)) return false;
    seen.add(m.messageId);
    return true;
  });
}


// --- WebSocketClient Class ---

export class WebSocketClient {
  private _state: ConnectionState = 'disconnected';
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private messageHandlers: MessageHandler[] = [];
  private stateChangeHandlers: StateChangeHandler[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAckTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastReceivedTimestamp: string | null = null;
  private intentionalDisconnect = false;

  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Connect to the WebSocket API with a Cognito JWT token.
   * Requirement 4.1
   */
  connect(token: string): void {
    this.token = token;
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;
    this.openConnection();
  }

  /**
   * Gracefully disconnect and stop all timers.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cleanup();
    this.setState('disconnected');
  }

  /**
   * Send an action with payload over the WebSocket.
   */
  send(action: string, payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ action, ...payload }));
  }

  /**
   * Register a handler for incoming WebSocket messages.
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register a handler for connection state changes.
   */
  onStateChange(handler: StateChangeHandler): void {
    this.stateChangeHandlers.push(handler);
  }

  // --- Private Methods ---

  private setState(newState: ConnectionState): void {
    if (this._state === newState) return;
    this._state = newState;
    for (const handler of this.stateChangeHandlers) {
      handler(newState);
    }
  }

  private getWebSocketUrl(): string {
    const base = process.env.NEXT_PUBLIC_WEBSOCKET_URL || '';
    return `${base}?token=${encodeURIComponent(this.token || '')}`;
  }

  private openConnection(): void {
    this.cleanup();
    this.setState('connecting');

    try {
      this.ws = new WebSocket(this.getWebSocketUrl());
    } catch {
      this.handleConnectionFailure();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState('connected');
      this.startHeartbeat();

      // Requirement 4.6: sync missed messages on reconnection
      if (this.lastReceivedTimestamp) {
        this.send('sync', { lastMessageTimestamp: this.lastReceivedTimestamp });
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data: WebSocketEvent = JSON.parse(String(event.data));

        // Track heartbeat ack
        if (data.action === 'heartbeat_ack') {
          this.clearHeartbeatAckTimer();
          return;
        }

        // Track last received timestamp for sync on reconnect
        if (data.timestamp && typeof data.timestamp === 'string') {
          this.lastReceivedTimestamp = data.timestamp;
        }

        for (const handler of this.messageHandlers) {
          handler(data);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      if (!this.intentionalDisconnect) {
        this.handleConnectionFailure();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, so reconnection is handled there
    };
  }

  private handleConnectionFailure(): void {
    this.reconnectAttempts++;

    // Requirement 4.5: after 5 consecutive failures, go disconnected
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.cleanup();
      this.setState('disconnected');
      return;
    }

    this.setState('reconnecting');
    const delay = calculateBackoff(this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => this.openConnection(), delay);
  }

  /**
   * Send heartbeat ping every 30 seconds.
   * Requirement 4.2, 5.3
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send('heartbeat', {});
      this.startHeartbeatAckTimer();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatAckTimer();
  }

  /**
   * Requirement 5.3: treat absence of heartbeat ack within 60s as connection failure.
   */
  private startHeartbeatAckTimer(): void {
    this.clearHeartbeatAckTimer();
    this.heartbeatAckTimer = setTimeout(() => {
      // No ack received — treat as connection failure
      if (this.ws) {
        this.ws.close();
      }
    }, HEARTBEAT_ACK_TIMEOUT_MS);
  }

  private clearHeartbeatAckTimer(): void {
    if (this.heartbeatAckTimer) {
      clearTimeout(this.heartbeatAckTimer);
      this.heartbeatAckTimer = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}
