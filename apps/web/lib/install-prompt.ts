'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const VISIT_COUNT_KEY = 'vyapargyan_visit_count';

/**
 * Pure function: returns true if the visit count meets the install prompt threshold.
 *
 * **Validates: Requirements 8.5**
 */
export function shouldShowInstallPrompt(visitCount: number): boolean {
  return visitCount >= 3;
}

/**
 * Reads the current visit count from localStorage.
 * Returns 0 if the key is missing or the value is not a valid number.
 */
export function getVisitCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(VISIT_COUNT_KEY);
    if (raw === null) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  } catch {
    return 0;
  }
}

/**
 * Increments the visit count in localStorage and returns the new value.
 */
export function incrementVisitCount(): number {
  const current = getVisitCount();
  const next = current + 1;
  try {
    localStorage.setItem(VISIT_COUNT_KEY, String(next));
  } catch {
    // localStorage may be full or unavailable — silently skip
  }
  return next;
}

/**
 * React hook that manages the PWA install prompt lifecycle.
 *
 * - Increments visit count on mount
 * - Listens for the `beforeinstallprompt` event
 * - Returns `canInstall` (true when count >= 3 AND event was captured)
 * - Returns `promptInstall` to trigger the deferred prompt
 * - Silently skips if `beforeinstallprompt` is not supported (e.g. iOS Safari)
 */
export function useInstallPrompt(): {
  canInstall: boolean;
  promptInstall: () => void;
} {
  const [visitCount, setVisitCount] = useState(0);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [hasPromptEvent, setHasPromptEvent] = useState(false);

  useEffect(() => {
    const count = incrementVisitCount();
    setVisitCount(count);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setHasPromptEvent(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = useCallback(() => {
    const prompt = deferredPromptRef.current;
    if (!prompt) return;
    prompt.prompt();
    deferredPromptRef.current = null;
    setHasPromptEvent(false);
  }, []);

  const canInstall = shouldShowInstallPrompt(visitCount) && hasPromptEvent;

  return { canInstall, promptInstall };
}

/**
 * The `beforeinstallprompt` event type is not in the standard lib.
 * Declare it here for TypeScript support.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
