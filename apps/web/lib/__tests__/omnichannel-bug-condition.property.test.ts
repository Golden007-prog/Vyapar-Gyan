/**
 * Bug Condition Exploration Test — Bridge-First Architecture Causes
 * Cross-Channel Message Loss and Stale Seller UI
 *
 * Property 1: Bug Condition
 *
 * This test MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9**
 */

import fc from 'fast-check';
import { deduplicateMessages } from '../websocket-client';

// ---------------------------------------------------------------------------
// Helpers: read source files as strings for static analysis of unfixed code
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf-8');
}

// ---------------------------------------------------------------------------
// Case A (Chat Page): Backend messages must be retrieved via API sync,
// not solely from sessionStorage bridge.
//
// On unfixed code the chat page reads from getSessionMessages(DEMO_SESSION_ID)
// and polls the bridge every 1.5s — backend-only messages never appear.
// ---------------------------------------------------------------------------
describe('Case A — Chat Page: API-first message loading', () => {
  const chatPageSource = readSource('app/(customer)/chat/page.tsx');

  it('should use sync client (createSyncClient) as primary data source for messages', () => {
    fc.assert(
      fc.property(
        fc.record({
          userId: fc.stringMatching(/^cust-[0-9]{3,6}$/),
          messageText: fc.string({ minLength: 1, maxLength: 200 }),
        }),
        ({ userId }) => {
          // The chat page MUST create a sync client for continuous polling
          // from /api/v1/chat/sync as the primary data source.
          // On unfixed code, createSyncClient is NOT used in the chat page.
          const usesSyncClient = chatPageSource.includes('createSyncClient');
          expect(usesSyncClient).toBe(true);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('should NOT use bridge polling (setInterval + getSessionMessages) as primary message source', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          // On unfixed code, the chat page has a setInterval that polls
          // getSessionMessages(DEMO_SESSION_ID) every 1.5s as the primary
          // message source. This must be replaced with sync client polling.
          const hasBridgePollingLoop =
            chatPageSource.includes('setInterval') &&
            chatPageSource.includes('getSessionMessages(DEMO_SESSION_ID)');

          // Expected: bridge polling loop should NOT be the primary source.
          // On unfixed code this is true → test fails, confirming the bug.
          expect(hasBridgePollingLoop).toBe(false);
        },
      ),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// Case B (Seller Inbox): Conversations must come from API as primary source,
// not from buildSeedSessions() / bridge.
//
// On unfixed code the inbox builds sessions from getSessionMessages() and
// only appends non-overlapping API sessions.
// ---------------------------------------------------------------------------
describe('Case B — Seller Inbox: API-first conversation loading', () => {
  const inboxSource = readSource('app/seller/inbox/page.tsx');

  it('should use API data as the PRIMARY session list, not seed data', () => {
    fc.assert(
      fc.property(
        fc.record({
          sellerId: fc.stringMatching(/^seller-[a-z]+-[0-9]{3}$/),
        }),
        () => {
          // On unfixed code, the inbox calls setSessions(buildSeedSessions())
          // FIRST, then appends API sessions that don't overlap with seed IDs.
          // The seed data is the primary source; API is secondary.
          //
          // Expected behavior: API data should be fetched FIRST and used as
          // the primary session list. Seed data should only be fallback.
          //
          // Check: the inbox should NOT filter API sessions by seed IDs.
          // On unfixed code: `apiSessions.filter(s => !seedIds.has(s.id))`
          const filtersApiBySeeds = inboxSource.includes('seedIds.has(s.id)') ||
            inboxSource.includes('!seedIds.has');
          expect(filtersApiBySeeds).toBe(false);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('should NOT use bridge polling (setInterval + getSessionMessages) as primary message source', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          // On unfixed code, the inbox has a setInterval that polls
          // getSessionMessages(DEMO_SESSION_ID) every 1.5s.
          const hasBridgePollingLoop =
            inboxSource.includes('setInterval') &&
            inboxSource.includes('getSessionMessages(DEMO_SESSION_ID)');

          expect(hasBridgePollingLoop).toBe(false);
        },
      ),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// Case C (Duplicate Messages): Messages with bridge ID `cust-{timestamp}`
// and backend ID `msg-uuid` for the same logical content must deduplicate
// to exactly one entry.
//
// On unfixed code, dedup is by messageId only — two different IDs for the
// same message pass through.
// ---------------------------------------------------------------------------
describe('Case C — Duplicate Messages: content-based deduplication', () => {
  it('should deduplicate messages with different IDs but same content and timestamp', () => {
    fc.assert(
      fc.property(
        fc.record({
          timestamp: fc.integer({ min: 1700000000000, max: 1800000000000 }),
          content: fc.string({ minLength: 1, maxLength: 200 }),
          uuid: fc.uuid(),
        }),
        ({ timestamp, content, uuid }) => {
          const bridgeMsg = {
            messageId: `cust-${timestamp}`,
            content: { body: content },
            createdAt: new Date(timestamp).toISOString(),
            direction: 'outbound' as const,
          };
          const backendMsg = {
            messageId: `msg-${uuid}`,
            content: { body: content },
            createdAt: new Date(timestamp).toISOString(),
            direction: 'outbound' as const,
          };

          const result = deduplicateMessages([bridgeMsg, backendMsg]);

          // Expected: exactly 1 message (same logical content + timestamp)
          // On unfixed code: dedup is by messageId only, so both pass → 2
          expect(result).toHaveLength(1);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Case D (Dashboard Hardcoded): The seller dashboard must make an API call
// to fetch metrics. On unfixed code, the page renders static JSX with
// hardcoded values (₹45,231, 127, etc.) and zero API calls.
// ---------------------------------------------------------------------------
describe('Case D — Dashboard: API data fetching', () => {
  const dashboardSource = readSource('app/seller/page.tsx');

  it('should contain a useEffect that fetches dashboard metrics from an API', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          // On unfixed code, the dashboard has zero useEffect hooks and
          // zero fetch/API calls. It renders hardcoded values.
          const hasUseEffect = dashboardSource.includes('useEffect');
          const hasFetchCall =
            dashboardSource.includes('fetch') ||
            dashboardSource.includes('fetchWithAuth') ||
            dashboardSource.includes('fetchSellerDashboard') ||
            dashboardSource.includes('api.get');

          expect(hasUseEffect && hasFetchCall).toBe(true);
        },
      ),
      { numRuns: 5 },
    );
  });

  it('should NOT have hardcoded metric values as the only data source', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          // On unfixed code, the dashboard has hardcoded "₹45,231" and "127"
          // as static JSX with no state management for metrics.
          const hasHardcodedSales = dashboardSource.includes('₹45,231');
          const hasHardcodedProducts = dashboardSource.includes('"127"');
          const hasState =
            dashboardSource.includes('useState') ||
            dashboardSource.includes('metrics');

          // Expected: either no hardcoded values, or they exist only as
          // fallback with useState-managed state for real data.
          // On unfixed code: hardcoded values exist AND no useState for metrics.
          const isBuggy = hasHardcodedSales && hasHardcodedProducts && !hasState;
          expect(isBuggy).toBe(false);
        },
      ),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// Case E (WebSocket Zombie): When readyState !== OPEN but no close event
// fires, the system must detect this and resume polling.
//
// On unfixed code, the heartbeat timer may not check readyState, and
// useWebSocket only starts polling on connectionState === 'disconnected'.
// ---------------------------------------------------------------------------
describe('Case E — WebSocket Zombie: readyState health check', () => {
  const wsClientSource = readSource('lib/websocket-client.ts');
  const useWsSource = readSource('hooks/useWebSocket.ts');

  it('should check ws.readyState in the heartbeat interval callback to detect zombie connections', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          0, // WebSocket.CONNECTING
          2, // WebSocket.CLOSING
          3, // WebSocket.CLOSED
        ),
        (zombieReadyState) => {
          // The heartbeat callback (inside startHeartbeat) should check
          // readyState and force-close the socket if it's not OPEN.
          // On unfixed code, the heartbeat only sends a ping and starts
          // an ack timer — it does NOT check readyState.

          // Extract the startHeartbeat method definition body (not the call site)
          const heartbeatMatch = wsClientSource.match(
            /private startHeartbeat\(\):\s*void\s*\{([\s\S]*?)(?=\n  private\s)/
          );
          const heartbeatBody = heartbeatMatch ? heartbeatMatch[1] : '';

          // The readyState check must be inside the heartbeat section
          const heartbeatChecksReadyState =
            heartbeatBody.includes('readyState !== WebSocket.OPEN') ||
            heartbeatBody.includes('readyState !== 1');

          expect(heartbeatChecksReadyState).toBe(true);
        },
      ),
      { numRuns: 5 },
    );
  });

  it('should start polling by default on mount, not only when connectionState is disconnected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('connecting', 'reconnecting', 'connected', 'disconnected'),
        (connectionState) => {
          // On unfixed code, useWebSocket only starts polling when
          // newState === 'disconnected'. During 'connecting' or
          // 'reconnecting', polling is NOT active — messages are lost.
          //
          // Expected: polling starts on mount by default and is only
          // suppressed when WS is confirmed connected and healthy.

          // Extract the handleStateChange callback body
          const handleStateBody = useWsSource.match(
            /const handleStateChange = useCallback\(\s*\n?\s*\(newState[^)]*\)\s*=>\s*\{([\s\S]*?)\},\s*\n?\s*\[startPolling/
          );
          const stateBody = handleStateBody ? handleStateBody[1] : '';

          // On unfixed code, startPolling() is ONLY called inside
          // `if (newState === 'disconnected')` — never on mount or
          // for other states like 'connecting' or 'reconnecting'.
          // Expected: startPolling should be called unconditionally
          // (on mount) or for all non-connected states.

          // Check: is startPolling called OUTSIDE the disconnected branch?
          // On unfixed code, the only call is inside the disconnected if-block.
          const lines = stateBody.split('\n');
          let insideDisconnectedBlock = false;
          let startPollingOnlyInDisconnected = true;
          let foundStartPolling = false;

          for (const line of lines) {
            if (line.includes("newState === 'disconnected'")) {
              insideDisconnectedBlock = true;
            }
            if (line.includes('startPolling()')) {
              foundStartPolling = true;
              if (!insideDisconnectedBlock) {
                startPollingOnlyInDisconnected = false;
              }
            }
            // Reset block tracking on closing brace at same indent
            if (insideDisconnectedBlock && line.trim() === '}') {
              insideDisconnectedBlock = false;
            }
          }

          // Also check the useEffect that initializes the WS client —
          // on unfixed code, it does NOT call startPolling on mount.
          const useEffectBody = useWsSource.match(
            /useEffect\(\(\)\s*=>\s*\{[\s\S]*?if \(!token\) return;([\s\S]*?)return \(\) =>/
          );
          const effectBody = useEffectBody ? useEffectBody[1] : '';
          const startsPollingOnMount = effectBody.includes('startPolling');

          // Expected: polling starts on mount OR is called for non-disconnected states
          // On unfixed code: startPolling only in disconnected branch, not on mount
          expect(startsPollingOnMount || !startPollingOnlyInDisconnected).toBe(true);
        },
      ),
      { numRuns: 5 },
    );
  });
});
