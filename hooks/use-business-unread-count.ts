import { useState, useEffect, useCallback, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { apiCall } from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Returns the total number of unread client messages in the business owner's inbox.
 * Polls every 30 s while the app is active, and re-fetches whenever the app
 * returns to the foreground.
 *
 * Guards against making API calls when no session token is present (e.g. on
 * first launch before login, or after logout) to avoid "Invalid session cookie"
 * console errors in Expo Go.
 */
export function useBusinessUnreadCount(): number {
  const [count, setCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCount = useCallback(async () => {
    try {
      // Only fetch if we actually have a session token — avoids noisy 401 errors
      // when the tab layout mounts before the user has logged in.
      const token = await Auth.getSessionToken();
      if (!token) return;

      const data = await apiCall<{ count: number }>("/api/business/messages/unread-count");
      setCount(data.count ?? 0);
    } catch {
      // silently fail — badge is non-critical
    }
  }, []);

  // Poll on mount and every 30 s while active
  useEffect(() => {
    fetchCount();
    intervalRef.current = setInterval(fetchCount, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchCount]);

  // Re-fetch when app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") fetchCount();
    });
    return () => sub.remove();
  }, [fetchCount]);

  return count;
}
