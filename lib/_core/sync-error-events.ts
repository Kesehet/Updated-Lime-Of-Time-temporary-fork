/**
 * sync-error-events.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight event bus for DB sync failures.
 *
 * When syncToDb catches an error it calls `emitSyncError()`.
 * The SyncErrorToast component in the root layout subscribes via `onSyncError()`
 * and shows a dismissible toast with a "Retry" button.
 */

type SyncErrorHandler = (actionType: string, retry: () => void) => void;

const handlers: Set<SyncErrorHandler> = new Set();

export function onSyncError(handler: SyncErrorHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function emitSyncError(actionType: string, retry: () => void): void {
  handlers.forEach((h) => {
    try {
      h(actionType, retry);
    } catch {
      // ignore handler errors
    }
  });
}
