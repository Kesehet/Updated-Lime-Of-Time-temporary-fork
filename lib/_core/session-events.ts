/**
 * Global session-expired event system.
 *
 * When any API call receives a 401, it calls `emitSessionExpired()`.
 * The root layout subscribes via `onSessionExpired()` and shows a toast + redirects.
 *
 * This module-level approach avoids React context / hook dependencies in api.ts.
 */

type SessionExpiredHandler = (portal: "business" | "client") => void;

let _handler: SessionExpiredHandler | null = null;
let _lastEmitTime = 0;
const DEBOUNCE_MS = 3000; // prevent multiple toasts from batched 401s

/**
 * Register a handler to be called when a session expires.
 * Call this once from the root layout.
 */
export function onSessionExpired(handler: SessionExpiredHandler): () => void {
  _handler = handler;
  return () => {
    _handler = null;
  };
}

/**
 * Emit a session-expired event.
 * Called from api.ts / trpc.ts when a 401 is received.
 */
export function emitSessionExpired(portal: "business" | "client"): void {
  const now = Date.now();
  if (now - _lastEmitTime < DEBOUNCE_MS) return; // debounce
  _lastEmitTime = now;
  if (_handler) {
    _handler(portal);
  }
}
