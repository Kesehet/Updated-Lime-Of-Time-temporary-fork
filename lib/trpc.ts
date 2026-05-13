import { createTRPCReact } from "@trpc/react-query";
import { httpLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers";
import { getApiBaseUrl } from "@/constants/oauth";
import * as Auth from "@/lib/_core/auth";
import { emitSessionExpired } from "@/lib/_core/session-events";

/**
 * tRPC React client for type-safe API calls.
 *
 * IMPORTANT (tRPC v11): The `transformer` must be inside `httpBatchLink`,
 * NOT at the root createClient level. This ensures client and server
 * use the same serialization format (superjson).
 */
export const trpc = createTRPCReact<AppRouter>();

/**
 * Creates the tRPC client with proper configuration.
 * Call this once in your app's root layout.
 */
export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpLink({
        url: `${getApiBaseUrl()}/api/trpc`,
        // tRPC v11: transformer MUST be inside httpLink, not at root
        // Using httpLink (non-batching) instead of httpBatchLink because React Native's
        // fetch implementation does not support ReadableStream body, which tRPC v11's
        // httpBatchLink requires for its JSONL streaming response format.
        transformer: superjson,
        async headers() {
          const token = await Auth.getSessionToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
        // Custom fetch with a 15-second timeout and credentials.
        // Without a timeout, React Native's fetch can hang indefinitely on slow
        // networks, causing "Failed to fetch" errors that confuse users.
        async fetch(url, options) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
          try {
            const response = await globalThis.fetch(url, {
              ...options,
              credentials: "include",
              signal: controller.signal,
            });
            if (response.status === 401) {
              emitSessionExpired("business"); // tRPC is used by business portal
            }
            return response;
          } catch (err: any) {
            // Convert AbortError to a user-friendly message
            if (err?.name === "AbortError") {
              throw new Error("Request timed out. Please check your internet connection and try again.");
            }
            throw err;
          } finally {
            clearTimeout(timeoutId);
          }
        },
      }),
    ],
  });
}
